import { ChapterProductionError, chapterFingerprint, type JournalChapter } from "../reliability";

/**
 * Degraded finalization for a chapter whose prose is already saved but whose acceptance review
 * never produced a usable assessment (structured-output parse failure) and whose range job then
 * lost its resumable anchor.
 *
 * This is deliberately not a general "make failed tasks succeed" routine. It only closes the
 * exact saved-prose boundary:
 *  - the task still owns a failed range job for this chapter;
 *  - the chapter has non-empty saved prose inside that job's range;
 *  - the production journal proves `pipeline.draft`/`pipeline.save_draft` finished and the only
 *    failed steps are acceptance-review steps with a technical parse failure;
 *  - the journal fingerprint still matches the chapter, there is no live lease, no unknown external
 *    call and no pending manual acknowledgement.
 *
 * The chapter is then completed as a usable draft with visible chapter-level quality debt and the
 * acceptance failure record kept in the chapter history, the task seed and the journal. The review
 * is never marked passed; no prose is rewritten and no model call is made.
 */

const ACCEPTANCE_PROMPT_PREFIX = "novel.chapter.acceptance_assessment";
const REVIEW_STEP_PATTERN = /^pipeline\.review:\d+$/;
const EVALUATION_STEP_PATTERN = /^evaluation:/;

export interface AcceptanceUnavailableTask {
  id: string;
  novelId: string | null;
  lane: string;
  status: string;
  pendingManualRecovery: boolean;
  cancelRequestedAt: Date | null;
  updatedAt: Date;
  seedPayloadJson: string | null;
}

export interface AcceptanceUnavailableJob {
  id: string;
  novelId: string;
  status: string;
  startOrder: number;
  endOrder: number;
  currentItemKey: string | null;
  pendingManualRecovery: boolean;
  cancelRequestedAt: Date | null;
  executionOwner: string | null;
  executionLeaseExpiresAt: Date | null;
  payload: string | null;
  updatedAt: Date;
  error: string | null;
}

export type AcceptanceUnavailableChapter = JournalChapter & {
  order: number;
  generationState: string | null;
  chapterStatus: string | null;
  repairHistory: string | null;
  riskFlags: string | null;
};

export interface AcceptanceUnavailableJournalRow {
  id: string;
  novelId: string;
  chapterId: string;
  contentHash: string;
  artifactType: string;
  syncMode: string;
  metadataJson: string | null;
}

export interface AcceptanceUnavailableFinalizationPlan {
  task: {
    id: string;
    expectedUpdatedAt: Date;
    expectedSeedPayloadJson: string;
    expectedStatus: string;
    expectedPendingManualRecovery: boolean;
    nextSeedPayloadJson: string;
  };
  chapter: {
    id: string;
    novelId: string;
    expectedContent: string;
    expectedGenerationState: string | null;
    expectedChapterStatus: string | null;
    nextGenerationState: "approved";
    nextChapterStatus: "completed";
    nextRepairHistory: string;
    nextRiskFlags: string;
  };
  job: {
    id: string;
    expectedStatus: string;
    expectedUpdatedAt: Date;
    expectedPayload: string | null;
    nextPayload: string;
    completedAt: Date;
  };
  journal: {
    id: string;
    expectedMetadataJson: string;
    nextMetadataJson: string;
  };
  evidence: {
    jobId: string;
    chapterId: string;
    chapterOrder: number;
    promptId: string | null;
    failedSteps: string[];
    acceptanceError: string;
    recordedAt: string;
  };
}

export interface AcceptanceUnavailableFinalizationResult {
  changed: boolean;
  action: "completed_saved_prose_with_acceptance_unavailable_debt" | null;
  reason: string | null;
  chapterId?: string;
  chapterOrder?: number;
  jobId?: string;
}

export interface AcceptanceUnavailableFinalizationDeps {
  loadTask: (taskId: string) => Promise<AcceptanceUnavailableTask | null>;
  findJob: (jobId: string) => Promise<AcceptanceUnavailableJob | null>;
  findChapter: (novelId: string, chapterId: string) => Promise<AcceptanceUnavailableChapter | null>;
  readJournal: (novelId: string, chapterId: string) => Promise<AcceptanceUnavailableJournalRow | null>;
  /** Atomic CAS writes for chapter/journal/job/task; false when any expected value changed. */
  persist: (plan: AcceptanceUnavailableFinalizationPlan) => Promise<boolean>;
  now?: () => number;
}

type Recorded = Record<string, unknown>;
const isRecord = (value: unknown): value is Recorded => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function parseJson(value: string | null | undefined): unknown {
  try { return JSON.parse(value ?? "null"); } catch { return null; }
}

