import { isTerminalPlanningRepairPhase } from "@ai-novel/shared/types/planningRepair/recovery";

/**
 * Pure preflight decisions for "the facts finished but the pause is stale" recovery convergence.
 *
 * The application service that applies them lives in `DirectorRecoveryConvergenceService.ts`.
 * Keeping the decisions pure makes them directly testable: they never read a database, never
 * write, and every piece of evidence (task pause, command activity, journal ownership, job
 * effects) is passed in explicitly by the caller.
 */

export interface PlanningRepairConvergenceEvidence {
  phase: string;
  pendingOperation?: unknown;
  repairOutputPending?: unknown;
  pendingGrant?: unknown;
}

export type PlanningRepairConvergenceDecision = { action: "abandon" } | { action: "none" };

/**
 * A repair session stuck in `reviewing`—or a `technical_failed` session whose exact failure is
 * already recorded and has no in-flight marker—holds the pause forever: the panel keeps offering
 * the same repair while the user just wants to continue writing.
 *
 * The explicit continuation request is treated as "do not retry this review": the session is
 * given up (auditable terminal state) and the chapter is planned again. Bounded deliberately:
 * only these stale phases, only while the task is paused, and never while a command, in-flight
 * operation, unapplied output or pending budget grant could still change planning sources.
 */
export function planStalePlanningRepairConvergence(input: {
  repair: PlanningRepairConvergenceEvidence | null;
  taskPaused: boolean;
  activeCommand: boolean;
}): PlanningRepairConvergenceDecision {
  const repair = input.repair;
  if (!repair || isTerminalPlanningRepairPhase(repair.phase)) return { action: "none" };
  if (input.activeCommand || !input.taskPaused) return { action: "none" };
  if (repair.phase !== "reviewing" && repair.phase !== "technical_failed") return { action: "none" };
  if (repair.pendingOperation || repair.repairOutputPending || repair.pendingGrant) return { action: "none" };
  return { action: "abandon" };
}

/** A terminal repair session must not carry a stale execution binding into the next attempt. */
export function planTerminalRepairBindingCleanup(input: {
  repair: { phase: string } | null;
  hasRecoveryBinding: boolean;
  hasPipelineBinding: boolean;
  hasPendingGrant: boolean;
}): { clear: boolean } {
  if (!input.repair || !isTerminalPlanningRepairPhase(input.repair.phase)) return { clear: false };
  // A pending grant is an explicit paid authorization; converging it silently would discard it.
  if (input.hasPendingGrant) return { clear: false };
  return { clear: input.hasRecoveryBinding || input.hasPipelineBinding };
}

export interface BindingJobEvidence {
  id: string;
  novelId: string;
  status: string;
  pendingManualRecovery: boolean;
  startOrder: number;
  endOrder: number;
  payloadWorkflowTaskId: string | null;
  payload: string;
  /** Derived effect counters; a displaced technical retry must not have done external work. */
  llmCallCount: number;
  totalTokens: number;
  completedCount: number;
  cancelRequestedAt: unknown | null;
  leaseActive: boolean;
}

export interface BindingJournalEvidence {
  operationId: string;
  status: string;
  entry: string | null;
  workflowTaskId: string | null;
  expiresAt: number;
  chapterId: string;
  hasUncertainStep: boolean;
}

export interface DisplacedPipelineBindingEvidence {
  seedPipelineJobId: string;
  seedPipelineStatus: string | null;
  displacedJob: BindingJobEvidence | null;
  originalJob: BindingJobEvidence | null;
  activeJobInNovel: boolean;
  activeCommand: boolean;
  /** The planning repair that owned this preparation pause is over (abandoned/committed) or absent. */
  repairTerminalOrAbsent: boolean;
  chapter: {
    id: string;
    order: number;
    hasProse: boolean;
    fingerprintMatchesJournal: boolean;
  } | null;
  journal: BindingJournalEvidence | null;
  now: number;
}

/**
 * A failed retry job can be written into the task's `autoExecution.pipelineJobId` even though it
 * never owned the chapter journal: the paused preparation journal still belongs to the original
 * range job. That displaced pointer is what makes continue reject every click with the
 * source-page confirmation message, because the target chapter is neither completed nor paused
 * under the pointed job.
 *
 * The safe convergence is the one already proven by the maintenance script: re-point the task at
 * the job that actually owns the journal, and retire the displaced pointer only when it proves it
 * performed no external work. The original journal/budget/candidate stay untouched, so the
 * existing preflight can then resume the original job.
 */
