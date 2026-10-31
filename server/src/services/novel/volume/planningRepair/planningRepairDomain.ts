import { z } from "zod";
import { preserveGeneratedContentConstraints } from "../../../../llm/generatedContentSchema";
import type { VolumeChapterPlan, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { normalizeChapterScenePlan, parseChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import {
  chapterCapacityPlanSchema,
  evaluateChapterCapacity,
  isRelatedCapacityText,
  normalizeChapterCapacityPlan,
  type ChapterCapacityPlan,
} from "@ai-novel/shared/types/chapterCapacity";
import { createChapterTaskSheetSchema, stateBoundSceneCardWireSchema } from "../chapterDetail/chapterDetailSchemas";
import { requiredElementRevisionSchema, applyRequiredElementRevisions } from "./domain/requiredElementRevisions";
import { chapterStateClaimsSchema, contextStateClaimsWireSchema } from "@ai-novel/shared/types/novel/sceneCausality";
export { mergeAppliedPlanningRepairRequiredElements } from "./domain/requiredElementRevisions";

const requiredText = z.string().trim().min(1);
const contractText = requiredText.max(240);
const taskSheetShape = createChapterTaskSheetSchema().out.shape;
// Program-owned scalars in a repair suggestion are normalized deterministically: strengths are
// later projected back to the current plan, and scene budgets are projected to the chapter target.
// Doing this in the wire schema prevents a single echoed zero/overflow from discarding the answer.
const clampRepairLevel = (value: unknown) => typeof value === "number" && Number.isFinite(value)
  ? Math.min(100, Math.max(0, Math.round(value))) : value;
const clampRepairWordCount = (value: unknown) => typeof value === "number" && Number.isFinite(value)
  ? Math.max(1, Math.round(value)) : value;
const repairLevelSchema = z.preprocess(clampRepairLevel, z.number().int().min(0).max(100).optional());
const normalizeRepairSceneWordCount = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const normalized = clampRepairWordCount(record.targetWordCount);
  return normalized === record.targetWordCount ? value : { ...record, targetWordCount: normalized };
};

export const planningRepairChangeSchema = z.object({
  chapterId: requiredText,
  // Optional on purpose: a repair only rewrites the title when the title itself is the conflict.
  // Omitting it must mean 'leave the title alone', not 'fail validation'.
  title: requiredText.max(120).optional(),
  summary: requiredText.max(600),
  purpose: contractText,
  exclusiveEvent: contractText,
  endingState: contractText,
  nextChapterEntryState: contractText,
  conflictLevel: repairLevelSchema,
  revealLevel: repairLevelSchema,
  taskSheet: taskSheetShape.taskSheet,
  mustAvoid: contractText,
  payoffRefs: z.array(requiredText.max(160)).max(8),
  sceneCards: z.array(z.preprocess(normalizeRepairSceneWordCount, taskSheetShape.sceneCards.element)),
  stateClaims: chapterStateClaimsSchema.optional(),
  readerExperience: taskSheetShape.readerExperience,
  requiredElementRevisions: z.array(requiredElementRevisionSchema).max(8).optional(),
  // Optional for legacy saved responses; new repairs are prompted to return it. Missing values are
  // projected from the current candidate during apply so an old session cannot lose its capacity
  // classification just by omitting the field.
  capacityPlan: chapterCapacityPlanSchema.optional(),
}).strict();

export const planningRepairOutputSchema = preserveGeneratedContentConstraints(z.object({
  requiresUserDecision: z.boolean(),
  reason: requiredText,
  changes: z.array(planningRepairChangeSchema),
  obligationMoves: z.array(z.object({
    obligation: requiredText,
    fromChapterId: requiredText,
    toChapterId: requiredText,
    action: z.enum(["retain", "merge", "move", "revise"]),
    replacement: requiredText.max(160).optional(),
    reason: requiredText,
  }).strict().superRefine((move, context) => {
    if (move.action === "revise" && !move.replacement) {
      context.addIssue({ code: "custom", path: ["replacement"], message: "Revise requires an explicit replacement reference." });
    }
    if (move.action !== "revise" && move.replacement !== undefined) {
      context.addIssue({ code: "custom", path: ["replacement"], message: "Only revise may replace a reference." });
    }
  })),
}).strict());

export const planningRepairReviewOutputSchema = z.object({
  usable: z.boolean(),
  safeToSync: z.boolean(),
  requiresUserDecision: z.boolean(),
  summary: requiredText,
  issues: z.array(requiredText),
}).strict().superRefine((output, context) => {
  if (output.safeToSync && (!output.usable || output.requiresUserDecision || output.issues.length > 0)) {
    context.addIssue({ code: "custom", path: ["safeToSync"], message: "Unusable, undecided or unresolved repairs cannot be safe to sync." });
  }
});

export const planningRepairWireOutputSchema = preserveGeneratedContentConstraints(planningRepairOutputSchema.extend({
  changes: z.array(planningRepairChangeSchema.extend({
    stateClaims: contextStateClaimsWireSchema,
    sceneCards: z.array(z.preprocess(normalizeRepairSceneWordCount, stateBoundSceneCardWireSchema)).min(3).max(8),
  })),
}));

export type PlanningRepairChange = z.infer<typeof planningRepairChangeSchema>;
export type PlanningRepairOutput = z.infer<typeof planningRepairOutputSchema>;
export type PlanningRepairReviewOutput = z.infer<typeof planningRepairReviewOutputSchema>;

function comparable(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function collectPayoffs(chapters: readonly VolumeChapterPlan[]): Set<string> {
  const refs = new Set<string>();
  for (const chapter of chapters) {
    for (const ref of chapter.payoffRefs) {
      const key = comparable(ref);
      if (key) refs.add(key);
    }
  }
  return refs;
}

type ObligationMove = PlanningRepairOutput["obligationMoves"][number];

function appliedMoves(value: readonly unknown[]): ObligationMove[] {
  return planningRepairOutputSchema.parse({ requiresUserDecision: false, reason: "Persisted obligation ledger",
    changes: [], obligationMoves: value }).obligationMoves;
}
function moveIdentity(move: ObligationMove): string {
  return JSON.stringify([move.action, move.fromChapterId, move.toChapterId,
    comparable(move.obligation), comparable(move.replacement)]);
}

/** Only successfully persisted candidate ledgers may be supplied as prior; never model history. */
export function mergeAppliedPlanningRepairObligations(prior: readonly unknown[], current: readonly ObligationMove[]): ObligationMove[] {
  const merged = new Map<string, ObligationMove>();
  for (const move of [...appliedMoves(prior), ...current]) {
    if (!merged.has(moveIdentity(move))) merged.set(moveIdentity(move), move);
  }
  return [...merged.values()];
}

function appliedRevisionEndpoint(revision: ObligationMove, prior: readonly ObligationMove[], source: VolumeChapterPlan): string | null {
  if (!prior.some(move => moveIdentity(move) === moveIdentity(revision))) return null;
  // Follow only saved same-chapter revisions to the reference that exists in the current
  // candidate. A historical A -> B -> C ledger must not require A or B to reappear.
  let reference = comparable(revision.replacement);
  const visited = new Set<string>([comparable(revision.obligation)]);
  while (reference && !visited.has(reference)) {
    if (source.payoffRefs.some(ref => comparable(ref) === reference)) return reference;
    visited.add(reference);
    const next = prior.filter(move => move.action === "revise" && move.fromChapterId === source.id
      && move.toChapterId === source.id && comparable(move.obligation) === reference);
    if (next.length !== 1) return null;
    reference = comparable(next[0].replacement);
  }
  return null;
}

/**
 * Established conflict/reveal strengths belong to the current plan, not to a repair suggestion.
 * A model often echoes a different scalar in an otherwise valid change; project the established
 * value back before domain validation. The protected-field guard below keeps rejecting direct
 * programmatic attempts, so this only normalizes the accepted wire output.
 */
export function projectPlanningRepairEstablishedStrengths(
  document: VolumePlanDocument,
  volumeId: string,
  output: PlanningRepairOutput,
): PlanningRepairOutput {
  const volume = document.volumes.find((item) => item.id === volumeId);
  if (!volume) return output;
  const byId = new Map(volume.chapters.map((chapter) => [chapter.id, chapter]));
  return {
    ...output,
    changes: output.changes.map((change) => {
      const chapter = byId.get(change.chapterId);
      if (!chapter) return change;
      return {
        ...change,
        ...(chapter.conflictLevel != null ? { conflictLevel: chapter.conflictLevel } : {}),
        ...(chapter.revealLevel != null ? { revealLevel: chapter.revealLevel } : {}),
      };
    }),
  };
}

function apportionSceneWordCounts(counts: number[], target: number): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= target || !counts.length) return counts;
  const values = counts.map((value) => Math.max(1, Math.floor((value * target) / total)));
  let sum = values.reduce((left, value) => left + value, 0);
  // Min-one floors can overshoot on very small scenes; trim the largest allocations first.
  while (sum > target) {
    const index = values.reduce((best, value, at) => (value > values[best] ? at : best), 0);
    if (values[index] <= 1) break;
    values[index] -= 1;
    sum -= 1;
  }
  // Distribute the remaining words by largest fractional remainder.
  const remainders = counts.map((value, index) => ({ index, remainder: (value * target) / total - Math.floor((value * target) / total) }))
    .sort((left, right) => right.remainder - left.remainder);
  for (let cursor = 0; sum < target; cursor = (cursor + 1) % remainders.length) {
    values[remainders[cursor].index] += 1;
    sum += 1;
  }
  return values;
}

