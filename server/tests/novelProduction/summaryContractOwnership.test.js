const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../../dist/db/prisma.js");
const promptRunner = require("../../dist/prompting/core/promptRunner.js");
const { ChapterArtifactDeltaService, buildContentHash } = require("../../dist/services/novel/runtime/ChapterArtifactDeltaService.js");
const { NovelChapterSummaryService } = require("../../dist/services/novel/NovelChapterSummaryService.js");

for (const source of ["artifact", "manual_summary"]) {
  test(`${source} saves actual summary without overwriting the reviewed objective`, async () => {
    const original = [prisma.$transaction, prisma.chapter.findFirst, promptRunner.runStructuredPrompt];
    const chapter = { id: "c", order: 1, title: "Chapter", content: "actual prose", expectation: "reviewed objective", novel: { title: "Novel" } };
    let savedSummary;
    let chapterWrites = 0;
    const tx = {
      chapter: {
        findFirst: async () => chapter,
        update: async () => { chapterWrites++; },
      },
      chapterSummary: { upsert: async ({ create }) => { savedSummary = create.summary; } },
    };
    prisma.$transaction = async (run) => run(tx);
    prisma.chapter.findFirst = async () => chapter;
    promptRunner.runStructuredPrompt = async () => ({ output: { summary: "actual summary", concreteFacts: [] } });
    try {
      if (source === "artifact") {
        const service = new ChapterArtifactDeltaService();
        service.queueRagUpsert = () => {};
        await service.persistChapterSummaryAndFacts({
          novelId: "n", chapterId: "c", chapterOrder: 1, content: chapter.content,
          expectedContentHash: buildContentHash(chapter.content),
          output: { summary: "actual summary", concreteFacts: [] },
        });
      } else {
        const service = new NovelChapterSummaryService();
        service.queueRagUpsert = () => {};
        const result = await service.generateChapterSummary("n", "c");
        assert.equal(result.expectation, chapter.expectation);
        assert.equal(result.summary, "actual summary");
      }
      assert.equal(savedSummary, "actual summary");
      assert.equal(chapterWrites, 0);
    } finally {
      [prisma.$transaction, prisma.chapter.findFirst, promptRunner.runStructuredPrompt] = original;
    }
  });
}
