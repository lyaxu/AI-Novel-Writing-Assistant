import { z } from "zod";
import { chapterPayoffDirectiveOperationSchema } from "../canonicalState.js";

export const chapterPayoffDecisionSchema = z.object({
  ledgerKey: z.string().trim().min(1),
  operation: z.union([chapterPayoffDirectiveOperationSchema, z.enum(["defer", "out_of_scope", "requires_replan"])]),
  reason: z.string().trim().min(1),
  authorizedScope: z.string().trim().min(1),
  remainingObligation: z.string().trim().min(1).nullable().optional(),
  contractEvidence: z.object({
    sourcePath: z.enum(["expectation", "taskSheet", "sceneCards", "hook", "mustAvoid"]),
    quote: z.string().trim().min(1),
  }),
  followUp: z.object({
    chapterOrder: z.number().int().positive(),
    expectedChange: z.string().trim().min(1),
    planningQuote: z.string().trim().min(1),
  }).nullable(),
}).superRefine((decision, ctx) => {
  if (decision.operation === "defer" && !decision.followUp) {
    ctx.addIssue({ code: "custom", path: ["followUp"], message: "Deferred payoff requires a concrete planned follow-up." });
  }
  if (decision.operation === "partial_reveal" && (!decision.remainingObligation || !decision.followUp)) {
    ctx.addIssue({ code: "custom", path: ["followUp"], message: "Partial payoff requires the remaining obligation and a concrete follow-up." });
  }
});

export const chapterPayoffDecisionsSchema = z.array(chapterPayoffDecisionSchema).max(20);
export type ChapterPayoffDecision = z.infer<typeof chapterPayoffDecisionSchema>;
