import type { NovelWorkflowTaskStatus } from "@prisma/client";
import { prisma } from "../../../../db/prisma";
import { logPipelineInfo, logPipelineWarn } from "../../novelCoreShared";
import { retirePreparationJournalIfSafe } from "./PreparationJournalRetirement";
import {
  planSupersededJournalOwnershipHandoff,
  type SupersededJournalOwnershipEvidence,
  type SupersededJournalOwnershipJournalEvidence,
  type SupersededJournalOwnershipJobEvidence,
  type SupersededJournalOwnershipPlan,
} from "./DirectorRecoveryConvergence";

/**
 * Application layer for `planSupersededJournalOwnershipHandoff`.
 *
 * A takeover task for an unwritten chapter can be blocked because a cancelled/superseded range
 * task still owns the chapter's paused preparation journal. The new job fails immediately with the
 * chapter-production ownership conflict and the chapter recovery endpoint refuses ("本章属于范围
 * 任务"). This service archives that exact preparation journal as superseded, retires the new
 * zero-work shell job and clears the task's stale execution binding so normal continue creates a
 * fresh execution for the pending chapter.
 *
 * Every write is CAS-guarded: a changed task seed, manuscript, job row, live lease/command, unknown
 * call or still-active old task aborts without touching anything. Old task/job rows are kept as
 * evidence; only the active journal slot moves to its archive record.
 */

const ACTIVE_COMMAND_STATUSES = ["queued", "leased", "running"] as const;
const OWNERSHIP_CONFLICT_FRAGMENTS = [
  "章节正文、执行约定或执行所有权已变化",
  "章节执行所有权已变化",
];
const HANDED_OVER_JOB_MESSAGE =
  "被取消旧任务遗留的章节执行记录已归档；已由新的章节执行任务接管本章。";

export interface HandoffTaskRow {
  id: string;
  novelId: string | null;
  lane: string;
  status: NovelWorkflowTaskStatus;
  pendingManualRecovery: boolean;
  cancelRequestedAt: Date | null;
  updatedAt: Date;
  seedPayloadJson: string | null;
}

export interface HandoffJobRow {
  id: string;
  novelId: string;
  status: string;
  pendingManualRecovery: boolean;
  currentItemKey: string | null;
  payload: string | null;
  cancelRequestedAt: Date | null;
  executionOwner: string | null;
  executionLeaseExpiresAt: Date | null;
  llmCallCount: number;
  totalTokens: number;
  completedCount: number;
  error: string | null;
}

export interface HandoffChapterRow {
  id: string;
  order: number;
  content: string | null;
  title: string;
  taskSheet: string | null;
  sceneCards: string | null;
  expectation: string | null;
  targetWordCount: number | null;
  mustAvoid: string | null;
  conflictLevel: number | null;
  revealLevel: number | null;
  hook: string | null;
}

export interface HandoffJournalRow {
  metadataJson: string;
  status: string;
}

export interface ChapterJournalOwnershipHandoffDeps {
  findTask: (id: string) => Promise<HandoffTaskRow | null>;
  findJob: (id: string) => Promise<HandoffJobRow | null>;
  findChapter: (id: string) => Promise<HandoffChapterRow | null>;
  findActiveJournal: (input: { novelId: string; chapterId: string }) => Promise<HandoffJournalRow | null>;
  countActiveCommands: (taskId: string) => Promise<number>;
  countActiveJobs: (input: { novelId: string; workflowTaskId?: string; excludeJobIds?: string[] }) => Promise<number>;
  apply: (input: {
    task: HandoffTaskRow;
    plan: Extract<SupersededJournalOwnershipPlan, { action: "handoff" }>;
    journalMetadataJson: string;
    now: number;
    trigger: string;
  }) => Promise<{ changed: boolean; reason?: string }>;
  now?: () => number;
}

