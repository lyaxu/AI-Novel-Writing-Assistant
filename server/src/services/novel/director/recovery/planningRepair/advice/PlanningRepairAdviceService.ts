import { randomUUID } from "node:crypto";
import { planningRepairAdviceOutputSchema, type PlanningRepairAdviceOutput, type PlanningRepairAdviceStatus } from "@ai-novel/shared/types/planningRepair/advice";
import { prisma } from "../../../../../../db/prisma";
import { AppError } from "../../../../../../middleware/errorHandler";
import { runStructuredPrompt } from "../../../../../../prompting/core/promptRunner";
import { planningRepairAdvicePrompt } from "../../../../../../prompting/prompts/novel/volume/recovery/planningRepairAdvice.prompts";
import { runWithEnforcedTimeout } from "../../../../../../llm/invokeTimeout";
import { PlanningRepairRecoveryService } from "../PlanningRepairRecoveryService";
import { assertAdvicePaused, readAdviceSource, type AdviceSource } from "./AdviceSource";

interface SavedAdvice {
  adviceId: string; requestId: string; repairKey: string; fingerprint: string; sourceToken: string;
  status: "running" | "ready" | "failed"; result?: PlanningRepairAdviceOutput; error?: string;
}
const active = new Set<string>();
const requesting = new Set<string>();
export function adviceModelOptions(seed: Record<string, unknown>) {
  const director = seed.directorInput && typeof seed.directorInput === "object" ? seed.directorInput as Record<string, unknown> : {};
  const provider = seed.provider ?? director.provider;
  const model = seed.model ?? director.model;
  return { provider: typeof provider === "string" && provider.trim() ? provider.trim() : undefined,
    model: typeof model === "string" && model.trim() ? model.trim() : undefined };
}
function saved(source: AdviceSource): SavedAdvice | undefined { return source.seed.planningRepairAdvice as SavedAdvice | undefined; }
function canResume(option: PlanningRepairAdviceOutput["options"][number], source: AdviceSource) {
  return !option.changesHardConstraints && !option.requiresSourceEdit
    && option.affectedChapterIds.every((id) => source.eligibleChapterIds.includes(id));
}
export function projectAdvice(source: AdviceSource): PlanningRepairAdviceStatus {
  const advice = saved(source);
  if (!advice) return { status: "none" };
  const base = { adviceId: advice.adviceId, requestId: advice.requestId };
  if (advice.fingerprint !== source.fingerprint) return { ...base, status: "stale" };
  if (advice.status === "running") return { ...base, status: active.has(advice.adviceId) ? "running" : "uncertain" };
  if (advice.status === "failed") return { ...base, status: "failed", error: advice.error };
  if (!advice.result) return { ...base, status: "uncertain" };
  return { ...base, status: "ready", summary: advice.result.summary, recommendedOptionId: advice.result.recommendedOptionId,
    options: advice.result.options.map((option) => ({
      id: option.id, title: option.title, reason: option.reason, changes: option.changes,
      preserves: option.preserves, tradeoffs: option.tradeoffs, canResume: canResume(option, source),
      ...(!canResume(option, source) ? { blockedReason: option.changesHardConstraints
        ? "请先到小说基础信息与卷规划确认书级约束，再返回本页获取建议。"
        : "请先在本页章节规划或所属卷规划确认窗口外的改动，再获取建议。" } : {}),
    })) };
}

async function generate(source: AdviceSource) {
  const contextJson = JSON.stringify(source.context);
  if (contextJson.length > 160000) throw new AppError("相关规划与审查证据超出单次建议容量，请在章节规划中精简重复资料后重新获取建议。", 409);
  const result = await runWithEnforcedTimeout({ timeoutMs: 300000, label: "planning-repair-advice", run: (signal) => runStructuredPrompt({
    asset: planningRepairAdvicePrompt, promptInput: { contextJson },
    options: { ...adviceModelOptions(source.seed), signal, timeoutMs: 300000, temperature: 0.2, reasoningEnabled: false, maxTokens: 6000,
      disableFallbackModel: true, transportRetryCount: 0, disableStrategyFallback: true,
      taskId: source.row.id, novelId: source.repair.novelId, chapterId: source.repair.chapterId,
      entrypoint: "planning_repair_advice_explicit", stage: "planning_repair_advice" },
  }) });
  return planningRepairAdviceOutputSchema.parse(result.output);
}

export class PlanningRepairAdviceService {
  constructor(private readonly recovery: Pick<PlanningRepairRecoveryService, "grant"> = new PlanningRepairRecoveryService(),
    private readonly generateAdvice: (source: AdviceSource) => Promise<PlanningRepairAdviceOutput> = generate) {}

  async status(taskId: string) { return prisma.$transaction(async (tx) => projectAdvice(await readAdviceSource(tx, taskId))); }

