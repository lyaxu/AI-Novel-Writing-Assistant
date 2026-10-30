import type { ResolvedStyleContext, StyleBinding, StyleProfile, StyleRuleSet } from "@ai-novel/shared/types/styleEngine";
import { prisma } from "../../db/prisma";
import { AntiAiPolicyResolver } from "./AntiAiPolicyResolver";
import { StyleCompiler } from "./StyleCompiler";
import { ensureStyleEngineSeedData } from "./StyleEngineSeedService";
import {
  buildEmptyRuleSet,
  clamp,
  mapStyleProfileRow,
  mergeRuleObjects,
} from "./helpers";
import { sanitizeStyleContextForGeneration } from "./styleGenerationSanitizer";

const TARGET_PRIORITY: Record<StyleBinding["targetType"], number> = {
  novel: 1,
  chapter: 2,
  task: 3,
};

type StyleSectionKey = keyof StyleRuleSet;
type RuleWeightMap = Record<StyleSectionKey, Record<string, number>>;

type StyleProfileRowWithAntiAi = Parameters<typeof mapStyleProfileRow>[0];

type StyleBindingRowLike = {
  id: string;
  styleProfileId: string;
  targetType: StyleBinding["targetType"];
  targetId: string;
  priority: number;
  weight: number;
  enabled: boolean;
  styleProfile: StyleProfileRowWithAntiAi;
  createdAt: Date;
  updatedAt: Date;
};

const BINDING_INCLUDE = {
  styleProfile: {
    include: {
      antiAiBindings: {
        include: { antiAiRule: true },
      },
    },
  },
} as const;

