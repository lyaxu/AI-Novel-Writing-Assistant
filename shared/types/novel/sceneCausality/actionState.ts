import { z } from "zod";

const stateText = z.string().trim().min(1).max(180);

/** Provenance is checked against supplied prose, never against the plan's self-description. */
export const actionStateEvidenceSchema = z.object({
  source: z.enum(["current_prose", "established_context", "planned_contract"]),
  sourceId: z.string().trim().min(1).max(240),
  quote: z.string().trim().min(1).max(180),
});

export const actionStateDimensionCheckSchema = z.object({
  dimension: z.enum(["body", "item", "ability", "knowledge", "location"]),
  entity: stateText,
  before: stateText,
  requiredForAction: stateText,
  after: stateText,
  beforeEvidence: z.array(actionStateEvidenceSchema).max(2),
  afterEvidence: z.array(actionStateEvidenceSchema).max(2),
  transitionEvidence: z.array(actionStateEvidenceSchema).max(2),
  enablingTransitionRequired: z.boolean(),
  stateChanged: z.boolean(),
  transitionStatus: z.enum(["not_needed", "established", "missing", "contradicted", "unknown"]),
});

export const actionStateCheckSchema = z.object({
  sceneKey: z.string().trim().min(1),
  actor: stateText,
  action: stateText,
  actionEvidence: z.array(actionStateEvidenceSchema).min(1).max(2),
  states: z.array(actionStateDimensionCheckSchema).min(1).max(5),
  verdict: z.enum(["earned", "unearned", "contradicted", "insufficient_evidence"]),
  explanation: stateText,
  // Added by deterministic evidence validation, not a model-authored semantic diagnosis.
  validationIssues: z.array(z.string()).optional(),
});

export type ActionStateEvidence = z.infer<typeof actionStateEvidenceSchema>;
export type ActionStateDimensionCheck = z.infer<typeof actionStateDimensionCheckSchema>;
export type ActionStateCheck = z.infer<typeof actionStateCheckSchema>;
