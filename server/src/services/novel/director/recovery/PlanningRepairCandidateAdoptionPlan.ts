/**
 * Pure decisions for adopting a saved (not yet committed) planning-repair candidate.
 *
 * A terminal planning-repair session can leave a fully planned candidate behind only as a
 * `VolumePlanVersion` draft: the plan text/capacity contract exists, but the volume chapter rows
 * and the materialized `Chapter` still have no execution contract. Regenerating would discard the
 * reviewed candidate and spend another planning round, so the recovery path adopts the saved
 * candidate into the workspace first and only then rebuilds the chapter execution binding.
 *
 * The decision never reads or writes the database: every piece of evidence (repair phase, old job
 * anchor, candidate shape, journal state, written-source fingerprint) is passed in explicitly.
 */

export const PREPARATION_JOURNAL_STEP_KEYS = [
  "prepare",
  "prepare.contract",
  "prepare.execution_contract",
  "pipeline.options",
] as const;

export interface AdoptionJobEvidence {
  id: string;
  novelId: string;
  status: string;
  pendingManualRecovery: boolean;
  currentItemKey: string | null;
  payloadWorkflowTaskId: string | null;
  leaseActive: boolean;
  cancelRequestedAt: unknown | null;
  /** Queued/running row proven to have no owner/lease/fresh heartbeat, no anchor and no output. */
  staleWithoutAnchor: boolean;
  /** Raw activity timestamps let the transactional writer re-check the stale classification. */
  updatedAtMs?: number | null;
  heartbeatAtMs?: number | null;
  startedAtMs?: number | null;
  completedCount?: number;
}

export interface AdoptionJournalEvidence {
  status: string;
  hasUncertainStep: boolean;
  /** A preparation pause may only be superseded; saved prose or post-preparation work must not. */
  hasWorkBeyondPreparation: boolean;
  belongsToPreviousJob: boolean;
  /** Shared definitive no-output code for every failed/unknown preparation step, else null. */
  definitiveNoOutputCode: string | null;
}

export interface AdoptionCandidateEvidence {
  versionId: string;
  status: string;
  volumeMatches: boolean;
  volumeChapterId: string | null;
  chapterExists: boolean;
  chapterOrder: number | null;
  /** taskSheet + sceneCards present and pass the shared execution-contract shape. */
  contractUsable: boolean;
  /** Deterministic capacity gate result for the candidate's scene plan. */
  capacityPassed: boolean;
}

export interface AdoptionTargetChapterEvidence {
  id: string;
  order: number;
  hasProse: boolean;
  hasPlan: boolean;
}

export interface PlanningRepairCandidateAdoptionEvidence {
  taskId: string;
  novelId: string;
  taskPaused: boolean;
  cancelRequested: boolean;
  activeCommand: boolean;
  activeJobInNovel: boolean;
  repairPhase: string | null;
  /** pendingOperation / repairOutputPending / recoveryAction / pendingGrant. */
  repairPendingWork: boolean;
  candidateVersionId: string | null;
  executionRange: { startOrder: number; endOrder: number } | null;
  pipelineJobId: string | null;
  job: AdoptionJobEvidence | null;
  /** Any chapter inside the execution range already has prose; adoption never overwrites it. */
  rangeHasProse: boolean;
  targetChapter: AdoptionTargetChapterEvidence | null;
  candidate: AdoptionCandidateEvidence | null;
  journal: AdoptionJournalEvidence | null;
  writtenSourceUnchanged: boolean;
  /**
   * The repair session already persisted bounded capacity debt for this chapter (deferred duties
   * handed to later unwritten chapters). A deterministic capacity-plan classification violation is
   * then quality debt the policy already accepted, not a reason to lose the candidate; the debt
   * stays visible in the adoption receipt. Shape/contract violations still block.
   */
  capacityDebtDocumented: boolean;
}

export type PlanningRepairCandidateAdoptionPlan =
  | {
    action: "adopt";
    versionId: string;
    /** VolumeChapterPlan id; the repair session's own chapter id. */
    volumeChapterId: string;
    chapterId: string;
    chapterOrder: number;
  }
  | { action: "none"; reason: string };

function isTerminalOrExhaustedRepair(phase: string | null, pendingWork: boolean): boolean {
  if (!phase) return false;
  if (phase === "abandoned" || phase === "committed") return true;
  // A technical failure is a definite end only when no call/output is still ambiguous.
  return phase === "technical_failed" && !pendingWork;
}

