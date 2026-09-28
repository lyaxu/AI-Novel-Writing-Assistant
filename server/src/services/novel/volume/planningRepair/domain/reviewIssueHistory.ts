import type {
  ChapterPlanningIssueCheck,
  ChapterTaskSheetQualityGateResult,
  ChapterTaskSheetQualityIssue,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";

/** Fold each issue to its original scope and latest decision; never cache a pass. */
export function buildReviewIssueHistory(history: unknown[], chapterId: string) {
  const originals = new Map<string, ChapterTaskSheetQualityIssue>();
  const decisions = new Map<string, ChapterPlanningIssueCheck>();
  for (const value of history) {
    const entry = value as { kind?: string; result?: { chapters?: Record<string, ChapterTaskSheetQualityGateResult> } };
    if (entry.kind === "evidence_refresh") {
      originals.clear(); decisions.clear();
      continue;
    }
    if (entry.kind !== "assessment") continue;
    const result = entry.result?.chapters?.[chapterId];
    if (!result) continue;
    for (const issue of result.issues ?? []) {
      if (!originals.has(issue.id)) originals.set(issue.id, issue);
    }
    for (const check of result.issueChecks ?? []) {
      decisions.set(check.issueId, check);
    }
  }
  // Control repeated history by folding per ID, not by forgetting old resolutions:
  // any old issue can otherwise return under a new ID in a later review.
  const previousIssues = [...originals.values()];
  const priorIssueDecisions = previousIssues.flatMap(issue => {
    const check = decisions.get(issue.id);
    return check ? [check] : [];
  });
  return { previousIssues, priorIssueDecisions, omittedResolvedIssueCount: 0 };
}
