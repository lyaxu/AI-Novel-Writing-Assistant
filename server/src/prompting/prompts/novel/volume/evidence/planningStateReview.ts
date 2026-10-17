import type { AiChapterTaskSheetQualityAssessment, ChapterExecutionContractQualityCandidate } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { unresolvedPlanningPromises } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";
import { newIssueContextEvidenceIndex } from "./newIssueEvidence";
import { narrativeProgressionPriorEvidenceIndex } from "./narrativeProgressionEvidence";
import { resolveChapterStateClaims } from "./stateClaimBinding";

type Claim = { id: string; temporalScope: "prior" | "planned"; modality: string; source: { kind: string } };
function readClaims(candidate: ChapterExecutionContractQualityCandidate, reviewContextJson?: string): Claim[] {
  const plan = typeof candidate.sceneCards === "string" ? JSON.parse(candidate.sceneCards || "{}") : candidate.sceneCards;
  return plan && typeof plan === "object" && Array.isArray(plan.stateClaims)
    ? resolveChapterStateClaims(plan.stateClaims, reviewContextJson, candidate.chapterOrder) : [];
}

/** Validate AI-authored relations, never infer story semantics with keyword/amount rules. */
export function projectPlanningStateReview(
  output: AiChapterTaskSheetQualityAssessment,
  candidate: ChapterExecutionContractQualityCandidate,
  reviewContextJson?: string,
  inheritedIssueIds: Set<string> = new Set(),
): AiChapterTaskSheetQualityAssessment {
  // Historical persisted reviews remain readable; fresh PromptAsset schema requires both arrays.
  if (!output.issueDecisions || !output.stateChecks) return output;
  const current = buildChapterEvidenceIndex(candidate);
  const context = newIssueContextEvidenceIndex(reviewContextJson);
  const prose = narrativeProgressionPriorEvidenceIndex(reviewContextJson, candidate.chapterOrder);
  const claims = readClaims(candidate, reviewContextJson);
  const plan = JSON.parse(candidate.sceneCards || "{}");
  const requiredClaimIds = new Set<string>((plan.scenes ?? []).flatMap((scene: { causality?: {
    prerequisites?: Array<{ claimIds?: string[] }>; stateTransition?: { beforeClaimIds: string[] };
  } }) => [...(scene.causality?.prerequisites?.flatMap(item => item.claimIds ?? []) ?? []),
    ...(scene.causality?.stateTransition?.beforeClaimIds ?? [])]));
  const claimIds = new Set(claims.map(claim => claim.id));
  if (claimIds.size !== claims.length) throw new Error("Duplicate state claim identity in candidate.");
  const decisions = new Map(output.issueDecisions.map(decision => [decision.issueId, decision]));
  const issueIds = new Set(output.issues.map(issue => issue.id));
  if (unresolvedPlanningPromises(output.promiseChecks).length && !issueIds.has("selected_direction_drift")) {
    throw new Error("Unresolved promises require one selected_direction_drift issue and canonical decision; independent promise advice cannot authorize repair.");
  }
  if (output.loadRisk === "overloaded" && !issueIds.has("contract_overloaded")) {
    throw new Error("Overloaded planning requires one contract_overloaded issue and canonical decision.");
  }
  if (decisions.size !== output.issueDecisions.length || issueIds.size !== output.issues.length
    || decisions.size !== issueIds.size || [...issueIds].some(id => !decisions.has(id))) {
    throw new Error("issueDecisions must cover every current unresolved issue exactly once, including historical issues.");
  }
  const assertCurrent = (quotes: Array<{ sourcePath: string; quote: string }>, label: string) => {
    if (quotes.some(quote => !matchesChapterEvidence(current, quote))) throw new Error(`${label} cites absent candidate evidence.`);
  };
  const assertEither = (quotes: Array<{ sourcePath: string; quote: string }>, label: string) => {
    if (quotes.some(quote => !matchesChapterEvidence(current, quote) && !matchesChapterEvidence(context, quote))) {
      throw new Error(`${label} cites absent premise evidence.`);
    }
  };
  const isHistoricalOrRule = (quote: { sourcePath: string; quote: string }) => matchesChapterEvidence(prose, quote)
    || ((quote.sourcePath.startsWith("bookConstraints.") || quote.sourcePath.startsWith("bookConstraints["))
      && matchesChapterEvidence(context, quote));
  for (const decision of decisions.values()) {
    const issue = output.issues.find(item => item.id === decision.issueId)!;
    if (decision.claimIds.some(id => !claimIds.has(id)) || new Set(decision.claimIds).size !== decision.claimIds.length) {
      throw new Error(`Decision ${decision.issueId} references an unknown or duplicate state claim.`);
    }
    assertCurrent(decision.candidateAssertion.evidence, decision.issueId);
    // A reference may be another candidate clause or supplied context. Written prose must be earlier primary prose.
    if (decision.referenceAssertion) {
      assertEither(decision.referenceAssertion.evidence, decision.issueId);
      if (decision.referenceAssertion.temporalScope === "prior" && ["fact", "outcome"].includes(decision.referenceAssertion.modality)
        && decision.referenceAssertion.evidence.some(quote => !isHistoricalOrRule(quote))) {
        throw new Error(`Decision ${decision.issueId}: earlier facts require primary prose or an explicit book rule, never a future/old plan.`);
      }
      for (const quote of decision.referenceAssertion.evidence) {
        if (quote.sourcePath.startsWith("writtenEvidence.") && !matchesChapterEvidence(prose, quote)) {
          throw new Error(`Decision ${decision.issueId} cannot establish an earlier state from secondary/future evidence.`);
        }
      }
    }
    assertCurrent(decision.transitionEvidence, decision.issueId);
    assertEither(decision.repair.premiseEvidence, decision.issueId);
    const left = decision.candidateAssertion, right = decision.referenceAssertion;
    if (decision.relation === "contradiction") {
      const actual = new Set(["fact", "outcome"]);
      if (!right || decision.comparisonScope !== "same_state" || left.subject !== right.subject
        || left.temporalScope !== right.temporalScope
        || (left.modality !== right.modality && !(actual.has(left.modality) && actual.has(right.modality)))) {
        throw new Error(`Decision ${decision.issueId}: contradiction requires the same subject, time and comparable modality; a new decision/attempt is not an earlier accomplished result.`);
      }
    }
    if (decision.relation === "missing_precondition" && decision.transition === "established") {
      throw new Error(`Decision ${decision.issueId}: an established transition cannot simultaneously be a missing precondition.`);
    }
    if (decision.transition === "established" && !decision.transitionEvidence.length) {
      throw new Error(`Decision ${decision.issueId}: established transition requires candidate evidence.`);
    }
    const expectedKind = { contradiction: "conflicting_requirements", missing_precondition: "unsupported_prerequisite",
      missing_requirement: "missing_requirement", boundary_violation: "boundary_violation" }[decision.relation];
    if (!inheritedIssueIds.has(issue.id) && issue.basis && issue.basis.kind !== expectedKind) {
      throw new Error(`Decision ${decision.issueId} disagrees with its issue basis.`);
    }
    if (decision.relation === "contradiction" && !decision.repair.premiseEvidence.length) {
      throw new Error(`Decision ${decision.issueId}: a factual repair must bind its premises to supplied evidence.`);
    }
    if (decision.relation === "contradiction" && left.temporalScope === "prior"
      && decision.repair.premiseEvidence.some(quote => !isHistoricalOrRule(quote))) {
      throw new Error(`Decision ${decision.issueId}: historical repair premises cannot come from planning claims.`);
    }
  }
  const checks = new Map(output.stateChecks.map(check => [check.claimId, check]));
  if (checks.size !== output.stateChecks.length || checks.size !== claimIds.size || [...claimIds].some(id => !checks.has(id))) {
    throw new Error("stateChecks must evaluate every state claim exactly once.");
  }
  for (const claim of claims) {
    const check = checks.get(claim.id)!;
    assertEither(check.evidence, claim.id);
    if (check.status === "supported") {
      if (claim.temporalScope !== "prior" || claim.source.kind !== "written_prose" || !check.evidence.length
        || check.evidence.some(quote => !matchesChapterEvidence(prose, quote))) {
        throw new Error(`State ${claim.id}: supported historical state requires earlier primary prose.`);
      }
    }
    if (check.status === "established_in_plan") {
      if (claim.temporalScope !== "planned" || !check.evidence.length) throw new Error(`State ${claim.id}: planned transition needs current plan evidence.`);
      assertCurrent(check.evidence, claim.id);
    }
    if (check.status === "contradicted" && !check.issueId) throw new Error(`State ${claim.id}: contradicted claim requires an issue.`);
    if (check.issueId) {
      const decision = decisions.get(check.issueId);
      if (!decision || !decision.claimIds.includes(claim.id) || ["supported", "established_in_plan"].includes(check.status)) {
        throw new Error(`State ${claim.id}: state verdict and blocking decision disagree.`);
      }
    }
    if (requiredClaimIds.has(claim.id) && check.status === "insufficient_context" && !check.issueId
      && (output.safeToSync || output.verdict === "usable")) {
      throw new Error(`State ${claim.id}: unknown prerequisite cannot silently admit execution.`);
    }
  }
  for (const decision of decisions.values()) {
    if (decision.claimIds.some(id => checks.get(id)?.issueId !== decision.issueId)) {
      throw new Error(`Decision ${decision.issueId}: linked state claims must share the same blocking decision.`);
    }
  }
  const issues = output.issues.map(issue => {
    const decision = decisions.get(issue.id)!;
    const references = decision.referenceAssertion?.evidence ?? [];
    const kind = { contradiction: "conflicting_requirements", missing_precondition: "unsupported_prerequisite",
      missing_requirement: "missing_requirement", boundary_violation: "boundary_violation" } as const;
    return { ...issue, repairHint: decision.repair.instruction,
      ...(inheritedIssueIds.has(issue.id) ? { basis: {
        kind: kind[decision.relation], candidateEvidence: decision.candidateAssertion.evidence,
        counterEvidence: references.filter(quote => matchesChapterEvidence(current, quote)),
        contextEvidence: references.filter(quote => !matchesChapterEvidence(current, quote)),
        executionImpact: decision.explanation, whyExistingConstraintsInsufficient: decision.explanation,
      } } : {}),
    };
  });
  return {
    ...output, issues,
    repairGuidance: issues.map(issue => issue.repairHint),
    progressionChecks: output.progressionChecks?.map(check => ({ ...check,
      repairHint: check.issueId ? decisions.get(check.issueId)?.repair.instruction ?? "" : "" })),
  };
}
