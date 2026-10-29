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
 * A repair session stuck in `reviewing` without an in-flight marker holds the pause forever:
 * the panel keeps offering the same repair while the user just wants to continue writing.
 *
 * The explicit continuation request is treated as "do not retry this review": the session is
 * given up (auditable terminal state) and the chapter is planned again. Bounded deliberately:
 * only the review phase, only while the task is paused, and never while a command, in-flight
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
  if (repair.phase !== "reviewing") return { action: "none" };
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