export function planDisplacedPipelineBindingConvergence(
  evidence: DisplacedPipelineBindingEvidence,
): { displacedJobId: string; originalJobId: string; originalJobStatus: string } | null {
  const { displacedJob, originalJob, journal, chapter } = evidence;
  if (evidence.activeJobInNovel || evidence.activeCommand) return null;
  if (!evidence.repairTerminalOrAbsent) return null;
  if (!displacedJob || !originalJob || displacedJob.id === originalJob.id) return null;
  if (evidence.seedPipelineJobId !== displacedJob.id || evidence.seedPipelineStatus !== "failed") return null;
  for (const job of [displacedJob, originalJob]) {
    if (job.status !== "failed" || !job.pendingManualRecovery || job.cancelRequestedAt || job.leaseActive) return null;
    if (!job.payloadWorkflowTaskId) return null;
  }
  if (displacedJob.payloadWorkflowTaskId !== originalJob.payloadWorkflowTaskId) return null;
  if (displacedJob.novelId !== originalJob.novelId) return null;
  if (displacedJob.startOrder !== originalJob.startOrder || displacedJob.endOrder !== originalJob.endOrder) return null;
  // A displaced job is only a pointer shell when it never reached an external call or saved work.
  if (displacedJob.llmCallCount !== 0 || displacedJob.totalTokens !== 0 || displacedJob.completedCount !== 0) return null;
  if (displacedJob.payload !== originalJob.payload) return null;
  if (!chapter || !journal) return null;
  if (chapter.order < originalJob.startOrder || chapter.order > originalJob.endOrder) return null;
  if (!chapter.fingerprintMatchesJournal) return null;
  if (journal.chapterId !== chapter.id) return null;
  if (journal.operationId !== `pipeline:${originalJob.id}:${chapter.id}`) return null;
  if (journal.entry !== "pipeline" || journal.workflowTaskId !== originalJob.payloadWorkflowTaskId) return null;
  if (journal.status !== "paused" || journal.expiresAt > evidence.now || journal.hasUncertainStep) return null;
  // Prose must either not exist yet (rebuild the plan) or already be saved in the journal.
  if (chapter.hasProse) return null;
  return { displacedJobId: displacedJob.id, originalJobId: originalJob.id, originalJobStatus: originalJob.status };
}

export interface StalePlanRepairExecutionJobEvidence {
  id: string;
  novelId: string;
  status: string;
  pendingManualRecovery: boolean;
  currentItemKey: string | null;
  payloadWorkflowTaskId: string | null;
  leaseActive: boolean;
  cancelRequestedAt: unknown | null;
  startOrder: number;
  endOrder: number;
}

export interface StalePlanRepairExecutionChapterEvidence {
  id: string;
  order: number;
  hasProse: boolean;
  /** A saved chapter contract (task sheet / scene cards) or a chapter-level story plan exists. */
  hasUsablePlan: boolean;
}

export interface StalePlanRepairExecutionJournalEvidence {
  status: string;
  hasUncertainStep: boolean;
  /** Draft text or post-preparation steps mean the journal is not a pure failed preparation pause. */
  hasWorkBeyondPreparation: boolean;
  /** The journal operation must belong to the range job that is about to be superseded. */
  belongsToPreviousJob: boolean;
}

export interface StalePlanRepairExecutionEvidence {
  taskId: string;
  novelId: string;
  taskPaused: boolean;
  cancelRequested: boolean;
  activeCommand: boolean;
  /** Another queued/running job for this novel already owns execution. */
  activeJobInNovel: boolean;
  repairTerminalOrAbsent: boolean;
  repairPhase: string | null;
  executionRange: { startOrder: number; endOrder: number } | null;
  pipelineJobId: string | null;
  job: StalePlanRepairExecutionJobEvidence | null;
  /** The chapter the director is about to write, resolved from the saved execution state. */
  nextChapter: StalePlanRepairExecutionChapterEvidence | null;
  /** The paused production journal for `nextChapter`; unknown external calls block any rebuild. */
  journal: StalePlanRepairExecutionJournalEvidence | null;
}

export type StalePlanRepairExecutionPlan =
  | {
    action: "rebuild_execution";
    previousJobId: string;
    targetChapterId: string;
    targetChapterOrder: number;
  }
  | {
    action: "requires_planning";
    previousJobId: string;
    targetChapterOrder: number | null;
  }
  | { action: "none"; reason: string };

