import { createHash } from "node:crypto";
import { productionFingerprint, type ChapterProductionJournalRecord } from "../../../../production/reliability";
import type { PlanningRepairState, PlanningRepairRecovery } from "../planningRepairRecovery";
import { originalPlanningPolicyFingerprint } from "./reviewExistingAcknowledgement";

export function initialResponseFingerprint(seed: Record<string, unknown>, repair: PlanningRepairState) {
  const last = repair.history.at(-1) as { output?: unknown } | undefined;
  // Match PlanningRepairStore's stable business authority; omit mutable repair/heartbeat projections.
  const generationKeys = ["directorInput", "novelId", "provider", "model", "temperature", "guidance", "runMode",
    "issueGovernanceVersion", "issuePolicy", "issuePolicySource", "styleProfileId", "taskStyleProfileId",
    "styleIntentSummary", "postGenerationStyleReviewEnabled", "completionProfile", "autoExecutionPlan", "candidate", "startupPreparation"];
  return { response: createHash("sha256").update(JSON.stringify(last?.output ?? null)).digest("hex"),
    history: productionFingerprint(repair.history), source: productionFingerprint(seed.planningRepairSnapshot),
    generation: productionFingerprint(Object.fromEntries(generationKeys.map(key => [key, seed[key]]))),
    policy: originalPlanningPolicyFingerprint(seed, repair.maxRounds ?? 2),
    initialGenerationAttempts: repair.initialGenerationAttempts ?? null,
    correctionAttempts: repair.initialContractCorrection?.attempts ?? 0, validationError: repair.technicalError ?? null };
}

export function initialContractBoundary(repair: PlanningRepairState, journal: ChapterProductionJournalRecord) {
  const step = journal.steps?.["prepare.execution_contract"], receipt = step?.planningPause;
  const last = repair.history.at(-1) as { kind?: string; promptId?: string; round?: number; output?: unknown } | undefined;
  if (repair.phase !== "waiting_confirmation" || repair.candidateVersionId || repair.pendingOperation || repair.repairOutputPending
    || step?.external !== true || step.status !== "failed" || receipt?.version !== 1 || receipt.outcome !== "settled"
    || receipt.repairKey !== repair.key || receipt.round !== repair.rounds || receipt.candidateVersionId
    || last?.kind !== "rejected_response" || last.round !== repair.rounds
    || last.promptId !== "novel.volume.chapter_execution_contract" || last.output === undefined
    || Object.values(journal.steps).some(s => s.status === "unknown" || s.status === "running")
    || journal.prepared || journal.partialText?.trim()) return null;
  return "initial_contract_rejected" as const;
}

export function assertInitialContractAcknowledgement(input: {
  acknowledgement: Record<string, any>; archive: Record<string, any>; repair: PlanningRepairState;
  recovery: PlanningRepairRecovery; journal: ChapterProductionJournalRecord; seed: Record<string, unknown>;
}) {
  const { acknowledgement: ack, archive, repair, recovery, journal, seed } = input;
  const decision = archive.initialContractDecision, action = repair.recoveryAction, budget = repair.initialContractCorrection;
  const fingerprint = initialResponseFingerprint(seed, repair);
  const prior = { ...repair, phase: "waiting_confirmation" as const };
  if (ack.version !== 1 || !ack.requestId || ack.requestId !== recovery.idempotencyKey || ack.repairKey !== repair.key
    || ack.round !== repair.rounds || recovery.grantedAtRound !== repair.rounds
    || recovery.executionMode !== "retry_initial_contract" || ack.executionMode !== recovery.executionMode
    || action?.mode !== recovery.executionMode || action.requestId !== ack.requestId || action.paidRound !== undefined
    || repair.phase !== "assessing" || repair.candidateVersionId || repair.pendingOperation || repair.repairOutputPending
    || !budget || budget.requestId !== ack.requestId || !Number.isSafeInteger(budget.attempts) || budget.attempts < 0
    || budget.allowedAttempts !== budget.attempts + 1 || budget.historyIndex !== repair.history.length - 1
    || budget.rejectedResponseFingerprint !== fingerprint.response
    || !initialContractBoundary(prior, archive as ChapterProductionJournalRecord)
    || decision?.requestId !== ack.requestId || decision?.executionMode !== recovery.executionMode
    || productionFingerprint(ack.policyFingerprint) !== productionFingerprint(fingerprint)
    || productionFingerprint(decision.policyFingerprint) !== productionFingerprint(fingerprint)
    || decision.originalOperationId !== journal.operationId || ack.operationId !== journal.operationId
    || archive.operationId !== ack.archiveId || ack.archiveFingerprint !== productionFingerprint(archive)
    || ack.acknowledgedJournalFingerprint !== productionFingerprint(journal)) {
    throw Object.assign(new Error("初始规划纠正的响应、来源或单次授权已变化，请重新核对。"), { code: "PLANNING_REPAIR_CONFLICT" });
  }
  return { kind: "explicit_initial_contract" as const, source: "user_acknowledgement" as const,
    repairKey: repair.key, requestId: ack.requestId as string, round: repair.rounds, operationId: journal.operationId,
    archiveId: ack.archiveId as string, executionMode: "retry_initial_contract" as const };
}
