import { z } from "zod";
import { preserveGeneratedContentConstraints } from "../../../../llm/generatedContentSchema";
import type { VolumeChapterPlan, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { normalizeChapterScenePlan, parseChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import { createChapterTaskSheetSchema, stateBoundSceneCardWireSchema } from "../chapterDetail/chapterDetailSchemas";
import { requiredElementRevisionSchema, applyRequiredElementRevisions } from "./domain/requiredElementRevisions";
import { chapterStateClaimsSchema, contextStateClaimsWireSchema } from "@ai-novel/shared/types/novel/sceneCausality";
export { mergeAppliedPlanningRepairRequiredElements } from "./domain/requiredElementRevisions";

const requiredText = z.string().trim().min(1);
const contractText = requiredText.max(240);
const taskSheetShape = createChapterTaskSheetSchema().out.shape;

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
  conflictLevel: z.number().int().min(0).max(100).optional(),
  revealLevel: z.number().int().min(0).max(100).optional(),
  taskSheet: taskSheetShape.taskSheet,
  mustAvoid: contractText,
  payoffRefs: z.array(requiredText.max(160)).max(8),
  sceneCards: taskSheetShape.sceneCards,
  stateClaims: chapterStateClaimsSchema.optional(),
  readerExperience: taskSheetShape.readerExperience,
  requiredElementRevisions: z.array(requiredElementRevisionSchema).max(8).optional(),
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
    sceneCards: z.array(stateBoundSceneCardWireSchema).min(3).max(8),
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
    const scenePlan = normalizeChapterScenePlan({
      scenes: change.sceneCards,
      ...(change.stateClaims !== undefined ? { stateClaims: change.stateClaims } : {}),
      readerExperience: change.readerExperience,
      requiredElements: applyRequiredElementRevisions({ chapterId: chapter.id,
        elements: existingPlan?.requiredElements ?? [], sceneKeys: change.sceneCards.map(scene => scene.key),
        revisions: change.requiredElementRevisions, previouslyApplied: previouslyAppliedRequiredElements }),
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
  return {
    ...document,
    volumes: document.volumes.map((item) => item.id === volumeId ? { ...item, chapters } : item),
  };
}
