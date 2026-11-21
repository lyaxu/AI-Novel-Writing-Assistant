import { prisma } from "../../../../db/prisma";
import type { NovelWorkflowTaskStatus, PipelineJobStatus, Prisma } from "@prisma/client";
import { getSharedNovelServices } from "../../application/sharedNovelServices";
import { ChapterProductionError, createDefaultChapterProductionJournal } from "../reliability";
import { ChapterPipelineRecoveryService } from "./ChapterPipelineRecoveryService";
import {
  AcceptanceUnavailableFinalizationService,
  type AcceptanceUnavailableFinalizationPlan,
} from "./AcceptanceUnavailableFinalizationService";

export { ChapterPipelineRecoveryService, assertUnchangedPipelineRecoveryScope } from "./ChapterPipelineRecoveryService";
export type { ChapterPipelineRecoveryDeps, PipelineRecoveryJob, PipelineRecoveryProjection, PipelineRecoveryExpectation, DirectorPipelineRecoveryRequest, DirectorPipelineContinuationExpectation, RecoveryChapterSnapshot, CompletedPipelineJobExpectation } from "./ChapterPipelineRecoveryService";
export { AcceptanceUnavailableFinalizationService, isAcceptanceReviewFormatFailure } from "./AcceptanceUnavailableFinalizationService";
export type {
  AcceptanceUnavailableChapter, AcceptanceUnavailableFinalizationDeps, AcceptanceUnavailableFinalizationPlan,
  AcceptanceUnavailableFinalizationResult, AcceptanceUnavailableJob, AcceptanceUnavailableJournalRow, AcceptanceUnavailableTask,
} from "./AcceptanceUnavailableFinalizationService";

export function createChapterPipelineRecoveryService() {
  return new ChapterPipelineRecoveryService({
    inspect: target => createDefaultChapterProductionJournal().inspect(target),
    findChapter: ({ novelId, chapterId }) => prisma.chapter.findFirst({
      where: { novelId, id: chapterId },
      select: { order: true, content: true, generationState: true, chapterStatus: true },
    }),
    findJob: id => prisma.generationJob.findUnique({ where: { id }, select: {
      id: true, novelId: true, status: true, startOrder: true, endOrder: true, currentItemKey: true,
      pendingManualRecovery: true, cancelRequestedAt: true, executionOwner: true, executionLeaseExpiresAt: true, payload: true, updatedAt: true,
    } }),
    resumeJob: (id, expected) => getSharedNovelServices().resumePipelineJob(id, expected),
    /**
     * Complete a stale paused range job. The caller has already proved, from the chapter row and
     * the execution journal, that the target work is done; this only writes the derived job status.
     */
    completeJob: async (id, expected) => {
      const updated = await prisma.generationJob.updateMany({
        where: {
          id,
          novelId: expected.novelId,
          currentItemKey: expected.chapterId,
          status: expected.jobStatus as PipelineJobStatus,
          pendingManualRecovery: true,
          cancelRequestedAt: null,
          updatedAt: expected.updatedAt,
          payload: expected.payload,
          OR: [{ executionOwner: null }, { executionLeaseExpiresAt: null }, { executionLeaseExpiresAt: { lte: new Date() } }],
        },
        data: {
          status: "succeeded",
          pendingManualRecovery: false,
          currentItemKey: null,
          currentItemLabel: null,
          currentStage: null,
          error: null,
          progress: 1,
          heartbeatAt: null,
          finishedAt: expected.completedAt,
          cancelRequestedAt: null,
        },
      });
      if (updated.count !== 1) {
        throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "原章节任务状态已变化，请刷新本书工作区后核对。");
      }
    },
  });
}

/**
 * Degraded finalization for saved prose whose acceptance review never parsed. Every expected value
 * is part of a CAS; any concurrent change rolls the whole transaction back (persist returns false).
 */
