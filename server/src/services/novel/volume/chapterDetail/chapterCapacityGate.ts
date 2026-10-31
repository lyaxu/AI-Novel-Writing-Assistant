import { parseChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import {
  evaluateChapterCapacity,
  normalizeChapterCapacityPlan,
  type ChapterCapacityDecision,
  type ChapterCapacityPlan,
} from "@ai-novel/shared/types/chapterCapacity";
import type {
  ChapterExecutionContractQualityCandidate,
  ChapterTaskSheetQualityIssue,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";

/**
 * 章节容量门禁的适配层：把执行合同候选（可能来自模型输出、持久化 sceneCards 或修复建议）
 * 统一成容量评估需要的结构化字段。判定本身在 shared/types/chapterCapacity 中，不读正文。
 */

export interface ChapterCapacityCandidateLike {
  targetWordCount?: number | null;
  exclusiveEvent?: string | null;
  requiredElements?: readonly (string | null | undefined)[] | null;
  sceneCards?: string | null;
  capacityPlan?: ChapterCapacityPlan | null | unknown;
}

export function resolveCandidateCapacityPlan(
  candidate: ChapterCapacityCandidateLike,
): ChapterCapacityPlan | null {
  const fromField = normalizeChapterCapacityPlan(candidate.capacityPlan);
  if (fromField) return fromField;
  const scenePlan = parseChapterScenePlan(candidate.sceneCards, {
    targetWordCount: candidate.targetWordCount ?? undefined,
  });
  return normalizeChapterCapacityPlan(scenePlan?.capacityPlan);
}

export function evaluateCandidateCapacity(
  candidate: ChapterCapacityCandidateLike,
  options: { requireCapacityPlan?: boolean; allowDeferable?: boolean } = {},
): ChapterCapacityDecision {
  const scenePlan = parseChapterScenePlan(candidate.sceneCards, {
    targetWordCount: candidate.targetWordCount ?? undefined,
  });
  return evaluateChapterCapacity({
    targetWordCount: candidate.targetWordCount ?? scenePlan?.targetWordCount ?? 2800,
    exclusiveEvent: candidate.exclusiveEvent ?? null,
    requiredElements: scenePlan?.requiredElements ?? candidate.requiredElements ?? [],
    sceneMustAdvance: scenePlan?.scenes.flatMap((scene) => scene.mustAdvance) ?? [],
    sceneCount: scenePlan?.scenes.length ?? null,
    capacityPlan: resolveCandidateCapacityPlan(candidate),
  }, options);
}

/** 把确定性容量结论映射成现有质量门禁的 issue / repair guidance 结构。 */
export function buildCapacityGateIssues(decision: ChapterCapacityDecision): {
  issues: ChapterTaskSheetQualityIssue[];
  repairGuidance: string[];
} {
  const issues: ChapterTaskSheetQualityIssue[] = decision.violations.map((violation) => ({
    id: violation.code,
    severity: "high",
    target: violation.code === "capacity_core_event_mismatch" ? "boundary"
      : violation.code.startsWith("capacity_scene_count") ? "scene_cards"
        : "semantic",
    summary: violation.message,
    repairHint: violationMessageRepairHint(violation.code, violation.items),
  }));
  return {
    issues,
    repairGuidance: issues.map((issue) => issue.repairHint),
  };
}

function violationMessageRepairHint(code: string, items: readonly string[]): string {
  const itemList = items.slice(0, 4).join("；");
  const decorated = itemList ? `涉及：${itemList}。` : "";
  switch (code) {
    case "capacity_plan_missing":
      return "重新生成完整容量计划：一个 coreEvent、一个 keyTurn，并把必须完成项分成 mustDeliver / deferable / seedOnly。";
    case "capacity_core_event_mismatch":
      return "coreEvent 必须与本章 exclusiveEvent 是同一个事件；若实际主事件不同，先调整独占事件再重新归类。";
    case "capacity_key_turn_missing":
    case "capacity_key_turn_repeats_event":
      return "给本章补一个只发生一次的明确转折（keyTurn），不能复述主事件或堆多个转折。";
    case "capacity_required_elements_unclassified":
      return `${decorated}把清单中的每一项归入 mustDeliver / deferable / seedOnly，requiredElements 只保留本章必须兑现项与只埋线索。`;
    case "capacity_required_elements_missing":
      return `${decorated}必须兑现项必须全部写入 requiredElements，不能只写在容量计划里。`;
    case "capacity_deferable_leaked":
      return `${decorated}把可延期项从 requiredElements 和场景 mustAdvance 中移出，只保留在容量计划的 deferable 里。`;
    case "capacity_deferable_requires_redistribution":
      return `${decorated}这些可延期职责必须在规划修复中写入后续未写章节的 requiredElements/场景卡，不能没有承接就放行本章。`;
    case "capacity_must_deliver_missing":
      return "每章至少要有 1 个本章必须兑现项；把主事件产生的可见结果写入 mustDeliver 与 requiredElements。";
    case "capacity_must_deliver_over_budget":
      return `${decorated}超过本章容量；把超出部分拆到相邻未写章节，或删除不属于本章主事件的职责，不能压进本章。`;
    case "capacity_scene_count_too_few":
      return `${decorated}为每个必须兑现项安排可执行场景，或把部分职责拆到后续章节。`;
    case "capacity_scene_count_too_many":
      return "减少场景数并合并同类动作，避免 2800 字章节被切成碎片。";
    case "capacity_seed_only_over_budget":
      return "减少本章只埋不兑现的线索数量，把次要线索留到后续章节。";
    case "capacity_total_words_over_budget":
    case "capacity_word_estimate_over_budget":
      return "按目标字数重估容量：压缩本章职责或把可延期/不必兑现部分拆到后续未写章节。";
    default:
      return "按容量预算重新安排本章职责。";
  }
}

/** 生成失败反馈里的容量摘要（中文，供模型修复）。 */
export function formatCapacityFeedback(decision: ChapterCapacityDecision): string {
  const lines = decision.violations.map((violation) => {
    const items = violation.items.length ? `（${violation.items.slice(0, 6).join("；")}）` : "";
    return `- ${violation.code}：${violation.message}${items}`;
  });
  return [
    "章节容量门禁未通过：",
    ...lines,
    "修复要求：本章只保留一个主事件和一个明确转折；把超出容量的职责拆到允许窗口内后续未写章节；可延期项不得留在本章 requiredElements/sceneCards 的必须完成动作里；每条被拆出的职责都必须在后章有实际承接，不能删除或静默丢失。",
  ].join("\n");
}

export function candidateFromPersistedChapter(input: {
  novelId: string;
  volumeId?: string | null;
  chapterId: string;
  chapterOrder: number;
  title: string;
  exclusiveEvent?: string | null;
  targetWordCount?: number | null;
  requiredElements?: string[] | null;
  sceneCards?: string | null;
}): ChapterCapacityCandidateLike & {
  novelId: string; chapterId: string; chapterOrder: number; title: string; volumeId?: string | null;
} {
  return {
    novelId: input.novelId,
    volumeId: input.volumeId ?? null,
    chapterId: input.chapterId,
    chapterOrder: input.chapterOrder,
    title: input.title,
    exclusiveEvent: input.exclusiveEvent ?? null,
    targetWordCount: input.targetWordCount ?? null,
    requiredElements: input.requiredElements ?? null,
    sceneCards: input.sceneCards ?? null,
  };
}
