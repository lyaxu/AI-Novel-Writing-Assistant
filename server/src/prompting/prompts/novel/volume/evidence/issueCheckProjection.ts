import type { AiChapterTaskSheetQualityAssessment, ChapterTaskSheetQualityIssue } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

/**
 * Evidence entries here are either a bare quote string or a `{ sourcePath, quote }` pair. Describe
 * both shapes so a failure can name what it actually received instead of "[object Object]".
 */
function describeEvidence(evidence: string | { sourcePath?: string; quote?: string }) {
  if (typeof evidence === "string") return { sourcePath: null, quote: evidence.slice(0, 80) };
  return { sourcePath: evidence?.sourcePath ?? null, quote: (evidence?.quote ?? "").slice(0, 80) };
}

/** The AI decides issue status; this projection preserves validated unresolved decisions without a second call. */
export function projectValidatedIssueChecks(
  output: AiChapterTaskSheetQualityAssessment,
  candidate: unknown,
  previousIssues: ChapterTaskSheetQualityIssue[] = [],
): AiChapterTaskSheetQualityAssessment {
  const expected = new Map(previousIssues.map(issue => [issue.id, issue]));
  const checks = output.issueChecks ?? [];
  if (checks.length !== expected.size || new Set(checks.map(check => check.issueId)).size !== checks.length
    || checks.some(check => !expected.has(check.issueId))) {
    const returned = checks.map(check => check.issueId);
    const missing = [...expected.keys()].filter(id => !returned.includes(id));
    const extra = returned.filter(id => !expected.has(id));
    const duplicated = returned.filter((id, index) => returned.indexOf(id) !== index);
    throw new Error(`issueChecks must cover each previous issue exactly once. `
      + `应核对 ${expected.size} 个历史问题，实际返回 ${checks.length} 条；`
      + `缺失 ${JSON.stringify(missing)}，多余 ${JSON.stringify(extra)}，重复 ${JSON.stringify([...new Set(duplicated)])}。`);
  }
  const source = buildChapterEvidenceIndex(candidate);
  for (const check of checks) {
    if (check.candidateEvidence.some(quote => !matchesChapterEvidence(source, quote))) {
      const failed = check.candidateEvidence.filter(quote => !matchesChapterEvidence(source, quote));
      throw new Error(`issueChecks ${check.issueId} contains evidence absent from the current candidate. `
        + `candidateEvidence 共 ${check.candidateEvidence.length} 条，其中 ${failed.length} 条找不到：`
        + JSON.stringify(failed.map(describeEvidence)));
    }
    if (check.status === "resolved" && (!check.candidateEvidence.length || output.issues.some(issue => issue.id === check.issueId))) {
      throw new Error(`Resolved issue ${check.issueId} requires evidence and must not remain in issues. `
        + `candidateEvidence ${check.candidateEvidence.length} 条（resolved 至少需要 1 条），`
        + `issues 中${output.issues.some(issue => issue.id === check.issueId) ? "仍存在" : "已不存在"}该问题：两个条件必须同时满足。`);
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
