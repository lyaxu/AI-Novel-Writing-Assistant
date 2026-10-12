import { hasUnresolvedActualStateProposal } from "./proposalDecision";
import { ragServices } from "../../../rag";
import { payoffLedgerSyncService } from "../../../payoff/PayoffLedgerSyncService";
import type { ArtifactSyncMode } from "../../novelCoreShared";
import { currentProductionSession, ChapterProductionError } from "../reliability";
import { runInActualStateTransaction } from "./transactionContext";
import { CHAPTER_ARTIFACT_CONSUMERS, ChapterArtifactDeltaService, buildContentHash,
  type ChapterArtifactDeltaSyncInput, type ChapterArtifactConsumerResult } from "../../runtime/ChapterArtifactDeltaService";
import { CHAPTER_ARTIFACT_BOUNDARY_TYPE } from "../../runtime/artifactSync/ChapterArtifactSyncBoundary";
import type { ChapterArtifactSyncResult } from "../../runtime/artifactSync/ChapterArtifactSyncResult";

/** Final selected prose is the sole input. External extraction never runs inside the local commit. */
export class ChapterActualStateService {
  constructor(private readonly delta = new ChapterArtifactDeltaService()) {}
  async sync(input: ChapterArtifactDeltaSyncInput & { artifactSyncMode?: ArtifactSyncMode }): Promise<ChapterArtifactSyncResult> {
    const session = currentProductionSession();
    if (!session || session.chapterId !== input.chapterId || session.novelId !== input.novelId) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "实际状态提交需要当前章节执行所有权。");
    }
    const contentHash = buildContentHash(input.content);
    const key = `actual:${contentHash}:assets`;
    const extraction = await session.runStep(`${key}:extract`, () => this.delta.extractChapterArtifacts(input), { external: true });
    if (extraction.contentHash !== contentHash) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "实际状态抽取与保留稿版本不符。");
    const committed = await session.commitState(`${key}:commit`, (tx) => runInActualStateTransaction(tx, async () => {
      const aggregate: ChapterArtifactConsumerResult = {};
      for (const consumer of CHAPTER_ARTIFACT_CONSUMERS) {
        Object.assign(aggregate, await this.delta.applyChapterArtifactConsumer({ ...input, contentHash,
          output: extraction.output, consumer, stateSnapshotId: aggregate.stateSnapshotId ?? null }));
      }
      const chapter = await tx.chapter.findFirst({ where: { id: input.chapterId, novelId: input.novelId }, select: { order: true, title: true } });
      const characters = await tx.character.findMany({ where: { novelId: input.novelId }, select: { id: true, name: true } });
      const supersededTimeline = await tx.characterTimeline.findMany({ where: { novelId: input.novelId, chapterId: input.chapterId, source: { in: ["chapter_extract", "chapter_artifact_delta"] } }, select: { id: true } });
      await tx.characterTimeline.updateMany({ where: { novelId: input.novelId, chapterId: input.chapterId, source: { in: ["chapter_extract", "chapter_artifact_delta"] } }, data: { source: "superseded" } });
      const events = extraction.output.stateDeltas.characterStates.flatMap((state) => {
        const character = characters.find((item) => item.id === state.characterId || item.name === state.characterName);
        return character && state.summary && chapter ? [{ novelId: input.novelId, chapterId: input.chapterId, characterId: character.id,
          chapterOrder: chapter.order, title: `${chapter.order} - ${chapter.title}`, content: state.summary, source: "chapter_artifact_delta" }] : [];
      });
      if (events.length) await tx.characterTimeline.createMany({ data: events });
      const activeTimeline = await tx.characterTimeline.findMany({ where: { novelId: input.novelId, chapterId: input.chapterId, source: "chapter_artifact_delta" }, select: { id: true } });
      const facts = await tx.consistencyFact.findMany({ where: { novelId: input.novelId, chapterId: input.chapterId }, select: { id: true, source: true } });
      return { aggregate, activeTimeline, supersededTimeline, facts };
    }));
    const { aggregate } = committed;
    const summary = this.delta.toSyncResult(extraction, aggregate);
    if (summary.requiresFullReconcile || input.artifactSyncMode === "strict") {
      await payoffLedgerSyncService.syncLedger(input.novelId, { sourceChapterId: input.chapterId });
    }
    const boundary = await session.commitState(`${key}:boundary`, (tx) => runInActualStateTransaction(tx, async () => {
      const proposals = await tx.stateChangeProposal.findMany({
        where: { novelId: input.novelId, chapterId: input.chapterId, status: { in: ["pending_review", "rejected"] } },
        select: { payloadJson: true, status: true, validationNotesJson: true },
      });
      if (hasUnresolvedActualStateProposal(proposals, session.operationId, contentHash)) throw new ChapterProductionError("CHAPTER_PRODUCTION_STORAGE", "正文和审查结果已保存，故事状态提交等待资源核对。请在本章右侧“资源风险”的“需要判断的资源变更”中核对并确认或忽略，再点“继续自动导演”；恢复会复用已有结果，不重写正文。");
      const result: ChapterArtifactSyncResult = { status: "completed", contentHash, completedArtifacts: [...CHAPTER_ARTIFACT_CONSUMERS] };
      await tx.chapterArtifactSyncCheckpoint.upsert({
        where: { novelId_chapterId_contentHash_artifactType_syncMode: {
          novelId: input.novelId, chapterId: input.chapterId, contentHash, artifactType: CHAPTER_ARTIFACT_BOUNDARY_TYPE, syncMode: "strict" } },
        create: { novelId: input.novelId, chapterId: input.chapterId, contentHash, artifactType: CHAPTER_ARTIFACT_BOUNDARY_TYPE,
          syncMode: "strict", status: "succeeded", sourceType: "chapter_production", sourceStage: "actual_state",
          metadataJson: JSON.stringify({ ...result, outcome: "completed", operationId: session.operationId, aggregate }) },
        update: { status: "succeeded", metadataJson: JSON.stringify({ ...result, outcome: "completed", operationId: session.operationId, aggregate }) },
      });
      return result;
    }));
    await session.runStep(`${key}:rag-enqueue`, async () => {
      await ragServices.ragIndexService.enqueueUpsert("chapter", input.chapterId);
      await ragServices.ragIndexService.enqueueUpsert("chapter_summary", input.chapterId);
      await ragServices.ragIndexService.enqueueUpsert("novel", input.novelId);
      for (const row of committed.facts) {
        if (row.source === "superseded") await ragServices.ragIndexService.enqueueDelete("consistency_fact", row.id);
        else await ragServices.ragIndexService.enqueueUpsert("consistency_fact", row.id);
      }
      for (const row of committed.activeTimeline) await ragServices.ragIndexService.enqueueUpsert("character_timeline", row.id);
      for (const row of committed.supersededTimeline) await ragServices.ragIndexService.enqueueDelete("character_timeline", row.id);
    }).catch((error) => { console.warn("[chapter-production] RAG queue deferred", { chapterId: input.chapterId, error: error instanceof Error ? error.message : String(error) }); });
    return boundary;
  }
}
