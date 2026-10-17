const test = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("./fixtures/directorUsage/fiveChapterPause.json");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const prisma = { directorLlmUsageRecord: {}, chapter: {}, volumeChapterPlan: {} };
const filename = path.resolve(__dirname, "../src/services/novel/director/runtime/DirectorUsageTelemetryQueryService.ts");
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
  if (name === "../../../../db/prisma") return { prisma };
  throw new Error(`Unexpected dependency ${name}`);
}, api);
const { DirectorUsageTelemetryQueryService } = api;

function mockStore({ rows = fixture.rows, chapters = fixture.chapters, plans = fixture.plans } = {}) {
  const queries = [];
  const original = [prisma.directorLlmUsageRecord.findMany, prisma.chapter.findMany, prisma.volumeChapterPlan.findMany];
  prisma.directorLlmUsageRecord.findMany = async (query) => {
    queries.push(query);
    return rows.map((row) => ({ ...row, recordedAt: new Date(row.recordedAt) }));
  };
  prisma.chapter.findMany = async () => chapters;
  prisma.volumeChapterPlan.findMany = async () => plans;
  return { queries, restore() {
    [prisma.directorLlmUsageRecord.findMany, prisma.chapter.findMany, prisma.volumeChapterPlan.findMany] = original;
  } };
}

const scope = { taskId: "fixture-task", novelId: "fixture-novel" };

test("real 26 calls merge planning and prose by persisted chapter links and retain unknown cost", async () => {
  const mock = mockStore();
  try {
    const result = await new DirectorUsageTelemetryQueryService().getTaskControlUsage(scope);
    assert.equal(result.summary.llmCallCount, 26);
    assert.equal(result.summary.totalTokens, 1008277);
    assert.equal(result.chapterUsage.length, 2);
    const fourth = result.chapterUsage.find((chapter) => chapter.chapterOrder === 4);
    const fifth = result.chapterUsage.find((chapter) => chapter.chapterOrder === 5);
    assert.equal(fourth.chapterId, "chapter-4");
    assert.equal(fourth.totalTokens, 241566 + 222310);
    assert.deepEqual(fourth.sourceChapterIds.sort(), ["chapter-4", "plan-chapter-4"]);
    assert.equal(fifth.totalTokens, 246741 + 171436);
    assert.equal(fifth.latestUsageRecordId, "usage-26");
    assert.equal(result.unattributedUsage.llmCallCount, 5);
    assert.equal(result.unattributedUsage.totalTokens, 126224);
    assert.equal(result.nodeUsage.reduce((sum, group) => sum + group.totalTokens, 0), result.summary.totalTokens);
    assert.equal(result.stageUsage.reduce((sum, group) => sum + group.totalTokens, 0), result.summary.totalTokens);
    assert.equal(result.records.length, 26);
    assert.equal(result.records[1].chapterId, "chapter-4");
    assert.equal(result.records[1].sourceChapterId, "plan-chapter-4");
    assert.equal(result.records[1].chapterOrder, 4);
    assert.deepEqual(mock.queries[0].where, { taskId: "fixture-task" });
    assert.equal(mock.queries[0].take, undefined);
    const largest = await new DirectorUsageTelemetryQueryService().getLargestChapterUsage({ novelId: scope.novelId, taskIds: [scope.taskId] });
    assert.equal(largest.chapterOrder, 4);
    assert.equal(largest.totalTokens, fourth.totalTokens);
  } finally { mock.restore(); }
});

test("task control excludes another task and applies inclusive recovery boundary without record caps", async () => {
  const since = new Date(fixture.rows[15].recordedAt);
  const mock = mockStore({ rows: [...fixture.rows, { ...fixture.rows[25], id: "other-task", taskId: "other-task", totalTokens: 9999999 }] });
  try {
    const result = await new DirectorUsageTelemetryQueryService().getTaskControlUsage({ ...scope, since });
    assert.equal(result.records.length, 11);
    assert.equal(result.records[0].id, "usage-16");
    assert.deepEqual(mock.queries[0].where, { taskId: scope.taskId, recordedAt: { gte: since } });
    assert.equal(result.chapterUsage.length, 1);
    assert.equal(result.chapterUsage[0].chapterOrder, 5);
    assert.equal(result.summary.totalTokens, fixture.rows.slice(15).reduce((sum, row) => sum + row.totalTokens, 0));
  } finally { mock.restore(); }
});

test("unlinked plans retain chapter order but unknown, conflicting and cross-book links remain unassigned", async () => {
  const examples = [
    { chapterId: "plan-6" },
    { chapterId: "missing", chapterOrder: 4 },
    { chapterId: "broken-plan" },
    { chapterId: "wrong-order" },
    { chapterId: "plan-chapter-4", volumeId: "wrong-volume" },
    { chapterId: "chapter-4", foreignNovel: true },
    null,
  ];
  const rows = examples.map((metadata, index) => ({ ...fixture.rows[0], id: `unknown-${index}`, novelId: metadata?.foreignNovel ? "other-novel" : scope.novelId, metadataJson: JSON.stringify(metadata), totalTokens: 10 }));
  const mock = mockStore({ rows, plans: [...fixture.plans,
    { id: "plan-6", chapterId: null, chapterOrder: 6, volumeId: "fixture-volume" },
    { id: "broken-plan", chapterId: "foreign-chapter", chapterOrder: 4, volumeId: "fixture-volume" },
    { id: "wrong-order", chapterId: "chapter-4", chapterOrder: 5, volumeId: "fixture-volume" },
  ] });
  try {
    const result = await new DirectorUsageTelemetryQueryService().getTaskControlUsage(scope);
    assert.equal(result.chapterUsage.length, 1);
    assert.equal(result.chapterUsage[0].chapterId, "plan-6");
    assert.equal(result.chapterUsage[0].chapterOrder, 6);
    assert.equal(result.unattributedUsage.llmCallCount, 6);
    assert.equal(result.unattributedUsage.totalTokens, 60);
  } finally { mock.restore(); }
});

test("task and book totals include more than display and historical query caps", async () => {
  const rows = Array.from({ length: 1201 }, (_, index) => ({ ...fixture.rows[0], id: `many-${index}`, totalTokens: 1 }));
  const mock = mockStore({ rows });
  try {
    const service = new DirectorUsageTelemetryQueryService();
    const task = await service.getTaskUsage(scope.taskId);
    const book = await service.getBookUsage({ novelId: scope.novelId });
    const control = await service.getTaskControlUsage(scope);
    assert.equal(task.summary.totalTokens, 1201);
    assert.equal(book.summary.totalTokens, 1201);
    assert.equal(control.summary.totalTokens, 1201);
    assert.equal(control.records.length, 1201);
    assert.equal(task.recentUsage.length, 12);
    assert.equal(book.recentUsage.length, 12);
    assert.ok(mock.queries.every((query) => query.take === undefined));
  } finally { mock.restore(); }
});

test("control records preserve output termination and step identity for recovery guards", async () => {
  const mock = mockStore({ rows: [{ ...fixture.rows[0], status: "failed", stepIdempotencyKey: "same-step", metadataJson: JSON.stringify({ finishReason: "output_limit", chapterId: "chapter-4" }) }] });
  try {
    const result = await new DirectorUsageTelemetryQueryService().getTaskControlUsage(scope);
    assert.equal(result.records[0].finishReason, "output_limit");
    assert.equal(result.records[0].stepIdempotencyKey, "same-step");
    assert.equal(result.records[0].status, "failed");
  } finally { mock.restore(); }
});