/**
 * Scene word counts must fit the chapter's original target. A repair suggestion may redistribute
 * words between scenes but cannot enlarge the chapter, so normalize an over-budget allocation
 * proportionally instead of rejecting the entire otherwise valid repair.
 */
export function projectPlanningRepairSceneBudgets(
  document: VolumePlanDocument,
  volumeId: string,
  output: PlanningRepairOutput,
): PlanningRepairOutput {
  const volume = document.volumes.find((item) => item.id === volumeId);
  if (!volume) return output;
  const byId = new Map(volume.chapters.map((chapter) => [chapter.id, chapter]));
  return {
    ...output,
    changes: output.changes.map((change) => {
      const target = byId.get(change.chapterId)?.targetWordCount;
      if (!Number.isSafeInteger(target) || (target ?? 0) < 1 || !Array.isArray(change.sceneCards) || !change.sceneCards.length) return change;
      const requested = change.sceneCards.reduce((sum, scene) => sum + (Number.isSafeInteger(scene.targetWordCount) ? scene.targetWordCount : 0), 0);
      if (requested <= target!) return change;
      const counts = apportionSceneWordCounts(change.sceneCards.map((scene) => Number.isSafeInteger(scene.targetWordCount) ? scene.targetWordCount : 0), target!);
      return { ...change, sceneCards: change.sceneCards.map((scene, index) => ({ ...scene, targetWordCount: counts[index] })) };
    }),
  };
}

