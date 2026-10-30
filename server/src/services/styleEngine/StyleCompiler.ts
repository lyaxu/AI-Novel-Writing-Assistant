import type {
  AntiAiRule,
  CompiledStylePromptBlocks,
  StyleBinding,
  StyleContract,
  StyleContractMaturity,
  StyleContractSection,
  StyleContractSectionKey,
  StyleProfile,
  StyleRuleSet,
} from "@ai-novel/shared/types/styleEngine";
import { STYLE_ENGINE_COMPATIBILITY_FIELDS } from "@ai-novel/shared/types/styleEngine";
import {
  STYLE_CONTRACT_EXECUTION_LINE,
  STYLE_CONTRACT_SECTION_TITLES,
  renderStyleRuleLines,
  renderStyleSelfCheckLines,
} from "./contract/styleRuleText";
import { clamp } from "./helpers";

type StyleSectionKey = keyof StyleRuleSet;
type StyleRuleSectionKey = "narrative" | "character" | "language" | "rhythm";

const STYLE_RULE_SECTION_BY_CONTRACT_SECTION: Record<StyleRuleSectionKey, StyleSectionKey> = {
  narrative: "narrativeRules",
  character: "characterRules",
  language: "languageRules",
  rhythm: "rhythmRules",
};

interface BindingSummary {
  styleProfileId: string;
  styleProfileName?: string | null;
  targetType: StyleBinding["targetType"];
  priority: number;
  weight: number;
}

interface CompileStyleInput {
  styleProfile: Pick<StyleProfile, "narrativeRules" | "characterRules" | "languageRules" | "rhythmRules">;
  antiAiRules: AntiAiRule[];
  weight?: number;
  appliedRuleIds?: string[];
  outputInstruction?: string;
  bindingSummaries?: BindingSummary[];
  sectionWeights?: Partial<Record<StyleSectionKey, Record<string, number>>>;
  antiAiRuleWeights?: Record<string, number>;
  effectiveStyleProfileId?: string | null;
  taskStyleProfileId?: string | null;
  activeSourceTargets?: StyleBinding["targetType"][];
  activeSourceLabels?: string[];
  writerIncludedSections?: StyleContractSectionKey[];
  plannerIncludedSections?: StyleContractSectionKey[];
  droppedSections?: StyleContractSectionKey[];
  usesGlobalAntiAiBaseline?: boolean;
  globalAntiAiRuleIds?: string[];
  styleAntiAiRuleIds?: string[];
}

const TARGET_TYPE_LABELS: Record<StyleBinding["targetType"], string> = {
  novel: "书级",
  chapter: "章节级",
  task: "任务级",
};

function resolveAntiAiVerb(weight: number, type: AntiAiRule["type"]): string {
  if (type === "encourage") {
    if (weight >= 0.85) {
      return "优先";
    }
    if (weight >= 0.65) {
      return "鼓励";
    }
    return "自然使用";
  }

  if (type === "forbidden") {
    if (weight >= 0.85) {
      return "禁止";
    }
    if (weight >= 0.65) {
      return "避免";
    }
    return "尽量避开";
  }

  if (weight >= 0.85) {
    return "重点警惕";
  }
  if (weight >= 0.65) {
    return "警惕";
  }
  return "留意";
}

function renderBindingContext(summaries: BindingSummary[] | undefined): string {
  if (!summaries?.length) {
    return "";
  }

  const lines = summaries.map((binding, index) => {
    const targetLabel = TARGET_TYPE_LABELS[binding.targetType];
    const profileLabel = binding.styleProfileName?.trim() || binding.styleProfileId;
    const suffix = index === summaries.length - 1 ? " ← 最高优先级" : "";
    return `${index + 1}. ${targetLabel} → ${profileLabel}（优先级 ${binding.priority}，权重 ${binding.weight.toFixed(2)}）${suffix}`;
  });

  return [
    "写法来源（从宽到具体，越靠后优先级越高）：",
    ...lines,
    "继承规则：同一规则以更具体来源为准。",
  ].join("\n");
}

