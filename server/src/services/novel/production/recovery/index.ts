import { prisma } from "../../../../db/prisma";
import { getSharedNovelServices } from "../../application/sharedNovelServices";
import { createDefaultChapterProductionJournal } from "../reliability";
import { ChapterPipelineRecoveryService } from "./ChapterPipelineRecoveryService";

export { ChapterPipelineRecoveryService } from "./ChapterPipelineRecoveryService";
export type { ChapterPipelineRecoveryDeps, PipelineRecoveryJob, PipelineRecoveryProjection, PipelineRecoveryExpectation } from "./ChapterPipelineRecoveryService";

export function createChapterPipelineRecoveryService() {
  return new ChapterPipelineRecoveryService({
    inspect: target => createDefaultChapterProductionJournal().inspect(target),
    findChapter: ({ novelId, chapterId }) => prisma.chapter.findFirst({ where: { novelId, id: chapterId }, select: { order: true } }),
    findJob: id => prisma.generationJob.findUnique({ where: { id }, select: {
      id: true, novelId: true, status: true, startOrder: true, endOrder: true, currentItemKey: true,
      pendingManualRecovery: true, cancelRequestedAt: true, executionOwner: true, executionLeaseExpiresAt: true, payload: true, updatedAt: true,
    } }),
    resumeJob: (id, expected) => getSharedNovelServices().resumePipelineJob(id, expected),
  });
}
