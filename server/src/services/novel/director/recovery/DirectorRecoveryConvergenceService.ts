import { isTerminalPlanningRepairPhase } from "@ai-novel/shared/types/planningRepair/recovery";
import type { NovelWorkflowTaskStatus } from "@prisma/client";
import { prisma } from "../../../../db/prisma";
import { createChapterPipelineRecoveryService } from "../../production/recovery";
import { chapterFingerprint, type JournalChapter } from "../../production/reliability";
import { planningRepairStore } from "../../volume/planningRepair/PlanningRepairStore";
import { logPipelineInfo, logPipelineWarn } from "../../novelCoreShared";
import {
  planDisplacedPipelineBindingConvergence,
  planStalePlanningRepairConvergence,
  planTerminalRepairBindingCleanup,
  type BindingJobEvidence,
  type BindingJournalEvidence,
  type PlanningRepairConvergenceEvidence,
} from "./DirectorRecoveryConvergence";
import { createPlanRepairExecutionRebuildService } from "./PlanRepairExecutionRebuildService";

const ACTIVE_COMMAND_STATUSES = ["queued", "leased", "running"] as const;
const TERMINAL_REPAIR_AUTO_ABANDON_REASON =
  "自动恢复：规划修复会话停留在旧的复核阶段，没有任何在途调用或命令；按用户的继续请求结束该会话，计划与正文均未改动。";

export interface DirectorRecoveryConvergenceResult {
  changed: boolean;
  actions: string[];
}

interface TaskRow {
  id: string;
  novelId: string | null;
  lane: string;
  status: NovelWorkflowTaskStatus;
  pendingManualRecovery: boolean;
  cancelRequestedAt: Date | null;
  updatedAt: Date;
  seedPayloadJson: string | null;
}

type Seed = Record<string, unknown>;

