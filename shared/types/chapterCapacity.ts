import { z } from "zod";

/**
 * 章节容量计划与容量门禁。
 *
 * 背景：章节执行合同如果只写“必须完成项”清单，模型会把一章能塞十件事当成“信息密度高”，
 * 正文就会变成清单赶任务。这里把“这一章到底承载多少叙事动作”变成结构化字段，并用确定性
 * 预算在写作前拦截：
 *
 * - 每章只允许 1 个主事件（coreEvent）和 1 个明确转折（keyTurn）；
 * - 必须完成项分三档：本章必须兑现（mustDeliver）、可延期（deferable）、只埋不兑现（seedOnly）；
 * - 可延期项不得留在本章的 requiredElements / 场景 mustAdvance 里；
 * - 必须完成项数量与 estimatedCoreWordCount 必须与目标字数容量匹配；
 * - 超容量时由规划修复把可延期职责拆到后续未写章节，而不是压进本章。
 *
 * 判定只使用结构化字段，不扫描正文关键词，也不按题材写死阈值；预算由目标字数推导，
 * 权重集中在 CHAPTER_CAPACITY_POLICY，可在调用侧覆盖。
 */

export const CHAPTER_CAPACITY_POLICY = {
  /** 开场、转折、收尾与过渡的固定叙事开销占目标字数的比例。 */
  narrativeOverheadRatio: 0.28,
  /** 每个“本章必须兑现”动作至少要分到的正文篇幅。 */
  minWordsPerMustDeliver: 560,
  /** 每个“只埋不兑现”线索至少要分到的正文篇幅。 */
  minWordsPerSeedOnly: 240,
  /** 单个场景至少要有这么多字才不算被切碎。 */
  minWordsPerScene: 320,
  /** 单章绝对上限：再多就不属于“一个主事件”。 */
  maxMustDeliverItems: 4,
  maxSeedOnlyItems: 5,
  /** estimatedCoreWordCount 允许相对目标字数上浮的比例。 */
  estimateToleranceRatio: 0.08,
  /** 容量合计允许相对目标字数上浮的比例（给实现细节留一点余量）。 */
  capacityToleranceRatio: 0.04,
} as const;

export interface ChapterCapacityPolicy {
  narrativeOverheadRatio: number;
  minWordsPerMustDeliver: number;
  minWordsPerSeedOnly: number;
  minWordsPerScene: number;
  maxMustDeliverItems: number;
  maxSeedOnlyItems: number;
  estimateToleranceRatio: number;
  capacityToleranceRatio: number;
}

export type ChapterCapacityViolationCode =
  | "capacity_plan_missing"
  | "capacity_core_event_mismatch"
  | "capacity_key_turn_missing"
  | "capacity_key_turn_repeats_event"
  | "capacity_required_elements_unclassified"
  | "capacity_required_elements_missing"
  | "capacity_deferable_leaked"
  | "capacity_deferable_requires_redistribution"
  | "capacity_scene_count_too_few"
  | "capacity_scene_count_too_many"
  | "capacity_must_deliver_missing"
  | "capacity_must_deliver_over_budget"
  | "capacity_seed_only_over_budget"
  | "capacity_word_estimate_over_budget"
  | "capacity_total_words_over_budget";

export interface ChapterCapacityViolation {
  code: ChapterCapacityViolationCode;
  message: string;
  /** 超载或被错误分类的具体条目，供修复提示与日志定位。 */
  items: string[];
}

export interface ChapterCapacityBudget {
  targetWordCount: number;
  narrativeOverheadWords: number;
  mustDeliverLimit: number;
  seedOnlyLimit: number;
  sceneCountLimit: number;
  maxEstimatedWords: number;
  maxTotalNarrativeWords: number;
}

