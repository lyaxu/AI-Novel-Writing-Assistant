import { productionFingerprint, type ChapterProductionJournalRecord } from "../../../../production/reliability";
import type { PlanningRepairState, PlanningRepairRecovery } from "../planningRepairRecovery";

export function reviewExistingBoundary(repair: PlanningRepairState, journal: ChapterProductionJournalRecord) {
  const pending = repair.pendingOperation as { kind?: string; startedAt?: string } | undefined;
  const step = journal.steps?.["prepare.execution_contract"];
  if (step?.external !== true) return null;
  if (["technical_failed", "uncertain"].includes(repair.phase)
    && pending?.startedAt && [`review:${repair.chapterId}`, "window_review"].includes(pending.kind ?? "")
    && step.status === "unknown") return "acknowledge_unknown" as const;
  const last = repair.history.at(-1) as { kind?: string; round?: number; promptId?: string } | undefined;
  const receipt = step.planningPause;
  if (repair.phase === "waiting_confirmation" && !pending && step.status === "failed"
    && receipt?.version === 1 && receipt.outcome === "settled" && receipt.repairKey === repair.key
    && receipt.round === repair.rounds && receipt.candidateVersionId === repair.candidateVersionId
    && last?.kind === "rejected_response" && last.round === repair.rounds
    && ["novel.volume.chapter_task_sheet_quality", "novel.volume.planning_repair_review"].includes(last.promptId ?? "")) {
    return "rejected_review" as const;
  }
  return null;
}

/** Dedicated user decision, never evidence that an unknown paid response had completed. */
export function assertReviewExistingAcknowledgement(input: {
  acknowledgement: Record<string, any>; archive: Record<string, any>;
  repair: PlanningRepairState; recovery: PlanningRepairRecovery; journal: ChapterProductionJournalRecord;
}) {
  const { acknowledgement: ack, archive, repair, recovery, journal } = input;
  const action = repair.recoveryAction;
  const decision = archive.reviewExistingDecision;
  const original = archive as ChapterProductionJournalRecord;
  const priorRepair = { ...repair, phase: ack.previousPhase, pendingOperation: ack.pendingOperation } as PlanningRepairState;
  const boundary = reviewExistingBoundary(priorRepair, original);
  if (ack.version !== 1 || !ack.requestId || ack.requestId !== recovery.idempotencyKey
    || ack.repairKey !== repair.key || ack.candidateVersionId !== repair.candidateVersionId || ack.round !== repair.rounds
    || recovery.executionMode !== "review_existing" || recovery.grantedAtRound !== repair.rounds
    || !action || action.requestId !== ack.requestId || action.mode !== "review_existing"
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
    archiveId: ack.archiveId as string, boundary };
}