function journalBlocksAdoption(journal: AdoptionJournalEvidence | null): string | null {
  if (!journal) return null;
  if (journal.hasUncertainStep && !journal.definitiveNoOutputCode) return "journal_unknown_call";
  if (journal.status !== "paused") return "journal_not_paused";
  if (journal.hasWorkBeyondPreparation) return "journal_has_unfinished_work";
  if (!journal.belongsToPreviousJob) return "journal_owned_by_other_execution";
  return null;
}

/**
 * Adoption is only for the specific stale shape: terminal repair, failed old job that lost its
 * chapter anchor, empty pending chapter without an execution contract, and a saved candidate
 * whose contract can enter execution. Anything live, written or ambiguous keeps the strict
 * recovery/preflight path in charge.
 */
export function planPlanningRepairCandidateAdoption(
  evidence: PlanningRepairCandidateAdoptionEvidence,
): PlanningRepairCandidateAdoptionPlan {
  if (evidence.cancelRequested) return { action: "none", reason: "task_cancelled" };
  if (!evidence.taskPaused) return { action: "none", reason: "task_not_paused" };
  if (evidence.activeCommand) return { action: "none", reason: "active_command" };
  if (evidence.activeJobInNovel) return { action: "none", reason: "active_job" };
  if (!isTerminalOrExhaustedRepair(evidence.repairPhase, evidence.repairPendingWork)) {
    return { action: "none", reason: "planning_repair_active" };
  }
  if (evidence.repairPendingWork) return { action: "none", reason: "repair_pending_work" };
  if (!evidence.pipelineJobId) return { action: "none", reason: "no_saved_job" };
  const job = evidence.job;
  if (!job || job.id !== evidence.pipelineJobId) return { action: "none", reason: "no_saved_job" };
  if (job.payloadWorkflowTaskId !== evidence.taskId || job.novelId !== evidence.novelId) {
    return { action: "none", reason: "job_owned_by_other_task" };
  }
  if (job.cancelRequestedAt) return { action: "none", reason: "job_cancelled" };
  const staleLiveWithoutAnchor = (job.status === "queued" || job.status === "running") && job.staleWithoutAnchor;
  if (job.status !== "failed" && !staleLiveWithoutAnchor) return { action: "none", reason: "job_not_retirable" };
  // A job that still carries an anchor has an ordinary recovery route; never adopt around it.
  if (job.currentItemKey) return { action: "none", reason: "job_has_anchor" };
  if (job.leaseActive) return { action: "none", reason: "job_lease_active" };
  if (evidence.rangeHasProse) return { action: "none", reason: "range_has_prose" };
  if (!evidence.writtenSourceUnchanged) return { action: "none", reason: "written_source_changed" };
  if (!evidence.candidateVersionId) return { action: "none", reason: "no_candidate_version" };
  const candidate = evidence.candidate;
  if (!candidate || candidate.versionId !== evidence.candidateVersionId) {
    return { action: "none", reason: "no_candidate_version" };
  }
  if (candidate.status !== "draft") return { action: "none", reason: "candidate_not_draft" };
  if (!candidate.volumeMatches) return { action: "none", reason: "candidate_volume_mismatch" };
  if (!candidate.chapterExists || !candidate.volumeChapterId) return { action: "none", reason: "candidate_chapter_missing" };
  const target = evidence.targetChapter;
  if (!target) return { action: "none", reason: "no_target_chapter" };
  if (candidate.chapterOrder === null || candidate.chapterOrder !== target.order) {
    return { action: "none", reason: "candidate_chapter_order_mismatch" };
  }
  if (!candidate.contractUsable) return { action: "none", reason: "candidate_contract_unusable" };
  // A deterministic capacity classification violation is only adoptable when the repair session
  // already recorded a bounded capacity debt for this chapter; otherwise keep planning in charge.
  if (!candidate.capacityPassed && !evidence.capacityDebtDocumented) {
    return { action: "none", reason: "candidate_capacity_unusable" };
  }
  if (evidence.executionRange
    && (target.order < evidence.executionRange.startOrder || target.order > evidence.executionRange.endOrder)) {
    return { action: "none", reason: "target_chapter_out_of_range" };
  }
  // Saved prose is never overwritten by an adoption or a rebuild.
  if (target.hasProse) return { action: "none", reason: "target_chapter_has_prose" };
  if (target.hasPlan) return { action: "none", reason: "target_chapter_has_plan" };
  const journalReason = journalBlocksAdoption(evidence.journal);
  if (journalReason) return { action: "none", reason: journalReason };
  return {
    action: "adopt",
    versionId: candidate.versionId,
    volumeChapterId: candidate.volumeChapterId,
    chapterId: target.id,
    chapterOrder: target.order,
  };
}
