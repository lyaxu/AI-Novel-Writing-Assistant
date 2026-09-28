import type {
  ChapterPlanningIssueCheck,
  ChapterTaskSheetQualityGateResult,
  ChapterTaskSheetQualityIssue,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";

/** Retain current obligations and a bounded regression memory, never a cached pass. */
export function buildReviewIssueHistory(history: unknown[], chapterId: string) {
  const originals = new Map<string, ChapterTaskSheetQualityIssue>();
  const decisions = new Map<string, ChapterPlanningIssueCheck>();
  const resolvedOrder = new Map<string, number>();
  let resolutionSequence = 0;
  let currentIssues: ChapterTaskSheetQualityIssue[] = [];
  for (const value of history) {
    const entry = value as { kind?: string; result?: { chapters?: Record<string, ChapterTaskSheetQualityGateResult> } };
    if (entry.kind === "evidence_refresh") {
      originals.clear(); decisions.clear(); resolvedOrder.clear(); currentIssues = [];
      continue;
    }
    if (entry.kind !== "assessment") continue;
    const result = entry.result?.chapters?.[chapterId];
    if (!result) continue;
    currentIssues = result.issues ?? [];
    for (const issue of currentIssues) {
      if (!originals.has(issue.id)) originals.set(issue.id, issue);
    }
    for (const check of result.issueChecks ?? []) {
      if (check.status === "resolved" && decisions.get(check.issueId)?.status !== "resolved") {
        resolvedOrder.set(check.issueId, resolutionSequence++);
      }
      decisions.set(check.issueId, check);
    }
  }
  const activeIds = new Set(currentIssues.map(issue => issue.id));
  const resolved = [...decisions.values()].filter(check => check.status === "resolved"
    && originals.has(check.issueId) && !activeIds.has(check.issueId));
  // Current unresolved issues are never dropped to meet a history budget. The latest
  // assessment already projects every unresolved check into this active list.
  const retained = resolved.sort((a, b) => (resolvedOrder.get(a.issueId) ?? 0)
    - (resolvedOrder.get(b.issueId) ?? 0)).slice(-8);
  const previousIssues = [...currentIssues.map(issue => originals.get(issue.id) ?? issue),
    ...retained.map(check => originals.get(check.issueId)!)];
  const priorIssueDecisions = previousIssues.flatMap(issue => {
    const check = decisions.get(issue.id);
    return check ? [check] : [];
  });
  return { previousIssues, priorIssueDecisions, omittedResolvedIssueCount: resolved.length - retained.length };
}
