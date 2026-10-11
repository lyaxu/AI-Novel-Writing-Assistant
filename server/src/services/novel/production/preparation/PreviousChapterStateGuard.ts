import { prisma } from "../../../../db/prisma";
import { ChapterProductionError } from "../reliability";
import { getCurrentChapterArtifactSyncOutcome, CHAPTER_ARTIFACT_BOUNDARY_TYPE } from "../../runtime/artifactSync";

/** Read-only prerequisite; never repair a previous chapter or invoke a model while checking. */
export async function assertPreviousChapterStateReady(novelId: string, chapterId: string): Promise<void> {
  const chapter = await prisma.chapter.findFirst({ where: { novelId, id: chapterId }, select: { order: true } });
  if (!chapter) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节不存在，请刷新工作区。");
  const previousChapters = await prisma.chapter.findMany({
    where: { novelId, order: { lt: chapter.order }, content: { not: null } },
    orderBy: { order: "desc" },
    select: { id: true, order: true, content: true, artifactSyncCheckpoints: {
      where: { OR: [
        { artifactType: CHAPTER_ARTIFACT_BOUNDARY_TYPE, status: "succeeded" },
        { artifactType: "production_execution", contentHash: "active" },
      ] },
      select: { contentHash: true, metadataJson: true, artifactType: true },
    } },
  });
  const previous = previousChapters.find(row => Boolean(row.content?.trim()));
  if (!previous?.content?.trim()) return;
  const journal = previous.artifactSyncCheckpoints.find(row => row.artifactType === "production_execution");
  let operationId: string | undefined;
  if (journal) {
    try { operationId = JSON.parse(journal.metadataJson ?? "null")?.operationId; } catch { /* no valid boundary below */ }
    if (!operationId) throw new ChapterProductionError("CHAPTER_PRODUCTION_STORAGE", `第${previous.order}章的执行记录需要核对，请先保留现场。`);
  }
  const boundaries = previous.artifactSyncCheckpoints.filter(row => {
    if (row.artifactType !== CHAPTER_ARTIFACT_BOUNDARY_TYPE) return false;
    if (!operationId) return true;
    try { return JSON.parse(row.metadataJson ?? "null")?.operationId === operationId; } catch { return false; }
  });
  if (!boundaries.some(row => getCurrentChapterArtifactSyncOutcome(previous.content, [row]) === "completed")) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_STORAGE", `第${previous.order}章的实际故事状态尚未完整提交。请回到该章核对保留稿并完成状态提交，再开始本章。`);
  }
}
