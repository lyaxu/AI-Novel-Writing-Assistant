import { prisma } from "../../../../../db/prisma";
import { AppError } from "../../../../../middleware/errorHandler";
import { NovelWorkflowService } from "../../../workflow/NovelWorkflowService";
import { buildNovelEditResumeTarget } from "../../../workflow/novelWorkflow.shared";
import { isPlanningRepairConfirmationError, readPlanningRepairSeed, resolvePlanningRepairResumePhase } from "./planningRepairRecovery";
import { PlanningRepairStore } from "../../../volume/planningRepair/PlanningRepairStore";
import { isPlanningRepairConfirmationPhase, isPlanningRepairTaskPaused, isTerminalPlanningRepairPhase } from "@ai-novel/shared/types/planningRepair/recovery";
import { readPipelinePauseProjection } from "../pipelinePause";

export class PlanningRepairRecoveryService {
  constructor(
    private readonly workflow = new NovelWorkflowService(),
    private readonly repairStore: Pick<PlanningRepairStore, "rebase"> = new PlanningRepairStore(),
  ) {}

  async capturePipelineFailureBoundary(taskId: string) {
    return this.workflow.getTaskByIdWithoutHealing(taskId);
  }

  async pauseAfterPipelineFailure(taskId: string, pipelineJobId: string, error: unknown,
    expected: Awaited<ReturnType<PlanningRepairRecoveryService["capturePipelineFailureBoundary"]>>,
  ): Promise<boolean> {
    if (!expected || !isPlanningRepairConfirmationError(error) || expected.pendingManualRecovery
      || expected.cancelRequestedAt || !["queued", "running"].includes(expected.status)) return false;
    const row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row || row.id !== expected.id || row.novelId !== expected.novelId || row.lane !== "auto_director"
      || row.lane !== expected.lane || !["queued", "running"].includes(row.status)
      || row.pendingManualRecovery || row.cancelRequestedAt
      || row.attemptCount !== expected.attemptCount
      || row.startedAt?.getTime() !== expected.startedAt?.getTime()) return false;
    const current = readPlanningRepairSeed(row.seedPayloadJson);
    const original = readPlanningRepairSeed(expected.seedPayloadJson);
    if (!original.repair || !current.repair || current.repair.novelId !== row.novelId || isTerminalPlanningRepairPhase(current.repair.phase)
      || current.repair.key !== original.repair.key
      || current.recovery?.idempotencyKey !== original.recovery?.idempotencyKey
      || current.recovery?.pendingGrant) return false;
    const execution = current.seed.autoExecution as { pipelineJobId?: string } | undefined;
    if (execution?.pipelineJobId !== pipelineJobId) return false;
    const job = await prisma.generationJob.findUnique({ where: { id: pipelineJobId } });
    if (!job || job.novelId !== row.novelId || job.cancelRequestedAt || job.status === "cancelled") return false;
    let payload: { workflowTaskId?: string };
    try { payload = JSON.parse(job.payload || "{}"); } catch { return false; }
    if (payload.workflowTaskId !== taskId) return false;
    await this.pauseAfterFailure(taskId, error, row);
    return true;
  }

  async statusByNovel(novelId: string) {
    const rows = await this.workflow.getVisibleRowsByNovelIdRaw(novelId, "auto_director");
    return rows[0] ? this.status(rows[0].id) : null;
  }

  async pauseIfNeeded(taskId: string): Promise<boolean> {
    const row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    const { repair } = readPlanningRepairSeed(row?.seedPayloadJson);
    if (!repair || !isPlanningRepairConfirmationPhase(repair.phase)) return false;
    await this.pauseAfterFailure(taskId);
    return true;
  }

  async status(taskId: string) {
    // Read without workflow healing: viewing a repair must never resume it.
    const row = await prisma.novelWorkflowTask.findUnique({ where: { id: taskId } });
    if (!row || row.lane !== "auto_director") throw new AppError("自动导演任务不存在。", 404);
    const { repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
    const view = await readPipelinePauseProjection(row);
    const recoveryRequest = recovery?.idempotencyKey && recovery.guidance
      && repair && (recovery.pendingGrant || !["waiting_confirmation", "uncertain", "committed"].includes(repair.phase)
        || (view !== row && view.currentItemKey === "planning_repair_confirmation"))
      && isPlanningRepairTaskPaused(view)
      ? { idempotencyKey: recovery.idempotencyKey, guidance: recovery.guidance, executionMode: recovery.executionMode, affectedChapterIds: recovery.affectedChapterIds } : null;
    return { taskId, novelId: row.novelId, status: view.status, pendingManualRecovery: view.pendingManualRecovery, cancelRequestedAt: row.cancelRequestedAt, planningRepair: repair, recoveryRequest };
  }

  async pauseAfterFailure(taskId: string, error?: unknown,
    expectedRow?: Awaited<ReturnType<PlanningRepairRecoveryService["capturePipelineFailureBoundary"]>>,
  ): Promise<void> {
    let row = expectedRow ?? await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row || row.status === "cancelled" || row.cancelRequestedAt) return;
    const { seed, repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
    if (!repair) throw new AppError("规划修复缺少持久化状态。", 409);
    if (repair.novelId !== row.novelId || isTerminalPlanningRepairPhase(repair.phase)) throw new AppError("规划修复归属或状态已变化。", 409);
    const technicalError = error instanceof Error ? error.message : undefined;
    const executionConflict = expectedRow && error && typeof error === "object" && "code" in error
      && error.code === "PLANNING_REPAIR_CONFLICT";
    const summary = executionConflict
      ? "章节规划修复的执行状态发生变化。候选和修复轮次已保留，请回到节奏 / 拆章工作区确认后继续。"
      : technicalError ?? repair.summary ?? "规划修复需要确认。";
    const waitingRepair = { ...repair, phase: repair.phase === "technical_failed" ? "technical_failed" : repair.phase === "uncertain" ? "uncertain" : "waiting_confirmation", summary,
      ...(expectedRow && technicalError ? { technicalError } : {}),
    };
    const resumeTarget = buildNovelEditResumeTarget({
      novelId: repair.novelId, taskId, stage: "structured", volumeId: repair.volumeId, chapterId: repair.chapterId,
    });
    const changed = await this.workflow.updateTaskManyWithRetry({
      where: { id: taskId, seedPayloadJson: row.seedPayloadJson, updatedAt: row.updatedAt, status: { not: "cancelled" }, cancelRequestedAt: null },
      data: {
        status: "waiting_approval", checkpointType: "step_review_required", pendingManualRecovery: true,
        currentStage: "结构化大纲", currentItemKey: "planning_repair_confirmation", currentItemLabel: "规划修复等待确认",
        checkpointSummary: summary, lastError: null, finishedAt: null, heartbeatAt: new Date(),
        resumeTargetJson: JSON.stringify(resumeTarget),
        seedPayloadJson: JSON.stringify({ ...seed, planningRepair: waitingRepair, resumeTarget, planningRepairRecovery: {
          repairKey: repair.key, resumePhase: recovery?.resumePhase ?? resolvePlanningRepairResumePhase(row),
        } }),
      },
    });
    if (changed.count !== 1) throw new AppError("规划修复暂停状态发生并发变更，请刷新状态。", 409);
  }

  async grant(taskId: string, input: { action: "retry" | "pause"; repairKey: string; guidance?: string; idempotencyKey?: string; expectedSourceToken?: string; executionMode?: "repair_then_review" | "review_existing"; affectedChapterIds?: string[] }) {
    let row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row || row.lane !== "auto_director") throw new AppError("自动导演任务不存在。", 404);
    const { seed, repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
    if (!repair || repair.key !== input.repairKey) throw new AppError("规划修复状态已变化，请刷新后再确认。", 409);
    if (row.status === "cancelled" || row.cancelRequestedAt) throw new AppError("任务已取消，不能继续规划修复。", 409);
    if (input.action === "pause") {
      if (!isPlanningRepairTaskPaused(row)) throw new AppError("任务不处于暂停状态，请刷新后查看进度。", 409);
      return { granted: false, replayed: false, taskId };
    }
    const guidance = input.guidance?.trim();
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!guidance || !idempotencyKey) throw new AppError("请填写修复方向并提供本次请求标识。", 400);
    const requests = Array.isArray(seed.planningRepairRecoveryRequests)
      ? seed.planningRepairRecoveryRequests as Array<{ repairKey: string; idempotencyKey: string; guidance: string; executionMode?: string; affectedChapterIds?: string[] }> : [];
    const prior = requests.find((item) => item.repairKey === repair.key && item.idempotencyKey === idempotencyKey);
    if (prior) {
      if (prior.guidance !== guidance || prior.executionMode !== input.executionMode
        || JSON.stringify(prior.affectedChapterIds) !== JSON.stringify(input.affectedChapterIds)) throw new AppError("同一请求标识不能用于不同修复方向。", 409);
      return { granted: true, replayed: true, taskId };
    }
    if (repair.novelId !== row.novelId) throw new AppError("规划修复不属于当前小说。", 409);
    if (recovery?.pendingGrant && (recovery.idempotencyKey !== idempotencyKey || recovery.guidance !== guidance || recovery.executionMode !== input.executionMode
      || JSON.stringify(recovery.affectedChapterIds) !== JSON.stringify(input.affectedChapterIds))) {
      throw new AppError("另一条修复确认正在处理，请先恢复该请求。", 409);
    }
    if ((!recovery?.pendingGrant && !repair.pendingOperation && !["waiting_confirmation", "uncertain", "technical_failed"].includes(repair.phase))
      || !isPlanningRepairTaskPaused(row)) {
      throw new AppError("当前规划修复不处于等待确认状态。", 409);
    }
    const maxRounds = repair.maxRounds ?? 2;
    if (input.affectedChapterIds) {
      const eligible = (seed.planningRepairSnapshot as { eligibleChapterIds?: string[] } | undefined)?.eligibleChapterIds ?? [];
      if (!input.affectedChapterIds.length || input.affectedChapterIds.length > 3
        || new Set(input.affectedChapterIds).size !== input.affectedChapterIds.length
        || !input.affectedChapterIds.includes(repair.chapterId)
        || input.affectedChapterIds.some(id => !eligible.includes(id))) {
        throw new AppError("建议修改范围不属于当前可修复窗口，请重新获取建议。", 409);
      }
    }
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 0 || !Number.isSafeInteger(repair.rounds) || repair.rounds < 0) {
      throw new AppError("规划修复轮次无效，无法追加预算。", 409);
    }
    if (!recovery?.pendingGrant) {
      const reserved = await this.workflow.updateTaskManyWithRetry({
        where: { id: taskId, seedPayloadJson: row.seedPayloadJson, updatedAt: row.updatedAt, status: row.status, cancelRequestedAt: null },
        data: { seedPayloadJson: JSON.stringify({ ...seed, planningRepairRecovery: {
          repairKey: repair.key, resumePhase: recovery?.resumePhase ?? resolvePlanningRepairResumePhase(row),
          idempotencyKey, guidance, pendingGrant: true, expectedMaxRounds: maxRounds, expectedRound: repair.rounds,
          executionMode: input.executionMode,
          affectedChapterIds: input.affectedChapterIds,
          expectedSourceToken: input.expectedSourceToken,
          previousRecovery: input.expectedSourceToken ? recovery : undefined,
        } }) },
      });
      if (reserved.count !== 1) throw new AppError("规划修复状态已被更新，请刷新后重试。", 409);
    }
    row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row) throw new AppError("自动导演任务不存在。", 404);
    const reservation = readPlanningRepairSeed(row.seedPayloadJson).recovery;
    if (!reservation?.pendingGrant || reservation.idempotencyKey !== idempotencyKey) {
      throw new AppError("修复确认状态已变化，请刷新后重试。", 409);
    }
    const rebaseInput = {
      novelId: repair.novelId, taskId, volumeId: repair.volumeId, chapterId: repair.chapterId,
      document: await this.workflow.volumeService.getVolumes(repair.novelId),
      expectedSeedPayloadJson: row.seedPayloadJson,
      expectedSourceToken: reservation.expectedSourceToken,
    };
    try {
      const rebased = await this.repairStore.rebase(rebaseInput);
      if (input.affectedChapterIds?.some(id => !rebased.eligibleChapterIds.includes(id))) {
        throw new AppError("可修复窗口已变化，请重新获取建议。", 409);
      }
    } catch (error) {
      // Only this transactional pre-write guard proves that no rebase/budget operation occurred.
      // Unknown failures retain the reservation for explicit reconciliation.
      if (reservation.expectedSourceToken && error && typeof error === "object"
        && "reason" in error && error.reason === "advice_source_changed") {
        const failedRow = await this.workflow.getTaskByIdWithoutHealing(taskId);
        if (failedRow) {
          const failed = readPlanningRepairSeed(failedRow.seedPayloadJson);
          if (failed.repair?.key === repair.key && failed.repair.rounds === reservation.expectedRound
            && failed.repair.maxRounds === reservation.expectedMaxRounds && failed.recovery?.pendingGrant
            && failed.recovery.idempotencyKey === idempotencyKey && failed.recovery.guidance === guidance
            && failed.recovery.expectedSourceToken === reservation.expectedSourceToken) {
            await this.workflow.updateTaskManyWithRetry({
              where: { id: taskId, seedPayloadJson: failedRow.seedPayloadJson, updatedAt: failedRow.updatedAt,
                status: failedRow.status, cancelRequestedAt: null },
              data: { seedPayloadJson: JSON.stringify({ ...failed.seed,
                planningRepairRecovery: failed.recovery.previousRecovery ?? {
                  repairKey: repair.key, resumePhase: failed.recovery.resumePhase,
                },
              }) },
            });
          }
        }
      }
      throw error;
    }
    row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row) throw new AppError("自动导演任务不存在。", 404);
    const current = readPlanningRepairSeed(row.seedPayloadJson);
    if (!current.repair || current.repair.key !== repair.key || !current.recovery?.pendingGrant
      || current.recovery.idempotencyKey !== idempotencyKey || current.recovery.guidance !== guidance
      || current.repair.rounds !== reservation.expectedRound || current.repair.maxRounds !== reservation.expectedMaxRounds
      || !isPlanningRepairTaskPaused(row)) {
      throw new AppError("修复范围或轮次已变化，本次未追加预算。", 409);
    }
    const currentRequests = Array.isArray(current.seed.planningRepairRecoveryRequests) ? current.seed.planningRepairRecoveryRequests : [];
    const changed = await this.workflow.updateTaskManyWithRetry({
      where: { id: taskId, seedPayloadJson: row.seedPayloadJson, updatedAt: row.updatedAt, status: row.status, cancelRequestedAt: null },
      data: { seedPayloadJson: JSON.stringify({
        ...current.seed,
        planningRepair: { ...current.repair, guidance, maxRounds: input.executionMode === "review_existing" ? maxRounds : maxRounds + 1, pendingOperation: undefined,
          recoveryAction: input.executionMode ? { requestId: idempotencyKey, mode: input.executionMode, affectedChapterIds: input.affectedChapterIds } : undefined },
        planningRepairRecoveryRequests: [...currentRequests, { repairKey: repair.key, idempotencyKey, guidance, executionMode: input.executionMode, affectedChapterIds: input.affectedChapterIds }],
        planningRepairRecovery: {
          repairKey: repair.key, resumePhase: current.recovery.resumePhase,
          idempotencyKey, guidance, grantedAtRound: repair.rounds,
          executionMode: input.executionMode,
          affectedChapterIds: input.affectedChapterIds,
        },
      }) },
    });
    if (changed.count !== 1) throw new AppError("规划修复状态已被更新，请刷新后重试。", 409);
    return { granted: true, replayed: false, taskId };
  }
}