  async request(taskId: string, input: { repairKey: string; idempotencyKey: string }) {
    if (requesting.has(taskId)) throw new AppError("建议请求正在处理，请刷新查看结果。", 409);
    requesting.add(taskId);
    try {
    const reservation = await prisma.$transaction(async (tx) => {
      const source = await readAdviceSource(tx, taskId);
      if (source.repair.key !== input.repairKey) throw new AppError("修复记录已变化，请刷新。", 409);
      const previous = saved(source);
      if (previous?.requestId === input.idempotencyKey) return { source, advice: previous, run: false };
      const requestIds = Array.isArray(source.seed.planningRepairAdviceRequests) ? source.seed.planningRepairAdviceRequests : [];
      if (requestIds.includes(input.idempotencyKey)) throw new AppError("这次请求已有记录，请刷新查看最新建议。", 409);
      await assertAdvicePaused(tx, source);
      if (previous && active.has(previous.adviceId)) throw new AppError("建议正在生成，请等待结果。", 409);
      const advice: SavedAdvice = { adviceId: randomUUID(), requestId: input.idempotencyKey,
        repairKey: input.repairKey, fingerprint: source.fingerprint, sourceToken: source.sourceToken, status: "running" };
      const changed = await tx.novelWorkflowTask.updateMany({ where: { id: taskId, seedPayloadJson: source.row.seedPayloadJson, updatedAt: source.row.updatedAt },
        data: { seedPayloadJson: JSON.stringify({ ...source.seed, planningRepairAdvice: advice,
          planningRepairAdviceRequests: [...requestIds, input.idempotencyKey] }) } });
      if (changed.count !== 1) throw new AppError("修复状态发生并发变化，请刷新。", 409);
      source.seed.planningRepairAdvice = advice;
      return { source, advice, run: true };
    });
    if (reservation.run) {
      active.add(reservation.advice.adviceId);
      void this.complete(taskId, reservation.source, reservation.advice).finally(() => active.delete(reservation.advice.adviceId));
    }
    return projectAdvice(reservation.source);
    } finally { requesting.delete(taskId); }
  }

  private async complete(taskId: string, source: AdviceSource, advice: SavedAdvice) {
    let completed: SavedAdvice;
    try { completed = { ...advice, status: "ready", result: planningRepairAdviceOutputSchema.parse(await this.generateAdvice(source)) }; }
    catch (error) { completed = { ...advice, status: "failed", error: error instanceof Error ? error.message : "建议生成未完成，请明确重试。" }; }
    try {
      await prisma.$transaction(async (tx) => {
        const current = await readAdviceSource(tx, taskId);
        if (saved(current)?.adviceId !== advice.adviceId || current.fingerprint !== advice.fingerprint) return;
        await assertAdvicePaused(tx, current);
        await tx.novelWorkflowTask.updateMany({ where: { id: taskId, seedPayloadJson: current.row.seedPayloadJson, updatedAt: current.row.updatedAt },
          data: { seedPayloadJson: JSON.stringify({ ...current.seed, planningRepairAdvice: completed }) } });
      });
    } catch { /* Persisted running becomes uncertain; viewing never resubmits a paid request. */ }
  }

  async select(taskId: string, input: { repairKey: string; adviceId: string; optionId: string; idempotencyKey: string }) {
    const selection = await prisma.$transaction(async (tx) => {
      const source = await readAdviceSource(tx, taskId);
      const advice = saved(source);
      if (!advice || advice.adviceId !== input.adviceId || advice.repairKey !== input.repairKey || source.repair.key !== input.repairKey
        || advice.status !== "ready" || !advice.result) throw new AppError("建议不存在或未完成，请刷新。", 409);
      const option = advice.result.options.find((item) => item.id === input.optionId);
      if (!option || !canResume(option, source)) throw new AppError("此方向不能直接继续，请先确认规划来源。", 409);
      // The stored option owns the recovery identity. Fresh client keys cannot add repeated rounds.
      const idempotencyKey = `advice:${advice.adviceId}:${option.id}`;
      const guidance = JSON.stringify({ diagnosis: option.diagnosis, affectedChapterIds: option.affectedChapterIds, ...option.guidance });
      if (guidance.length > 4000) throw new AppError("建议超出修复指令长度，请重新获取建议。", 409);
      const requests = Array.isArray(source.seed.planningRepairRecoveryRequests) ? source.seed.planningRepairRecoveryRequests as Array<{ idempotencyKey: string; guidance: string }> : [];
      const replay = requests.some((item) => item.idempotencyKey === idempotencyKey && item.guidance === guidance);
      const pending = source.recovery?.pendingGrant && source.recovery.idempotencyKey === idempotencyKey && source.recovery.guidance === guidance;
      if (!replay && !pending) {
        await assertAdvicePaused(tx, source);
        if (advice.fingerprint !== source.fingerprint) throw new AppError("规划、正文或修复记录已变化，请重新获取建议。", 409);
      }
      return { guidance, idempotencyKey, expectedSourceToken: advice.sourceToken };
    });
    const grant = await this.recovery.grant(taskId, { action: "retry", repairKey: input.repairKey, ...selection });
    return { ...grant, idempotencyKey: selection.idempotencyKey };
  }
}
