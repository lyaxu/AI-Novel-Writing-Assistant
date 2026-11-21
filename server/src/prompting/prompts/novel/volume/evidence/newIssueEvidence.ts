import type { AiChapterTaskSheetQualityAssessment, ChapterTaskSheetQualityIssue } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

/** Only supplied source material, never review judgments or generated repair guidance. */
export function newIssueContextEvidenceIndex(reviewContextJson?: string) {
  let context: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(reviewContextJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) context = parsed as Record<string, unknown>;
  } catch { /* Absent source evidence cannot be inferred. */ }
  return buildChapterEvidenceIndex({
    writtenEvidence: context.writtenEvidence,
    readonlyPrevious: context.readonlyPrevious,
    readonlyNext: context.readonlyNext,
    readonlyOpeningRoutes: context.readonlyOpeningRoutes,
    readonlyPlanningHorizon: context.readonlyPlanningHorizon,
    selectedPlanningDirection: context.selectedPlanningDirection,
    bookConstraints: context.bookConstraints,
    volume: context.volume,
    strategyPlan: context.strategyPlan,
    beatSheet: context.beatSheet,
  });
}

/** AI owns the blocking judgment; this boundary verifies its evidence and decision consistency. */
export function validateNewIssueEvidence(
  output: AiChapterTaskSheetQualityAssessment,
  candidate: unknown,
  previousIssues: ChapterTaskSheetQualityIssue[] = [],
  reviewContextJson?: string,
): void {
  const previousIds = new Set(previousIssues.map(issue => issue.id));
  const fresh = output.issues.filter(issue => !previousIds.has(issue.id));
  const source = buildChapterEvidenceIndex(candidate);
  const contextSource = newIssueContextEvidenceIndex(reviewContextJson);
  const rejected = new Set<string>();
  for (const issue of fresh) {
    const reject = () => { rejected.add(issue.id); };
    const basis = issue.basis;
    if (!basis || !basis.executionImpact.trim() || !basis.whyExistingConstraintsInsufficient.trim()) {
      // An unsupported finding is not a reason to reject the whole plan. Without a usable basis it
      // cannot be acted on; drop the finding and let the plan continue instead of fabricating support.
      reject();
      continue;
    }
    basis.candidateEvidence = basis.candidateEvidence.filter(quote => matchesChapterEvidence(source, quote));
    basis.counterEvidence = (basis.counterEvidence ?? []).filter(quote => matchesChapterEvidence(source, quote));
    basis.contextEvidence = (basis.contextEvidence ?? []).filter(quote => matchesChapterEvidence(contextSource, quote));
    if (!basis.candidateEvidence.length && !basis.contextEvidence.length) {
      // The reviewer named a problem but none of its quotes exist in the current candidate/context.
      // Keeping the issue would force an unverifiable contract failure; drop it and keep the plan.
      reject();
      continue;
    }
    const citedLeaves = new Set([
      ...basis.candidateEvidence.map(quote => `candidate:${source.aliases.get(quote.sourcePath) ?? quote.sourcePath}`),
      ...(basis.contextEvidence ?? []).map(quote => `context:${contextSource.aliases.get(quote.sourcePath) ?? quote.sourcePath}`),
    ]);
    if (basis.kind === "conflicting_requirements" && citedLeaves.size < 2) reject();
  }
  if (rejected.size > 0) {
    const kept = output.issues.filter(issue => !rejected.has(issue.id));
    output.issues.splice(0, output.issues.length, ...kept);
    if (output.issueDecisions) {
      output.issueDecisions = output.issueDecisions.filter(decision => !rejected.has(decision.issueId));
    }
  }
  const freshAfter = output.issues.filter(issue => !previousIds.has(issue.id));
  if (freshAfter.length && (output.verdict === "usable" || output.safeToSync || output.recommendedHandling === "use_as_is")) {
    throw new Error("New blocking issues cannot accompany usable, safeToSync, or use_as_is decisions.");
  }
}
