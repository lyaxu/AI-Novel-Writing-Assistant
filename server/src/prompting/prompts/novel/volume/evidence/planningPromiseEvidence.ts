import { isOpeningPlanningPromise, selectedPlanningPromiseIds, type SelectedPlanningDirection } from "@ai-novel/shared/types/novel/planningPromises";
import type { ChapterPlanningPromiseCheck } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

export function planningPromiseEvidenceContext(reviewContextJson?: string, chapterOrder?: number) {
  let context: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(reviewContextJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) context = parsed as Record<string, unknown>;
  } catch { /* Missing context remains unknown. */ }
  const direction = context.selectedPlanningDirection as SelectedPlanningDirection | undefined;
  const source = direction?.status === "available" ? direction.candidate : {};
  const sourceIndex = buildChapterEvidenceIndex(source);
  const contextIndex = buildChapterEvidenceIndex({
    originalChapters: context.originalChapters, candidateChapters: context.candidateChapters,
    readonlyPrevious: context.readonlyPrevious, readonlyNext: context.readonlyNext,
    writtenEvidence: context.writtenEvidence,
    readonlyOpeningRoutes: context.readonlyOpeningRoutes,
    readonlyPlanningHorizon: context.readonlyPlanningHorizon,
    plannedVolume: (context.planningContext as { targetVolume?: unknown } | undefined)?.targetVolume,
  });
  return { direction, sourceIndex, contextIndex, sourceIds: selectedPlanningPromiseIds(direction, chapterOrder) };
}

export function validatePlanningPromiseEvidence(checks: ChapterPlanningPromiseCheck[], candidate: unknown, reviewContextJson?: string) {
  const { sourceIds, sourceIndex, contextIndex } = planningPromiseEvidenceContext(reviewContextJson, (candidate as { chapterOrder?: number })?.chapterOrder);
  if (checks.length !== sourceIds.length || new Set(checks.map(check => check.sourceId)).size !== checks.length
    || checks.some(check => !sourceIds.includes(check.sourceId))) throw new Error("promiseChecks must cover every selected source exactly once; absent sources must not be invented.");
  const candidateIndex = buildChapterEvidenceIndex(candidate);
  for (const check of checks) {
    if (check.handoffStatus !== undefined && (check.status === "deferred" ? check.handoffStatus === "not_needed" : check.handoffStatus !== "not_needed")) {
      throw new Error(`Promise ${check.sourceId} has an incompatible handoffStatus.`);
    }
    if (isOpeningPlanningPromise(check.sourceId) && check.scope === "book_arc") throw new Error(`Opening promise ${check.sourceId} cannot be reclassified as a book arc.`);
    if (!check.sourceEvidence.length || check.sourceEvidence.some(evidence =>
      !(evidence.sourcePath === check.sourceId || evidence.sourcePath.startsWith(`${check.sourceId}.`))
      || !matchesChapterEvidence(sourceIndex, evidence))) throw new Error(`Promise ${check.sourceId} lacks exact selected-source evidence.`);
    if (check.candidateEvidence.some(evidence => !matchesChapterEvidence(candidateIndex, evidence))
      || check.contextEvidence.some(evidence => !matchesChapterEvidence(contextIndex, evidence))) throw new Error(`Promise ${check.sourceId} cites evidence absent from supplied plans or written facts.`);
    if (["preserved", "adapted"].includes(check.status) && !check.candidateEvidence.length && !check.contextEvidence.length) {
      throw new Error(`Promise ${check.sourceId} needs evidence of its preserved narrative value.`);
    }
  }
}
