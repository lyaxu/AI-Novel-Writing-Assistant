import type { AiChapterTaskSheetQualityAssessment, ChapterTaskSheetQualityIssue } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

/** AI owns the blocking judgment; this boundary verifies its evidence and decision consistency. */
export function validateNewIssueEvidence(
  output: AiChapterTaskSheetQualityAssessment,
  candidate: unknown,
  previousIssues: ChapterTaskSheetQualityIssue[] = [],
): void {
  const previousIds = new Set(previousIssues.map(issue => issue.id));
  const fresh = output.issues.filter(issue => !previousIds.has(issue.id));
  const source = buildChapterEvidenceIndex(candidate);
  for (const issue of fresh) {
    const basis = issue.basis;
    if (!basis || !basis.candidateEvidence.length || !basis.executionImpact.trim()
      || !basis.whyExistingConstraintsInsufficient.trim()) {
      throw new Error(`New issue ${issue.id} requires an execution-impact basis and current candidate evidence.`);
    }
    for (const quote of [...basis.candidateEvidence, ...basis.counterEvidence]) {
      if (!matchesChapterEvidence(source, quote)) {
        throw new Error(`New issue ${issue.id} cites evidence absent from the current candidate.`);
      }
    }
    const citedLeaves = new Set(basis.candidateEvidence.map(quote => source.aliases.get(quote.sourcePath) ?? quote.sourcePath));
    if (basis.kind === "conflicting_requirements" && citedLeaves.size < 2) {
      throw new Error(`New conflict ${issue.id} must cite at least two distinct candidate requirements.`);
    }
  }
  if (fresh.length && (output.verdict === "usable" || output.safeToSync || output.recommendedHandling === "use_as_is")) {
    throw new Error("New blocking issues cannot accompany usable, safeToSync, or use_as_is decisions.");
  }
}
