import { prisma } from "../../../../db/prisma";
import type { PipelineJobStatus } from "@prisma/client";
import { getSharedNovelServices } from "../../application/sharedNovelServices";
import { ChapterProductionError, createDefaultChapterProductionJournal } from "../reliability";
import { ChapterPipelineRecoveryService } from "./ChapterPipelineRecoveryService";

export { ChapterPipelineRecoveryService, assertUnchangedPipelineRecoveryScope } from "./ChapterPipelineRecoveryService";
export type { ChapterPipelineRecoveryDeps, PipelineRecoveryJob, PipelineRecoveryProjection, PipelineRecoveryExpectation, DirectorPipelineRecoveryRequest, DirectorPipelineContinuationExpectation, RecoveryChapterSnapshot, CompletedPipelineJobExpectation } from "./ChapterPipelineRecoveryService";

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