/**
 * The flat writer-compatible list is a projection of the structured classification: only
 * mustDeliver + seedOnly belong here. Deferred duties are therefore removed by construction and
 * must be carried by a later chapter instead of silently disappearing.
 */
function projectRequiredElementsFromCapacityPlan(plan: ChapterCapacityPlan): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of [...plan.mustDeliver, ...plan.seedOnly]) {
    const key = comparable(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= 8) break;
  }
  return result;
}

/**
 * 可延期职责在规划修复窗口内没有可用承接章时，不能整本停在确认，也不能删除职责。
 * 这类条目作为“规划容量质量债”随候选一起持久化，来源章可以继续进入写前流程；
 * 后续章节规划/卷规划会从来源章 capacityPlan.deferable 继续看到它们。
 */
export type PlanningCapacityDebtReason =
  | "no_later_writable_chapter"
  | "later_chapters_over_capacity"
  | "later_chapters_missing_capacity_plan";

export interface PlanningCapacityDebt {
  fromChapterId: string;
  fromChapterOrder: number;
  item: string;
  reason: PlanningCapacityDebtReason;
  /** 窗口内最早的后继未写章节；供后续章节规划/人工复核定位。 */
  suggestedChapterId: string | null;
  suggestedChapterOrder: number | null;
}