/** Technical acceptance-review failure only; prose verdicts are quality debt, not this path. */
export function isAcceptanceReviewFormatFailure(message: string | null | undefined): boolean {
  const normalized = message?.trim() ?? "";
  if (!normalized) return false;
  if (normalized.includes("CHAPTER_REVIEW_INCOMPLETE") || normalized.includes("审查尚未完成")) return true;
  const structured = normalized.includes("[STRUCTURED_OUTPUT:") && (
    normalized.includes("malformed_json")
    || normalized.includes("incomplete_json")
    || normalized.includes("schema_mismatch")
    || normalized.includes("json_parse")
  );
  return structured && normalized.includes(ACCEPTANCE_PROMPT_PREFIX);
}

function stepStatus(step: unknown): string {
  return isRecord(step) ? text(step.status) : "";
}

function stepError(step: unknown): string {
  return isRecord(step) ? text(step.error) : "";
}

function hasUnknownJournalOutcome(record: Recorded): boolean {
  const steps = isRecord(record.steps) ? record.steps : {};
  if (Object.values(steps).some((step) => stepStatus(step) === "unknown"
    || (isRecord(step) && step.external === true && stepStatus(step) === "running"))) return true;
  const values = isRecord(record.values) ? record.values : {};
  return Boolean(values["stream.started"] && stepStatus(steps["stream.normalize"]) !== "done")
    || Boolean(values["manual_repair.started"] && !values["manual_repair.content"]);
}

