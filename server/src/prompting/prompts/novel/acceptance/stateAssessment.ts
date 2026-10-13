import { z } from "zod";
import {
  actionStateCheckSchema,
  actionStateDimensionCheckSchema,
  type ActionStateCheck,
  type ActionStateDimensionCheck,
} from "@ai-novel/shared/types/novel/sceneCausality";
import { resolveEvidenceReference, type EvidenceCatalog } from "./evidenceCatalog";

const referenceSchema = z.object({ evidenceId: z.string().trim().min(1) }).strict();
const references = z.array(referenceSchema).max(2);
const reason = z.string().trim().min(1).max(180);

/** AI decides two different causal questions; compatibility flags are program-owned. */
export const referenceStateAssessmentSchema = actionStateDimensionCheckSchema.omit({
  stateChanged: true,
  enablingTransitionRequired: true,
  transitionStatus: true,
  transitionEvidence: true,
  assessment: true,
}).extend({
  beforeEvidence: references,
  afterEvidence: references,
  // Missing semantic findings must enter full-context correction, not JSON-only guessing.
  prerequisite: z.object({
    status: z.enum(["satisfied", "established", "missing", "contradicted", "unknown"]),
    evidence: references,
    reason,
  }).strict().optional(),
  resultChange: z.object({
    status: z.enum(["unchanged", "changed", "unsupported", "contradicted", "unknown"]),
    evidence: references,
    reason,
  }).strict().optional(),
}).strict();

export const referenceActionAssessmentSchema = actionStateCheckSchema.omit({
  verdict: true, validationIssues: true,
}).extend({
  actionEvidence: references.min(1),
  states: z.array(referenceStateAssessmentSchema).min(1).max(5),
}).strict();

export type ReferenceStateAssessment = z.infer<typeof referenceStateAssessmentSchema>;
export type ReferenceActionAssessment = z.infer<typeof referenceActionAssessmentSchema>;

/** Summarize already-structured findings; never infer state semantics from prose or reasons. */
function compatibilityTransition(
  prerequisite: ReferenceStateAssessment["prerequisite"],
  result: ReferenceStateAssessment["resultChange"],
): ActionStateDimensionCheck["transitionStatus"] {
  if (prerequisite?.status === "contradicted" || result?.status === "contradicted") return "contradicted";
  if (prerequisite?.status === "missing" || result?.status === "unsupported") return "missing";
  if (!prerequisite || !result || prerequisite.status === "unknown" || result.status === "unknown") return "unknown";
  if (prerequisite.status === "established" || result.status === "changed") return "established";
  return "not_needed";
}

function actionVerdict(states: ReferenceStateAssessment[], hasProblems: boolean): ActionStateCheck["verdict"] {
  if (states.some((state) => state.prerequisite?.status === "contradicted"
    || state.resultChange?.status === "contradicted"
    || state.beforeEvidenceTiming?.relation === "not_before_action")) return "contradicted";
  if (states.some((state) => state.prerequisite?.status === "missing"
    || state.resultChange?.status === "unsupported")) return "unearned";
  if (hasProblems || states.some((state) => !state.prerequisite || !state.resultChange
    || !state.beforeEvidenceTiming || state.prerequisite.status === "unknown"
    || state.resultChange.status === "unknown" || state.beforeEvidenceTiming.relation === "unknown")) return "insufficient_evidence";
  return "earned";
}

/** Resolve every evidence role and preserve invalid IDs as explicit, non-successful problems. */
export function normalizeReferenceActions(rawChecks: ReferenceActionAssessment[], catalog: EvidenceCatalog): {
  checks: ActionStateCheck[];
  problems: string[];
} {
  const problems: string[] = [];
  const resolve = (refs: Array<{ evidenceId: string }>, path: string) => refs.flatMap((ref, index) => {
    try { return [resolveEvidenceReference(catalog, ref)]; }
    catch (error) {
      problems.push(`${path}[${index}]: ${error instanceof Error ? error.message : String(error)} snapshot=${catalog.snapshotId}`);
      return [];
    }
  });
  const checks = rawChecks.map((check, index): ActionStateCheck => {
    const path = `actionStateChecks[${index}](sceneKey=${check.sceneKey})`;
    const initialProblemCount = problems.length;
    const actionEvidence = resolve(check.actionEvidence, `${path}.actionEvidence`);
    const states = check.states.map((state, stateIndex): ActionStateDimensionCheck => {
      const statePath = `${path}.states[${stateIndex}]`;
      const { prerequisite, resultChange, ...base } = state;
      if (!prerequisite) problems.push(`${statePath}.prerequisite:required_prerequisite_assessment_missing`);
      if (!resultChange) problems.push(`${statePath}.resultChange:required_result_change_assessment_missing`);
      if (!state.beforeEvidenceTiming) problems.push(`${statePath}.beforeEvidenceTiming:required_story_time_finding_missing`);
      const beforeEvidence = resolve(state.beforeEvidence, `${statePath}.beforeEvidence`);
      const afterEvidence = resolve(state.afterEvidence, `${statePath}.afterEvidence`);
      const prerequisiteEvidence = resolve(prerequisite?.evidence ?? [], `${statePath}.prerequisite.evidence`);
      const resultEvidence = resolve(resultChange?.evidence ?? [], `${statePath}.resultChange.evidence`);
      return {
        ...base, beforeEvidence, afterEvidence,
        // Preserve role-specific evidence even when a finding claims unchanged or satisfied.
        assessment: prerequisite && resultChange ? {
          prerequisite: { ...prerequisite, evidence: prerequisiteEvidence },
          resultChange: { ...resultChange, evidence: resultEvidence },
        } : undefined,
        transitionEvidence: [...prerequisiteEvidence, ...resultEvidence],
        enablingTransitionRequired: prerequisite?.status === "established"
          || prerequisite?.status === "missing" || prerequisite?.status === "contradicted",
        stateChanged: resultChange?.status === "changed" || resultChange?.status === "unsupported"
          || resultChange?.status === "contradicted",
        transitionStatus: compatibilityTransition(prerequisite, resultChange),
      };
    });
    return {
      ...check, actionEvidence, states,
      verdict: actionVerdict(check.states, problems.length > initialProblemCount),
    };
  });
  return { checks, problems };
}
