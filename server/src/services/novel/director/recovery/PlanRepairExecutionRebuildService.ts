import { prisma } from "../../../../db/prisma";
import { isTerminalPlanningRepairPhase } from "@ai-novel/shared/types/planningRepair/recovery";
import type { NovelWorkflowTaskStatus } from "@prisma/client";
import { logPipelineInfo, logPipelineWarn } from "../../novelCoreShared";
import {
  planStalePlanRepairExecutionRebuild,
  type StalePlanRepairExecutionChapterEvidence,
  type StalePlanRepairExecutionJobEvidence,
  type StalePlanRepairExecutionPlan,
} from "./DirectorRecoveryConvergence";

/**
 * Application layer for `planStalePlanRepairExecutionRebuild`.
 *
 * A planning repair that ended can leave `autoExecution.pipelineJobId` pointing at a range job
 * that lost its resumable chapter anchor. The task then rejects every continue/retry with
 * "原章节任务缺少可核对的恢复位置". This service retires that old job (keeping its row/error as
 * evidence), clears the stale binding and points the director at the chapter that is actually
 * pending, so the normal execution runtime creates a fresh `GenerationJob` from the saved chapter
 * plan. When no usable plan exists it only clears the binding and lets normal planning take over.
 *
 * All writes are CAS-guarded and idempotent: a concurrent change aborts without touching anything.
 */

const ACTIVE_JOB_STATUSES = ["queued", "running"] as const;
const SUPERSEDED_JOB_MESSAGE = "规划修复已结束，原执行任务缺少当前章节的恢复位置；已结束该任务并由新的章节执行任务从现有章纲重新开始。";

export interface RebuildTaskRow {
  id: string;
  novelId: string | null;
  status: NovelWorkflowTaskStatus;
  pendingManualRecovery: boolean;
  cancelRequestedAt: Date | null;
  updatedAt: Date;
  seedPayloadJson: string | null;
}

export interface RebuildJobRow {
  id: string;
  novelId: string;
  status: string;
  pendingManualRecovery: boolean;
  currentItemKey: string | null;
  payload: string | null;
  startOrder: number;
  endOrder: number;
  cancelRequestedAt: Date | null;
  executionOwner: string | null;
  executionLeaseExpiresAt: Date | null;
  updatedAt: Date;
  error: string | null;
}

export interface RebuildChapterRow {
  id: string;
  order: number;
  content: string | null;
  taskSheet: string | null;
  sceneCards: string | null;
}

export interface PlanRepairExecutionRebuildDeps {
  findJob: (id: string) => Promise<RebuildJobRow | null>;
  findChapter: (id: string) => Promise<RebuildChapterRow | null>;
  findFirstPendingChapter: (input: { novelId: string; startOrder: number; endOrder: number }) => Promise<RebuildChapterRow | null>;
  hasChapterLevelPlan: (chapterId: string) => Promise<boolean>;
  findActiveJournalMetadata: (input: { novelId: string; chapterId: string }) => Promise<string | null>;
  countActiveJobs: (novelId: string) => Promise<number>;
  updateTaskSeed: (input: {
    taskId: string;
    expectedUpdatedAt: Date;
    expectedSeedPayloadJson: string | null;
    expectedStatus: NovelWorkflowTaskStatus;
    expectedPendingManualRecovery: boolean;
    nextSeedPayloadJson: string;
  }) => Promise<boolean>;
  retireJob: (input: {
    job: RebuildJobRow;
    supersedeMessage: string;
    now: Date;
  }) => Promise<boolean>;
  now?: () => number;
}

export interface PlanRepairExecutionRebuildAction {
  action: "rebuild_execution" | "requires_planning";
  oldJobId: string;
  targetChapterId: string | null;
  targetChapterOrder: number | null;
}