function parseSeed(json: string | null | undefined): Seed | null {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Seed : null;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Seed {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Repair state is read defensively: a malformed seed must keep its pause, not converge it. */
function readRepair(seed: Seed): (PlanningRepairConvergenceEvidence & { key: string }) | null {
  const repair = seed.planningRepair;
  if (!record(repair) || repair.version !== 1 || typeof repair.key !== "string"
    || typeof repair.phase !== "string" || !Array.isArray(repair.history)) return null;
  const recovery = seed.planningRepairRecovery;
  return {
    key: repair.key,
    phase: repair.phase,
    pendingOperation: repair.pendingOperation,
    repairOutputPending: repair.repairOutputPending,
    pendingGrant: record(recovery) ? recovery.pendingGrant : undefined,
  };
}

function readPayloadWorkflowTaskId(payloadJson: string | null): string | null {
  try {
    const payload: unknown = JSON.parse(payloadJson || "{}");
    return record(payload) && typeof payload.workflowTaskId === "string" ? payload.workflowTaskId : null;
  } catch {
    return null;
  }
}

function readActiveJournal(json: string | null): Record<string, unknown> | null {
  try {
    const journal: unknown = JSON.parse(json || "null");
    return record(journal) ? journal : null;
  } catch {
    return null;
  }
}

function hasUncertainJournalStep(journal: Record<string, unknown>): boolean {
  const steps = record(journal.steps) ? journal.steps : {};
  if (Object.values(steps).some(step => record(step) && (step.status === "unknown" || step.status === "running"))) {
    return true;
  }
  const values = record(journal.values) ? journal.values : {};
  if (values["stream.started"] && !(record(steps["stream.normalize"]) && steps["stream.normalize"].status === "done")) return true;
  return Boolean(values["manual_repair.started"] && !values["manual_repair.content"]);
}

function journalEvidence(
  journal: Record<string, unknown>,
  chapterId: string,
  now: number,
): BindingJournalEvidence | null {
  const operationId = typeof journal.operationId === "string" ? journal.operationId : null;
  const request = record(journal.request) ? journal.request : {};
  const expiresAt = typeof journal.expiresAt === "number" ? journal.expiresAt : 0;
  if (!operationId) return null;
  return {
    operationId,
    status: typeof journal.status === "string" ? journal.status : "",
    entry: typeof request.entry === "string" ? request.entry : null,
    workflowTaskId: typeof request.workflowTaskId === "string" ? request.workflowTaskId : null,
    expiresAt,
    chapterId,
    hasUncertainStep: hasUncertainJournalStep(journal),
  };
}

function bindingJobEvidence(row: {
  id: string; novelId: string; status: string; pendingManualRecovery: boolean;
  startOrder: number; endOrder: number; payload: string | null;
  llmCallCount: number; totalTokens: number; completedCount: number;
  cancelRequestedAt: Date | null; executionOwner: string | null; executionLeaseExpiresAt: Date | null;
}, now: number): BindingJobEvidence {
  const leaseExpiry = row.executionLeaseExpiresAt?.getTime();
  return {
    id: row.id,
    novelId: row.novelId,
    status: row.status,
    pendingManualRecovery: row.pendingManualRecovery,
    startOrder: row.startOrder,
    endOrder: row.endOrder,
    payloadWorkflowTaskId: readPayloadWorkflowTaskId(row.payload),
    payload: row.payload ?? "",
    llmCallCount: row.llmCallCount,
    totalTokens: row.totalTokens,
    completedCount: row.completedCount,
    cancelRequestedAt: row.cancelRequestedAt,
    leaseActive: Boolean(row.executionOwner
      && (leaseExpiry === undefined || !Number.isFinite(leaseExpiry) || leaseExpiry > now)),
  };
}

const BINDING_JOB_SELECT = {
  id: true, novelId: true, status: true, pendingManualRecovery: true, startOrder: true, endOrder: true,
  payload: true, llmCallCount: true, totalTokens: true, completedCount: true, cancelRequestedAt: true,
  executionOwner: true, executionLeaseExpiresAt: true, currentItemKey: true,
} as const;

/**
 * Reconciles execution rows that are factually finished or technically abandoned before an
 * explicit auto-director continue/retry is accepted.
 *
 * This is deliberately not a general-purpose "fix any pause" routine. It only converges:
 *  1. a planning-repair session stuck in `reviewing` with no in-flight operation or command;
 *  2. execution bindings left behind by an already terminal (abandoned/committed) repair session;
 *  3. a paused range job whose target chapter is saved and journal-completed (via the strict
 *     chapter recovery preflight);
 *  4. a displaced failed job pointer whose journal is still owned by the original range job;
 *  5. a terminal planning-repair pause whose saved range job lost its resumable chapter anchor —
 *     a new execution binding is rebuilt for the pending chapter when it already has a usable
 *     plan, otherwise the task is routed to normal planning (never blind prose).
 *
 * Unknown external calls, active leases, changed manuscripts, incomplete prose and live commands
 * are all left untouched so the strict recovery preflight keeps blocking with its source-page
 * confirmation message.
 */
export class DirectorRecoveryConvergenceService {
  async converge(input: {
    taskId: string;
    trigger: string;
    /**
     * A command that carries an explicit planning-repair authorization is retrying that repair,
     * not giving it up. In that case the stale review session must be preserved for the recovery
     * preflight to use; only the plain "继续自动导演" intent may converge it.
     */
    preservePlanningRepairSession?: boolean;
  }): Promise<DirectorRecoveryConvergenceResult> {
    const actions: string[] = [];
    let task = await prisma.novelWorkflowTask.findUnique({ where: { id: input.taskId } });
    if (!task || task.lane !== "auto_director" || task.cancelRequestedAt) return { changed: false, actions };
    // Only a paused boundary is eligible. A live queued/running task must keep its own execution.
    if (!task.pendingManualRecovery && !["waiting_approval", "failed"].includes(task.status)) {
      return { changed: false, actions };
    }
    let seed = parseSeed(task.seedPayloadJson);
    if (!seed) return { changed: false, actions };
    const activeCommand = (await prisma.directorRunCommand.count({
      where: { taskId: task.id, status: { in: [...ACTIVE_COMMAND_STATUSES] } },
    })) > 0;
    const taskPaused = task.pendingManualRecovery || task.status === "waiting_approval" || task.status === "failed";

    // 1. A repair session frozen in review with no in-flight marker: the explicit continue means
    //    "give the review up, rebuild the chapter", not "retry the same stuck session". An explicit
    //    repair authorization key means the opposite intent and must leave the session alone.
    if (!input.preservePlanningRepairSession
      && planStalePlanningRepairConvergence({ repair: readRepair(seed), taskPaused, activeCommand }).action === "abandon") {
      try {
        await planningRepairStore.abandon({ taskId: task.id, reason: TERMINAL_REPAIR_AUTO_ABANDON_REASON });
        actions.push("abandoned_stale_planning_repair");
        logPipelineInfo("规划修复陈旧复核会话已自动收敛为放弃，将继续原任务的重新规划。", {
          taskId: task.id, trigger: input.trigger, action: "abandoned_stale_planning_repair",
        });
        task = await prisma.novelWorkflowTask.findUnique({ where: { id: task.id } }) ?? task;
        seed = parseSeed(task.seedPayloadJson) ?? seed;
      } catch (error) {
        logPipelineWarn("规划修复陈旧会话自动收敛未应用，保留原暂停。", {
          taskId: task.id, trigger: input.trigger,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. An abandoned/committed repair no longer owns a grant or a pipeline binding. Keeping those
    //    stale keys makes later explicit retries read "repair still pending" even though it is over.
    const currentRepair = readRepair(seed);
    const recoveryBinding = record(seed.planningRepairRecovery) ? seed.planningRepairRecovery : null;
    if (planTerminalRepairBindingCleanup({
      repair: currentRepair,
      hasRecoveryBinding: seed.planningRepairRecovery !== undefined,
      hasPipelineBinding: seed.planningRepairPipelineRecovery !== undefined,
      hasPendingGrant: Boolean(recoveryBinding?.pendingGrant),
    }).clear) {
      const nextSeed: Seed = { ...seed };
      delete nextSeed.planningRepairRecovery;
      delete nextSeed.planningRepairPipelineRecovery;
      if (await this.casTaskSeed(task, nextSeed)) {
        actions.push("cleared_terminal_planning_repair_bindings");
        logPipelineInfo("已清理终态规划修复遗留的执行绑定，保留修复证据与候选。", {
          taskId: task.id, trigger: input.trigger, action: "cleared_terminal_planning_repair_bindings",
        });
        task = await prisma.novelWorkflowTask.findUnique({ where: { id: task.id } }) ?? task;
        seed = parseSeed(task.seedPayloadJson) ?? nextSeed;
      }
    }

    const autoExecution = record(seed.autoExecution) ? seed.autoExecution : null;
    const pipelineJobId = typeof autoExecution?.pipelineJobId === "string" ? autoExecution.pipelineJobId : null;

    // 3. The saved range job is stale because its target chapter already finished: complete the
    //    technical job row through the strict chapter preflight, then let the normal path continue
    //    with the next chapter. Unknown calls / changed prose / active leases make it return null.
    if (pipelineJobId && task.novelId && !activeCommand) {
      try {
        const converged = await createChapterPipelineRecoveryService().reconcileStaleCompletedChapterJob(
          pipelineJobId,
          { novelId: task.novelId, directorTaskId: task.id },
        );
        if (converged) {
          actions.push("completed_stale_chapter_job");
          logPipelineInfo("已完成章节对应的陈旧范围任务已收敛为成功，继续自动导演。", {
            taskId: task.id, trigger: input.trigger, jobId: pipelineJobId, action: "completed_stale_chapter_job",
          });
        }
      } catch (error) {
        logPipelineWarn("陈旧范围任务收敛未应用，保留原有恢复核对。", {
          taskId: task.id, trigger: input.trigger, jobId: pipelineJobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 4. A failed retry wrote itself into the task pointer but never owned the paused preparation
    //    journal. Re-point at the original range job (the journal owner) and retire the shell job.
    if (pipelineJobId && task.novelId && !activeCommand && autoExecution?.pipelineStatus === "failed") {
      const plan = await this.planDisplacedBinding(task, pipelineJobId, String(autoExecution.pipelineStatus), currentRepair, Date.now());
      if (plan) {
        const nextSeed: Seed = {
          ...seed,
          autoExecution: { ...autoExecution, pipelineJobId: plan.originalJobId, pipelineStatus: plan.originalJobStatus },
        };
        if (await this.casTaskSeed(task, nextSeed)) {
          await this.retireDisplacedJob(plan.displacedJobId);
          actions.push("repointed_displaced_pipeline_job");
          logPipelineInfo("已把陈旧任务指针收敛回实际持有章节日志的原任务，继续自动导演。", {
            taskId: task.id, trigger: input.trigger, action: "repointed_displaced_pipeline_job",
            originalJobId: plan.originalJobId, displacedJobId: plan.displacedJobId,
          });
          task = await prisma.novelWorkflowTask.findUnique({ where: { id: task.id } }) ?? task;
          seed = parseSeed(task.seedPayloadJson) ?? nextSeed;
        }
      }
    }

    // 5. A terminal planning repair can leave `autoExecution.pipelineJobId` pointing at a range
    //    job that lost its resumable chapter anchor (no `currentItemKey`, stale scope). Rebuild a
    //    fresh execution binding for the chapter that is actually pending when it already has a
    //    saved plan; if it has no plan, clear the dead binding so normal planning takes over.
    //    All writes are CAS-guarded; prose, unknown calls and active leases keep the strict block.
    {
      const freshTask = await prisma.novelWorkflowTask.findUnique({ where: { id: input.taskId } });
      if (freshTask) {
        try {
          const freshSeed = parseSeed(freshTask.seedPayloadJson) ?? seed;
          const rebuild = await createPlanRepairExecutionRebuildService().converge({
            task: freshTask,
            seed: freshSeed,
            repairPhase: readRepair(freshSeed)?.phase ?? null,
            activeCommand,
            trigger: input.trigger,
          });
          if (rebuild.changed && rebuild.action) {
            actions.push(rebuild.action.action === "rebuild_execution"
              ? "rebuilt_stale_plan_repair_execution"
              : "routed_stale_plan_repair_to_planning");
          }
        } catch (error) {
          logPipelineWarn("规划修复终止后的执行绑定重建未应用，保留原有恢复核对。", {
            taskId: input.taskId, trigger: input.trigger,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return { changed: actions.length > 0, actions };
  }

  private async casTaskSeed(task: TaskRow, nextSeed: Seed): Promise<boolean> {
    const updated = await prisma.novelWorkflowTask.updateMany({
      where: {
        id: task.id,
        updatedAt: task.updatedAt,
        seedPayloadJson: task.seedPayloadJson,
        status: task.status,
        pendingManualRecovery: task.pendingManualRecovery,
        cancelRequestedAt: null,
      },
      data: { seedPayloadJson: JSON.stringify(nextSeed), heartbeatAt: new Date() },
    });
    return updated.count === 1;
  }

  private async planDisplacedBinding(
    task: TaskRow,
    seedPipelineJobId: string,
    seedPipelineStatus: string,
    repair: { phase: string } | null,
    now: number,
  ): Promise<{ displacedJobId: string; originalJobId: string; originalJobStatus: string } | null> {
    if (!task.novelId) return null;
    const displaced = await prisma.generationJob.findUnique({ where: { id: seedPipelineJobId }, select: BINDING_JOB_SELECT });
    if (!displaced || displaced.novelId !== task.novelId || !displaced.currentItemKey) return null;
    const activeJobInNovel = (await prisma.generationJob.count({
      where: { novelId: task.novelId, status: { in: ["queued", "running"] } },
    })) > 0;
    if (activeJobInNovel) return null;
    const journalRows = await prisma.chapterArtifactSyncCheckpoint.findMany({
      where: { novelId: task.novelId, artifactType: "production_execution", syncMode: "journal" },
      select: { chapterId: true, contentHash: true, metadataJson: true },
    });
    const parsed = journalRows.map(row => ({ row, journal: readActiveJournal(row.metadataJson) }));
    // Never re-point away from a job that actually owns an execution record of its own.
    if (parsed.some(entry => entry.journal && typeof entry.journal.operationId === "string"
      && entry.journal.operationId.startsWith(`pipeline:${displaced.id}:`))) return null;
    const activeEntry = parsed.find(entry => entry.row.chapterId === displaced.currentItemKey && entry.row.contentHash === "active");
    if (!activeEntry?.journal) return null;
    const journal = journalEvidence(activeEntry.journal, displaced.currentItemKey, now);
    if (!journal) return null;
    const originalJobId = journal.operationId.slice("pipeline:".length, journal.operationId.lastIndexOf(":"));
    if (!originalJobId || originalJobId.includes(":") || originalJobId === displaced.id) return null;
    const original = await prisma.generationJob.findUnique({ where: { id: originalJobId }, select: BINDING_JOB_SELECT });
    if (!original || !original.currentItemKey || original.currentItemKey !== displaced.currentItemKey) return null;
    const chapter = await prisma.chapter.findUnique({
      where: { id: displaced.currentItemKey },
      select: {
        id: true, novelId: true, order: true, content: true, title: true, taskSheet: true, sceneCards: true,
        expectation: true, targetWordCount: true, mustAvoid: true, conflictLevel: true, revealLevel: true, hook: true,
      },
    });
    if (!chapter) return null;
    let fingerprintMatchesJournal = false;
    try {
      fingerprintMatchesJournal = typeof activeEntry.journal.expectedFingerprint === "string"
        && chapterFingerprint(chapter as JournalChapter) === activeEntry.journal.expectedFingerprint;
    } catch {
      fingerprintMatchesJournal = false;
    }
    return planDisplacedPipelineBindingConvergence({
      seedPipelineJobId,
      seedPipelineStatus,
      displacedJob: bindingJobEvidence(displaced, now),
      originalJob: bindingJobEvidence(original, now),
      activeJobInNovel,
      activeCommand: false,
      repairTerminalOrAbsent: !repair || isTerminalPlanningRepairPhase(repair.phase),
      chapter: {
        id: chapter.id,
        order: chapter.order,
        hasProse: Boolean((chapter.content ?? "").trim()),
        fingerprintMatchesJournal,
      },
      journal,
      now,
    });
  }

  private async retireDisplacedJob(jobId: string): Promise<void> {
    try {
      const retired = await prisma.generationJob.updateMany({
        where: {
          id: jobId,
          status: "failed",
          pendingManualRecovery: true,
          cancelRequestedAt: null,
          llmCallCount: 0,
          totalTokens: 0,
          completedCount: 0,
          OR: [{ executionOwner: null }, { executionLeaseExpiresAt: null }, { executionLeaseExpiresAt: { lte: new Date() } }],
        },
        data: {
          status: "cancelled",
          pendingManualRecovery: false,
          error: "旧恢复任务已由实际持有章节执行记录的原任务接管；本次重试没有执行任何外部调用。",
          heartbeatAt: null,
          currentStage: null,
          currentItemKey: null,
          currentItemLabel: null,
          finishedAt: new Date(),
        },
      });
      if (retired.count !== 1) {
        logPipelineWarn("陈旧替换任务未标记结束，已保留原失败证据。", { jobId });
      }
    } catch (error) {
      logPipelineWarn("陈旧替换任务结束标记写入失败，已保留原失败证据。", {
        jobId, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createDirectorRecoveryConvergenceService(): DirectorRecoveryConvergenceService {
  return new DirectorRecoveryConvergenceService();
}
