import { z } from "zod";

const stateText = z.string().trim().min(1).max(180);

/** Provenance is checked against supplied prose, never against the plan's self-description. */
export const actionStateEvidenceSchema = z.object({
  source: z.enum(["current_prose", "established_context", "planned_contract"]),
  sourceId: z.string().trim().min(1).max(240),
  quote: z.string().min(1).max(180),
  evidenceId: z.string().optional(),
  evidenceSnapshotId: z.string().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

// Partial fields preserve incomplete reviews for full-context semantic correction.
// Their presence is checked by the review contract, never guessed by JSON repair.
const semanticFactSchema = z.object({
  entity: stateText.optional(),
  dimension: z.enum(["body", "item", "ability", "knowledge", "location"]).optional(),
  claim: stateText.optional(),
  evidence: z.array(actionStateEvidenceSchema).max(2).optional(),
  storyTime: z.enum(["before_or_at_action", "during_or_after_action", "unknown"]).optional(),
  // Some reviews describe an unverifiable fact as "unknown"; the fact-support field only has
  // supported/contradicted/insufficient. Map that one value deterministically before semantic
  // audit instead of rejecting the whole review over a vocabulary mismatch.
  support: z.preprocess(value => value === "unknown" ? "insufficient" : value,
    z.enum(["supported", "contradicted", "insufficient"]).optional()),
  reason: stateText.optional(),
});

const semanticFactsSchema = z.object({
  before: semanticFactSchema.optional(),
  after: semanticFactSchema.optional(),
  prerequisite: z.object({
    status: z.enum(["satisfied", "established", "missing", "contradicted", "unknown"]).optional(),
    basis: semanticFactSchema.optional(),
    reason: stateText.optional(),
  }).optional(),
  resultChange: z.object({
    status: z.enum(["unchanged", "changed", "unsupported", "contradicted", "unknown"]).optional(),
    basis: semanticFactSchema.optional(),
    reason: stateText.optional(),
  }).optional(),
});

export const actionStateDimensionCheckSchema = z.object({
  dimension: z.enum(["body", "item", "ability", "knowledge", "location"]),
  entity: stateText,
  before: stateText,
  requiredForAction: stateText,
  after: stateText,
  beforeEvidence: z.array(actionStateEvidenceSchema).max(2),
  // Optional for historical records. Narrative position alone cannot establish story time.
  beforeEvidenceTiming: z.object({
    relation: z.enum(["before_or_at_action", "retrospective_prior_state", "not_before_action", "unknown"]),
    reason: stateText,
  }).optional(),
  afterEvidence: z.array(actionStateEvidenceSchema).max(2),
  // Compatibility projection combines two independently audited evidence roles.
  transitionEvidence: z.array(actionStateEvidenceSchema).max(4),
  enablingTransitionRequired: z.boolean(),
  stateChanged: z.boolean(),
  transitionStatus: z.enum(["not_needed", "established", "missing", "contradicted", "unknown"]),
  // Optional for historical records; new reviews retain the two original AI findings.
  assessment: z.object({
    prerequisite: z.object({
      status: z.enum(["satisfied", "established", "missing", "contradicted", "unknown"]),
      evidence: z.array(actionStateEvidenceSchema).max(2),
      reason: stateText,
    }),
    resultChange: z.object({
      status: z.enum(["unchanged", "changed", "unsupported", "contradicted", "unknown"]),
      evidence: z.array(actionStateEvidenceSchema).max(2),
      reason: stateText,
    }),
  }).optional(),
  // v16: source location proves provenance; these AI findings describe story time.
  semanticFacts: semanticFactsSchema.optional(),
});

export const actionStateCheckSchema = z.object({
  sceneKey: z.string().trim().min(1),
  // Historical reviews predate the planned-state checklist.
  claimIds: z.array(z.string().trim().min(1).max(64)).max(48).optional(),
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