export interface ChapterCapacityDecision {
  passed: boolean;
  /** 现有合同是否携带容量计划；false 表示旧合同，按兼容策略放行。 */
  capacityPlanPresent: boolean;
  /** 需要跨章节拆分（而不是只改本章分类）时为 true。 */
  requiresWindowReplan: boolean;
  budget: ChapterCapacityBudget | null;
  violations: ChapterCapacityViolation[];
  /** 逐条说明本章可延期项及其数量，便于修复/日志展示“为什么这章被拆”。 */
  deferableItems: string[];
  summary: string;
}

const normalizedText = z.preprocess(
  (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).join("；") : value),
  z.string().trim().min(1).max(240),
);
const normalizedRequiredText = z.string().trim().min(1).max(240);
const normalizedCount = z.preprocess(
  (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.round(value));
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return Math.max(1, Math.round(parsed));
    }
    return value;
  },
  z.number().int().positive(),
);
const textList = z.array(z.string().trim().min(1).max(200)).max(20).default([]);

function normalizeObjectAlias(raw: unknown, aliasMap: Record<string, string[]>): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = { ...(raw as Record<string, unknown>) };
  for (const [canonicalKey, aliases] of Object.entries(aliasMap)) {
    if (record[canonicalKey] !== undefined && record[canonicalKey] !== null) continue;
    for (const alias of aliases) {
      if (record[alias] !== undefined && record[alias] !== null) {
        record[canonicalKey] = record[alias];
        break;
      }
    }
  }
  return record;
}

/**
 * 容量计划（模型输出与持久化共用）。
 *
 * `deferable` 表示本章不兑现、交给后续章节承接的职责；它不是本章的必须完成项，
 * 但也不允许被静默删除——规划修复必须把它落到后续章节。
 */
export const chapterCapacityPlanSchema = z.preprocess(
  (raw) => normalizeObjectAlias(raw, {
    coreEvent: ["core_event", "mainEvent", "main_event", "主事件"],
    keyTurn: ["key_turn", "turn", "keyTurningPoint", "明确转折"],
    mustDeliver: ["must_deliver", "mustFulfill", "must_fulfill", "本章必须兑现"],
    deferable: ["deferrable", "deferred", "可延期", "可顺延"],
    seedOnly: ["seed_only", "seedonly", "只埋不兑现", "仅埋设"],
    estimatedCoreWordCount: ["estimated_core_word_count", "estimatedWordCount", "estimated_words", "容量估算"],
  }),
  z.object({
    coreEvent: normalizedText,
    keyTurn: normalizedText,
    mustDeliver: textList,
    deferable: textList,
    seedOnly: textList,
    estimatedCoreWordCount: normalizedCount,
  }),
);

export type ChapterCapacityPlan = z.infer<typeof chapterCapacityPlanSchema>;