function mapBindingRow(row: StyleBindingRowLike): StyleBinding {
  return {
    id: row.id,
    styleProfileId: row.styleProfileId,
    targetType: row.targetType,
    targetId: row.targetId,
    priority: row.priority,
    weight: row.weight,
    enabled: row.enabled,
    styleProfile: mapStyleProfileRow(row.styleProfile),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildEmptyRuleWeightMap(): RuleWeightMap {
  return {
    narrativeRules: {},
    characterRules: {},
    languageRules: {},
    rhythmRules: {},
  };
}

function assignRuleWeights(
  target: RuleWeightMap,
  section: StyleSectionKey,
  rules: Record<string, unknown>,
  weight: number,
): void {
  for (const [key, value] of Object.entries(rules)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    target[section][key] = weight;
  }
}

/** 生效写法：更具体（书<章<任务）、更高优先级、更新绑定的来源排在最前。 */
function sortMatchedBindings(bindings: StyleBinding[]): StyleBinding[] {
  return bindings.slice().sort((left, right) => {
    const targetDiff = TARGET_PRIORITY[right.targetType] - TARGET_PRIORITY[left.targetType];
    if (targetDiff !== 0) {
      return targetDiff;
    }
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

/**
 * 合并顺序：从宽到具体、从低优先级到高优先级、从旧到新。
 * reduce 里越靠后的来源覆盖前面的同名规则，这样“刚选的写法”一定能压过旧绑定。
 * 旧实现把同优先级的新绑定排在前面，reduce 时旧规则最后写入并覆盖新规则，
 * 造成“界面显示已切换写法，但正文仍按旧写法生成”。
 */
function sortBindingsForMerge(bindings: StyleBinding[]): StyleBinding[] {
  return bindings.slice().sort((left, right) => {
    const targetDiff = TARGET_PRIORITY[left.targetType] - TARGET_PRIORITY[right.targetType];
    if (targetDiff !== 0) {
      return targetDiff;
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
  });
}

type CreateBindingInput = Pick<StyleBinding, "styleProfileId" | "targetType" | "targetId" | "priority" | "weight" | "enabled">;

export class StyleBindingService {
  private readonly compiler = new StyleCompiler();
  private readonly antiAiPolicyResolver = new AntiAiPolicyResolver();

  async listBindings(filter?: Partial<Pick<StyleBinding, "targetType" | "targetId" | "styleProfileId">>): Promise<StyleBinding[]> {
    await ensureStyleEngineSeedData();
    const rows = await prisma.styleBinding.findMany({
      where: {
        targetType: filter?.targetType,
        targetId: filter?.targetId,
        styleProfileId: filter?.styleProfileId,
      },
      include: BINDING_INCLUDE,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });

    return rows.map((row) => mapBindingRow(row as unknown as StyleBindingRowLike));
  }

  async createBinding(input: CreateBindingInput): Promise<StyleBinding> {
    const normalizedInput = await this.normalizeBindingPriority(input);
    if (normalizedInput.existingBindingId) {
      const current = await prisma.styleBinding.findUnique({
        where: { id: normalizedInput.existingBindingId },
        include: BINDING_INCLUDE,
      });
      if (current) {
        return mapBindingRow(current as unknown as StyleBindingRowLike);
      }
    }
    const row = await prisma.styleBinding.create({
      data: normalizedInput.data,
      include: BINDING_INCLUDE,
    });

    return mapBindingRow(row as unknown as StyleBindingRowLike);
  }

  /**
   * 用户从“本书默认写法”里再选一套时，旧接口固定传 priority=1。
   * 如果直接落库，两套写法同优先级，旧规则仍会压过新规则，看起来像“选了没生效”。
   * 这里统一让新绑定排在已有绑定之前；同一套写法重复绑定则提升原绑定，不重复创建。
   */
  private async normalizeBindingPriority(input: CreateBindingInput): Promise<{
    data: CreateBindingInput;
    existingBindingId?: string;
  }> {
    if (input.targetType !== "novel" && input.targetType !== "chapter") {
      return { data: input };
    }
    const existing = await prisma.styleBinding.findMany({
      where: {
        targetType: input.targetType,
        targetId: input.targetId,
        enabled: true,
      },
      select: { id: true, styleProfileId: true, priority: true },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });
    if (existing.length === 0) {
      return { data: input };
    }
    const maxPriority = Math.max(...existing.map((binding) => binding.priority));
    const sameProfile = existing.find((binding) => binding.styleProfileId === input.styleProfileId);
    if (sameProfile) {
      if (sameProfile.priority >= maxPriority) {
        return { data: input, existingBindingId: sameProfile.id };
      }
      await prisma.styleBinding.update({
        where: { id: sameProfile.id },
        data: { priority: maxPriority + 1 },
      });
      return { data: input, existingBindingId: sameProfile.id };
    }
    if (input.priority > maxPriority) {
      return { data: input };
    }
    return { data: { ...input, priority: maxPriority + 1 } };
  }

  async deleteBinding(id: string): Promise<void> {
    await prisma.styleBinding.delete({ where: { id } });
  }

  async resolveForGeneration(input: {
    novelId: string;
    chapterId?: string;
    taskStyleProfileId?: string;
  }): Promise<ResolvedStyleContext> {
    await ensureStyleEngineSeedData();

    const bindings = await prisma.styleBinding.findMany({
      where: {
        enabled: true,
        OR: [
          { targetType: "novel", targetId: input.novelId },
          ...(input.chapterId ? [{ targetType: "chapter" as const, targetId: input.chapterId }] : []),
        ],
      },
      include: {
        styleProfile: {
          include: {
            antiAiBindings: {
              where: { enabled: true },
              include: { antiAiRule: true },
            },
          },
        },
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });

    const matchedBindings: StyleBinding[] = bindings.map((row) => mapBindingRow(row as unknown as StyleBindingRowLike));

    if (input.taskStyleProfileId) {
      const profileRow = await prisma.styleProfile.findUnique({
        where: { id: input.taskStyleProfileId },
        include: {
          antiAiBindings: {
            where: { enabled: true },
            include: { antiAiRule: true },
          },
        },
      });

      if (profileRow) {
        matchedBindings.push({
          id: `task_${profileRow.id}`,
          styleProfileId: profileRow.id,
          targetType: "task",
          targetId: input.chapterId ?? input.novelId,
          priority: 999,
          weight: 1,
          enabled: true,
          styleProfile: mapStyleProfileRow(profileRow as unknown as StyleProfileRowWithAntiAi),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const ordered = sortBindingsForMerge(matchedBindings);
    const effectiveBinding = sortMatchedBindings(matchedBindings)[0] ?? null;
    const sourceTargets = Array.from(new Set(ordered.map((binding) => binding.targetType)));
    const sourceLabels = sourceTargets.map((targetType) => targetType.toUpperCase());
    const antiAiPolicy = await this.antiAiPolicyResolver.resolveFromBindings({
      matchedBindings,
      effectiveStyleProfileId: effectiveBinding?.styleProfileId ?? null,
    });
    const baselineRules = antiAiPolicy.globalBaselineRules.map((item) => item.rule);

    if (matchedBindings.length === 0) {
      if (baselineRules.length === 0) {
        return sanitizeStyleContextForGeneration({
          matchedBindings: [],
          compiledBlocks: null,
          effectiveStyleProfileId: null,
          taskStyleProfileId: input.taskStyleProfileId?.trim() || null,
          activeSourceTargets: [],
          activeSourceLabels: [],
          maturity: "summary_only",
          usesGlobalAntiAiBaseline: false,
          globalAntiAiRuleIds: [],
          styleAntiAiRuleIds: [],
        });
      }

      const compiledBlocks = this.compiler.compile({
        styleProfile: buildEmptyRuleSet(),
        antiAiRules: baselineRules,
        weight: 1,
        appliedRuleIds: baselineRules.map((rule) => rule.id),
        taskStyleProfileId: input.taskStyleProfileId?.trim() || null,
        activeSourceTargets: [],
        activeSourceLabels: ["GLOBAL_BASELINE"],
        usesGlobalAntiAiBaseline: true,
        globalAntiAiRuleIds: baselineRules.map((rule) => rule.id),
        styleAntiAiRuleIds: [],
      });

      return sanitizeStyleContextForGeneration({
        matchedBindings: [],
        compiledBlocks,
        effectiveStyleProfileId: null,
        taskStyleProfileId: input.taskStyleProfileId?.trim() || null,
        activeSourceTargets: [],
        activeSourceLabels: ["GLOBAL_BASELINE"],
        maturity: compiledBlocks.contract.meta.maturity,
        usesGlobalAntiAiBaseline: true,
        globalAntiAiRuleIds: baselineRules.map((rule) => rule.id),
        styleAntiAiRuleIds: [],
      });
    }

    const mergedRules = ordered.reduce<StyleRuleSet>((acc, binding) => {
      const profile = binding.styleProfile as StyleProfile | undefined;
      if (!profile) {
        return acc;
      }
      return {
        narrativeRules: mergeRuleObjects(acc.narrativeRules, profile.narrativeRules),
        characterRules: mergeRuleObjects(acc.characterRules, profile.characterRules),
        languageRules: mergeRuleObjects(acc.languageRules, profile.languageRules),
        rhythmRules: mergeRuleObjects(acc.rhythmRules, profile.rhythmRules),
      };
    }, buildEmptyRuleSet());

    const sectionWeights = ordered.reduce<RuleWeightMap>((acc, binding) => {
      const profile = binding.styleProfile as StyleProfile | undefined;
      if (!profile) {
        return acc;
      }
      assignRuleWeights(acc, "narrativeRules", profile.narrativeRules, binding.weight);
      assignRuleWeights(acc, "characterRules", profile.characterRules, binding.weight);
      assignRuleWeights(acc, "languageRules", profile.languageRules, binding.weight);
      assignRuleWeights(acc, "rhythmRules", profile.rhythmRules, binding.weight);
      return acc;
    }, buildEmptyRuleWeightMap());

    const styleSpecificRules = antiAiPolicy.styleSpecificRules.map((item) => item.rule);
    const styleSpecificWeights = new Map(antiAiPolicy.styleSpecificRules.map((item) => [item.rule.id, item.weight]));
    const combinedAntiAiRules = antiAiPolicy.effectiveRules.map((item) => item.rule);
    const combinedRuleWeights = combinedAntiAiRules.reduce<Record<string, number>>((acc, rule) => {
      if (styleSpecificWeights.has(rule.id)) {
        acc[rule.id] = styleSpecificWeights.get(rule.id)!;
      } else {
        acc[rule.id] = 1;
      }
      return acc;
    }, {});

    const totalSpecificity = ordered.reduce((sum, item) => sum + TARGET_PRIORITY[item.targetType], 0);
    const weightedStrength = ordered.reduce(
      (sum, item) => sum + (item.weight * TARGET_PRIORITY[item.targetType]),
      0,
    );
    const mergedWeight = clamp(
      totalSpecificity > 0 ? weightedStrength / totalSpecificity : 1,
      0.3,
      1,
    );

    const compiledBlocks = this.compiler.compile({
      styleProfile: mergedRules,
      antiAiRules: combinedAntiAiRules,
      weight: mergedWeight,
      appliedRuleIds: combinedAntiAiRules.map((rule) => rule.id),
      bindingSummaries: ordered.map((binding) => ({
        styleProfileId: binding.styleProfileId,
        styleProfileName: binding.styleProfile?.name ?? null,
        targetType: binding.targetType,
        priority: binding.priority,
        weight: binding.weight,
      })),
      sectionWeights,
      antiAiRuleWeights: combinedRuleWeights,
      effectiveStyleProfileId: effectiveBinding?.styleProfileId ?? null,
      taskStyleProfileId: input.taskStyleProfileId?.trim() || null,
      activeSourceTargets: sourceTargets,
      activeSourceLabels: sourceLabels,
      usesGlobalAntiAiBaseline: baselineRules.length > 0,
      globalAntiAiRuleIds: baselineRules.map((rule) => rule.id),
      styleAntiAiRuleIds: styleSpecificRules.map((rule) => rule.id),
    });

    return sanitizeStyleContextForGeneration({
      matchedBindings: sortMatchedBindings(matchedBindings),
      compiledBlocks,
      effectiveStyleProfileId: effectiveBinding?.styleProfileId ?? null,
      taskStyleProfileId: input.taskStyleProfileId?.trim() || null,
      activeSourceTargets: sourceTargets,
      activeSourceLabels: sourceLabels,
      maturity: compiledBlocks.contract.meta.maturity,
      usesGlobalAntiAiBaseline: baselineRules.length > 0,
      globalAntiAiRuleIds: baselineRules.map((rule) => rule.id),
      styleAntiAiRuleIds: styleSpecificRules.map((rule) => rule.id),
    });
  }
}
