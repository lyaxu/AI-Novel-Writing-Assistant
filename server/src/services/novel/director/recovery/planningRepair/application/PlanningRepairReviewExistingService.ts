import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../../../../db/prisma";
import { AppError } from "../../../../../../middleware/errorHandler";
import { isPlanningRepairTaskPaused } from "@ai-novel/shared/types/planningRepair/recovery";
import { chapterFingerprint, productionFingerprint, type ChapterProductionJournalRecord } from "../../../../production/reliability";
import { assertUnchangedPipelineRecoveryScope } from "../../../../production/recovery";
import { PlanningRepairStore } from "../../../../volume/planningRepair/PlanningRepairStore";
import { readPlanningRepairSeed } from "../planningRepairRecovery";
import { assertReviewExistingAcknowledgement, reviewExistingBoundary } from "../domain/reviewExistingAcknowledgement";

const guidance = "仅重新复核保留的候选，不修改或重新生成；通过后按原授权章节范围继续，未通过则保持暂停。";
const contractStep = "prepare.execution_contract";
function refuse(message: string): never { throw new AppError(message, 409); }
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse("保存的恢复记录无法核对。");
  return value as Record<string, any>;
}
function parse(value: string | null) { try { return object(JSON.parse(value ?? "null")); } catch { return refuse("保存的恢复记录无法核对。"); } }
const slot = (novelId: string, chapterId: string, contentHash = "active") => ({ novelId, chapterId, contentHash, artifactType: "production_execution", syncMode: "journal" });
interface Dependencies {
  db?: Pick<PrismaClient, "$transaction">;
  store?: Pick<PlanningRepairStore, "assertPipelineRecoverySnapshot">;
  now?: () => number;
}
export interface ReviewExistingRequest { repairKey: string; token: string; idempotencyKey: string }

/** Explicit source-page decision. No model call, no rebase, and no repair budget grant. */
export class PlanningRepairReviewExistingService {
  constructor(private readonly deps: Dependencies = {}) {}