export interface PlanRepairExecutionRebuildResult {
  changed: boolean;
  action: PlanRepairExecutionRebuildAction | null;
  reason: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(json: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readWorkflowTaskId(payload: string | null): string | null {
  const parsed = parseJsonRecord(payload);
  return parsed && typeof parsed.workflowTaskId === "string" ? parsed.workflowTaskId : null;
}

function readJournalEvidence(metadataJson: string | null): { status: string; hasUncertainStep: boolean } | null {
  if (!metadataJson) return null;
  const journal = parseJsonRecord(metadataJson);
  if (!journal) return null;
  const steps = record(journal.steps) ? journal.steps : {};
  const hasUncertainStep = Object.values(steps).some((step) => record(step)
    && (step.status === "unknown" || step.status === "running"))
    || Boolean(record(journal.values) && journal.values["stream.started"])
    || Boolean(record(journal.values) && journal.values["manual_repair.started"]);
  return {
    status: typeof journal.status === "string" ? journal.status : "",
    hasUncertainStep,
  };
}

function readExecutionRange(state: Record<string, unknown> | null): { startOrder: number; endOrder: number } | null {
  if (!state) return null;
  if (state.mode === "book") return null;
  const startOrder = typeof state.startOrder === "number" ? state.startOrder : Number.NaN;
  const endOrder = typeof state.endOrder === "number" ? state.endOrder : Number.NaN;
  return Number.isInteger(startOrder) && Number.isInteger(endOrder) && startOrder >= 1 && endOrder >= startOrder
    ? { startOrder, endOrder }
    : null;
}

function hasUsablePlan(input: {
  chapter: RebuildChapterRow;
  chapterLevelPlanExists: boolean;
}): boolean {
  return Boolean(input.chapter.taskSheet?.trim())
    || Boolean(input.chapter.sceneCards?.trim())
    || input.chapterLevelPlanExists;
}

export class PlanRepairExecutionRebuildService {
  constructor(private readonly deps: PlanRepairExecutionRebuildDeps) {}

  async converge(input: {
    task: RebuildTaskRow;
    seed: Record<string, unknown>;
    repairPhase: string | null;
    activeCommand: boolean;
    trigger: string;
  }): Promise<PlanRepairExecutionRebuildResult> {
    const { task, seed } = input;
    const autoExecution = record(seed.autoExecution) ? seed.autoExecution : null;
    const pipelineJobId = typeof autoExecution?.pipelineJobId === "string" && autoExecution.pipelineJobId.trim()
      ? autoExecution.pipelineJobId.trim()
      : null;
    const baseEvidence = {
      taskId: task.id,
      novelId: task.novelId ?? "",
      taskPaused: Boolean(task.pendingManualRecovery)
        || task.status === "waiting_approval"
        || task.status === "failed",
      cancelRequested: Boolean(task.cancelRequestedAt) || task.status === "cancelled",
      activeCommand: input.activeCommand,
      repairTerminalOrAbsent: !input.repairPhase || isTerminalPlanningRepairPhase(input.repairPhase),
      repairPhase: input.repairPhase,
      pipelineJobId,
    };
    if (!task.novelId || !pipelineJobId) {
      return { changed: false, action: null, reason: "no_saved_pipeline_job" };
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    const now = new Date(nowMs);
    const [job, activeJobCount] = await Promise.all([
      this.deps.findJob(pipelineJobId),
      this.deps.countActiveJobs(task.novelId),
    ]);
    const leaseActive = Boolean(job?.executionOwner && (() => {
      const expiry = job?.executionLeaseExpiresAt?.getTime();
      return expiry === undefined || !Number.isFinite(expiry) || expiry > nowMs;
    })());
    const jobEvidence: StalePlanRepairExecutionJobEvidence | null = job
      ? {
        id: job.id,
        novelId: job.novelId,
        status: job.status,
        pendingManualRecovery: job.pendingManualRecovery,
        currentItemKey: job.currentItemKey,
        payloadWorkflowTaskId: readWorkflowTaskId(job.payload),
        leaseActive,
        cancelRequestedAt: job.cancelRequestedAt,
        startOrder: job.startOrder,
        endOrder: job.endOrder,
      }
      : null;
    const executionRange = readExecutionRange(autoExecution);
    const nextChapter = await this.resolveNextChapter({
      novelId: task.novelId,
      autoExecution,
      executionRange,
      job,
    });
    const journal = nextChapter
      ? readJournalEvidence(await this.deps.findActiveJournalMetadata({
        novelId: task.novelId,
        chapterId: nextChapter.chapter.id,
      }).catch(() => null))
      : null;
    const plan: StalePlanRepairExecutionPlan = planStalePlanRepairExecutionRebuild({
      ...baseEvidence,
      activeJobInNovel: activeJobCount > 0,
      executionRange,
      job: jobEvidence,
      nextChapter: nextChapter?.evidence ?? null,
      journal,
    });
    if (plan.action === "none") {
      return { changed: false, action: null, reason: plan.reason };
    }

    const nextAutoExecution: Record<string, unknown> = {
      ...(autoExecution ?? {}),
      pipelineJobId: null,
      pipelineStatus: null,
    };
    if (plan.action === "rebuild_execution") {
      nextAutoExecution.nextChapterId = plan.targetChapterId;
      nextAutoExecution.nextChapterOrder = plan.targetChapterOrder;
    } else if (plan.targetChapterOrder != null) {
      // Force the normal planning path: the runtime plans this order before any prose starts.
      nextAutoExecution.nextChapterId = null;
      nextAutoExecution.nextChapterOrder = plan.targetChapterOrder;
    }
    const nextSeed: Record<string, unknown> = {
      ...seed,
      autoExecution: nextAutoExecution,
      planningRepairExecutionRebuild: {
        version: 1,
        action: plan.action,
        previousJobId: plan.previousJobId,
        targetChapterId: plan.action === "rebuild_execution" ? plan.targetChapterId : null,
        targetChapterOrder: plan.targetChapterOrder ?? null,
        rebuiltAt: now.toISOString(),
        trigger: input.trigger,
        reason: "planning_repair_terminal_unrecoverable_job",
      },
    };
    // The task seed is the authoritative binding: clear it before retiring the old job so a
    // crash between the two writes can never leave a task pointing at a retired job.
    const persisted = await this.deps.updateTaskSeed({
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
      expectedSeedPayloadJson: task.seedPayloadJson,
      expectedStatus: task.status,
      expectedPendingManualRecovery: task.pendingManualRecovery,
      nextSeedPayloadJson: JSON.stringify(nextSeed),
    });
    if (!persisted) {
      return { changed: false, action: null, reason: "task_seed_changed" };
    }
    const retired = await this.deps.retireJob({
      job: job!,
      supersedeMessage: `${SUPERSEDED_JOB_MESSAGE}${job?.error?.trim() ? `\n原失败记录：${job.error.trim()}` : ""}`,
      now,
    }).catch(() => false);
    if (!retired) {
      logPipelineWarn("旧执行任务未能标记结束，保留原失败证据；新的章节执行绑定已写入。", {
        taskId: task.id, trigger: input.trigger, jobId: plan.previousJobId, action: plan.action,
      });
    }
    logPipelineInfo(
      plan.action === "rebuild_execution"
        ? "规划修复结束后旧任务不可恢复，已按现有章纲重建章节执行绑定。"
        : "规划修复结束后旧任务不可恢复且当前章尚无可用章纲，已转入正常规划路径。",
      {
        taskId: task.id,
        trigger: input.trigger,
        action: plan.action,
        oldJobId: plan.previousJobId,
        retired: retired ? 1 : 0,
        targetChapterId: plan.action === "rebuild_execution" ? plan.targetChapterId : null,
        targetChapterOrder: plan.targetChapterOrder ?? null,
      },
    );
    return {
      changed: true,
      action: {
        action: plan.action,
        oldJobId: plan.previousJobId,
        targetChapterId: plan.action === "rebuild_execution" ? plan.targetChapterId : null,
        targetChapterOrder: plan.targetChapterOrder ?? null,
      },
      reason: null,
    };
  }

  private async resolveNextChapter(input: {
    novelId: string;
    autoExecution: Record<string, unknown> | null;
    executionRange: { startOrder: number; endOrder: number } | null;
    job: RebuildJobRow | null;
  }): Promise<{
    chapter: RebuildChapterRow;
    evidence: StalePlanRepairExecutionChapterEvidence;
  } | null> {
    const savedNextChapterId = typeof input.autoExecution?.nextChapterId === "string"
      && input.autoExecution.nextChapterId.trim()
      ? input.autoExecution.nextChapterId.trim()
      : null;
    let chapter = savedNextChapterId
      ? await this.deps.findChapter(savedNextChapterId).catch(() => null)
      : null;
    if (chapter && input.autoExecution) {
      const expectedOrder = typeof input.autoExecution.nextChapterOrder === "number"
        ? input.autoExecution.nextChapterOrder
        : chapter.order;
      if (chapter.order !== expectedOrder) {
        // A chapter id/order mismatch means the saved pointer is already stale; fall back to the
        // range scan below instead of trusting the id.
        chapter = null;
      }
    }
    if (!chapter && input.executionRange) {
      chapter = await this.deps.findFirstPendingChapter({
        novelId: input.novelId,
        startOrder: input.executionRange.startOrder,
        endOrder: input.executionRange.endOrder,
      }).catch(() => null);
    }
    if (!chapter) {
      return null;
    }
    const chapterLevelPlanExists = await this.deps.hasChapterLevelPlan(chapter.id).catch(() => false);
    return {
      chapter,
      evidence: {
        id: chapter.id,
        order: chapter.order,
        hasProse: Boolean((chapter.content ?? "").trim()),
        hasUsablePlan: hasUsablePlan({ chapter, chapterLevelPlanExists }),
      },
    };
  }
}

function defaultDeps(): PlanRepairExecutionRebuildDeps {
  return {
    findJob: (id) => prisma.generationJob.findUnique({
      where: { id },
      select: {
        id: true,
        novelId: true,
        status: true,
        pendingManualRecovery: true,
        currentItemKey: true,
        payload: true,
        startOrder: true,
        endOrder: true,
        cancelRequestedAt: true,
        executionOwner: true,
        executionLeaseExpiresAt: true,
        updatedAt: true,
        error: true,
      },
    }),
    findChapter: (id) => prisma.chapter.findUnique({
      where: { id },
      select: { id: true, order: true, content: true, taskSheet: true, sceneCards: true },
    }),
    findFirstPendingChapter: ({ novelId, startOrder, endOrder }) => prisma.chapter.findFirst({
      where: {
        novelId,
        order: { gte: startOrder, lte: endOrder },
        OR: [{ content: null }, { content: "" }],
      },
      orderBy: { order: "asc" },
      select: { id: true, order: true, content: true, taskSheet: true, sceneCards: true },
    }),
    hasChapterLevelPlan: async (chapterId) => (await prisma.storyPlan.count({
      where: { chapterId, level: "chapter", rawPlanJson: { not: null } },
    })) > 0,
    findActiveJournalMetadata: async ({ novelId, chapterId }) => {
      const row = await prisma.chapterArtifactSyncCheckpoint.findUnique({
        where: {
          novelId_chapterId_contentHash_artifactType_syncMode: {
            novelId,
            chapterId,
            contentHash: "active",
            artifactType: "production_execution",
            syncMode: "journal",
          },
        },
        select: { metadataJson: true },
      });
      return row?.metadataJson ?? null;
    },
    countActiveJobs: async (novelId) => prisma.generationJob.count({
      where: {
        novelId,
        status: { in: [...ACTIVE_JOB_STATUSES] },
        pendingManualRecovery: false,
      },
    }),
    updateTaskSeed: async (input) => {
      const updated = await prisma.novelWorkflowTask.updateMany({
        where: {
          id: input.taskId,
          updatedAt: input.expectedUpdatedAt,
          seedPayloadJson: input.expectedSeedPayloadJson,
          status: input.expectedStatus,
          pendingManualRecovery: input.expectedPendingManualRecovery,
          cancelRequestedAt: null,
        },
        data: {
          seedPayloadJson: input.nextSeedPayloadJson,
          heartbeatAt: new Date(),
        },
      });
      return updated.count === 1;
    },
    retireJob: async ({ job, supersedeMessage, now }) => {
      const updated = await prisma.generationJob.updateMany({
        where: {
          id: job.id,
          novelId: job.novelId,
          status: job.status as never,
          pendingManualRecovery: true,
          currentItemKey: job.currentItemKey,
          updatedAt: job.updatedAt,
          cancelRequestedAt: null,
          OR: [
            { executionOwner: null },
            { executionLeaseExpiresAt: null },
            { executionLeaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: "cancelled",
          pendingManualRecovery: false,
          currentStage: null,
          currentItemKey: null,
          currentItemLabel: null,
          heartbeatAt: null,
          finishedAt: now,
          error: supersedeMessage,
        },
      });
      return updated.count === 1;
    },
  };
}

export function createPlanRepairExecutionRebuildService(
  overrides: Partial<PlanRepairExecutionRebuildDeps> = {},
): PlanRepairExecutionRebuildService {
  return new PlanRepairExecutionRebuildService({ ...defaultDeps(), ...overrides });
}
