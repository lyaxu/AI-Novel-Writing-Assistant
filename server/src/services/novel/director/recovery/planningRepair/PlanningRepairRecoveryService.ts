import { prisma } from "../../../../../db/prisma";
import { AppError } from "../../../../../middleware/errorHandler";
import { NovelWorkflowService } from "../../../workflow/NovelWorkflowService";
import { buildNovelEditResumeTarget } from "../../../workflow/novelWorkflow.shared";
import { readPlanningRepairSeed, resolvePlanningRepairResumePhase } from "./planningRepairRecovery";
import { PlanningRepairStore } from "../../../volume/planningRepair/PlanningRepairStore";

export class PlanningRepairRecoveryService {
  constructor(
    private readonly workflow = new NovelWorkflowService(),
    private readonly repairStore: Pick<PlanningRepairStore, "rebase"> = new PlanningRepairStore(),
  ) {}

  async statusByNovel(novelId: string) {
    const rows = await this.workflow.getVisibleRowsByNovelIdRaw(novelId, "auto_director");
    return rows[0] ? this.status(rows[0].id) : null;
  }

  async pauseIfNeeded(taskId: string): Promise<boolean> {
    const row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    const { repair } = readPlanningRepairSeed(row?.seedPayloadJson);
    if (!repair || !["waiting_confirmation", "uncertain"].includes(repair.phase)) return false;
    await this.pauseAfterFailure(taskId);
    return true;
  }

  async status(taskId: string) {
    // Read without workflow healing: viewing a repair must never resume it.
    const row = await prisma.novelWorkflowTask.findUnique({ where: { id: taskId } });
    if (!row || row.lane !== "auto_director") throw new AppError("自动导演任务不存在。", 404);
    const { repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
    const recoveryRequest = recovery?.idempotencyKey && recovery.guidance
      && repair && (recovery.pendingGrant || !["waiting_confirmation", "uncertain", "committed"].includes(repair.phase))
      && ["waiting_approval", "failed"].includes(row.status)
      ? { idempotencyKey: recovery.idempotencyKey, guidance: recovery.guidance } : null;
    return { taskId, novelId: row.novelId, status: row.status, pendingManualRecovery: row.pendingManualRecovery, planningRepair: repair, recoveryRequest };
  }

  async pauseAfterFailure(taskId: string, error?: unknown): Promise<void> {
    let row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row || row.status === "cancelled" || row.cancelRequestedAt) return;
    const { seed, repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
    if (!repair) throw new AppError("规划修复缺少持久化状态。", 409);
    if (repair.novelId !== row.novelId || repair.phase === "committed") throw new AppError("规划修复归属或状态已变化。", 409);
    const summary = error instanceof Error ? error.message : repair.summary ?? "规划修复需要确认。";
    const waitingRepair = { ...repair, phase: repair.phase === "uncertain" ? "uncertain" : "waiting_confirmation", summary };
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

  async grant(taskId: string, input: { action: "retry" | "pause"; repairKey: string; guidance?: string; idempotencyKey?: string }) {
    let row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row || row.lane !== "auto_director") throw new AppError("自动导演任务不存在。", 404);
    const { seed, repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
    if (!repair || repair.key !== input.repairKey) throw new AppError("规划修复状态已变化，请刷新后再确认。", 409);
    if (input.action === "pause") {
      if (!["waiting_approval", "failed"].includes(row.status)) throw new AppError("任务不处于暂停状态，请刷新后查看进度。", 409);
      return { granted: false, replayed: false, taskId };
    }
    const guidance = input.guidance?.trim();
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!guidance || !idempotencyKey) throw new AppError("请填写修复方向并提供本次请求标识。", 400);
    const requests = Array.isArray(seed.planningRepairRecoveryRequests)
      ? seed.planningRepairRecoveryRequests as Array<{ repairKey: string; idempotencyKey: string; guidance: string }> : [];
    const prior = requests.find((item) => item.repairKey === repair.key && item.idempotencyKey === idempotencyKey);
    if (prior) {
      if (prior.guidance !== guidance) throw new AppError("同一请求标识不能用于不同修复方向。", 409);
      return { granted: true, replayed: true, taskId };
    }
    if (repair.novelId !== row.novelId) throw new AppError("规划修复不属于当前小说。", 409);
    if (recovery?.pendingGrant && (recovery.idempotencyKey !== idempotencyKey || recovery.guidance !== guidance)) {
      throw new AppError("另一条修复确认正在处理，请先恢复该请求。", 409);
    }
    if ((!recovery?.pendingGrant && !repair.pendingOperation && !["waiting_confirmation", "uncertain", "technical_failed"].includes(repair.phase))
      || !["waiting_approval", "failed"].includes(row.status)) {
      throw new AppError("当前规划修复不处于等待确认状态。", 409);
    }
    const maxRounds = repair.maxRounds ?? 2;
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 0 || !Number.isSafeInteger(repair.rounds) || repair.rounds < 0) {
      throw new AppError("规划修复轮次无效，无法追加预算。", 409);
    }
    if (!recovery?.pendingGrant) {
      const reserved = await this.workflow.updateTaskManyWithRetry({
        where: { id: taskId, seedPayloadJson: row.seedPayloadJson, updatedAt: row.updatedAt, status: row.status, cancelRequestedAt: null },
        data: { seedPayloadJson: JSON.stringify({ ...seed, planningRepairRecovery: {
          repairKey: repair.key, resumePhase: recovery?.resumePhase ?? resolvePlanningRepairResumePhase(row),
          idempotencyKey, guidance, pendingGrant: true, expectedMaxRounds: maxRounds, expectedRound: repair.rounds,
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
    };
    await this.repairStore.rebase(rebaseInput);
    row = await this.workflow.getTaskByIdWithoutHealing(taskId);
    if (!row) throw new AppError("自动导演任务不存在。", 404);
    const current = readPlanningRepairSeed(row.seedPayloadJson);
    if (!current.repair || current.repair.key !== repair.key || !current.recovery?.pendingGrant
      || current.recovery.idempotencyKey !== idempotencyKey || current.recovery.guidance !== guidance
      || current.repair.rounds !== reservation.expectedRound || current.repair.maxRounds !== reservation.expectedMaxRounds
      || !["waiting_approval", "failed"].includes(row.status)) {
      throw new AppError("修复范围或轮次已变化，本次未追加预算。", 409);
    }
    const currentRequests = Array.isArray(current.seed.planningRepairRecoveryRequests) ? current.seed.planningRepairRecoveryRequests : [];
    const changed = await this.workflow.updateTaskManyWithRetry({
      where: { id: taskId, seedPayloadJson: row.seedPayloadJson, updatedAt: row.updatedAt, status: row.status, cancelRequestedAt: null },
      data: { seedPayloadJson: JSON.stringify({
        ...current.seed,
        planningRepair: { ...current.repair, guidance, maxRounds: maxRounds + 1, pendingOperation: undefined },
        planningRepairRecoveryRequests: [...currentRequests, { repairKey: repair.key, idempotencyKey, guidance }],
        planningRepairRecovery: {
          repairKey: repair.key, resumePhase: current.recovery.resumePhase,
          idempotencyKey, guidance, grantedAtRound: repair.rounds,
        },
      }) },
    });
    if (changed.count !== 1) throw new AppError("规划修复状态已被更新，请刷新后重试。", 409);
    return { granted: true, replayed: false, taskId };
  }
}
