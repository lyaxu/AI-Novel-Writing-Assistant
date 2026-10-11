const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

function fixture(entry = "pipeline") {
  const types = loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": require("node:crypto") });
  const { createChapterProductionJournal } = loadRuntimeSource("../production/reliability/session.ts", { "node:crypto": require("node:crypto"), "./types": types });
  let now = 1000; let row = null;
  let chapter = { id: "c", novelId: "n", title: "chapter", content: "retained draft", taskSheet: "contract", sceneCards: null, expectation: null, targetWordCount: 2800 };
  const archives = []; let serial = Promise.resolve();
  const journal = createChapterProductionJournal({ now: () => now, leaseMs: 1000, repository: { transaction(work) {
    const pending = serial.then(async () => {
      const before = structuredClone({ row, chapter, archives });
      try { return await work({
        readChapter: async () => structuredClone(chapter), readJournal: async () => row && { ...row },
        writeJournal: async (_n, _c, expected, next) => { assert.equal(row?.metadataJson ?? null, expected); row = { metadataJson: next, status: JSON.parse(next).status }; },
        archiveJournal: async (_n, _c, record) => archives.push(structuredClone(record)),
        writeContent: async (_n, _c, _prior, data) => { chapter = { ...chapter, ...data }; },
      }); } catch (error) { row = before.row; chapter = before.chapter; archives.splice(0, archives.length, ...before.archives); throw error; }
    }); serial = pending.catch(() => {}); return pending;
  } } });
  const request = { entry, model: "offline", ...(entry === "pipeline" ? { workflowTaskId: "task" } : {}) };
  return { journal, request, archives, open: (extra = {}) => journal.open({ novelId: "n", chapterId: "c", operationId: "op", request, ...extra }),
    ack: () => journal.acknowledgeUnknown({ novelId: "n", chapterId: "c", operationId: "op" }),
    record: () => JSON.parse(row.metadataJson), expire: () => { now += 1001; }, edit: () => { chapter.content = "human edit"; },
  };
}

test("explicit unknown acknowledgement retains completed outputs and resumes only the unresolved step", async () => {
  const f = fixture(); let writerCalls = 0; let reviewCalls = 0;
  let s = await f.open(); await s.runStep("pipeline.draft", async () => { writerCalls++; return "retained draft"; });
  await s.checkpoint("partial evidence");
  await assert.rejects(s.runStep("pipeline.review:0", async () => { reviewCalls++; throw new Error("lost response"); }, { external: true }));
  await s.close();
  await f.ack();
  assert.equal(f.record().operationId, "op"); assert.equal(f.record().status, "paused");
  assert.equal(f.record().steps["pipeline.draft"].status, "done"); assert.equal(f.record().partialText, "partial evidence");
  assert.equal(f.archives.length, 1); assert.equal(f.archives[0].steps["pipeline.review:0"].status, "unknown");
  assert.equal(f.archives[0].recoveryDecision.originalOperationId, "op");
  assert.notEqual(f.archives[0].operationId, "op");
  s = await f.open();
  await s.runStep("pipeline.draft", async () => { writerCalls++; });
  await s.runStep("pipeline.review:0", async () => { reviewCalls++; return "verified"; }, { external: true });
  assert.equal(writerCalls, 1); assert.equal(reviewCalls, 2);
});

test("manual heavy repair acknowledges its unfinished stream without discarding completed preparation", async () => {
  const f = fixture("repair"); const s = await f.open();
  await s.runStep("manual_repair.prepare", async () => ({ original: "retained draft" }));
  await s.put("manual_repair.started", true); await s.checkpoint("partial repair"); await s.close();
  assert.equal((await f.journal.inspect({ novelId: "n", chapterId: "c" })).canAcknowledge, true);
  await f.ack();
  assert.equal(f.record().values["manual_repair.started"], undefined);
  assert.equal(f.record().steps["manual_repair.prepare"].status, "done");
  assert.equal(f.record().partialText, "partial repair");
  await f.ack(); assert.equal(f.archives.length, 1, "repeating the same decision is idempotent");
});

test("acknowledgement refuses active ownership and human-edited input", async () => {
  const f = fixture(); const s = await f.open();
  await assert.rejects(f.ack(), { code: "CHAPTER_PRODUCTION_BUSY" });
  await s.close(); f.edit();
  await assert.rejects(f.ack(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.archives.length, 0);
});

test("expired external call and stream marker require explicit acknowledgement before retry", async () => {
  const f = fixture("stream"); const s = await f.open();
  await s.put("stream.started", true); await s.checkpoint("half chapter"); f.expire();
  await f.ack();
  assert.equal(f.record().values["stream.started"], undefined);
  assert.equal(f.record().partialText, "half chapter");
  assert.equal((await f.journal.inspect({ novelId: "n", chapterId: "c" })).canResume, true);
});

test("a new pipeline identity cannot replace a paused operation but may archive completed work", async () => {
  const f = fixture(); let s = await f.open(); await s.close();
  await assert.rejects(f.open({ operationId: "pipeline:new:c", replaceCompletedOnly: true }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  s = await f.open(); await s.close({ completed: true });
  const next = await f.open({ operationId: "pipeline:new:c", replaceCompletedOnly: true });
  assert.equal(next.operationId, "pipeline:new:c"); assert.equal(f.archives.length, 1);
});

test("incomplete review is a definite failed step that explicit recovery can rerun without rewriting", async () => {
  const f = fixture(); let draftCalls = 0; let reviewCalls = 0;
  let s = await f.open();
  await s.runStep("pipeline.draft", async () => { draftCalls++; return "retained draft"; });
  await assert.rejects(s.runStep("pipeline.review:0", async () => {
    reviewCalls++; throw Object.assign(new Error("review evidence incomplete"), { code: "CHAPTER_REVIEW_INCOMPLETE" });
  }, { external: true }), { code: "CHAPTER_REVIEW_INCOMPLETE" });
  await s.close();
  assert.equal(f.record().steps["pipeline.review:0"].status, "failed");
  assert.equal((await f.journal.inspect({ novelId: "n", chapterId: "c" })).canAcknowledge, false);
  s = await f.open();
  await s.runStep("pipeline.draft", async () => { draftCalls++; });
  await s.runStep("pipeline.review:0", async () => { reviewCalls++; return "verified"; }, { external: true });
  assert.equal(draftCalls, 1); assert.equal(reviewCalls, 2);
});