  private async inspect(tx: Prisma.TransactionClient, taskId: string) {
    const task = await tx.novelWorkflowTask.findUnique({ where: { id: taskId } });
    if (!task || !task.novelId || task.lane !== "auto_director" || !isPlanningRepairTaskPaused(task)) {
      return refuse("请在本书规划复核暂停后操作。");
    }
    const { seed, repair, recovery } = readPlanningRepairSeed(task.seedPayloadJson);
    const pending = repair?.pendingOperation as { kind?: string; startedAt?: string } | undefined;
    if (!repair || repair.novelId !== task.novelId || !["technical_failed", "uncertain", "waiting_confirmation"].includes(repair.phase)
      || !repair.candidateVersionId || repair.repairOutputPending || recovery?.pendingGrant || recovery?.idempotencyKey
      || recovery?.resumePhase !== "chapter_execution"
      || !Number.isSafeInteger(repair.rounds) || repair.rounds < 0
      || !Number.isSafeInteger(repair.maxRounds ?? 2) || repair.rounds > (repair.maxRounds ?? 2)) {
      return refuse("当前停点不是可单独重新复核的保留候选。");
    }
    const snapshot = object(seed.planningRepairSnapshot);
    const affected = repair.affectedChapterIds ?? [repair.chapterId];
    if (!Array.isArray(affected) || !affected.length || affected.length > 3 || new Set(affected).size !== affected.length
      || !affected.includes(repair.chapterId) || !Array.isArray(snapshot.eligibleChapterIds)
      || affected.some(id => !snapshot.eligibleChapterIds.includes(id))) return refuse("保留候选的复核窗口已变化。");
    const execution = object(seed.autoExecution);
    if (execution.enabled !== true || typeof execution.pipelineJobId !== "string"
      || !Number.isSafeInteger(execution.startOrder) || !Number.isSafeInteger(execution.endOrder)
      || execution.startOrder < 1 || execution.endOrder < execution.startOrder
      || repair.chapterOrder < execution.startOrder || repair.chapterOrder > execution.endOrder) {
      return refuse("原任务章节范围无法核对。");
    }
    assertUnchangedPipelineRecoveryScope(seed);
    const chapter = await tx.chapter.findFirst({ where: { novelId: task.novelId, order: repair.chapterOrder } });
    if (!chapter || (chapter.content ?? "").trim()) return refuse("当前章已有正文或不存在，不能按准备停点重核。");
    const job = await tx.generationJob.findUnique({ where: { id: execution.pipelineJobId } });
    const now = this.deps.now?.() ?? Date.now();
    if (!job || job.novelId !== task.novelId || job.status !== "failed" || !job.pendingManualRecovery
      || job.cancelRequestedAt || job.currentItemKey !== chapter.id
      || job.startOrder !== chapter.order || job.endOrder !== chapter.order
      || (job.executionOwner && (!job.executionLeaseExpiresAt || job.executionLeaseExpiresAt.getTime() > now))
      || parse(job.payload).workflowTaskId !== taskId) return refuse("原章节任务状态或执行权已变化。");
    if (await tx.generationJob.findFirst({ where: { novelId: task.novelId, status: { in: ["queued", "running"] } } })
      || await tx.directorRunCommand.findFirst({ where: { taskId, status: { in: ["queued", "leased", "running"] } } })
      || await tx.directorRuntimeExecution.findFirst({ where: { novelId: task.novelId,
        status: { in: ["leased", "running"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: new Date(now) } }] } })) {
      return refuse("本书仍有请求正在执行，请等待结果。");
    }
    const identity = slot(task.novelId, chapter.id);
    const row = await tx.chapterArtifactSyncCheckpoint.findUnique({ where: { novelId_chapterId_contentHash_artifactType_syncMode: identity } });
    const journal = parse(row?.metadataJson ?? null) as unknown as ChapterProductionJournalRecord;
    const request = object(journal.request);
    if (journal.version !== 1 || journal.status !== "paused" || !Number.isFinite(journal.expiresAt) || journal.expiresAt > now
      || journal.operationId !== `pipeline:${job.id}:${chapter.id}` || request.entry !== "pipeline" || request.workflowTaskId !== taskId
      || journal.requestFingerprint !== productionFingerprint(request) || journal.expectedFingerprint !== chapterFingerprint(chapter)
      || journal.expectedChapter?.id !== chapter.id || journal.expectedChapter.novelId !== task.novelId
      || (journal.expectedChapter.content ?? "").trim() || journal.partialText?.trim() || journal.prepared
      || !reviewExistingBoundary(repair, journal)
      || Object.keys(journal.steps).some(key => !["prepare", "prepare.contract", contractStep].includes(key))
      || Object.entries(journal.steps).some(([key, step]) => key !== contractStep && (step.status === "unknown" || step.status === "running"))) {
      return refuse("只有空稿准备步骤的单个未确认复核可以重新授权；其他未知结果需先核对。");
    }
    // Validate the exact saved source/candidate without mutating or rebasing the actual state.
    const settledView = { ...task, seedPayloadJson: JSON.stringify({ ...seed,
      planningRepair: { ...repair, pendingOperation: undefined } }) };
    await (this.deps.store ?? new PlanningRepairStore()).assertPipelineRecoverySnapshot(tx, settledView);
    const token = productionFingerprint({ task: task.seedPayloadJson, updatedAt: task.updatedAt, status: task.status,
      job: { id: job.id, updatedAt: job.updatedAt, payload: job.payload, executionOwner: job.executionOwner,
        executionLeaseExpiresAt: job.executionLeaseExpiresAt }, journal: row!.metadataJson });
    return { task, seed, repair, pending, execution, chapter, job, row: row!, journal, identity, token,
      boundary: reviewExistingBoundary(repair, journal)! };
  }

  async status(taskId: string) {
    try {
      return await (this.deps.db ?? prisma).$transaction(async tx => {
        const saved = await this.inspect(tx, taskId);
        return { available: true as const, token: saved.token, candidateVersionId: saved.repair.candidateVersionId!,
          startOrder: saved.execution.startOrder as number, endOrder: saved.execution.endOrder as number,
          chapterOrder: saved.repair.chapterOrder };
      }, { isolationLevel: "Serializable", timeout: 20_000 });
    } catch (error) {
      if (error instanceof AppError || (error && typeof error === "object" && "code" in error && error.code === "PLANNING_REPAIR_CONFLICT")) {
        return { available: false as const };
      }
      throw error;
    }
  }

  async grant(taskId: string, input: ReviewExistingRequest) {
    return (this.deps.db ?? prisma).$transaction(async tx => {
      const task = await tx.novelWorkflowTask.findUnique({ where: { id: taskId } });
      if (!task || task.cancelRequestedAt || task.status === "cancelled") return refuse("任务已取消或不存在。");
      const stored = readPlanningRepairSeed(task.seedPayloadJson);
      const previous = stored.seed.planningReviewExistingAcknowledgement as Record<string, unknown> | undefined;
      if (previous?.requestId === input.idempotencyKey) {
        if (previous.token !== input.token || previous.repairKey !== input.repairKey
          || stored.recovery?.idempotencyKey !== input.idempotencyKey || !stored.repair) return refuse("同一请求标识不能用于不同恢复位置。");
        if (task.lane !== "auto_director" || !isPlanningRepairTaskPaused(task)) return refuse("此请求已提交执行，请刷新任务状态。");
        assertUnchangedPipelineRecoveryScope(stored.seed);
        // A failed HTTP response may replay this grant, but never authorize a drifted candidate.
        await (this.deps.store ?? new PlanningRepairStore()).assertPipelineRecoverySnapshot(tx, task);
        const chapter = await tx.chapter.findFirst({ where: { novelId: task.novelId!, order: stored.repair.chapterOrder } });
        if (!chapter) return refuse("原章节已变化。");
        const job = await tx.generationJob.findUnique({ where: { id: String(previous.pipelineJobId) } });
        const execution = object(stored.seed.autoExecution);
        if (!job || job.id !== execution.pipelineJobId || job.novelId !== task.novelId || job.status !== "failed"
          || !job.pendingManualRecovery || job.cancelRequestedAt || job.currentItemKey !== chapter.id
          || job.startOrder !== chapter.order || job.endOrder !== chapter.order
          || (job.executionOwner && (!job.executionLeaseExpiresAt || job.executionLeaseExpiresAt.getTime() > (this.deps.now?.() ?? Date.now())))
          || parse(job.payload).workflowTaskId !== taskId || (chapter.content ?? "").trim()
          || stored.repair.chapterOrder < execution.startOrder || stored.repair.chapterOrder > execution.endOrder) return refuse("原任务已执行或发生变化，请刷新任务状态。");
        const archived = await tx.chapterArtifactSyncCheckpoint.findUnique({ where: {
          novelId_chapterId_contentHash_artifactType_syncMode: slot(task.novelId!, chapter.id, String(previous.archiveId)),
        } });
        const current = await tx.chapterArtifactSyncCheckpoint.findUnique({ where: {
          novelId_chapterId_contentHash_artifactType_syncMode: slot(task.novelId!, chapter.id),
        } });
        assertReviewExistingAcknowledgement({ acknowledgement: previous, archive: parse(archived?.metadataJson ?? null),
          repair: stored.repair, recovery: stored.recovery, journal: parse(current?.metadataJson ?? null) as unknown as ChapterProductionJournalRecord });
        return { granted: true, replayed: true, taskId };
      }
      const saved = await this.inspect(tx, taskId);
      if (!input.idempotencyKey.trim() || saved.token !== input.token || saved.repair.key !== input.repairKey) {
        return refuse("候选、来源或原任务已变化，请刷新后核对再操作。");
      }
      const acknowledgedAt = this.deps.now?.() ?? Date.now();
      const archiveId = `${saved.journal.operationId}:decision:${input.idempotencyKey}`;
      const archive = { ...structuredClone(saved.journal), operationId: archiveId,
        reviewExistingDecision: { requestId: input.idempotencyKey, originalOperationId: saved.journal.operationId, acknowledgedAt },
        ...(saved.boundary === "acknowledge_unknown" ? { recoveryDecision: { kind: "acknowledge_unknown" as const,
          originalOperationId: saved.journal.operationId, acknowledgedAt, affectedSteps: [contractStep] } } : {}) };
      const next = structuredClone(saved.journal);
      next.steps[contractStep].status = "failed";
      next.expiresAt = 0; delete next.error;
      const archiveIdentity = slot(saved.task.novelId!, saved.chapter.id, archiveId);
      const existingArchive = await tx.chapterArtifactSyncCheckpoint.findUnique({ where: {
        novelId_chapterId_contentHash_artifactType_syncMode: archiveIdentity,
      } });
      if (existingArchive && existingArchive.metadataJson !== JSON.stringify(archive)) return refuse("此确认请求已有不同的归档记录，请刷新核对。");
      await tx.chapterArtifactSyncCheckpoint.upsert({
        where: { novelId_chapterId_contentHash_artifactType_syncMode: archiveIdentity },
        create: { ...archiveIdentity, status: archive.status, metadataJson: JSON.stringify(archive) }, update: {},
      });
      const journalChanged = await tx.chapterArtifactSyncCheckpoint.updateMany({
        where: { ...saved.identity, metadataJson: saved.row.metadataJson },
        data: { metadataJson: JSON.stringify(next), status: next.status },
      });
      if (journalChanged.count !== 1) return refuse("原执行记录已变化，本次未授权。");
      const jobChanged = await tx.generationJob.updateMany({ where: { id: saved.job.id, status: "failed",
        updatedAt: saved.job.updatedAt, payload: saved.job.payload, pendingManualRecovery: true, cancelRequestedAt: null,
        executionOwner: saved.job.executionOwner, executionLeaseExpiresAt: saved.job.executionLeaseExpiresAt },
        data: { pendingManualRecovery: true } });
      if (jobChanged.count !== 1) return refuse("原章节任务已变化，本次未授权。");
      const requests = Array.isArray(saved.seed.planningRepairRecoveryRequests) ? saved.seed.planningRepairRecoveryRequests : [];
      const affectedChapterIds = saved.repair.affectedChapterIds as string[] | undefined;
      const grant = { repairKey: input.repairKey, idempotencyKey: input.idempotencyKey, guidance,
        executionMode: "review_existing" as const, affectedChapterIds };
      const nextSeed = { ...saved.seed,
        planningRepair: { ...saved.repair, phase: "reviewing", pendingOperation: undefined, quality: undefined,
          guidance, recoveryAction: { requestId: input.idempotencyKey, mode: "review_existing", affectedChapterIds } },
        planningRepairRecovery: { ...grant, resumePhase: "chapter_execution", grantedAtRound: saved.repair.rounds },
        planningRepairRecoveryRequests: [...requests, grant],
        planningReviewExistingAcknowledgement: { version: 1, requestId: input.idempotencyKey, token: input.token,
          repairKey: input.repairKey, candidateVersionId: saved.repair.candidateVersionId, round: saved.repair.rounds,
          operationId: saved.journal.operationId, pipelineJobId: saved.job.id, archiveId,
          archiveFingerprint: productionFingerprint(archive), acknowledgedJournalFingerprint: productionFingerprint(next),
          pendingOperation: saved.pending, previousPhase: saved.repair.phase, boundary: saved.boundary, acknowledgedAt },
      };
      const changed = await tx.novelWorkflowTask.updateMany({ where: { id: taskId, seedPayloadJson: saved.task.seedPayloadJson,
        updatedAt: saved.task.updatedAt, status: saved.task.status, pendingManualRecovery: true, cancelRequestedAt: null },
        data: { seedPayloadJson: JSON.stringify(nextSeed) } });
      if (changed.count !== 1) return refuse("任务已变化，本次未授权。");
      return { granted: true, replayed: false, taskId };
    }, { isolationLevel: "Serializable", timeout: 20_000 });
  }
}
