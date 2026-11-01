import { randomUUID } from "node:crypto";
import type { VolumeChapterPlan } from "@ai-novel/shared/types/novel";
import { normalizeChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import { buildVolumeChapterBudget, findVolumeChapterBudgetEntry } from "@ai-novel/shared/types/planningScale";

/**
 * Capacity debt carry-over extension.
 *
 * When a planning repair has exhausted its rounds and the only remaining problem is deferred
 * duties/capacity debt with no later writable chapter in the authorized window, the book appends
 * exactly one chapter inside the current volume's chapter budget. The new chapter is a
 * deterministic carry-over plan (no extra model call): its main event, task sheet, scenes and
 * capacity plan all come from the debt items, so every deferred duty lands in a visible
 * `mustDeliver` / scene action. Narrative authorship stays with the normal chapter contract and
 * quality gates; this module never fakes a review pass.
 */

export const DEFAULT_MAX_CAPACITY_AUTO_EXTENSIONS = 2;
export const MAX_CAPACITY_AUTO_EXTENSIONS_LIMIT = 2;

export interface CapacityCarryOverExtensionConfig {
  /** Cumulative auto extensions allowed for one director task. Configurable but capped. */
  maxExtensions?: number;
  targetChapterCount?: number | null;
  volumeOrder?: number | null;
}

export function resolveMaxCapacityAutoExtensions(value?: number): number {
  const minimumOne = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_MAX_CAPACITY_AUTO_EXTENSIONS;
  return Math.min(MAX_CAPACITY_AUTO_EXTENSIONS_LIMIT, Math.max(1, minimumOne));
}

function uniqueTexts(items: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function splitSceneWordCounts(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

export interface BuildCapacityCarryOverChapterInput {
  novelId: string;
  volumeId: string;
  chapterOrder: number;
  targetWordCount: number;
  debtItems: readonly string[];
  /** Last chapter's beat key; keeps the appended plan inside the same volume/beat lane when present. */
  beatKey?: string | null;
  sourceChapter?: Pick<VolumeChapterPlan, "exclusiveEvent" | "endingState" | "nextChapterEntryState" | "conflictLevel" | "revealLevel"> | null;
}

/**
 * Deterministic carry-over chapter plan. The chapter's main event is “receive the deferred duties
 * and turn them into one visible result”; the exact narrative rendering is still decided by the
 * execution-contract prompt and reviewed by the normal gates.
 */
export function buildCapacityCarryOverChapterPlan(input: BuildCapacityCarryOverChapterInput): VolumeChapterPlan {
  const debtItems = uniqueTexts(input.debtItems);
  if (debtItems.length === 0) {
    throw new Error("容量兜底扩章需要至少一条可延期职责。");
  }
  const targetWordCount = Math.max(600, Math.round(Number.isFinite(input.targetWordCount) ? input.targetWordCount : 2800));
  const now = new Date().toISOString();
  const mainEvent = `承接前章延期事项并完成可见兑现：${debtItems.join("；")}`;
  const keyTurn = "承接过程中出现一次明确变化：延期事项兑现后带来新的压力或线索，局面不再停留在原处。";
  const sceneWordCounts = splitSceneWordCounts(targetWordCount, 3);
  const sceneSeeds = [
    { title: "承接与确认", purpose: "把前章延期事项转成本章可执行的第一步", advances: [debtItems[0]] },
    { title: "兑现延期事项", purpose: "逐项执行并让读者看到具体结果", advances: debtItems.slice(1).length ? debtItems.slice(1) : ["完成承接后的第一次可见结果"] },
    { title: "收束与下一章入口", purpose: "让承接结果成为新的压力或新线索", advances: ["把承接结果转成下一章必须面对的新压力或新线索"] },
  ];
  const scenes = sceneSeeds.map((seed, index) => ({
    key: `carry-over-${index + 1}`,
    title: seed.title,
    purpose: seed.purpose,
    mustAdvance: seed.advances.map((item) => `承接前章延期职责：${item}`),
    mustPreserve: ["不重新解释或重复前章已发生事件", "不把已延期职责重新塞回前章"],
    entryState: "前章延期事项已明确，本章从承接处开始。",
    exitState: "延期事项已产生可见结果或新的压力。",
    forbiddenExpansion: ["不提前改写后续卷的终局承诺"],
    targetWordCount: sceneWordCounts[index],
    resistance: "承接过程遇到具体阻力。",
    turn: "出现一次明确变化。",
    emotionalShift: "从被动拖延转为必须处理。",
    readerValue: "读者看到被延期的职责真正落地。",
  }));
  const capacityPlan = {
    coreEvent: mainEvent,
    keyTurn,
    mustDeliver: debtItems,
    deferable: [],
    seedOnly: [],
    estimatedCoreWordCount: Math.max(1200, Math.min(targetWordCount, 2400)),
  };
  const scenePlan = normalizeChapterScenePlan({
    scenes,
    requiredElements: debtItems,
    capacityPlan,
  }, targetWordCount);
  const endingState = "延期事项已兑现，局面出现新的压力。";
  const nextChapterEntryState = "主角带着承接结果面对下一章的新问题。";
  return {
    id: `${input.novelId}-chapter-${randomUUID()}`,
    volumeId: input.volumeId,
    chapterId: null,
    chapterOrder: input.chapterOrder,
    beatKey: input.beatKey ?? null,
    title: `第${input.chapterOrder}章 延期事项的兑现`,
    summary: `承接第${input.chapterOrder - 1}章延期的职责：${debtItems.join("；")}。`,
    protagonistAction: "承接并兑现前章延期职责",
    chapterPayoff: debtItems[0] ?? null,
    purpose: `把前章可延期职责兑现为可见结果，并为下一章留下新压力。`,
    exclusiveEvent: mainEvent,
    endingState,
    nextChapterEntryState,
    conflictLevel: input.sourceChapter?.conflictLevel ?? 45,
    conflictLevelSource: "ai",
    revealLevel: input.sourceChapter?.revealLevel ?? 30,
    targetWordCount,
    mustAvoid: "不要重复前章已发生事件，不要把已延期职责重新塞回前章。",
    taskSheet: `本章只处理前章延期事项：${debtItems.join("；")}。按顺序兑现，每项都要有可见结果，结尾留下新的压力。`,
    sceneCards: JSON.stringify(scenePlan),
    styleContract: null,
    payoffRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface CapacityExtensionBudgetDecision {
  allowed: boolean;
  reason: "allowed" | "invalid_target" | "volume_budget_exhausted" | "book_target_reached" | "order_conflict";
  nextOrder: number;
  volumeBudgetEnd: number | null;
  targetChapterCount: number;
}

/** Same-volume budget gate: only append while the volume and the whole book still have room. */
export function decideCapacityExtensionBudget(input: {
  volumeOrder: number | null | undefined;
  currentLastOrder: number;
  targetChapterCount: number | null | undefined;
  budget?: ReturnType<typeof buildVolumeChapterBudget> | null;
}): CapacityExtensionBudgetDecision {
  const targetChapterCount = Math.max(1, Math.round(
    typeof input.targetChapterCount === "number" && Number.isFinite(input.targetChapterCount)
      ? input.targetChapterCount
      : 100,
  ));
  const nextOrder = Math.round(input.currentLastOrder) + 1;
  if (!Number.isInteger(input.currentLastOrder) || input.currentLastOrder < 1) {
    return { allowed: false, reason: "invalid_target", nextOrder, volumeBudgetEnd: null, targetChapterCount };
  }
  if (nextOrder > targetChapterCount) {
    return { allowed: false, reason: "book_target_reached", nextOrder, volumeBudgetEnd: null, targetChapterCount };
  }
  const budget = input.budget ?? buildVolumeChapterBudget(targetChapterCount);
  const volumeEntry = findVolumeChapterBudgetEntry(budget, input.volumeOrder);
  if (!volumeEntry) {
    return { allowed: false, reason: "volume_budget_exhausted", nextOrder, volumeBudgetEnd: null, targetChapterCount };
  }
  if (nextOrder > volumeEntry.endChapter) {
    return { allowed: false, reason: "volume_budget_exhausted", nextOrder, volumeBudgetEnd: volumeEntry.endChapter, targetChapterCount };
  }
  return { allowed: true, reason: "allowed", nextOrder, volumeBudgetEnd: volumeEntry.endChapter, targetChapterCount };
}

/** Patch the task seed execution range so projections agree with the appended chapter. */
export function buildCapacityExtensionSeedPatch(input: {
  seed: Record<string, unknown>;
  chapterOrder: number;
  extensionCount: number;
  maxExtensions: number;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const autoExecution = input.seed.autoExecution;
  if (autoExecution && typeof autoExecution === "object" && !Array.isArray(autoExecution)) {
    const current = autoExecution as Record<string, unknown>;
    const startOrder = Math.max(1, Math.round(typeof current.startOrder === "number" ? current.startOrder : 1));
    const endOrder = Math.max(startOrder, Math.round(input.chapterOrder));
    const totalChapterCount = endOrder - startOrder + 1;
    const completedChapterCount = Math.max(0, Math.round(
      typeof current.completedChapterCount === "number" ? current.completedChapterCount : 0,
    ));
    patch.autoExecution = {
      ...current,
      endOrder,
      totalChapterCount,
      remainingChapterCount: Math.max(0, totalChapterCount - completedChapterCount),
      scopeLabel: `第 ${startOrder}-${endOrder} 章`,
    };
  }
  const autoExecutionPlan = input.seed.autoExecutionPlan;
  if (autoExecutionPlan && typeof autoExecutionPlan === "object" && !Array.isArray(autoExecutionPlan)) {
    patch.autoExecutionPlan = {
      ...(autoExecutionPlan as Record<string, unknown>),
      endOrder: Math.max(1, Math.round(input.chapterOrder)),
    };
  }
  patch.capacityAutoExtension = {
    count: input.extensionCount,
    maxExtensions: input.maxExtensions,
    lastChapterOrder: Math.round(input.chapterOrder),
    updatedAt: new Date().toISOString(),
  };
  return patch;
}
