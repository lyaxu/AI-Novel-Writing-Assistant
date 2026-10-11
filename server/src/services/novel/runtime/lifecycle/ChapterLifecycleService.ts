import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../db/prisma";
import { withSqliteRetry } from "../../../../db/sqliteRetry";
import {
  mergeChapterPatchForGenerationStateBump,
  type OperationalChapterStatus,
  type PipelineGenerationState,
} from "../../chapterLifecycleState";
import { assertChapterContentNotEmpty } from "../chapterEmptyContentError";
import { currentProductionSession, ChapterProductionError } from "../../production/reliability";

function chapterExecution(chapterId: string, novelId?: string) {
  const session = currentProductionSession();
  if (session && (session.chapterId !== chapterId || (novelId && session.novelId !== novelId))) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "执行记录与待保存章节不一致，已停止写入。");
  }
  return session;
}

export class ChapterContentPersistenceError extends Error {
  constructor(
    readonly chapterId: string,
    message: string,
  ) {
    super(message);
    this.name = "ChapterContentPersistenceError";
  }
}

export class ChapterLifecycleService {
  async saveWorkingContent(input: {
    novelId: string;
    chapterId: string;
    content: string;
    generationState: "drafted" | "repaired";
  }): Promise<string> {
    const content = assertChapterContentNotEmpty(input.content, {
      novelId: input.novelId,
      chapterId: input.chapterId,
      source: "chapter_lifecycle_save",
    });
    const execution = chapterExecution(input.chapterId, input.novelId);
    if (execution) {
      await execution.saveContent({ content, generationState: input.generationState, chapterStatus: "generating" });
      return content;
    }
    try {
      await withSqliteRetry(
        () => prisma.chapter.update({
          where: { id: input.chapterId },
          data: {
            content,
            generationState: input.generationState,
            chapterStatus: "generating",
          },
        }),
        { label: "chapterLifecycle.saveWorkingContent" },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ChapterContentPersistenceError(input.chapterId, `正文保存失败：${detail}`);
    }
    return content;
  }

  async markChapterStatus(chapterId: string, chapterStatus: OperationalChapterStatus): Promise<void> {
    const execution = chapterExecution(chapterId);
    if (execution) return execution.updateState({ chapterStatus });
    await withSqliteRetry(
      () => prisma.chapter.update({
        where: { id: chapterId },
        data: { chapterStatus },
      }),
      { label: "chapterLifecycle.markChapterStatus" },
    );
  }

  async markGenerationState(chapterId: string, generationState: PipelineGenerationState): Promise<void> {
    const execution = chapterExecution(chapterId);
    if (execution) return execution.updateState(mergeChapterPatchForGenerationStateBump({}, generationState));
    await withSqliteRetry(
      () => prisma.chapter.update({
        where: { id: chapterId },
        data: mergeChapterPatchForGenerationStateBump({}, generationState),
      }),
      { label: "chapterLifecycle.markGenerationState" },
    );
  }

  async applyQualityAssessmentState(input: {
    chapterId: string;
    data: Pick<Prisma.ChapterUpdateInput, "riskFlags" | "repairHistory" | "chapterStatus" | "generationState">;
  }): Promise<void> {
    const execution = chapterExecution(input.chapterId);
    if (execution) {
      const data = input.data;
      return execution.updateState({
        riskFlags: data.riskFlags && typeof data.riskFlags === "object" ? data.riskFlags.set : data.riskFlags,
        repairHistory: data.repairHistory && typeof data.repairHistory === "object" ? data.repairHistory.set : data.repairHistory,
        chapterStatus: data.chapterStatus && typeof data.chapterStatus === "object" ? data.chapterStatus.set : data.chapterStatus,
        generationState: typeof data.generationState === "object" ? data.generationState.set : data.generationState,
      });
    }
    await withSqliteRetry(
      () => prisma.chapter.update({
        where: { id: input.chapterId },
        data: input.data,
      }),
      { label: "chapterLifecycle.applyQualityAssessmentState" },
    );
  }
}

export const chapterLifecycleService = new ChapterLifecycleService();
