import type { PrismaClient, Prisma } from "@prisma/client";
import { ChapterProductionError, type ChapterProductionJournalRepository, type JournalTransaction } from "./types";

const slot = (novelId: string, chapterId: string) => ({ novelId, chapterId, contentHash: "active", artifactType: "production_execution", syncMode: "journal" });
const selectChapter = { id: true, novelId: true, content: true, title: true, taskSheet: true, sceneCards: true, expectation: true, targetWordCount: true,
  mustAvoid: true, conflictLevel: true, revealLevel: true, hook: true } as const;

/** The existing checkpoint table owns execution outputs; Chapter remains the only prose authority. */
function adaptTransaction(db: Prisma.TransactionClient): JournalTransaction {
  const writeChapter: JournalTransaction["writeState"] = async (novelId, chapterId, expected, data) => {
    const result = await db.chapter.updateMany({
      where: { id: chapterId, novelId, content: expected.content, title: expected.title, taskSheet: expected.taskSheet, sceneCards: expected.sceneCards, expectation: expected.expectation, targetWordCount: expected.targetWordCount,
        mustAvoid: expected.mustAvoid, conflictLevel: expected.conflictLevel, revealLevel: expected.revealLevel, hook: expected.hook },
      data,
    });
    if (result.count !== 1) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "正文或执行约定已变化，已保留当前稿件并停止覆盖。");
  };
  return {
    assetClient: db,
    readChapter: (novelId, chapterId) => db.chapter.findFirst({ where: { id: chapterId, novelId }, select: selectChapter }),
    readJournal: (novelId, chapterId) => db.chapterArtifactSyncCheckpoint.findUnique({
      where: { novelId_chapterId_contentHash_artifactType_syncMode: slot(novelId, chapterId) },
      select: { status: true, metadataJson: true },
    }),
    async writeJournal(novelId, chapterId, expectedJson, nextJson) {
      const identity = slot(novelId, chapterId);
      const status = (JSON.parse(nextJson) as { status: string }).status;
      if (expectedJson === null) {
        try { await db.chapterArtifactSyncCheckpoint.create({ data: { ...identity, metadataJson: nextJson, status } }); }
        catch (cause) {
          if ((cause as { code?: string }).code === "P2002") throw new ChapterProductionError("CHAPTER_PRODUCTION_BUSY", "本章已有执行获得所有权。", { cause });
          throw cause;
        }
      } else {
        const result = await db.chapterArtifactSyncCheckpoint.updateMany({ where: { ...identity, metadataJson: expectedJson }, data: { metadataJson: nextJson, status } });
        if (result.count !== 1) throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节执行所有权已变化，已停止旧执行写入。");
      }
    },
    async archiveJournal(novelId, chapterId, record) {
      const identity = { ...slot(novelId, chapterId), contentHash: record.operationId };
      await db.chapterArtifactSyncCheckpoint.upsert({
        where: { novelId_chapterId_contentHash_artifactType_syncMode: identity },
        create: { ...identity, metadataJson: JSON.stringify(record), status: record.status },
        update: {},
      });
    },
    writeContent: writeChapter,
    writeState: writeChapter,
  };
}

export function createPrismaChapterProductionRepository(db: PrismaClient): ChapterProductionJournalRepository {
  return { transaction: (fn) => db.$transaction((tx) => fn(adaptTransaction(tx))) };
}
