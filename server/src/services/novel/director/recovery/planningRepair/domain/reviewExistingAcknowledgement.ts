import { productionFingerprint, type ChapterProductionJournalRecord } from "../../../../production/reliability";
import type { PlanningRepairState, PlanningRepairRecovery } from "../planningRepairRecovery";
import { canResumeOriginalPlanningPolicy, type PlanningCandidateRecoveryMode } from "@ai-novel/shared/types/planningRepair/recovery";

export function originalPlanningPolicyFingerprint(seed: Record<string, unknown>, maxRounds: number) {
  const execution = seed.autoExecution as Record<string, unknown> | undefined;
  return productionFingerprint({ runMode: seed.runMode, directorInput: seed.directorInput,
    autoExecution: execution && {
      enabled: execution.enabled, mode: execution.mode, startOrder: execution.startOrder, endOrder: execution.endOrder,
      volumeOrder: execution.volumeOrder, autoReview: execution.autoReview, autoRepair: execution.autoRepair,
      artifactSyncMode: execution.artifactSyncMode, usageBudget: execution.usageBudget, completionProfile: execution.completionProfile,
    }, maxRounds });
}

export function reviewExistingBoundary(repair: PlanningRepairState, journal: ChapterProductionJournalRecord) {
  const pending = repair.pendingOperation as { kind?: string; startedAt?: string } | undefined;
  const step = journal.steps?.["prepare.execution_contract"];
  if (step?.external !== true) return null;
  if (["technical_failed", "uncertain"].includes(repair.phase)
    && pending?.startedAt && [`review:${repair.chapterId}`, "window_review"].includes(pending.kind ?? "")
    && step.status === "unknown") return "acknowledge_unknown" as const;
  const last = repair.history.at(-1) as { kind?: string; round?: number; promptId?: string;
    result?: { chapters?: Record<string, { status?: unknown; safeToSync?: unknown }> } } | undefined;
  const receipt = step.planningPause;
  const assessment = last?.result?.chapters?.[repair.chapterId];
  if (repair.phase === "waiting_confirmation" && !pending && step.status === "failed"
    && receipt?.version === 1 && receipt.outcome === "settled" && receipt.repairKey === repair.key
    && receipt.round === repair.rounds && receipt.candidateVersionId === repair.candidateVersionId
    && last?.kind === "rejected_response" && last.round === repair.rounds
    && ["novel.volume.chapter_task_sheet_quality", "novel.volume.planning_repair_review"].includes(last.promptId ?? "")) {
    return "rejected_review" as const;
  }
  if (repair.phase === "waiting_confirmation" && !pending && step.status === "failed"
    && receipt?.version === 1 && receipt.outcome === "settled" && receipt.repairKey === repair.key
    && receipt.round === repair.rounds && receipt.candidateVersionId === repair.candidateVersionId
    && last?.kind === "assessment" && last.round === repair.rounds
    && typeof assessment?.status === "string" && typeof assessment?.safeToSync === "boolean") {
    return "settled_review" as const;
  }
  return null;
}

/** Dedicated user decision, never evidence that an unknown paid response had completed. */
export function assertReviewExistingAcknowledgement(input: {
  acknowledgement: Record<string, any>; archive: Record<string, any>;
  repair: PlanningRepairState; recovery: PlanningRepairRecovery; journal: ChapterProductionJournalRecord;
  seed?: Record<string, unknown>;
}) {
  const { acknowledgement: ack, archive, repair, recovery, journal } = input;
  const action = repair.recoveryAction;
  const decision = archive.reviewExistingDecision;
  const original = archive as ChapterProductionJournalRecord;
  const priorRepair = { ...repair, phase: ack.previousPhase, pendingOperation: ack.pendingOperation } as PlanningRepairState;
  const boundary = reviewExistingBoundary(priorRepair, original);
  const mode: PlanningCandidateRecoveryMode = ack.executionMode ?? "review_existing";
  if (ack.version !== 1 || !ack.requestId || ack.requestId !== recovery.idempotencyKey
    || ack.repairKey !== repair.key || ack.candidateVersionId !== repair.candidateVersionId || ack.round !== repair.rounds
    || !["review_existing", "resume_existing_policy"].includes(mode)
    || recovery.executionMode !== mode || recovery.grantedAtRound !== repair.rounds
    || (decision?.executionMode ?? "review_existing") !== mode
    || (mode === "resume_existing_policy" && !canResumeOriginalPlanningPolicy({ ...input.seed, rounds: repair.rounds, maxRounds: repair.maxRounds ?? 2 }))
    || (mode === "resume_existing_policy" && (!input.seed || ack.policyFingerprint !== decision?.policyFingerprint
      || ack.policyFingerprint !== originalPlanningPolicyFingerprint(input.seed, repair.maxRounds ?? 2)))
    || !action || action.requestId !== ack.requestId || action.mode !== mode
    || action.paidRound !== undefined || repair.phase !== "reviewing" || repair.pendingOperation || repair.repairOutputPending
    || !boundary || boundary !== ack.boundary || decision?.requestId !== ack.requestId
    || decision?.originalOperationId !== journal.operationId || ack.operationId !== journal.operationId
    || archive.operationId !== ack.archiveId || ack.archiveFingerprint !== productionFingerprint(archive)
    || ack.acknowledgedJournalFingerprint !== productionFingerprint(journal)
    || (boundary === "acknowledge_unknown" && (archive.recoveryDecision?.kind !== "acknowledge_unknown"
      || archive.recoveryDecision.originalOperationId !== journal.operationId
      || productionFingerprint(archive.recoveryDecision.affectedSteps) !== productionFingerprint(["prepare.execution_contract"])))) {
    throw Object.assign(new Error("保留候选复核的用户确认记录已变化，不能继续原任务。"), { code: "PLANNING_REPAIR_CONFLICT" });
  }
  return { kind: "explicit_review_existing" as const, source: "user_acknowledgement" as const,
    repairKey: repair.key, requestId: ack.requestId as string, round: repair.rounds,
    operationId: journal.operationId, candidateVersionId: repair.candidateVersionId,
    archiveId: ack.archiveId as string, boundary, executionMode: mode };
}
