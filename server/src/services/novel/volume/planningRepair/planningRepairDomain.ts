import { z } from "zod";
import type { VolumeChapterPlan, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { normalizeChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import { createChapterTaskSheetSchema } from "../chapterDetail/chapterDetailSchemas";

const requiredText = z.string().trim().min(1);
const contractText = requiredText.max(240);
const taskSheetShape = createChapterTaskSheetSchema().out.shape;

export const planningRepairChangeSchema = z.object({
  chapterId: requiredText,
  summary: requiredText.max(600),
  purpose: contractText,
  exclusiveEvent: contractText,
  endingState: contractText,
  nextChapterEntryState: contractText,
  conflictLevel: z.number().int().min(0).max(100).optional(),
  revealLevel: z.number().int().min(0).max(100).optional(),
  taskSheet: taskSheetShape.taskSheet,
  mustAvoid: contractText,
  payoffRefs: z.array(requiredText.max(160)).max(8),
  sceneCards: taskSheetShape.sceneCards,
  readerExperience: taskSheetShape.readerExperience,
}).strict();

export const planningRepairOutputSchema = z.object({
  requiresUserDecision: z.boolean(),
  reason: requiredText,
  changes: z.array(planningRepairChangeSchema),
  obligationMoves: z.array(z.object({
    obligation: requiredText,
    fromChapterId: requiredText,
    toChapterId: requiredText,
    action: z.enum(["retain", "merge", "move"]),
    reason: requiredText,
  }).strict()),
}).strict();

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

/** Pure candidate construction only; aggregate review and persistence belong to the coordinator. */
export function applyPlanningRepairCandidate(
  document: VolumePlanDocument,
  volumeId: string,
  allowedIds: readonly string[],
  output: PlanningRepairOutput,
): VolumePlanDocument {
  const parsed = planningRepairOutputSchema.parse(output);
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
    if ((move.action === "retain" && move.fromChapterId !== move.toChapterId)
      || (move.action === "move" && move.fromChapterId === move.toChapterId)) {
      throw new Error("Retain must stay in the same chapter; move must cross chapters; merge may stay in one chapter.");
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
    const scenePlan = normalizeChapterScenePlan({
      scenes: change.sceneCards,
      readerExperience: change.readerExperience,
    }, target);
    if (scenePlan.targetWordCount !== target
      || scenePlan.scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0) !== target) {
      throw new Error("Planning repair scene normalization changed the original word count budget.");
    }
    // Never spread model output onto a plan: IDs, title, ordering, metadata and target stay untouched.
    return {
      ...chapter,
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
  for (const ref of beforePayoffs) {
    if (!afterPayoffs.has(ref)) throw new Error(`Planning repair lost payoff obligation: ${ref}`);
  }
  for (const move of parsed.obligationMoves) {
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
  return {
    ...document,
    volumes: document.volumes.map((item) => item.id === volumeId ? { ...item, chapters } : item),
  };
}