function appendHistoryLine(previous: string | null, line: string): string {
  const existing = (previous ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [...existing, line].slice(-40).join("\n");
}

export function mergeRiskFlag(previous: string | null, flag: string): string {
  let parsed: unknown = null;
  try { parsed = JSON.parse(previous ?? "null"); } catch { parsed = null; }
  const flags = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  return JSON.stringify([...new Set([...flags, flag])]);
}

function remainingIds(autoExecution: Recorded): string[] {
  return Array.isArray(autoExecution.remainingChapterIds)
    ? autoExecution.remainingChapterIds.filter((item): item is string => typeof item === "string")
    : [];
}

function remainingOrders(autoExecution: Recorded): number[] {
  return Array.isArray(autoExecution.remainingChapterOrders)
    ? autoExecution.remainingChapterOrders.filter((item): item is number => Number.isInteger(item))
    : [];
}

export class AcceptanceUnavailableFinalizationService {
  constructor(private readonly deps: AcceptanceUnavailableFinalizationDeps) {}

  async finalize(input: { taskId: string; trigger: string }): Promise<AcceptanceUnavailableFinalizationResult> {
    const now = this.deps.now ?? Date.now;
    const unchanged = (reason: string): AcceptanceUnavailableFinalizationResult => ({
      changed: false, action: null, reason,
    });
    const task = await this.deps.loadTask(input.taskId);
    if (!task || task.lane !== "auto_director" || !task.novelId || task.cancelRequestedAt) {
      return unchanged("task_not_recoverable");
    }
    if (!(task.pendingManualRecovery || ["failed", "waiting_approval"].includes(task.status))) {
      return unchanged("task_not_paused");
    }
    const seed = isRecord(parseJson(task.seedPayloadJson)) ? parseJson(task.seedPayloadJson) as Recorded : null;
    const autoExecution = seed && isRecord(seed.autoExecution) ? seed.autoExecution : null;
    const jobId = text(autoExecution?.pipelineJobId);
    if (!seed || !autoExecution || !jobId) return unchanged("no_saved_range_job");

    const job = await this.deps.findJob(jobId);
    if (!job || job.novelId !== task.novelId || job.cancelRequestedAt) return unchanged("job_not_recoverable");
    if (job.status !== "failed") return unchanged("job_not_failed");
    const jobPayload = isRecord(parseJson(job.payload)) ? parseJson(job.payload) as Recorded : null;
    if (!jobPayload || text(jobPayload.workflowTaskId) !== task.id) return unchanged("job_belongs_to_another_task");
    const leaseActive = Boolean(job.executionOwner
      && (job.executionLeaseExpiresAt === null || job.executionLeaseExpiresAt.getTime() > now()));
    if (leaseActive) return unchanged("active_lease");

    // Target chapter must be the saved range's own pending chapter.
    const chapterIds = remainingIds(autoExecution);
    const chapterOrders = remainingOrders(autoExecution);
    const targetChapterId = chapterIds[0] ?? text(autoExecution.nextChapterId);
    const targetOrder = chapterOrders[0] ?? (Number.isInteger(autoExecution.nextChapterOrder) ? Number(autoExecution.nextChapterOrder) : null);
    if (!targetChapterId) return unchanged("no_target_chapter");
    const chapter = await this.deps.findChapter(task.novelId, targetChapterId);
    if (!chapter || chapter.novelId !== task.novelId) return unchanged("target_chapter_missing");
    if (job.currentItemKey && job.currentItemKey !== chapter.id) return unchanged("job_target_chapter_mismatch");
    if (chapter.order < job.startOrder || chapter.order > job.endOrder) return unchanged("chapter_outside_job_range");
    if (targetOrder !== null && chapter.order !== targetOrder) return unchanged("chapter_order_changed");
    if (!(chapter.content ?? "").trim()) return unchanged("no_saved_prose");
    if (chapter.chapterStatus === "completed" || chapter.generationState === "approved") {
      return unchanged("chapter_already_completed");
    }

    const journalRow = await this.deps.readJournal(task.novelId, chapter.id);
    if (!journalRow || journalRow.artifactType !== "production_execution"
      || journalRow.syncMode !== "journal" || journalRow.contentHash !== "active") {
      return unchanged("no_active_journal");
    }
    const journal = isRecord(parseJson(journalRow.metadataJson)) ? parseJson(journalRow.metadataJson) as Recorded : null;
    if (!journal || journal.version !== 1) return unchanged("journal_unreadable");
    if (text(journal.operationId) !== `pipeline:${job.id}:${chapter.id}`) return unchanged("journal_belongs_to_another_job");
    const journalRequest = isRecord(journal.request) ? journal.request : null;
    if (!journalRequest || text(journalRequest.entry) !== "pipeline"
      || text(journalRequest.workflowTaskId) !== task.id) return unchanged("journal_owner_mismatch");
    if (stepStatus(journal) === "running") return unchanged("journal_lease_active");
    if (hasUnknownJournalOutcome(journal)) return unchanged("unknown_external_call");
    if (typeof journal.expectedFingerprint !== "string"
      || journal.expectedFingerprint !== chapterFingerprint(chapter as JournalChapter)) {
      return unchanged("prose_fingerprint_changed");
    }

    const steps = isRecord(journal.steps) ? journal.steps : {};
    if (stepStatus(steps["pipeline.save_draft"]) !== "done" && stepStatus(steps["pipeline.draft"]) !== "done") {
      return unchanged("prose_not_saved");
    }
    const failedSteps = Object.entries(steps)
      .filter(([, step]) => stepStatus(step) === "failed")
      .map(([key, step]) => ({ key, error: stepError(step) }));
    const reviewFailures = failedSteps.filter((step) => REVIEW_STEP_PATTERN.test(step.key));
    const unrelatedFailures = failedSteps.filter((step) => !REVIEW_STEP_PATTERN.test(step.key) && !EVALUATION_STEP_PATTERN.test(step.key));
    if (unrelatedFailures.length > 0) return unchanged("unrelated_pipeline_failure");
    if (reviewFailures.length === 0) return unchanged("no_acceptance_review_failure");
    if (!reviewFailures.every((step) => isAcceptanceReviewFormatFailure(step.error))) {
      return unchanged("review_failure_not_acceptance_format");
    }
    const acceptanceError = reviewFailures[0]!.error || job.error || "";
    if (!isAcceptanceReviewFormatFailure(acceptanceError)) return unchanged("acceptance_failure_unclassified");
    const promptMatch = /\[([a-z0-9_.]+)@(v\d+)\]/i.exec(acceptanceError);
    const promptId = promptMatch && promptMatch[1]!.includes(ACCEPTANCE_PROMPT_PREFIX) ? `${promptMatch[1]}@${promptMatch[2]}` : null;

    const completedAt = new Date(now());
    const recordedAt = completedAt.toISOString();
    const errorSummary = acceptanceError.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" / ").slice(0, 400);
    const nextRemainingIds = chapterIds.filter((id) => id !== chapter.id);
    const nextRemainingOrders = chapterOrders.filter((order) => order !== chapter.order);
    const completedChapterCount = Math.min(
      Number.isInteger(autoExecution.totalChapterCount) ? Number(autoExecution.totalChapterCount) : 1,
      (Number.isInteger(autoExecution.completedChapterCount) ? Number(autoExecution.completedChapterCount) : 0) + 1,
    );
    const qualityDebtSummary = {
      chapterId: chapter.id,
      chapterOrder: chapter.order,
      reason: "验收评估在格式解析阶段失败，已保存正文按可用稿完成；验收失败证据保留，未生成通过结论。",
      source: "acceptance_unavailable",
      deferredAt: recordedAt,
    };
    const nextAutoExecution: Recorded = {
      ...autoExecution,
      pipelineStatus: "succeeded",
      completedChapterCount,
      remainingChapterCount: nextRemainingIds.length,
      remainingChapterIds: nextRemainingIds,
      remainingChapterOrders: nextRemainingOrders,
      nextChapterId: nextRemainingIds[0] ?? null,
      nextChapterOrder: nextRemainingOrders[0] ?? null,
      qualityDebtChapterIds: [...new Set([...(Array.isArray(autoExecution.qualityDebtChapterIds) ? autoExecution.qualityDebtChapterIds : []), chapter.id])],
      qualityDebtChapterOrders: [...new Set([...(Array.isArray(autoExecution.qualityDebtChapterOrders) ? autoExecution.qualityDebtChapterOrders : []), chapter.order])],
      qualityDebtSummaries: [...(Array.isArray(autoExecution.qualityDebtSummaries) ? autoExecution.qualityDebtSummaries : []), qualityDebtSummary].slice(-40),
    };
    const nextSeed: Recorded = { ...seed, autoExecution: nextAutoExecution };
    const nextRepairHistory = appendHistoryLine(chapter.repairHistory,
      `[acceptance_unavailable ${recordedAt}] event=degraded_completion job=${job.id} chapter=${chapter.order}`
      + ` failed=${reviewFailures.map((step) => step.key).join(",")} error=${errorSummary}`);
    const nextRiskFlags = mergeRiskFlag(chapter.riskFlags, "acceptance:acceptance_unavailable");
    const nextJobPayload: Recorded = {
      ...jobPayload,
      qualityAlertDetails: [...new Set([
        ...(Array.isArray(jobPayload.qualityAlertDetails) ? jobPayload.qualityAlertDetails.filter((item): item is string => typeof item === "string") : []),
        `第${chapter.order}章验收评估格式失败，已保存正文按可用稿完成并记录质量债；未生成通过结论。`,
      ])],
      acceptanceUnavailableEvidence: {
        chapterId: chapter.id,
        chapterOrder: chapter.order,
        promptId,
        failedSteps: reviewFailures.map((step) => step.key),
        error: acceptanceError.slice(0, 2000),
        trigger: input.trigger,
        recordedAt,
      },
    };
    const nextJournal: Recorded = {
      ...journal,
      status: "completed",
      steps: {
        ...steps,
        "pipeline.acceptance_unavailable": {
          status: "done",
          recordedAt,
          savedProseChars: (chapter.content ?? "").length,
          failedSteps: reviewFailures.map((step) => step.key),
          summary: errorSummary,
        },
      },
    };

    const persisted = await this.deps.persist({
      task: {
        id: task.id,
        expectedUpdatedAt: task.updatedAt,
        expectedSeedPayloadJson: task.seedPayloadJson ?? "{}",
        expectedStatus: task.status,
        expectedPendingManualRecovery: task.pendingManualRecovery,
        nextSeedPayloadJson: JSON.stringify(nextSeed),
      },
      chapter: {
        id: chapter.id,
        novelId: chapter.novelId,
        expectedContent: chapter.content ?? "",
        expectedGenerationState: chapter.generationState,
        expectedChapterStatus: chapter.chapterStatus,
        nextGenerationState: "approved",
        nextChapterStatus: "completed",
        nextRepairHistory,
        nextRiskFlags,
      },
      job: {
        id: job.id,
        expectedStatus: job.status,
        expectedUpdatedAt: job.updatedAt,
        expectedPayload: job.payload,
        nextPayload: JSON.stringify(nextJobPayload),
        completedAt,
      },
      journal: {
        id: journalRow.id,
        expectedMetadataJson: journalRow.metadataJson ?? "",
        nextMetadataJson: JSON.stringify(nextJournal),
      },
      evidence: {
        jobId: job.id,
        chapterId: chapter.id,
        chapterOrder: chapter.order,
        promptId,
        failedSteps: reviewFailures.map((step) => step.key),
        acceptanceError,
        recordedAt,
      },
    });
    if (!persisted) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节或任务状态已变化，未执行降级完成；请刷新后核对保留稿。");
    }
    return {
      changed: true,
      action: "completed_saved_prose_with_acceptance_unavailable_debt",
      reason: null,
      chapterId: chapter.id,
      chapterOrder: chapter.order,
      jobId: job.id,
    };
  }
}
