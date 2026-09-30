interface IssueSourceRecord {
  code?: string;
  evidence?: string;
  sourceValidationIssues?: string[];
}

/** Preserve uncertain findings for audit, but never turn them into prose edits. */
export function filterVerifiedRepairIssues<T extends { code?: string; evidence: string }>(
  issues: T[],
  reports: Array<{ legacyScoreJson?: string | null }> = [],
  assessmentIssues: IssueSourceRecord[] = [],
): T[] {
  const unverified = assessmentIssues.filter((issue) => issue.sourceValidationIssues?.length);
  for (const report of reports) {
    try {
      const metadata = JSON.parse(report.legacyScoreJson ?? "{}");
      if (!Array.isArray(metadata.blockingIssues)) continue;
      for (const issue of metadata.blockingIssues) {
        if (issue && Array.isArray(issue.sourceValidationIssues) && issue.sourceValidationIssues.length) {
          unverified.push(issue);
        }
      }
    } catch { /* Legacy reports may not contain structured acceptance metadata. */ }
  }
  return issues.filter((issue) => !unverified.some((item) =>
    item.code && issue.code ? item.code === issue.code : item.evidence === issue.evidence));
}