/**
 * Convergence for a planning-repair pause that can never resume its old execution job.
 *
 * When planning repair ended (abandoned/committed) and the saved range job lost its resumable
 * position (`currentItemKey = null`, stale scope, or no recoverable journal anchor), every
 * continue/retry click is rejected with "原章节任务缺少可核对的恢复位置". The chapter itself may
 * already be planned. In that case the safe recovery is a *new* execution binding for that
 * chapter, starting from the saved plan. If the chapter has no usable plan yet, the task must go
 * back through normal planning instead of writing blind.
 *
 * Never rebuilds over saved prose, unknown external calls, an active lease/command, a live job or
 * a non-terminal repair session; those boundaries keep the strict preflight in charge.
 */
export function planStalePlanRepairExecutionRebuild(
  evidence: StalePlanRepairExecutionEvidence,
): StalePlanRepairExecutionPlan {
  if (evidence.cancelRequested) return { action: "none", reason: "task_cancelled" };
  if (!evidence.taskPaused) return { action: "none", reason: "task_not_paused" };
  if (evidence.activeCommand) return { action: "none", reason: "active_command" };
  if (evidence.activeJobInNovel) return { action: "none", reason: "active_job" };
  if (!evidence.repairTerminalOrAbsent) return { action: "none", reason: "planning_repair_active" };
  const job = evidence.job;
  if (!evidence.pipelineJobId || !job || job.id !== evidence.pipelineJobId) {
    return { action: "none", reason: "no_saved_job" };
  }
  // Another director record owns this execution; retiring it would overwrite another task's work.
  if (job.payloadWorkflowTaskId !== evidence.taskId) return { action: "none", reason: "job_owned_by_other_task" };
  if (job.novelId !== evidence.novelId) return { action: "none", reason: "job_novel_mismatch" };
  if (job.cancelRequestedAt) return { action: "none", reason: "job_cancelled" };
  const lostAnchor = !job.currentItemKey;
  const outsideSavedScope = Boolean(evidence.nextChapter
    && (evidence.nextChapter.order < job.startOrder || evidence.nextChapter.order > job.endOrder));
  // A failed job that lost its chapter anchor is already terminal bookkeeping: its pending flag may
  // legitimately be false (nothing is waiting to resume), so it must not be read as "still live".
  const failedWithoutAnchor = job.status === "failed" && lostAnchor;
  if (!job.pendingManualRecovery && !failedWithoutAnchor) return { action: "none", reason: "job_not_paused" };
  if (job.leaseActive) return { action: "none", reason: "job_lease_active" };
  if (!["queued", "running", "failed"].includes(job.status)) return { action: "none", reason: "job_status_terminal" };
  // The old job is only unrecoverable when it lost its anchor or points outside the saved scope.
  if (!lostAnchor && !outsideSavedScope) return { action: "none", reason: "job_still_recoverable" };
  if (evidence.journal?.hasUncertainStep) return { action: "none", reason: "journal_unknown_call" };
  if (evidence.journal && evidence.journal.status !== "paused") {
    return { action: "none", reason: "journal_not_paused" };
  }
  if (evidence.journal?.hasWorkBeyondPreparation) {
    return { action: "none", reason: "journal_has_unfinished_work" };
  }
  if (evidence.journal && !evidence.journal.belongsToPreviousJob) {
    return { action: "none", reason: "journal_owned_by_other_execution" };
  }
  const chapter = evidence.nextChapter;
  if (!chapter) return { action: "none", reason: "no_pending_chapter" };
  if (evidence.executionRange
    && (chapter.order < evidence.executionRange.startOrder || chapter.order > evidence.executionRange.endOrder)) {
    return { action: "none", reason: "chapter_out_of_execution_range" };
  }
  // Saved prose is never rewritten by a rebuild; it needs its own review/repair recovery.
  if (chapter.hasProse) return { action: "none", reason: "target_chapter_has_prose" };
  if (chapter.hasUsablePlan) {
    return {
      action: "rebuild_execution",
      previousJobId: job.id,
      targetChapterId: chapter.id,
      targetChapterOrder: chapter.order,
    };
  }
  return { action: "requires_planning", previousJobId: job.id, targetChapterOrder: chapter.order };
}
