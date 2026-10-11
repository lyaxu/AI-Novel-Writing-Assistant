import type { ChapterAcceptanceAssessmentOutput } from "../../../../prompting/prompts/novel/chapterAcceptance.prompts";

/** Validation metadata describes the review, never a story defect or permission to rewrite prose. */
export function assertReviewCompleted(output: ChapterAcceptanceAssessmentOutput): void {
  const invalid = output.riskTags?.includes("acceptance_source_evidence_unverified")
    || output.riskTags?.includes("acceptance_gate_unavailable")
    || output.blockingIssues?.some(issue => Boolean(issue.sourceValidationIssues?.length) || issue.code === "acceptance_gate_unavailable")
    || Boolean(output.actionStateAuditIssues?.length || output.progressionAuditIssues?.length)
    || output.actionStateChecks?.some(check => Boolean(check.validationIssues?.length))
    || output.progressionChecks?.some(check => Boolean(check.validationIssues?.length));
  if (invalid) {
    throw Object.assign(new Error("审查尚未完成：部分引文或检查范围未通过核验。正文已保留，请从审查步骤恢复；不会根据未核实意见修改正文。"), {
      code: "CHAPTER_REVIEW_INCOMPLETE",
      reviewOutput: output,
    });
  }
}
