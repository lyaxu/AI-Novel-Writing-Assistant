import { z } from "zod";

const quoteSchema = z.object({ sourcePath: z.string().trim().min(1).max(240), quote: z.string().trim().min(1).max(240) });
export const planningStateAssertionSchema = z.object({
  subject: z.string().trim().min(1).max(100),
  statement: z.string().trim().min(1).max(400),
  temporalScope: z.enum(["prior", "planned"]),
  modality: z.enum(["fact", "intention", "attempt", "outcome"]),
  evidence: z.array(quoteSchema).min(1).max(2),
});

/** One semantic decision owns a blocking issue and its executable repair direction. */
export const planningIssueDecisionSchema = z.object({
  issueId: z.string().trim().min(1).max(180),
  claimIds: z.array(z.string().trim().min(1)).max(48),
  candidateAssertion: planningStateAssertionSchema,
  referenceAssertion: planningStateAssertionSchema.nullable(),
  relation: z.enum(["contradiction", "missing_precondition", "missing_requirement", "boundary_violation"]),
  comparisonScope: z.enum(["same_state", "new_transition", "different_state", "unknown"]),
  transition: z.enum(["not_applicable", "missing", "contradicted", "established"]),
  transitionEvidence: z.array(quoteSchema).max(3),
  explanation: z.string().trim().min(1).max(600),
  repair: z.object({
    instruction: z.string().trim().min(1).max(700),
    // Quotes support premises, not the still-unwritten proposed outcome.
    premiseEvidence: z.array(quoteSchema).max(3),
  }),
});
export type PlanningIssueDecision = z.infer<typeof planningIssueDecisionSchema>;

export const planningStateCheckSchema = z.object({
  claimId: z.string().trim().min(1),
  status: z.enum(["supported", "contradicted", "established_in_plan", "insufficient_context"])
    .describe("supported=earlier prose proves the historical claim; established_in_plan=planned transition is executable with valid prerequisites, NOT merely mentioned in a plan; contradicted=contradicted claim; insufficient_context=not enough valid support, including dependencies on a blocked prerequisite. The latter two may bind a blocking issue; the former two require issueId=null."),
  evidence: z.array(quoteSchema).max(3),
  explanation: z.string().trim().min(1).max(500),
  issueId: z.string().trim().min(1).nullable(),
});
export type PlanningStateCheck = z.infer<typeof planningStateCheckSchema>;