export function createAcceptanceUnavailableFinalizationService() {
  return new AcceptanceUnavailableFinalizationService({
    loadTask: id => prisma.novelWorkflowTask.findUnique({
      where: { id },
      select: {
        id: true, novelId: true, lane: true, status: true, pendingManualRecovery: true,
        cancelRequestedAt: true, updatedAt: true, seedPayloadJson: true,
      },
    }),
    findJob: id => prisma.generationJob.findUnique({
      where: { id },
      select: {
        id: true, novelId: true, status: true, startOrder: true, endOrder: true, currentItemKey: true,
        pendingManualRecovery: true, cancelRequestedAt: true, executionOwner: true,
        executionLeaseExpiresAt: true, payload: true, updatedAt: true, error: true,
      },
    }),
    findChapter: (novelId, chapterId) => prisma.chapter.findFirst({
      where: { id: chapterId, novelId },
      select: {
        id: true, novelId: true, order: true, title: true, content: true, taskSheet: true, sceneCards: true,
        expectation: true, targetWordCount: true, mustAvoid: true, conflictLevel: true, revealLevel: true, hook: true,
        generationState: true, chapterStatus: true, repairHistory: true, riskFlags: true,
      },
    }),
    readJournal: (novelId, chapterId) => prisma.chapterArtifactSyncCheckpoint.findFirst({
      where: { novelId, chapterId, contentHash: "active", artifactType: "production_execution", syncMode: "journal" },
      select: { id: true, novelId: true, chapterId: true, contentHash: true, artifactType: true, syncMode: true, metadataJson: true },
    }),
    persist: async (plan: AcceptanceUnavailableFinalizationPlan) => {
      try {
        await prisma.$transaction(async (tx) => {
          const chapter = await tx.chapter.updateMany({
            where: {
              id: plan.chapter.id, novelId: plan.chapter.novelId, content: plan.chapter.expectedContent,
              generationState: plan.chapter.expectedGenerationState as Prisma.ChapterWhereInput["generationState"],
              chapterStatus: plan.chapter.expectedChapterStatus as Prisma.ChapterWhereInput["chapterStatus"],
            },
            data: {
              generationState: plan.chapter.nextGenerationState,
              chapterStatus: plan.chapter.nextChapterStatus,
              repairHistory: plan.chapter.nextRepairHistory,
              riskFlags: plan.chapter.nextRiskFlags,
            },
          });
          if (chapter.count !== 1) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节正文或状态已变化，未执行降级完成。");
          const journal = await tx.chapterArtifactSyncCheckpoint.updateMany({
            where: {
              id: plan.journal.id, contentHash: "active", artifactType: "production_execution", syncMode: "journal",
              metadataJson: plan.journal.expectedMetadataJson,
            },
            data: { status: "succeeded", metadataJson: plan.journal.nextMetadataJson },
          });
          if (journal.count !== 1) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节执行记录已变化，未执行降级完成。");
          const job = await tx.generationJob.updateMany({
            where: {
              id: plan.job.id, status: plan.job.expectedStatus as PipelineJobStatus,
              updatedAt: plan.job.expectedUpdatedAt, payload: plan.job.expectedPayload,
              cancelRequestedAt: null,
              OR: [{ executionOwner: null }, { executionLeaseExpiresAt: null }, { executionLeaseExpiresAt: { lte: plan.job.completedAt } }],
            },
            data: {
              status: "succeeded", pendingManualRecovery: false, currentItemKey: null, currentItemLabel: null,
              currentStage: null, error: null, progress: 1, heartbeatAt: null,
              finishedAt: plan.job.completedAt, payload: plan.job.nextPayload,
            },
          });
          if (job.count !== 1) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "原章节任务状态已变化，未执行降级完成。");
          const task = await tx.novelWorkflowTask.updateMany({
            where: {
              id: plan.task.id, updatedAt: plan.task.expectedUpdatedAt,
              seedPayloadJson: plan.task.expectedSeedPayloadJson, status: plan.task.expectedStatus as NovelWorkflowTaskStatus,
              pendingManualRecovery: plan.task.expectedPendingManualRecovery, cancelRequestedAt: null,
            },
            data: { seedPayloadJson: plan.task.nextSeedPayloadJson, heartbeatAt: plan.job.completedAt },
          });
          if (task.count !== 1) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "自动导演任务已变化，未执行降级完成。");
        });
        return true;
      } catch (error) {
        if (error instanceof ChapterProductionError) return false;
        throw error;
      }
    },
  });
}