/** 旧存档读取：字段缺失/损坏时返回 null，不把旧合同判成不可读。 */
export function normalizeChapterCapacityPlan(raw: unknown): ChapterCapacityPlan | null {
  if (raw === null || raw === undefined) return null;
  const result = chapterCapacityPlanSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function resolveChapterCapacityPolicy(overrides: Partial<ChapterCapacityPolicy> = {}): ChapterCapacityPolicy {
  return { ...CHAPTER_CAPACITY_POLICY, ...overrides };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

/** 由目标字数推导确定性容量预算；不依赖题材、卷号或模型自评。 */
export function resolveChapterCapacityBudget(
  targetWordCount: number,
  options: { policy?: Partial<ChapterCapacityPolicy>; plan?: Pick<ChapterCapacityPlan, "seedOnly" | "mustDeliver"> | null } = {},
): ChapterCapacityBudget {
  const policy = resolveChapterCapacityPolicy(options.policy);
  const target = Math.max(1, Math.round(Number.isFinite(targetWordCount) ? targetWordCount : 2800));
  const narrativeOverheadWords = Math.round(target * policy.narrativeOverheadRatio);
  const seedOnlyCount = options.plan?.seedOnly.length ?? 0;
  const seedOnlyOverhead = seedOnlyCount * policy.minWordsPerSeedOnly;
  const discretionary = Math.max(0, target - narrativeOverheadWords - seedOnlyOverhead);
  const mustDeliverLimit = clamp(
    Math.floor(discretionary / policy.minWordsPerMustDeliver),
    1,
    policy.maxMustDeliverItems,
  );
  const seedOnlyLimit = clamp(
    Math.floor(Math.max(0, target - narrativeOverheadWords - mustDeliverLimit * policy.minWordsPerMustDeliver) / policy.minWordsPerSeedOnly),
    0,
    policy.maxSeedOnlyItems,
  );
  return {
    targetWordCount: target,
    narrativeOverheadWords,
    mustDeliverLimit,
    seedOnlyLimit,
    sceneCountLimit: Math.max(3, Math.floor(target / policy.minWordsPerScene)),
    maxEstimatedWords: Math.round(target * (1 + policy.estimateToleranceRatio)),
    maxTotalNarrativeWords: Math.round(target * (1 + policy.capacityToleranceRatio)),
  };
}

/** 规范化比较：去掉空白、常见标点与引号，用于结构化字段的确定性一致性检查。 */
export function normalizeCapacityComparableText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。；：、！？!?,.;:'"“”‘’（）()《》【】\[\]—\-…·]/g, "")
    .trim();
}

export interface ChapterCapacityEvaluationInput {
  targetWordCount: number;
  exclusiveEvent?: string | null;
  /** 章纲必须完成项（扁平数组，writer 兼容）。 */
  requiredElements?: readonly (string | null | undefined)[] | null;
  sceneMustAdvance?: readonly (string | null | undefined)[] | null;
  sceneCount?: number | null;
  capacityPlan: ChapterCapacityPlan | null | undefined;
  policy?: Partial<ChapterCapacityPolicy>;
}

function isRelatedText(left: string, right: string): boolean {
  const a = normalizeCapacityComparableText(left);
  const b = normalizeCapacityComparableText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

/** 同一套结构化比较规则，供规划修复校验“可延期职责是否在后章有承接”。 */
export function isRelatedCapacityText(left: string | null | undefined, right: string | null | undefined): boolean {
  return isRelatedText(left ?? "", right ?? "");
}

function textAppearsIn(candidate: string, texts: readonly string[]): boolean {
  return texts.some((text) => isRelatedText(candidate, text));
}

/**
 * 确定性容量门禁。只读取结构化字段；capacityPlan 缺失时按旧合同兼容放行
 * （调用方可用 requireCapacityPlan 强制新生成合同必须携带）。
 */
export function evaluateChapterCapacity(
  input: ChapterCapacityEvaluationInput,
  options: { requireCapacityPlan?: boolean; allowDeferable?: boolean } = {},
): ChapterCapacityDecision {
  const policy = resolveChapterCapacityPolicy(input.policy);
  const targetWordCount = Math.max(1, Math.round(input.targetWordCount || 2800));
  const plan = input.capacityPlan ? normalizeChapterCapacityPlan(input.capacityPlan) : null;
  const budget = plan ? resolveChapterCapacityBudget(targetWordCount, { policy, plan }) : null;
  const violations: ChapterCapacityViolation[] = [];

  if (!plan) {
    if (options.requireCapacityPlan) {
      violations.push({
        code: "capacity_plan_missing",
        message: "新生成的章节执行合同缺少容量计划（coreEvent/keyTurn/mustDeliver/deferable/seedOnly），不能进入写作。",
        items: [],
      });
    }
    return {
      passed: violations.length === 0,
      capacityPlanPresent: false,
      requiresWindowReplan: false,
      budget,
      violations,
      deferableItems: [],
      summary: violations.length === 0
        ? "旧合同未携带容量计划，按兼容规则放行。"
        : violations[0].message,
    };
  }

  // 1. 一个主事件：coreEvent 必须与 exclusiveEvent 是同一个事件（允许措辞等同或包含）。
  const exclusiveEvent = input.exclusiveEvent ?? "";
  if (!isRelatedText(plan.coreEvent, exclusiveEvent)) {
    violations.push({
      code: "capacity_core_event_mismatch",
      message: `容量计划主事件与章节独占事件不一致：coreEvent「${plan.coreEvent}」与 exclusiveEvent「${exclusiveEvent}」不是同一件事。`,
      items: [plan.coreEvent],
    });
  }

  // 2. 一个明确转折：keyTurn 必须存在，且不能把主事件复述一遍。
  const normalizedCore = normalizeCapacityComparableText(plan.coreEvent);
  const normalizedTurn = normalizeCapacityComparableText(plan.keyTurn);
  if (!normalizedTurn) {
    violations.push({ code: "capacity_key_turn_missing", message: "容量计划缺少本章明确转折（keyTurn）。", items: [] });
  } else if (normalizedTurn === normalizedCore) {
    violations.push({
      code: "capacity_key_turn_repeats_event",
      message: "keyTurn 不能与 coreEvent 相同；本章必须有且仅有一个明确转折。",
      items: [plan.keyTurn],
    });
  }

  // 3. 必须完成项全部归类；requiredElements 只允许 mustDeliver + seedOnly。
  const requiredElements = (input.requiredElements ?? [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  const sceneAdvance = (input.sceneMustAdvance ?? [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  const unclassified = requiredElements.filter((item) => !textAppearsIn(item, [...plan.mustDeliver, ...plan.seedOnly]));
  if (unclassified.length > 0) {
    violations.push({
      code: "capacity_required_elements_unclassified",
      message: "requiredElements 中存在未归类的必须完成项；所有必须完成项必须归入 mustDeliver / deferable / seedOnly。",
      items: unclassified,
    });
  }
  const missingMustDeliver = plan.mustDeliver.filter((item) => !textAppearsIn(item, requiredElements));
  if (missingMustDeliver.length > 0) {
    violations.push({
      code: "capacity_required_elements_missing",
      message: "mustDeliver 中的必须兑现项没有全部写入 requiredElements。",
      items: missingMustDeliver,
    });
  }
  const leakedDeferable = plan.deferable.filter((item) => (
    textAppearsIn(item, requiredElements) || textAppearsIn(item, sceneAdvance)
  ));
  if (leakedDeferable.length > 0) {
    violations.push({
      code: "capacity_deferable_leaked",
      message: "可延期项仍出现在本章 requiredElements 或场景 mustAdvance 中；必须显式移出本章。",
      items: leakedDeferable,
    });
  }
  // 初次生成的单章合同不允许用 deferable 逃过容量检查：可延期职责必须由规划修复
  // 明确写入后续未写章节，否则等于静默丢失。
  if (options.allowDeferable === false && plan.deferable.length > 0) {
    violations.push({
      code: "capacity_deferable_requires_redistribution",
      message: `本章仍有 ${plan.deferable.length} 条可延期职责没有接手章节；必须由规划修复写入后续未写章节，不能直接放行。`,
      items: plan.deferable,
    });
  }

  // 4. 容量：必须完成项数量、场景数与字数估算都要匹配目标字数。
  if (plan.mustDeliver.length === 0) {
    violations.push({
      code: "capacity_must_deliver_missing",
      message: "容量计划没有给出本章必须兑现项；每章至少要有 1 个由主事件产生的必须兑现结果。",
      items: [],
    });
  }
  if (plan.mustDeliver.length > budget!.mustDeliverLimit) {
    violations.push({
      code: "capacity_must_deliver_over_budget",
      message: `本章必须兑现项 ${plan.mustDeliver.length} 个，超过 ${targetWordCount} 字章节的容量上限 ${budget!.mustDeliverLimit} 个；应把可延期部分拆到后续章节。`,
      items: plan.mustDeliver.slice(budget!.mustDeliverLimit),
    });
  }
  if (plan.seedOnly.length > budget!.seedOnlyLimit) {
    violations.push({
      code: "capacity_seed_only_over_budget",
      message: `本章只埋不兑现项 ${plan.seedOnly.length} 个，超过容量上限 ${budget!.seedOnlyLimit} 个。`,
      items: plan.seedOnly.slice(budget!.seedOnlyLimit),
    });
  }
  const totalNarrativeWords = budget!.narrativeOverheadWords
    + plan.mustDeliver.length * policy.minWordsPerMustDeliver
    + plan.seedOnly.length * policy.minWordsPerSeedOnly;
  if (totalNarrativeWords > budget!.maxTotalNarrativeWords) {
    violations.push({
      code: "capacity_total_words_over_budget",
      message: `按必做项折算至少需要约 ${totalNarrativeWords} 字，超过 ${targetWordCount} 字章节的可用容量约 ${budget!.maxTotalNarrativeWords} 字。`,
      items: [...plan.mustDeliver, ...plan.seedOnly].slice(budget!.mustDeliverLimit),
    });
  }
  if (plan.estimatedCoreWordCount > budget!.maxEstimatedWords) {
    violations.push({
      code: "capacity_word_estimate_over_budget",
      message: `容量估算 ${plan.estimatedCoreWordCount} 字超过本章预算允许的 ${budget!.maxEstimatedWords} 字。`,
      items: [],
    });
  }
  const sceneCount = typeof input.sceneCount === "number" && Number.isFinite(input.sceneCount)
    ? Math.max(1, Math.round(input.sceneCount))
    : null;
  if (sceneCount !== null) {
    if (sceneCount > budget!.sceneCountLimit) {
      violations.push({
        code: "capacity_scene_count_too_many",
        message: `${targetWordCount} 字章节拆成 ${sceneCount} 个场景会被切碎，建议不超过 ${budget!.sceneCountLimit} 个场景。`,
        items: [],
      });
    }
    if (sceneCount < plan.mustDeliver.length) {
      violations.push({
        code: "capacity_scene_count_too_few",
        message: `本章有 ${plan.mustDeliver.length} 个必须兑现项，却只安排了 ${sceneCount} 个场景，无法逐一落地。`,
        items: plan.mustDeliver,
      });
    }
  }

  // 结构性问题（必做项超额、字数容量超额、场景不足）需要跨章节拆分；
  // 分类/一致性/估算问题可以只在本章内修复。
  const windowCodes = new Set<ChapterCapacityViolationCode>([
    "capacity_must_deliver_over_budget",
    "capacity_total_words_over_budget",
    "capacity_scene_count_too_few",
    "capacity_plan_missing",
    "capacity_deferable_requires_redistribution",
  ]);
  const requiresWindowReplan = violations.some((violation) => windowCodes.has(violation.code));
  return {
    passed: violations.length === 0,
    capacityPlanPresent: true,
    requiresWindowReplan,
    budget,
    violations,
    deferableItems: plan.deferable,
    summary: violations.length === 0
      ? `容量通过：1 个主事件、1 个转折；必须兑现 ${plan.mustDeliver.length} 项、只埋 ${plan.seedOnly.length} 项、可延期 ${plan.deferable.length} 项。`
      : violations.map((violation) => violation.message).join("；"),
  };
}

/** 容量结论的简短日志文本（运行日志/修复面板/章节审计共用）。 */export function formatChapterCapacityDecision(decision: ChapterCapacityDecision): string {
  if (!decision.budget) return decision.summary;
  return [
    decision.passed ? "capacity=passed" : "capacity=rejected",
    `words=${decision.budget.targetWordCount}`,
    `mustDeliverLimit=${decision.budget.mustDeliverLimit}`,
    decision.violations.length ? `codes=${decision.violations.map((violation) => violation.code).join(",")}` : "",
    decision.deferableItems.length ? `deferable=${decision.deferableItems.length}` : "",
    decision.requiresWindowReplan ? "needs_window_replan" : "",
  ].filter(Boolean).join(" ");
}