function compactText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function hasStructuredRuleContent(rules: Record<string, unknown>): boolean {
  return Object.entries(rules).some(([key, value]) => {
    if (key === "summary") {
      return false;
    }
    if (value == null || value === "") {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return true;
  });
}

function renderObjectRules(
  sectionKey: StyleRuleSectionKey,
  rules: Record<string, unknown>,
  defaultWeight: number,
  sectionWeightMap?: Record<string, number>,
): string[] {
  return renderStyleRuleLines({
    section: sectionKey,
    rules,
    weight: defaultWeight,
    fieldWeights: sectionWeightMap,
    compatibilityFields: STYLE_ENGINE_COMPATIBILITY_FIELDS[STYLE_RULE_SECTION_BY_CONTRACT_SECTION[sectionKey]],
  });
}

function compileAntiAiRuleLines(
  rules: AntiAiRule[],
  defaultWeight: number,
  ruleWeightMap?: Record<string, number>,
): string[] {
  if (rules.length === 0) {
    return [];
  }

  const grouped: Record<AntiAiRule["type"], string[]> = {
    forbidden: [],
    risk: [],
    encourage: [],
  };

  for (const rule of rules) {
    const weight = clamp(ruleWeightMap?.[rule.id] ?? defaultWeight, 0.3, 1);
    const instruction = rule.promptInstruction?.trim() || rule.description;
    grouped[rule.type].push(`- ${resolveAntiAiVerb(weight, rule.type)}：${instruction}`);
  }

  return [
    ...(grouped.forbidden.length > 0 ? ["禁止项：", ...grouped.forbidden] : []),
    ...(grouped.risk.length > 0 ? ["风险项：", ...grouped.risk] : []),
    ...(grouped.encourage.length > 0 ? ["鼓励项：", ...grouped.encourage] : []),
  ];
}

function buildContractSection(input: {
  key: StyleContractSectionKey;
  summary?: string | null;
  lines: string[];
}): StyleContractSection {
  const title = STYLE_CONTRACT_SECTION_TITLES[input.key];
  const summary = compactText(input.summary);
  const text = [`【${title}】`, ...input.lines.filter(Boolean)].join("\n");
  return {
    key: input.key,
    title,
    summary,
    lines: input.lines,
    text,
    hasContent: Boolean(summary || input.lines.length > 0),
  };
}

function resolveContractMaturity(styleProfile: CompileStyleInput["styleProfile"]): StyleContractMaturity {
  return [
    styleProfile.narrativeRules,
    styleProfile.characterRules,
    styleProfile.languageRules,
    styleProfile.rhythmRules,
  ].some((section) => hasStructuredRuleContent(section))
    ? "structured"
    : "summary_only";
}

export class StyleCompiler {
  compile(input: CompileStyleInput): CompiledStylePromptBlocks {
    const weight = clamp(input.weight ?? 1, 0.3, 1);
    const bindingContext = renderBindingContext(input.bindingSummaries);

    const narrative = buildContractSection({
      key: "narrative",
      summary: input.styleProfile.narrativeRules.summary,
      lines: renderObjectRules(
        "narrative",
        input.styleProfile.narrativeRules,
        weight,
        input.sectionWeights?.narrativeRules,
      ),
    });
    const character = buildContractSection({
      key: "character",
      summary: input.styleProfile.characterRules.summary,
      lines: renderObjectRules(
        "character",
        input.styleProfile.characterRules,
        weight,
        input.sectionWeights?.characterRules,
      ),
    });
    const language = buildContractSection({
      key: "language",
      summary: input.styleProfile.languageRules.summary,
      lines: renderObjectRules(
        "language",
        input.styleProfile.languageRules,
        weight,
        input.sectionWeights?.languageRules,
      ),
    });
    const rhythm = buildContractSection({
      key: "rhythm",
      summary: input.styleProfile.rhythmRules.summary,
      lines: renderObjectRules(
        "rhythm",
        input.styleProfile.rhythmRules,
        weight,
        input.sectionWeights?.rhythmRules,
      ),
    });
    const antiAi = buildContractSection({
      key: "antiAi",
      lines: compileAntiAiRuleLines(input.antiAiRules, weight, input.antiAiRuleWeights),
    });
    const selfCheck = buildContractSection({
      key: "selfCheck",
      lines: renderStyleSelfCheckLines({ styleProfile: input.styleProfile }),
    });

    const contract: StyleContract = {
      narrative,
      character,
      language,
      rhythm,
      antiAi,
      selfCheck,
      meta: {
        effectiveStyleProfileId: input.effectiveStyleProfileId ?? null,
        taskStyleProfileId: input.taskStyleProfileId ?? null,
        activeSourceTargets: input.activeSourceTargets ?? [],
        activeSourceLabels: input.activeSourceLabels ?? [],
        writerIncludedSections: input.writerIncludedSections ?? ["narrative", "character", "language", "rhythm", "antiAi", "selfCheck"],
        plannerIncludedSections: input.plannerIncludedSections ?? ["narrative", "character", "language", "antiAi"],
        droppedSections: input.droppedSections ?? [],
        maturity: resolveContractMaturity(input.styleProfile),
        usesGlobalAntiAiBaseline: input.usesGlobalAntiAiBaseline ?? false,
        globalAntiAiRuleIds: input.globalAntiAiRuleIds ?? [],
        styleAntiAiRuleIds: input.styleAntiAiRuleIds ?? [],
      },
    };

    const style = [
      "写作风格要求（按以下合同执行）：",
      narrative.text,
      language.text,
      rhythm.text,
      STYLE_CONTRACT_EXECUTION_LINE,
    ].filter(Boolean).join("\n\n");

    const output = input.outputInstruction
      ?? [
        "输出要求：",
        "只输出最终小说正文。",
        "不要解释规则，不要输出提纲，不要加元叙述。",
        weight >= 0.85
          ? "约束冲突时，优先服从当前写法合同与反 AI 底线。"
          : "自然运用写法合同，不要像在背诵规则。",
      ].join("\n");

    return {
      context: bindingContext,
      style,
      character: character.text,
      antiAi: antiAi.text,
      output,
      selfCheck: selfCheck.text,
      contract,
      mergedRules: {
        narrativeRules: input.styleProfile.narrativeRules,
        characterRules: input.styleProfile.characterRules,
        languageRules: input.styleProfile.languageRules,
        rhythmRules: input.styleProfile.rhythmRules,
      } satisfies StyleRuleSet,
      appliedRuleIds: input.appliedRuleIds ?? input.antiAiRules.map((rule) => rule.id),
    };
  }
}