const capacityDebtByDocument = new WeakMap<object, PlanningCapacityDebt[]>();

export function getPlanningRepairCapacityDebt(document: object): PlanningCapacityDebt[] {
  return capacityDebtByDocument.get(document) ?? [];
}

const MAX_REQUIRED_ELEMENTS = 8;
const MAX_SCENE_ADVANCE = 8;

function chapterCarriesCapacityDuty(chapter: VolumeChapterPlan, duty: string): boolean {
  const plan = parseChapterScenePlan(chapter.sceneCards, { targetWordCount: chapter.targetWordCount });
  return Boolean(plan && (
    (plan.capacityPlan?.mustDeliver ?? []).some((item) => isRelatedCapacityText(item, duty))
    || plan.requiredElements.some((item) => isRelatedCapacityText(item, duty))
    || plan.scenes.some((scene) => scene.mustAdvance.some((item) => isRelatedCapacityText(item, duty)))
  ));
}

/** 场景动作要能被正文执行，不能只把职责名塞进字段；保留原职责文本便于后续匹配/审计。 */
function formatDeferredDutySceneAction(duty: string): string {
  return `承接前章延期职责：${duty}`;
}

function uniqueCapacityTexts(items: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = comparable(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Deterministically append a deferred duty to one later chapter: capacityPlan.mustDeliver,
 * requiredElements and at least one scene's mustAdvance. Returns null when the chapter cannot
 * represent one more duty without dropping data (field caps) — caller then tries the next chapter.
 */
function supplementChapterWithDeferredDuty(
  chapter: VolumeChapterPlan,
  scenePlan: NonNullable<ReturnType<typeof parseChapterScenePlan>>,
  duty: string,
): { chapter: VolumeChapterPlan; scenePlan: NonNullable<ReturnType<typeof parseChapterScenePlan>> } | null {
  const capacityPlan = scenePlan.capacityPlan;
  if (!capacityPlan) return null;
  const mustDeliver = uniqueCapacityTexts([...capacityPlan.mustDeliver, duty]);
  const requiredElements = uniqueCapacityTexts([...scenePlan.requiredElements, duty]);
  if (requiredElements.length > MAX_REQUIRED_ELEMENTS) return null;
  const scenes = scenePlan.scenes.map((scene) => ({ ...scene, mustAdvance: [...scene.mustAdvance] }));
  const sceneIndex = scenes.findIndex((scene) => scene.mustAdvance.length < MAX_SCENE_ADVANCE);
  if (sceneIndex < 0) return null;
  scenes[sceneIndex].mustAdvance.push(formatDeferredDutySceneAction(duty));
  const effectiveTargetWordCount = chapter.targetWordCount ?? scenePlan.targetWordCount;
  let normalized: NonNullable<ReturnType<typeof parseChapterScenePlan>>;
  try {
    normalized = normalizeChapterScenePlan({
      ...(scenePlan.stateClaims !== undefined ? { stateClaims: scenePlan.stateClaims } : {}),
      scenes,
      readerExperience: scenePlan.readerExperience,
      requiredElements,
      capacityPlan: { ...capacityPlan, mustDeliver },
    }, effectiveTargetWordCount);
  } catch {
    return null;
  }
  if (normalized.requiredElements.length !== requiredElements.length
    || !normalized.capacityPlan
    || normalized.capacityPlan.mustDeliver.length !== mustDeliver.length) {
    // Never accept a projection that silently dropped a duty to fit a schema cap.
    return null;
  }
  const nextChapter: VolumeChapterPlan = {
    ...chapter,
    ...("requiredElements" in chapter ? { requiredElements: normalized.requiredElements } : {}),
    sceneCards: JSON.stringify(normalized),
  };
  return { chapter: nextChapter, scenePlan: normalized };
}

/**
 * Resolve every deferred duty against the allowed repair window:
 * 1. If a later chapter already carries it, keep the existing linkage.
 * 2. Otherwise deterministically write it into the earliest later writable chapter that still
 *    passes the capacity gate (capacityPlan + requiredElements + a scene mustAdvance).
 * 3. If no later chapter can hold it, keep `deferable` on the source and return a planning capacity
 *    debt record. The source may continue; the debt stays visible for later planning.
 */
function resolveRepairDeferableDestinations(
  volume: VolumePlanDocument["volumes"][number],
  chapters: VolumeChapterPlan[],
  allowed: ReadonlySet<string>,
): PlanningCapacityDebt[] {
  const orderById = new Map(volume.chapters.map((chapter) => [chapter.id, chapter.chapterOrder]));
  const changed = chapters
    .filter((chapter) => allowed.has(chapter.id))
    .slice()
    .sort((left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0));
  const debts: PlanningCapacityDebt[] = [];
  for (const source of changed) {
    const sourcePlan = parseChapterScenePlan(source.sceneCards, { targetWordCount: source.targetWordCount });
    const deferable = sourcePlan?.capacityPlan?.deferable ?? [];
    if (!deferable.length) continue;
    const sourceOrder = orderById.get(source.id) ?? 0;
    const laterIds = changed
      .filter((chapter) => chapter.id !== source.id && (orderById.get(chapter.id) ?? 0) > sourceOrder)
      .map((chapter) => chapter.id);
    for (const deferred of uniqueCapacityTexts(deferable)) {
      const sourceDebts = debts.filter((debt) => debt.fromChapterId === source.id);
      if (sourceDebts.some((debt) => isRelatedCapacityText(debt.item, deferred))) continue;
      const alreadyCarried = laterIds.some((id) => {
        const target = chapters.find((chapter) => chapter.id === id);
        return Boolean(target && chapterCarriesCapacityDuty(target, deferred));
      });
      if (alreadyCarried) continue;
      let carried = false;
      let sawWritableTarget = false;
      let sawMissingCapacityPlan = false;
      for (const targetId of laterIds) {
        const targetIndex = chapters.findIndex((chapter) => chapter.id === targetId);
        if (targetIndex < 0) continue;
        const target = chapters[targetIndex];
        const targetPlan = parseChapterScenePlan(target.sceneCards, { targetWordCount: target.targetWordCount });
        if (!targetPlan?.capacityPlan) {
          sawMissingCapacityPlan = true;
          continue;
        }
        sawWritableTarget = true;
        if (chapterCarriesCapacityDuty(target, deferred)) {
          carried = true;
          break;
        }
        const supplemented = supplementChapterWithDeferredDuty(target, targetPlan, deferred);
        if (!supplemented) continue;
        const decision = evaluateChapterCapacity({
          targetWordCount: target.targetWordCount ?? supplemented.scenePlan.targetWordCount,
          exclusiveEvent: target.exclusiveEvent,
          requiredElements: supplemented.scenePlan.requiredElements,
          sceneMustAdvance: supplemented.scenePlan.scenes.flatMap((scene) => scene.mustAdvance),
          sceneCount: supplemented.scenePlan.scenes.length,
          capacityPlan: supplemented.scenePlan.capacityPlan,
        }, { allowDeferable: true });
        if (!decision.passed) continue;
        chapters[targetIndex] = supplemented.chapter;
        carried = true;
        break;
      }
      if (carried) continue;
      const suggested = laterIds
        .map((id) => chapters.find((chapter) => chapter.id === id))
        .find((chapter): chapter is VolumeChapterPlan => Boolean(chapter));
      debts.push({
        fromChapterId: source.id,
        fromChapterOrder: sourceOrder,
        item: deferred,
        reason: sawWritableTarget ? "later_chapters_over_capacity"
          : sawMissingCapacityPlan ? "later_chapters_missing_capacity_plan"
            : "no_later_writable_chapter",
        suggestedChapterId: suggested?.id ?? null,
        suggestedChapterOrder: suggested ? (orderById.get(suggested.id) ?? null) : null,
      });
    }
  }
  return debts;
}

/**
 * Resolve residual deferred duties on an already-saved candidate (resume/review path).
 * The same deterministic fallback runs after applying a repair output; this entry lets a paused
 * session recover without buying another model round.
 */
export function resolvePlanningCandidateCapacityDebt(
  document: VolumePlanDocument,
  volumeId: string,
  allowedIds: readonly string[],
): { document: VolumePlanDocument; capacityDebt: PlanningCapacityDebt[]; changed: boolean } {
  const volume = document.volumes.find((item) => item.id === volumeId);
  if (!volume) return { document, capacityDebt: [], changed: false };
  const allowed = new Set(allowedIds.filter((id) => volume.chapters.some((chapter) => chapter.id === id)));
  const candidate = structuredClone(document);
  const targetVolume = candidate.volumes.find((item) => item.id === volumeId)!;
  const before = JSON.stringify(targetVolume.chapters);
  const capacityDebt = resolveRepairDeferableDestinations(targetVolume, targetVolume.chapters, allowed);
  targetVolume.chapters = targetVolume.chapters.slice();
  const after = JSON.stringify(targetVolume.chapters);
  capacityDebtByDocument.set(candidate, capacityDebt);
  return { document: candidate, capacityDebt, changed: before !== after };
}

/** Pure candidate construction only; aggregate review and persistence belong to the coordinator. */
export function applyPlanningRepairCandidate(
  document: VolumePlanDocument,
  volumeId: string,
  allowedIds: readonly string[],
  output: PlanningRepairOutput,
  previouslyAppliedObligations: readonly unknown[] = [],
  previouslyAppliedRequiredElements: readonly unknown[] = [],
): VolumePlanDocument {
  const parsed = planningRepairOutputSchema.parse(output);
  const priorMoves = appliedMoves(previouslyAppliedObligations);
  if (parsed.requiresUserDecision) {
    throw new Error("Planning repair requires user decision; no candidate can be applied.");
  }
  const allowed = new Set(allowedIds);
  if (!allowed.size || allowed.size !== allowedIds.length || allowedIds.some((id) => !id.trim())) {
    throw new Error("Planning repair requires a nonempty, unique allowed chapter set.");
  }
  const volumes = document.volumes.filter((volume) => volume.id === volumeId);
  if (volumes.length !== 1) throw new Error("Planning repair target volume must exist exactly once.");
  const volume = volumes[0];
  const allChapters = document.volumes.flatMap((item) => item.chapters);
  for (const id of allowed) {
    if (allChapters.filter((chapter) => chapter.id === id).length !== 1
      || !volume.chapters.some((chapter) => chapter.id === id && chapter.volumeId === volumeId)) {
      throw new Error(`Planning repair chapter ${id} is missing, ambiguous or outside the target volume.`);
    }
  }
  const changes = new Map(parsed.changes.map((change) => [change.chapterId, change]));
  if (changes.size !== parsed.changes.length || changes.size !== allowed.size
    || [...changes.keys()].some((id) => !allowed.has(id))) {
    throw new Error("Planning repair changes must update the exact allowed chapter set once, with no outside IDs.");
  }

  const seenMoves = new Set<string>();
  for (const move of parsed.obligationMoves) {
    if (!allowed.has(move.fromChapterId) || !allowed.has(move.toChapterId)) {
      throw new Error("Planning repair obligation move cannot touch readonly chapters.");
    }
    if (((move.action === "retain" || move.action === "revise") && move.fromChapterId !== move.toChapterId)
      || (move.action === "move" && move.fromChapterId === move.toChapterId)) {
      throw new Error("Retain and revise must stay in the same chapter; move must cross chapters; merge may stay in one chapter.");
    }
    const key = JSON.stringify([comparable(move.obligation), move.fromChapterId]);
    if (seenMoves.has(key)) throw new Error("Planning repair has duplicate or conflicting obligation moves.");
    seenMoves.add(key);
  }

  const chapters = volume.chapters.map((chapter): VolumeChapterPlan => {
    const change = changes.get(chapter.id);
    if (!change) return chapter;
    const levels: Record<"conflictLevel" | "revealLevel", number> = { conflictLevel: 0, revealLevel: 0 };
    for (const key of ["conflictLevel", "revealLevel"] as const) {
      const original = chapter[key];
      if (original != null && change[key] !== undefined && change[key] !== original) {
        throw new Error(`Planning repair cannot change the established ${key} for ${chapter.id}.`);
      }
      const value = original ?? change[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error(`Planning repair must supply missing ${key} for ${chapter.id}.`);
      }
      levels[key] = value;
    }
    const target = chapter.targetWordCount;
    // Guard before normalization: a target below scene count cannot be apportioned into positive budgets.
    if (!Number.isSafeInteger(target) || (target ?? 0) < change.sceneCards.length) {
      throw new Error(`Planning repair chapter ${chapter.id} has no valid original word count budget.`);
    }
    if (new Set(change.sceneCards.map((scene) => scene.key)).size !== change.sceneCards.length) {
      throw new Error(`Planning repair chapter ${chapter.id} has duplicate scene keys.`);
    }
    const requestedWords = change.sceneCards.reduce((sum, scene) => sum + scene.targetWordCount, 0);
    if (!Number.isSafeInteger(requestedWords) || requestedWords > target!) {
      throw new Error(`Planning repair chapter ${chapter.id} exceeds its original word count budget.`);
    }
    if (comparable(change.endingState) === comparable(change.nextChapterEntryState)) {
      throw new Error(`Planning repair chapter ${chapter.id} repeats its ending as the next entry state.`);
    }
    // Legacy output preserves the complete minimum-event list. Explicit mappings may correct an
    // obsolete implementation, with mandatory subsequent AI review of the retained narrative duty.
    const existingPlan = parseChapterScenePlan(chapter.sceneCards, { targetWordCount: target });
    if (existingPlan?.stateClaims !== undefined && change.stateClaims === undefined) {
      throw new Error(`Planning repair chapter ${chapter.id} must return its state claims together with the replaced scenes.`);
    }
    const capacityPlan = change.capacityPlan
      ? normalizeChapterCapacityPlan(change.capacityPlan)
      : normalizeChapterCapacityPlan(existingPlan?.capacityPlan);
    // Capacity-era repairs derive the flat writer list from the structured classification, so
    // deferred duties are removed from this chapter by construction; legacy repairs keep using the
    // explicit replacement ledger.
    const requiredElements = change.capacityPlan && capacityPlan
      ? projectRequiredElementsFromCapacityPlan(capacityPlan)
      : applyRequiredElementRevisions({ chapterId: chapter.id,
        elements: existingPlan?.requiredElements ?? [], sceneKeys: change.sceneCards.map(scene => scene.key),
        revisions: change.requiredElementRevisions, previouslyApplied: previouslyAppliedRequiredElements });
    const scenePlan = normalizeChapterScenePlan({
      scenes: change.sceneCards,
      ...(change.stateClaims !== undefined ? { stateClaims: change.stateClaims } : {}),
      readerExperience: change.readerExperience,
      requiredElements,
      ...(capacityPlan ? { capacityPlan } : {}),
    }, target);
    if (scenePlan.targetWordCount !== target
      || scenePlan.scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0) !== target) {
      throw new Error("Planning repair scene normalization changed the original word count budget.");
    }
    // Never spread model output onto a plan: IDs, title, ordering, metadata and target stay untouched.
    return {
      ...chapter,
      // The scene plan owns duties; keep any legacy top-level projection consistent.
      ...("requiredElements" in chapter ? { requiredElements: scenePlan.requiredElements } : {}),
      ...(change.title ? { title: change.title } : {}),
      summary: change.summary,
      purpose: change.purpose,
      exclusiveEvent: change.exclusiveEvent,
      endingState: change.endingState,
      nextChapterEntryState: change.nextChapterEntryState,
      conflictLevel: levels.conflictLevel,
      revealLevel: levels.revealLevel,
      taskSheet: change.taskSheet,
      mustAvoid: change.mustAvoid,
      payoffRefs: change.payoffRefs,
      sceneCards: JSON.stringify(scenePlan),
    };
  });

  // Resolve deferred duties before projecting the candidate: supplementation mutates later chapters
  // in the `chapters` array, and the aggregate candidate must see those updates.
  const capacityDebt = resolveRepairDeferableDestinations(volume, chapters, allowed);
  const candidateChapters = allChapters.map((chapter) => (
    allowed.has(chapter.id) ? chapters.find((item) => item.id === chapter.id)! : chapter
  ));
  for (const chapter of chapters.filter((item) => allowed.has(item.id))) {
    const event = comparable(chapter.exclusiveEvent);
    if (candidateChapters.some((other) => other.id !== chapter.id && comparable(other.exclusiveEvent) === event)) {
      throw new Error(`Planning repair duplicates exclusive event for chapter ${chapter.id}.`);
    }
  }
  const beforePayoffs = collectPayoffs(volume.chapters.filter((chapter) => allowed.has(chapter.id)));
  const afterPayoffs = collectPayoffs(chapters.filter((chapter) => allowed.has(chapter.id)));
  // Exact text locates references; it does not decide their narrative equivalence.
  // An explicit revision may replace an erroneous description, subject to mandatory AI review.
  const revisions = parsed.obligationMoves.filter((move) => move.action === "revise");
  for (const revision of revisions) {
    const source = volume.chapters.find((chapter) => chapter.id === revision.fromChapterId)!;
    const destination = chapters.find((chapter) => chapter.id === revision.toChapterId)!;
    const originalRef = comparable(revision.obligation);
    const replacementRef = comparable(revision.replacement);
    if (!source.payoffRefs.some((ref) => comparable(ref) === originalRef)) {
      const endpoint = appliedRevisionEndpoint(revision, priorMoves, source);
      if (!endpoint) {
        throw new Error("Planning repair revision source reference does not exist.");
      }
      if (destination.payoffRefs.some(ref => comparable(ref) === originalRef)) {
        throw new Error("Planning repair revision replay restored an obsolete reference.");
      }
      if (!destination.payoffRefs.some(ref => comparable(ref) === endpoint)
        && !revisions.some(move => move.fromChapterId === source.id && comparable(move.obligation) === endpoint)) {
        throw new Error(`Planning repair lost payoff obligation: ${endpoint}`);
      }
      // Current references remain protected by the before/after obligation check below;
      // replay cannot authorize deleting B/C or replacing it without a fresh revision.
      continue;
    }
    if (originalRef === replacementRef) throw new Error("Planning repair revision must change its reference.");
    if (!destination.payoffRefs.some((ref) => comparable(ref) === replacementRef)) {
      throw new Error("Planning repair revision replacement reference is missing from its chapter.");
    }
    if (destination.payoffRefs.some((ref) => comparable(ref) === originalRef)) {
      throw new Error("Planning repair revision left the obsolete reference in its chapter.");
    }
  }
  for (const ref of beforePayoffs) {
    if (afterPayoffs.has(ref)) continue;
    const sources = volume.chapters.filter((chapter) => allowed.has(chapter.id)
      && chapter.payoffRefs.some((item) => comparable(item) === ref));
    if (!sources.every((chapter) => revisions.some((revision) => revision.fromChapterId === chapter.id
      && comparable(revision.obligation) === ref))) {
      throw new Error(`Planning repair lost payoff obligation: ${ref}`);
    }
  }
  for (const move of parsed.obligationMoves) {
    if (move.action === "revise") continue;
    const ref = comparable(move.obligation);
    const source = volume.chapters.find((chapter) => chapter.id === move.fromChapterId)!;
    if (!source.payoffRefs.some((item) => comparable(item) === ref)) continue;
    const destination = chapters.find((chapter) => chapter.id === move.toChapterId)!;
    // Shared book hooks may legitimately remain referenced by both source and destination.
    // Actual duty removal/duplication is a semantic review concern, not a reference-count rule.
    if (!destination.payoffRefs.some((item) => comparable(item) === ref)) {
      throw new Error(`Planning repair obligation ledger disagrees with changes: ${ref}`);
    }
  }
  const documentWithRepair: VolumePlanDocument = {
    ...document,
    volumes: document.volumes.map((item) => item.id === volumeId ? { ...item, chapters } : item),
  };
  capacityDebtByDocument.set(documentWithRepair, capacityDebt);
  return documentWithRepair;
}
