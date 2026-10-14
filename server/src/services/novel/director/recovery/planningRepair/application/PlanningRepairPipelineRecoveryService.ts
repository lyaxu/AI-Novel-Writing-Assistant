import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../../../../db/prisma";
import {
  ChapterProductionError, chapterFingerprint, productionFingerprint,
  type ChapterProductionJournalRecord,
} from "../../../../production/reliability";
import { assertUnchangedPipelineRecoveryScope } from "../../../../production/recovery";
import { PlanningRepairStore } from "../../../../volume/planningRepair/PlanningRepairStore";
import { readPlanningRepairSeed } from "../planningRepairRecovery";
import { assertSettledPlanningPreparation } from "../domain/settledPipelinePause";

export interface PlanningPipelineRecoveryInput { taskId: string; novelId: string; recoveryKey: string }
export interface PlanningPipelineRecoveryResult {
  pipelineJobId: string; chapterId: string; currentStage: string | null; seedPayloadJson: string;
}
interface Dependencies {
  db?: Pick<PrismaClient, "$transaction">;
  store?: Pick<PlanningRepairStore, "assertPipelineRecoverySnapshot">;
  now?: () => number;
}
function conflict(message: string): never {
  throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) conflict("原规划恢复记录无法核对，请保留现场。");
  return value as Record<string, unknown>;
}
function parse(value: string | null): Record<string, unknown> {
  try { return object(JSON.parse(value ?? "null")); }
  catch { return conflict("原规划恢复记录无法读取，请保留现场。"); }
}
function liveLease(owner: string | null, expires: Date | null, now: number): boolean {
  return Boolean(owner && expires && expires.getTime() > now);
}
const slot = (novelId: string, chapterId: string) => ({
  novelId, chapterId, contentHash: "active", artifactType: "production_execution", syncMode: "journal",
});

/** Explicit grant recovery only. Reads/status projections never call this transaction. */
export class PlanningRepairPipelineRecoveryService {
  constructor(private readonly deps: Dependencies = {}) {}

