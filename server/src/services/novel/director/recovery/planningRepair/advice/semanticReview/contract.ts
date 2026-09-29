import { z } from "zod";
import { planningRepairAdviceOutputSchema } from "@ai-novel/shared/types/planningRepair/advice";

export const planningRepairAdviceReviewOutputSchema = z.object({
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
