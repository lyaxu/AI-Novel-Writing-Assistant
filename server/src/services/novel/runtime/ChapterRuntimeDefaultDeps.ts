import { ChapterWritingGraph } from "../chapterWritingGraph";
import type { ChapterArtifactSyncService } from "./ChapterArtifactSyncService";
export interface ChapterRuntimeAgentPort {
  createChapterGenRun: (novelId: string, chapterId: string, chapterOrder: number) => Promise<string>;
  finishChapterGenRun: (runId: string, summary: string, durationMs: number) => Promise<void>;
}

export const defaultChapterRuntimeAgent: ChapterRuntimeAgentPort = {
  async createChapterGenRun(novelId, chapterId, chapterOrder) {
    const { agentRuntime } = await import("../../../agents");
    return agentRuntime.createChapterGenRun(novelId, chapterId, chapterOrder);
  },
  async finishChapterGenRun(runId, summary, durationMs) {
    const { agentRuntime } = await import("../../../agents");
    await agentRuntime.finishChapterGenRun(runId, summary, durationMs);
  },
};

export function createDefaultChapterWritingGraph(artifactSyncService: Pick<ChapterArtifactSyncService, "saveDraftAndArtifacts">) {
  return new ChapterWritingGraph({
    enforceOpeningDiversity: async (_novelId, _chapterOrder, _chapterTitle, content) => ({
      content, rewritten: false, maxSimilarity: 0,
    }),
    saveDraftAndArtifacts: (...args) => artifactSyncService.saveDraftAndArtifacts(...args),
    logInfo: (message, meta) => console.info(`[chapter-runtime] ${message}`, ...(meta ? [meta] : [])),
    logWarn: (message, meta) => console.warn(`[chapter-runtime] ${message}`, ...(meta ? [meta] : [])),
  });
}