export interface ChapterJournalOwnershipHandoffResult {
  changed: boolean;
  action: "handoff" | null;
  reason: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSeed(json: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonRecord(json: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json || "null");
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readWorkflowTaskId(payload: string | null): string | null {
  const parsed = parseJsonRecord(payload);
  return parsed && typeof parsed.workflowTaskId === "string" ? parsed.workflowTaskId : null;
}

function leaseActive(job: Pick<HandoffJobRow, "executionOwner" | "executionLeaseExpiresAt">, now: number): boolean {
  if (!job.executionOwner) return false;
  const expiry = job.executionLeaseExpiresAt?.getTime();
  return expiry === undefined || !Number.isFinite(expiry) || expiry > now;
}

function jobEvidence(job: HandoffJobRow, now: number): SupersededJournalOwnershipJobEvidence {
  return {
    id: job.id,
    novelId: job.novelId,
    status: job.status,
    pendingManualRecovery: job.pendingManualRecovery,
    currentItemKey: job.currentItemKey,
    payloadWorkflowTaskId: readWorkflowTaskId(job.payload),
    leaseActive: leaseActive(job, now),
    cancelRequestedAt: job.cancelRequestedAt,
    error: job.error,
    llmCallCount: job.llmCallCount,
    completedCount: job.completedCount,
  };
}

/** The new shell job must carry exactly the chapter-production ownership conflict. */
export function isChapterOwnershipConflictError(error: string | null | undefined): boolean {
  if (!error) return false;
  return OWNERSHIP_CONFLICT_FRAGMENTS.some(fragment => error.includes(fragment));
}

/** The old-range journal operation id encodes its owning job: `pipeline:<jobId>:<chapterId>`. */
export function readPipelineOwnerJobId(operationId: string): string | null {
  if (!operationId.startsWith("pipeline:")) return null;
  const rest = operationId.slice("pipeline:".length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  return rest.slice(0, separator);
}

function journalEvidence(
  journal: Record<string, unknown>,
  chapter: HandoffChapterRow,
  oldJobId: string | null,
  now: number,
): SupersededJournalOwnershipJournalEvidence {
  const request = record(journal.request) ? journal.request : {};
  const expectedChapter = record(journal.expectedChapter) ? journal.expectedChapter : null;
  const expectedContent = expectedChapter && typeof expectedChapter.content === "string" ? expectedChapter.content : "";
  const partialText = typeof journal.partialText === "string" ? journal.partialText : "";
  const expiresAt = typeof journal.expiresAt === "number" ? journal.expiresAt : 0;
  const steps = record(journal.steps) ? journal.steps : {};
  const stepEntries = Object.values(steps).filter(record) as Array<Record<string, unknown>>;
  return {
    operationId: typeof journal.operationId === "string" ? journal.operationId : "",
    status: typeof journal.status === "string" ? journal.status : "",
    workflowTaskId: typeof request.workflowTaskId === "string" ? request.workflowTaskId : null,
    leaseActive: journal.status === "running" && expiresAt > now,
    partialTextLength: partialText.trim().length,
    expectedContentLength: expectedContent.trim().length,
    expectedContentMatchesChapter: expectedContent.trim() === (chapter.content ?? "").trim(),
    hasUnknownOrRunningStep: stepEntries.some(step => step.status === "unknown" || step.status === "running"),
    belongsToOldJob: Boolean(oldJobId) && typeof journal.operationId === "string"
      && (journal.operationId === `pipeline:${oldJobId}:${chapter.id}`
        || journal.operationId.startsWith(`pipeline:${oldJobId}:${chapter.id}:`)),
  };
}

export class ChapterJournalOwnershipHandoffService {
  constructor(private readonly deps: ChapterJournalOwnershipHandoffDeps) {}

  async handoff(input: {
    task: HandoffTaskRow;
    seed: Record<string, unknown>;
    activeCommand: boolean;
    trigger: string;
  }): Promise<ChapterJournalOwnershipHandoffResult> {
    const now = (this.deps.now ?? Date.now)();
    const evidence = await this.inspect(input, now);
    if ("reason" in evidence) {
      return { changed: false, action: null, reason: evidence.reason };
    }
    const plan = planSupersededJournalOwnershipHandoff(evidence);
    if (plan.action === "none") return { changed: false, action: null, reason: plan.reason };
    try {
      const applied = await this.deps.apply({
        task: input.task,
        plan,
        journalMetadataJson: evidence.journalMetadataJson,
        now,
        trigger: input.trigger,
      });
      if (!applied.changed) {
        logPipelineWarn("被取消旧任务的章节日志所有权移交未应用，保留原恢复核对。", {
          taskId: input.task.id, trigger: input.trigger, reason: applied.reason ?? "apply_not_changed",
        });
        return { changed: false, action: null, reason: applied.reason ?? "apply_not_changed" };
      }
      logPipelineInfo("已归档被取消旧任务遗留的章节执行记录，新任务接管未写章节。", {
        taskId: input.task.id,
        trigger: input.trigger,
        action: "handed_over_superseded_chapter_journal",
        oldTaskId: plan.oldTaskId,
        oldJobId: plan.oldJobId,
        newJobId: plan.newJobId,
        oldJournalOperationId: plan.oldJournalOperationId,
        targetChapterId: plan.targetChapterId,
        targetChapterOrder: plan.targetChapterOrder,
      });
      return { changed: true, action: "handoff", reason: null };
    } catch (error) {
      logPipelineWarn("被取消旧任务的章节日志所有权移交写入失败，保留原恢复核对。", {
        taskId: input.task.id, trigger: input.trigger,
        error: error instanceof Error ? error.message : String(error),
      });
      return { changed: false, action: null, reason: "handoff_write_failed" };
    }
  }

  private async inspect(
    input: { task: HandoffTaskRow; seed: Record<string, unknown>; activeCommand: boolean },
    now: number,
  ): Promise<(SupersededJournalOwnershipEvidence & { journalMetadataJson: string }) | { reason: string }> {
    const task = input.task;
    if (!task.novelId) return { reason: "task_has_no_novel" };
    const seed = input.seed;
    const autoExecution = record(seed.autoExecution) ? seed.autoExecution : null;
    const pipelineJobId = autoExecution && typeof autoExecution.pipelineJobId === "string"
      ? autoExecution.pipelineJobId
      : null;
    if (!pipelineJobId) return { reason: "no_saved_job" };
    const newJob = await this.deps.findJob(pipelineJobId);
    if (!newJob) return { reason: "no_saved_job" };
    const targetChapterId = newJob.currentItemKey
      ?? (autoExecution && typeof autoExecution.nextChapterId === "string" ? autoExecution.nextChapterId : null);
    if (!targetChapterId) return { reason: "no_target_chapter" };
    const chapter = await this.deps.findChapter(targetChapterId);
    if (!chapter) return { reason: "no_target_chapter" };
    const journalRow = await this.deps.findActiveJournal({ novelId: task.novelId, chapterId: targetChapterId });
    if (!journalRow) return { reason: "no_active_journal" };
    const journal = parseJsonRecord(journalRow.metadataJson);
    if (!journal) return { reason: "journal_unreadable" };
    const operationId = typeof journal.operationId === "string" ? journal.operationId : "";
    const oldJobId = readPipelineOwnerJobId(operationId);
    const oldTaskId = record(journal.request) && typeof journal.request.workflowTaskId === "string"
      ? journal.request.workflowTaskId
      : null;
    const oldJob = oldJobId ? await this.deps.findJob(oldJobId) : null;
    const oldTask = oldTaskId ? await this.deps.findTask(oldTaskId) : null;
    const excludeJobIds = [newJob.id, oldJobId].filter((id): id is string => Boolean(id));
    const activeJobInNovel = (await this.deps.countActiveJobs({ novelId: task.novelId, excludeJobIds })) > 0;
    const oldTaskActiveCommands = oldTaskId ? (await this.deps.countActiveCommands(oldTaskId)) > 0 : false;
    const oldTaskActiveJobs = oldTaskId
      ? (await this.deps.countActiveJobs({ novelId: task.novelId, workflowTaskId: oldTaskId })) > 0
      : false;
    const newJobOwnsJournal = operationId.startsWith(`pipeline:${newJob.id}:`)
      || Boolean(record(journal.request) && journal.request.workflowTaskId === task.id);
    const evidence: SupersededJournalOwnershipEvidence = {
      taskId: task.id,
      novelId: task.novelId,
      taskPaused: task.pendingManualRecovery || task.status === "waiting_approval" || task.status === "failed",
      cancelRequested: Boolean(task.cancelRequestedAt) || task.status === "cancelled",
      activeCommand: input.activeCommand,
      activeJobInNovel,
      targetChapter: { id: chapter.id, order: chapter.order, hasProse: Boolean((chapter.content ?? "").trim()) },
      newJob: jobEvidence(newJob, now),
      newJobOwnershipConflict: isChapterOwnershipConflictError(newJob.error),
      newJobOwnsJournal,
      oldTask: oldTask
        ? {
          id: oldTask.id,
          status: oldTask.status,
          cancelledOrSuperseded: oldTask.status === "cancelled",
          hasActiveCommand: oldTaskActiveCommands,
          hasActiveJob: oldTaskActiveJobs,
        }
        : null,
      oldJob: oldJob ? jobEvidence(oldJob, now) : null,
      journal: journalEvidence(journal, chapter, oldJobId, now),
    };
    return { ...evidence, journalMetadataJson: journalRow.metadataJson };
  }
}

/** A missing journal cannot be handed over; the planner's `no_active_journal` reason applies. */

export function createChapterJournalOwnershipHandoffService(
  deps: ChapterJournalOwnershipHandoffDeps = defaultDeps(),
): ChapterJournalOwnershipHandoffService {
  return new ChapterJournalOwnershipHandoffService(deps);
}

function defaultDeps(): ChapterJournalOwnershipHandoffDeps {
  return {
    findTask: async id => prisma.novelWorkflowTask.findUnique({ where: { id } }),
    findJob: async id => prisma.generationJob.findUnique({
      where: { id },
      select: {
        id: true, novelId: true, status: true, pendingManualRecovery: true, currentItemKey: true, payload: true,
        cancelRequestedAt: true, executionOwner: true, executionLeaseExpiresAt: true,
        llmCallCount: true, totalTokens: true, completedCount: true, error: true,
      },
    }),
    findChapter: async id => prisma.chapter.findUnique({
      where: { id },
      select: {
        id: true, order: true, content: true, title: true, taskSheet: true, sceneCards: true, expectation: true,
        targetWordCount: true, mustAvoid: true, conflictLevel: true, revealLevel: true, hook: true,
      },
    }),
    findActiveJournal: async ({ novelId, chapterId }) => {
      const row = await prisma.chapterArtifactSyncCheckpoint.findUnique({
        where: {
          novelId_chapterId_contentHash_artifactType_syncMode: {
            novelId, chapterId, contentHash: "active", artifactType: "production_execution", syncMode: "journal",
          },
        },
        select: { metadataJson: true, status: true },
      });
      return row?.metadataJson ? { metadataJson: row.metadataJson, status: row.status } : null;
    },
    countActiveCommands: async taskId => prisma.directorRunCommand.count({
      where: { taskId, status: { in: [...ACTIVE_COMMAND_STATUSES] } },
    }),
    countActiveJobs: async ({ novelId, workflowTaskId, excludeJobIds }) => {
      const jobs = await prisma.generationJob.findMany({
        where: {
          novelId,
          status: { in: ["queued", "running"] },
          ...(excludeJobIds && excludeJobIds.length > 0 ? { id: { notIn: excludeJobIds } } : {}),
        },
        select: { payload: true },
      });
      if (!workflowTaskId) return jobs.length;
      return jobs.filter(job => readWorkflowTaskId(job.payload) === workflowTaskId).length;
    },
    apply: applyDefault,
    now: Date.now,
  };
}

async function applyDefault(input: {
  task: HandoffTaskRow;
  plan: Extract<SupersededJournalOwnershipPlan, { action: "handoff" }>;
  journalMetadataJson: string;
  now: number;
  trigger: string;
}): Promise<{ changed: boolean; reason?: string }> {
  const { task, plan, now } = input;
  if (!task.novelId) return { changed: false, reason: "task_has_no_novel" };
  try {
    await prisma.$transaction(async tx => {
      const freshTask = await tx.novelWorkflowTask.findUnique({ where: { id: task.id } });
      if (!freshTask || !freshTask.seedPayloadJson
        || freshTask.updatedAt.getTime() !== task.updatedAt.getTime()
        || freshTask.seedPayloadJson !== task.seedPayloadJson
        || freshTask.status !== task.status
        || freshTask.pendingManualRecovery !== task.pendingManualRecovery
        || freshTask.cancelRequestedAt) throw new Error("task_changed");
      const activeCommands = await tx.directorRunCommand.count({
        where: { taskId: task.id, status: { in: [...ACTIVE_COMMAND_STATUSES] } },
      });
      if (activeCommands > 0) throw new Error("active_command");
      const freshNewJob = await tx.generationJob.findUnique({
        where: { id: plan.newJobId },
        select: {
          id: true, novelId: true, status: true, pendingManualRecovery: true, currentItemKey: true, payload: true,
          cancelRequestedAt: true, executionOwner: true, executionLeaseExpiresAt: true,
          llmCallCount: true, totalTokens: true, completedCount: true, error: true,
        },
      });
      if (!freshNewJob || freshNewJob.novelId !== task.novelId || freshNewJob.status !== "failed"
        || !freshNewJob.pendingManualRecovery || freshNewJob.cancelRequestedAt
        || freshNewJob.currentItemKey !== plan.targetChapterId
        || readWorkflowTaskId(freshNewJob.payload) !== task.id
        || !isChapterOwnershipConflictError(freshNewJob.error)
        || freshNewJob.llmCallCount > 0 || freshNewJob.completedCount > 0
        || (freshNewJob.executionOwner && (() => {
          const expiry = freshNewJob.executionLeaseExpiresAt?.getTime();
          return expiry === undefined || !Number.isFinite(expiry) || expiry > now;
        })())) throw new Error("new_job_changed");

      const freshOldTask = await tx.novelWorkflowTask.findUnique({ where: { id: plan.oldTaskId } });
      if (!freshOldTask || freshOldTask.status !== "cancelled") throw new Error("old_task_active");
      const oldActiveCommands = await tx.directorRunCommand.count({
        where: { taskId: plan.oldTaskId, status: { in: [...ACTIVE_COMMAND_STATUSES] } },
      });
      if (oldActiveCommands > 0) throw new Error("old_task_active_command");
      const freshOldJob = await tx.generationJob.findUnique({
        where: { id: plan.oldJobId },
        select: { id: true, status: true, executionOwner: true, executionLeaseExpiresAt: true },
      });
      if (!freshOldJob || !["failed", "cancelled"].includes(freshOldJob.status)) throw new Error("old_job_active");
      if (freshOldJob.executionOwner) {
        const expiry = freshOldJob.executionLeaseExpiresAt?.getTime();
        if (expiry === undefined || !Number.isFinite(expiry) || expiry > now) throw new Error("old_job_lease_active");
      }

      const chapter = await tx.chapter.findUnique({
        where: { id: plan.targetChapterId },
        select: {
          id: true, order: true, content: true, title: true, taskSheet: true, sceneCards: true, expectation: true,
          targetWordCount: true, mustAvoid: true, conflictLevel: true, revealLevel: true, hook: true,
        },
      });
      if (!chapter || (chapter.content ?? "").trim()) throw new Error("target_chapter_has_prose");
      if (chapter.order !== plan.targetChapterOrder) throw new Error("target_chapter_changed");

      const activeJournal = await tx.chapterArtifactSyncCheckpoint.findUnique({
        where: {
          novelId_chapterId_contentHash_artifactType_syncMode: {
            novelId: task.novelId!, chapterId: plan.targetChapterId,
            contentHash: "active", artifactType: "production_execution", syncMode: "journal",
          },
        },
        select: { metadataJson: true, status: true },
      });
      if (!activeJournal || activeJournal.metadataJson !== input.journalMetadataJson) throw new Error("journal_changed");
      const retirement = await retirePreparationJournalIfSafe(tx, {
        novelId: task.novelId,
        chapterId: plan.targetChapterId,
        expectedOperationId: plan.oldJournalOperationId,
        taskId: plan.oldTaskId,
        now,
      });
      if (retirement.status !== "retired") {
        throw new Error(`journal_retirement_blocked:${retirement.status === "blocked" ? retirement.reason : "none"}`);
      }

      const retiredShell = await tx.generationJob.updateMany({
        where: {
          id: plan.newJobId,
          status: "failed",
          pendingManualRecovery: true,
          currentItemKey: plan.targetChapterId,
          cancelRequestedAt: null,
          llmCallCount: 0,
          totalTokens: 0,
          completedCount: 0,
          OR: [{ executionOwner: null }, { executionLeaseExpiresAt: null }, { executionLeaseExpiresAt: { lte: new Date(now) } }],
        },
        data: {
          status: "cancelled",
          pendingManualRecovery: false,
          error: `${HANDED_OVER_JOB_MESSAGE}${freshNewJob.error?.trim() ? `\n原失败记录：${freshNewJob.error.trim()}` : ""}`,
          heartbeatAt: null,
          currentStage: null,
          currentItemKey: null,
          currentItemLabel: null,
          finishedAt: new Date(now),
        },
      });
      if (retiredShell.count !== 1) throw new Error("new_job_changed");

      const freshSeed = parseSeed(freshTask.seedPayloadJson);
      if (!freshSeed) throw new Error("seed_unreadable");
      const autoExecution = record(freshSeed.autoExecution) ? freshSeed.autoExecution : {};
      const nextSeed: Record<string, unknown> = {
        ...freshSeed,
        autoExecution: {
          ...autoExecution,
          pipelineJobId: null,
          pipelineStatus: null,
          nextChapterId: plan.targetChapterId,
          nextChapterOrder: plan.targetChapterOrder,
        },
        chapterJournalOwnershipHandoff: {
          version: 1,
          oldTaskId: plan.oldTaskId,
          oldJobId: plan.oldJobId,
          oldJournalOperationId: plan.oldJournalOperationId,
          archiveContentHash: retirement.archiveContentHash,
          newJobId: plan.newJobId,
          chapterId: plan.targetChapterId,
          chapterOrder: plan.targetChapterOrder,
          handedOverAt: new Date(now).toISOString(),
          trigger: input.trigger,
          source: "cancelled_task_superseded_journal",
        },
      };
      const updatedTask = await tx.novelWorkflowTask.updateMany({
        where: {
          id: task.id,
          updatedAt: task.updatedAt,
          seedPayloadJson: task.seedPayloadJson,
          status: task.status,
          pendingManualRecovery: task.pendingManualRecovery,
          cancelRequestedAt: null,
        },
        data: { seedPayloadJson: JSON.stringify(nextSeed), heartbeatAt: new Date(now) },
      });
      if (updatedTask.count !== 1) throw new Error("task_changed");
    }, { isolationLevel: "Serializable", timeout: 20_000 });
    return { changed: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logPipelineWarn("章节日志所有权移交事务未应用。", { taskId: task.id, trigger: input.trigger, reason });
    return { changed: false, reason };
  }
}
