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
  for (const issue of fresh) {
    const basis = issue.basis;
    if (!basis || !basis.candidateEvidence.length || !basis.executionImpact.trim()
      || !basis.whyExistingConstraintsInsufficient.trim()) {
      throw new Error(`New issue ${issue.id} requires an execution-impact basis and current candidate evidence.`);
    }
    for (const quote of [...basis.candidateEvidence, ...basis.counterEvidence]) {
      if (!matchesChapterEvidence(source, quote)) {
        const path = quote.sourcePath ?? "(no sourcePath)";
        throw new Error(
          `New issue ${issue.id} cites evidence absent from the current candidate.`
          + ` Source: ${path}${source.leaves.has(path) ? " (this source is in the candidate, but the quoted text is not found in it — likely paraphrased or stitched from separate places)" : " (this source is not part of the candidate at all)"}.`
          + ` Quote: ${JSON.stringify((quote.quote ?? "").slice(0, 120))}`,
        );
      }
    }
    for (const quote of basis.contextEvidence ?? []) {
      if (!matchesChapterEvidence(contextSource, quote)) {
        // Name the quote and where it claimed to come from. Without them the message says only that
        // something did not match, which is unactionable: the two cases below need opposite responses
        // — one is the reviewer misquoting, the other is context this validator never indexed.
        const path = quote.sourcePath ?? "(no sourcePath)";
        const known = contextSource.leaves.has(path);
        throw new Error(
          `New issue ${issue.id} cites evidence absent from the supplied read-only context.`
          + ` Source: ${path}${known ? " (this source is in the context, but the quoted text is not found in it — likely paraphrased or stitched from separate places)" : " (this source is not part of the read-only context at all)"}.`
          + ` Quote: ${JSON.stringify((quote.quote ?? "").slice(0, 120))}`,
        );
      }
    }
    const citedLeaves = new Set([
      ...basis.candidateEvidence.map(quote => `candidate:${source.aliases.get(quote.sourcePath) ?? quote.sourcePath}`),
      ...(basis.contextEvidence ?? []).map(quote => `context:${contextSource.aliases.get(quote.sourcePath) ?? quote.sourcePath}`),
    ]);
    if (basis.kind === "conflicting_requirements" && citedLeaves.size < 2) {
      throw new Error(`New conflict ${issue.id} must cite at least two distinct requirements from the candidate and supplied context.`);
    }
  }
  if (fresh.length && (output.verdict === "usable" || output.safeToSync || output.recommendedHandling === "use_as_is")) {
    throw new Error("New blocking issues cannot accompany usable, safeToSync, or use_as_is decisions.");
  }
}
