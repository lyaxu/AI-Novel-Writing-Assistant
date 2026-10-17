import { z } from "zod";
import { sceneStateTransitionSchema } from "./sceneCausality/stateClaims.js";
export {
  chapterStateClaimSchema, chapterStateClaimWireSchema, chapterStateClaimsSchema, chapterStateClaimsWireSchema,
  sceneStateTransitionSchema, stateClaimPrerequisiteWireSchema,
  type ChapterStateClaim, type ChapterStateClaimWire, type SceneStateTransition,
} from "./sceneCausality/stateClaims.js";
export {
  actionStateEvidenceSchema, actionStateDimensionCheckSchema, actionStateCheckSchema,
  type ActionStateEvidence, type ActionStateDimensionCheck, type ActionStateCheck,
} from "./sceneCausality/actionState.js";

const causalText = z.string().trim().min(1).max(240);

/** Planned reasons, not historical facts: sources still require comparison with the supplied evidence. */
export const sceneCausalitySchema = z.object({
  actor: causalText,
  choice: causalText,
  motive: causalText,
  prerequisites: z.array(z.object({
    condition: causalText,
    sourceKind: z.enum(["established_in_context", "establish_in_scene", "unresolved"]),
    reference: causalText,
    claimIds: z.array(z.string().trim().min(1).max(64)).min(1).max(6).optional(),
  })).max(6),
  stateTransition: sceneStateTransitionSchema.optional(),
  resistanceResponse: causalText,
  outcomeMechanism: causalText,
  resultingConstraints: z.array(z.object({
    constraint: causalText,
    persistence: causalText,
  })).max(6),
});

export const sceneCausalityVerdictSchema = z.object({
  sceneKey: z.string().trim().min(1),
  outcomeObserved: z.boolean(),
  verdict: z.enum(["earned", "unearned", "contradicted", "insufficient_evidence"]),
  prerequisiteEvidence: z.array(causalText).max(6),
  choiceAndResistanceEvidence: causalText,
  outcomeMechanismEvidence: causalText,
  constraintEvidence: z.array(causalText).max(6),
  explanation: causalText,
});

export type SceneCausality = z.infer<typeof sceneCausalitySchema>;
export type SceneCausalityVerdict = z.infer<typeof sceneCausalityVerdictSchema>;
