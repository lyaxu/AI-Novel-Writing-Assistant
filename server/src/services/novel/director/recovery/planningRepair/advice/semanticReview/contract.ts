import { z } from "zod";
import { planningRepairAdviceOutputSchema, type PlanningRepairAdviceOutput } from "@ai-novel/shared/types/planningRepair/advice";

const issueStatus = z.enum(["present", "resolved", "disputed", "insufficient"]);
export const planningRepairAdviceReviewOutputSchema = z.object({
  issueAssessments: z.array(z.object({
    issueId: z.string().min(1), chapterId: z.string().min(1), scope: z.enum(["chapter", "window"]).optional(),
    affectedChapterIds: z.array(z.string().min(1)).min(1).optional(), status: issueStatus,
    rationale: z.string().min(1).max(1000),
    evidence: z.array(z.object({ sourcePath: z.string().min(1), quote: z.string().min(1).max(600) }).strict()).max(8),
  }).strict()).optional(),
  advice: planningRepairAdviceOutputSchema,
  checks: z.array(z.object({
    optionId: z.string().min(1),
    verdict: z.enum(["supported", "corrected", "blocked"]),
    rationale: z.string().min(1).max(1600),
    evidence: z.array(z.object({
      sourcePath: z.string().min(1).max(400),
      quote: z.string().trim().min(1).max(600),
      relation: z.enum(["supports", "contradicts"]),
    }).strict()).max(8),
  }).strict()).min(1).max(3),
}).strict();
export type PlanningRepairAdviceReviewOutput = z.infer<typeof planningRepairAdviceReviewOutputSchema>;


/** Model-facing evidence is selected from this invocation's authoritative catalog. */
export const planningRepairAdviceReviewModelOutputSchema = z.object({
  issueAssessments: z.array(z.object({
    issueId: z.string().min(1), status: issueStatus,
    evidenceIds: z.array(z.string().min(1)).max(8), rationale: z.string().min(1).max(1000),
  }).strict()),
  checks: z.array(z.object({
    optionId: z.string().min(1), verdict: z.enum(["supported", "corrected", "blocked"]),
    rationale: z.string().min(1).max(1600),
    evidence: z.array(z.object({ evidenceId: z.string().min(1).max(100),
      relation: z.enum(["supports", "contradicts"]),
    }).strict()).max(8),
  }).strict()).min(1).max(3),
  ...planningRepairAdviceOutputSchema.shape,
}).strict().superRefine((value, ctx) => {
  const parsed = planningRepairAdviceOutputSchema.safeParse({ summary: value.summary,
    recommendedOptionId: value.recommendedOptionId, options: value.options });
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
});
export type PlanningRepairAdviceReviewModelOutput = z.infer<typeof planningRepairAdviceReviewModelOutputSchema>;

/** Alternatives are mutually exclusive: one selectable option must handle the whole unresolved scope. */
export function assertAdviceIssueCoverage(status: string, issue: { affectedChapterIds: string[] }, options: PlanningRepairAdviceOutput["options"]): void {
  if (status !== "present" && status !== "insufficient") return;
  for (const option of options) {
    const executable = option.executionMode !== "source_edit" && !option.requiresSourceEdit && !option.changesHardConstraints
      && option.blockerResolution.status === "complete" && option.blockerResolution.remainingBlockers.length === 0;
    if (!executable) continue;
    if (option.executionMode === "review_existing") throw new Error("仍存在或资料不足的问题不能仅复核，必须由每个可执行方案独立处理。");
    if (!issue.affectedChapterIds.every(id => option.affectedChapterIds.includes(id))) {
      throw new Error("每个可执行方案必须独立覆盖全部仍存在或资料不足的问题章节，不能由多个备选拼接覆盖。");
    }
  }
}
