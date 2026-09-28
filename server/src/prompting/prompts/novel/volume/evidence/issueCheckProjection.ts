import type { AiChapterTaskSheetQualityAssessment, ChapterTaskSheetQualityIssue } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

/** The AI decides issue status; this projection preserves validated unresolved decisions without a second call. */
export function projectValidatedIssueChecks(
  output: AiChapterTaskSheetQualityAssessment,
  candidate: unknown,
  previousIssues: ChapterTaskSheetQualityIssue[] = [],
): AiChapterTaskSheetQualityAssessment {
  const expected = new Map(previousIssues.map(issue => [issue.id, issue]));
  const checks = output.issueChecks ?? [];
  if (checks.length !== expected.size || new Set(checks.map(check => check.issueId)).size !== checks.length
    || checks.some(check => !expected.has(check.issueId))) throw new Error("issueChecks must cover each previous issue exactly once.");
  const source = buildChapterEvidenceIndex(candidate);
  for (const check of checks) {
    if (check.candidateEvidence.some(quote => !matchesChapterEvidence(source, quote))) {
      throw new Error(`issueChecks ${check.issueId} contains evidence absent from the current candidate.`);
    }
    if (check.status === "resolved" && (!check.candidateEvidence.length || output.issues.some(issue => issue.id === check.issueId))) {
      throw new Error(`Resolved issue ${check.issueId} requires evidence and must not remain in issues.`);
    }
  }
  const unresolved = checks.filter(check => check.status !== "resolved");
  if (!unresolved.length) return output;
  const issues = [...output.issues];
  for (const check of unresolved) {
    if (issues.some(issue => issue.id === check.issueId)) continue;
    const original = expected.get(check.issueId)!;
    issues.push({ ...original, summary: check.explanation });
  }
  return {
    ...output, issues, verdict: output.verdict === "unusable" ? "unusable" : "repairable", safeToSync: false,
    recommendedHandling: output.recommendedHandling === "replan_window" ? "replan_window" : "repair_contract",
    repairGuidance: [output.repairGuidance.join("；"), unresolved.map(check => {
      const original = expected.get(check.issueId)!;
      return `${check.issueId}：${check.explanation}；${original.repairHint}`;
    }).join("；")].filter(Boolean),
  };
}