  async recover(input: PlanningPipelineRecoveryInput): Promise<PlanningPipelineRecoveryResult | null> {
    const db = this.deps.db ?? prisma;
    const store = this.deps.store ?? new PlanningRepairStore();
    return db.$transaction(async (tx: Prisma.TransactionClient) => {
      const now = this.deps.now?.() ?? Date.now();
      const task = await tx.novelWorkflowTask.findUnique({ where: { id: input.taskId } });
      if (!task || task.novelId !== input.novelId || task.lane !== "auto_director"
        || task.cancelRequestedAt || !["queued", "running", "waiting_approval", "failed"].includes(task.status)) {
        conflict("原导演任务已取消或发生变化，请回到本书工作区核对。");
      }
      const { seed, repair, recovery } = readPlanningRepairSeed(task.seedPayloadJson);
      if (!repair || repair.novelId !== input.novelId || recovery?.resumePhase !== "chapter_execution"
        || recovery.pendingGrant || recovery.repairKey !== repair.key || recovery.idempotencyKey !== input.recoveryKey
        || !input.recoveryKey || repair.pendingOperation || repair.repairOutputPending
        || repair.recoveryAction?.requestId !== input.recoveryKey
        || repair.recoveryAction.mode !== recovery.executionMode
        || repair.guidance !== recovery.guidance
        || productionFingerprint(repair.recoveryAction.affectedChapterIds) !== productionFingerprint(recovery.affectedChapterIds)
        || !["reviewing", "assessing", "ready"].includes(repair.phase)) {
        conflict("本次规划修复授权或待处理结果已变化，请保留候选并刷新工作区。");
      }
      const grants = seed.planningRepairRecoveryRequests;
      if (!Array.isArray(grants) || !grants.some(value => {
        const grant = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return grant.repairKey === repair.key && grant.idempotencyKey === input.recoveryKey
          && grant.guidance === recovery.guidance && grant.executionMode === recovery.executionMode
          && productionFingerprint(grant.affectedChapterIds) === productionFingerprint(recovery.affectedChapterIds);
      })) conflict("找不到本次已保存的规划修复授权。");
      const execution = object(seed.autoExecution);
      const start = Number(execution.startOrder), end = Number(execution.endOrder);
      if (execution.enabled !== true || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 1 || end < start || repair.chapterOrder < start || repair.chapterOrder > end) {
        conflict("规划恢复必须保留原任务的已授权章节范围。");
      }
      assertUnchangedPipelineRecoveryScope(seed);
      const chapter = await tx.chapter.findFirst({ where: { novelId: input.novelId, order: repair.chapterOrder } });
      if (!chapter) conflict("找不到原规划对应的章节，请保留现场。");
      const identity = slot(input.novelId, chapter.id);
      const row = await tx.chapterArtifactSyncCheckpoint.findUnique({
        where: { novelId_chapterId_contentHash_artifactType_syncMode: identity },
      });
      // Planning outside an existing chapter execution has no production operation to reconnect.
      if (!row && !execution.pipelineJobId) return null;
      if (!row?.metadataJson) conflict("原章节任务缺少保存记录，不能新建任务替代。");
      const journal = parse(row.metadataJson) as unknown as ChapterProductionJournalRecord;
      const request = object(journal.request);
      const suffix = `:${chapter.id}`;
      if (journal.version !== 1 || journal.status !== "paused" || journal.expiresAt > now
        || typeof journal.operationId !== "string" || !journal.operationId.startsWith("pipeline:")
        || !journal.operationId.endsWith(suffix) || request.entry !== "pipeline"
        || request.workflowTaskId !== input.taskId || journal.expectedChapter?.id !== chapter.id
        || journal.expectedChapter.novelId !== input.novelId
        || journal.requestFingerprint !== productionFingerprint(request)
        || journal.expectedFingerprint !== chapterFingerprint(chapter)
        || (chapter.content ?? "").trim() || journal.partialText?.trim()) {
        conflict("原章节内容、执行约定或所有权发生变化，不能接替执行。");
      }
      const jobId = journal.operationId.slice("pipeline:".length, -suffix.length);
      if (!jobId || jobId.includes(":")) conflict("原章节任务身份无法核对。");
      const job = await tx.generationJob.findUnique({ where: { id: jobId } });
      if (!job || job.novelId !== input.novelId || job.status !== "failed" || job.cancelRequestedAt
        || job.currentItemKey !== chapter.id || job.startOrder < start || job.endOrder > end
        || chapter.order < job.startOrder || chapter.order > job.endOrder
        || liveLease(job.executionOwner, job.executionLeaseExpiresAt, now)
        || parse(job.payload).workflowTaskId !== input.taskId) {
        conflict("原章节任务的范围或执行权已变化，请保留规划修复记录。");
      }
      const active = await tx.generationJob.findFirst({ where: {
        novelId: input.novelId, id: { not: jobId }, status: { in: ["queued", "running"] },
      } });
      if (active) conflict("本书还有章节任务正在执行，不能同时恢复规划。");
      const boundId = typeof execution.pipelineJobId === "string" ? execution.pipelineJobId : null;
      if (boundId && boundId !== jobId) {
        const displaced = await tx.generationJob.findUnique({ where: { id: boundId } });
        if (!displaced || displaced.novelId !== input.novelId || displaced.status !== "failed"
          || displaced.cancelRequestedAt || displaced.currentItemKey !== chapter.id
          || displaced.startOrder !== job.startOrder || displaced.endOrder !== job.endOrder
          || displaced.llmCallCount !== 0 || displaced.totalTokens !== 0
          || displaced.promptTokens !== 0 || displaced.completionTokens !== 0 || displaced.completedCount !== 0
          || liveLease(displaced.executionOwner, displaced.executionLeaseExpiresAt, now)
          || parse(displaced.payload).workflowTaskId !== input.taskId) {
          conflict("当前关联任务已有执行结果，不能自动替换其恢复位置。");
        }
        const records = await tx.chapterArtifactSyncCheckpoint.findMany({
          where: { novelId: input.novelId, artifactType: "production_execution", syncMode: "journal" },
          select: { metadataJson: true },
        });
        if (records.some(record => {
          const saved = parse(record.metadataJson);
          return typeof saved.operationId === "string" && saved.operationId.startsWith(`pipeline:${boundId}:`);
        })) conflict("当前关联任务已有章节执行记录，不能接替其所有权。");
      }
      await store.assertPipelineRecoverySnapshot(tx, task);
      const proof = assertSettledPlanningPreparation({ repair, recovery, journal });
      if (proof.source === "history" && job.error !== repair.summary) {
        conflict("原章节任务与规划暂停证据不一致，不能重复发送。");
      }
      for (const [key, step] of Object.entries(journal.steps)) {
        if (step.status === "running" || (step.status === "unknown" && key !== "prepare.execution_contract")) {
          conflict("仍有外部调用结果未确认，不能重复发送。");
        }
      }
      const prior = seed.planningRepairPipelineRecovery as Partial<{
        recoveryKey: string; pipelineJobId: string; operationId: string;
      }> | undefined;
      if (prior?.recoveryKey === input.recoveryKey && prior.pipelineJobId === jobId
        && prior.operationId === journal.operationId && boundId === jobId
        && job.pendingManualRecovery && journal.steps["prepare.execution_contract"]?.status === "failed") {
        // The same durable authorization has already been prepared. Preserve its original proof
        // and CAS timestamps, while still checking every source/ownership guard above.
        return { pipelineJobId: jobId, chapterId: chapter.id, currentStage: job.currentStage,
          seedPayloadJson: task.seedPayloadJson! };
      }
      const next = structuredClone(journal);
      if (next.steps["prepare.execution_contract"]?.status === "unknown") {
        // Preserve the exact uncertain record before recording the narrowly proven control-flow outcome.
        const archiveIdentity = { ...identity, contentHash: `${journal.operationId}:planning-grant:${input.recoveryKey}` };
        await tx.chapterArtifactSyncCheckpoint.upsert({
          where: { novelId_chapterId_contentHash_artifactType_syncMode: archiveIdentity },
          create: { ...archiveIdentity, status: journal.status, metadataJson: row.metadataJson }, update: {},
        });
        next.steps["prepare.execution_contract"].status = "failed";
        next.steps["prepare.execution_contract"].planningPause = {
          version: 1, repairKey: repair.key, round: repair.rounds, outcome: "settled",
          candidateVersionId: repair.candidateVersionId,
        };
      }
      const nextSeed = JSON.stringify({ ...seed,
        autoExecution: { ...execution, pipelineJobId: jobId, pipelineStatus: job.status },
        planningRepairPipelineRecovery: { recoveryKey: input.recoveryKey, pipelineJobId: jobId,
          operationId: journal.operationId, proof },
      });
      const journalChanged = await tx.chapterArtifactSyncCheckpoint.updateMany({
        where: { ...identity, metadataJson: row.metadataJson },
        data: { metadataJson: JSON.stringify(next), status: next.status },
      });
      if (journalChanged.count !== 1) conflict("章节保存记录已被更新，本次未恢复。");
      const jobChanged = await tx.generationJob.updateMany({ where: {
        id: job.id, status: job.status, updatedAt: job.updatedAt, payload: job.payload,
        cancelRequestedAt: null, pendingManualRecovery: job.pendingManualRecovery,
        executionOwner: job.executionOwner, executionLeaseExpiresAt: job.executionLeaseExpiresAt,
      }, data: { pendingManualRecovery: true } });
      if (jobChanged.count !== 1) conflict("原章节任务已被更新，本次未恢复。");
      const taskChanged = await tx.novelWorkflowTask.updateMany({ where: {
        id: task.id, lane: task.lane, novelId: task.novelId, status: task.status, updatedAt: task.updatedAt,
        seedPayloadJson: task.seedPayloadJson, pendingManualRecovery: task.pendingManualRecovery,
        cancelRequestedAt: null, attemptCount: task.attemptCount, startedAt: task.startedAt,
      }, data: { seedPayloadJson: nextSeed } });
      if (taskChanged.count !== 1) conflict("规划授权或任务状态已被更新，本次未恢复。");
      return { pipelineJobId: jobId, chapterId: chapter.id, currentStage: job.currentStage, seedPayloadJson: nextSeed };
    }, { isolationLevel: "Serializable", timeout: 20_000 });
  }
}
