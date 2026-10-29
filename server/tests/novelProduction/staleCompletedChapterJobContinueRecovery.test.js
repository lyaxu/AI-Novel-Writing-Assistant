const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

class ProductionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const { ChapterPipelineRecoveryService } = loadRuntimeSource("../production/recovery/ChapterPipelineRecoveryService.ts", {
  "../reliability": { ChapterProductionError: ProductionError },
});

function fixture({
  job: jobPatch = {},
  chapter: chapterPatch = { ...{} },
  inspection: inspectionPatch = {},
  withoutWriter = false,
  completeFails = false,
  missing = false,
} = {}) {
  const job = {
    id: "chapter-4-job", novelId: "novel", status: "failed", startOrder: 4, endOrder: 4,
    currentItemKey: "chapter-4", pendingManualRecovery: true, cancelRequestedAt: null,
    executionOwner: null, executionLeaseExpiresAt: null,
    payload: JSON.stringify({ workflowTaskId: "director", startOrder: 4, endOrder: 4 }),
    updatedAt: new Date(1000), ...jobPatch,
  };
  const chapter = { order: 4, content: "preserved chapter four prose", generationState: "approved", chapterStatus: "completed", ...chapterPatch };
  const chapterBefore = structuredClone(chapter);
  const inspection = {
    entry: "pipeline", workflowTaskId: "director", operationId: "pipeline:chapter-4-job:chapter-4",
    status: "completed", leaseActive: false, inputChanged: false, canAcknowledge: false,
    steps: [{ key: "pipeline.draft", status: "done" }, { key: "pipeline.review:0", status: "done" }],
    ...inspectionPatch,
  };
  const calls = [];
  const deps = {
    findJob: async (id) => { calls.push(["job", id]); return missing ? null : job; },
    inspect: async (target) => { calls.push(["journal", target]); return inspection; },
    findChapter: async (target) => { calls.push(["chapter", target]); return chapter; },
    resumeJob: async () => assert.fail("a completed chapter must not be resumed through the chapter journal"),
    now: () => 5000,
  };
  if (!withoutWriter) {
    deps.completeJob = async (id, expected) => {
      calls.push(["complete", id, expected]);
      if (completeFails) throw new ProductionError("CHAPTER_PRODUCTION_CONFLICT", "原章节任务状态已变化，请刷新本书工作区后核对。");
    };
  }
  const service = new ChapterPipelineRecoveryService(deps);
  return {
    service, job, chapter, chapterBefore, calls,
    run: (request = { novelId: "novel", directorTaskId: "director" }) =>
      service.reconcileStaleCompletedChapterJob("chapter-4-job", request),
  };
}

test("a completed chapter with a stale failed+pending job converges to a completed continuation", async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, {
    kind: "completed", novelId: "novel", chapterId: null,
    updatedAt: new Date(5000), payload: f.job.payload,
  });
  const complete = f.calls.find(([name]) => name === "complete");
  assert.ok(complete, "the stale job row is completed after the evidence proves the chapter is done");
  assert.equal(complete[1], "chapter-4-job");
  assert.deepEqual(complete[2], {
    novelId: "novel", chapterId: "chapter-4", jobStatus: "failed",
    updatedAt: f.job.updatedAt, payload: f.job.payload, completedAt: new Date(5000),
  });
  // Only derived job bookkeeping converges: the chapter row and its prose are never written.
  assert.deepEqual(f.chapter, f.chapterBefore);
  assert.equal(f.calls.some(([name]) => name === "resumeJob"), false);
});

test("the old failed+pending projection still blocks when no completion writer is wired", async () => {
  const f = fixture({ withoutWriter: true });
  assert.equal(await f.run(), null);
});

for (const [reason, options] of Object.entries({
  missingJob: { missing: true },
  wrongNovel: { job: { novelId: "another-novel" } },
  anotherDirector: { job: { payload: JSON.stringify({ workflowTaskId: "another-director" }) } },
  missingDirector: { job: { payload: "{}" } },
  invalidPayload: { job: { payload: "broken" } },
  noTargetChapter: { job: { currentItemKey: null } },
  cancelledJob: { job: { cancelRequestedAt: new Date(2000) } },
  activeParentLease: { job: { executionOwner: "worker", executionLeaseExpiresAt: new Date(9000) } },
  indeterminateParentLease: { job: { executionOwner: "worker", executionLeaseExpiresAt: null } },
  notPending: { job: { pendingManualRecovery: false } },
  alreadySucceeded: { job: { status: "succeeded", currentItemKey: null } },
  cancelledStatus: { job: { status: "cancelled" } },
  unplannedChapter: { chapter: { chapterStatus: "unplanned" } },
  emptyProse: { chapter: { content: "   " } },
  nullProse: { chapter: { content: null } },
  journalUnknownCall: { inspection: { steps: [{ key: "pipeline.review:1", status: "unknown" }] } },
  journalRunningStep: { inspection: { steps: [{ key: "pipeline.draft", status: "running" }] } },
  journalLeaseActive: { inspection: { leaseActive: true } },
  journalInputChanged: { inspection: { inputChanged: true } },
  journalCanAcknowledge: { inspection: { canAcknowledge: true } },
  journalNotCompleted: { inspection: { status: "paused" } },
  journalOtherDirector: { inspection: { workflowTaskId: "another-director" } },
  journalOtherOperation: { inspection: { operationId: "pipeline:another-job:chapter-4" } },
  journalNotPipeline: { inspection: { entry: "stream" } },
})) {
  test(`stale completed chapter convergence does not fire for ${reason}`, async () => {
    const f = fixture(options);
    assert.equal(await f.run(), null);
    assert.equal(f.calls.some(([name]) => name === "complete"), false, "no job write without proof");
    assert.deepEqual(f.chapter, f.chapterBefore);
  });
}

test("chapter completion is proven by the model-facing journal, not by a succeeded job status", async () => {
  // A job that is already terminal is left to the normal continuation branch; only a stale
  // paused/failed row is converged here.
  const f = fixture({ job: { status: "succeeded", currentItemKey: null, pendingManualRecovery: false } });
  assert.equal(await f.run(), null);
  assert.equal(f.calls.some(([name]) => name === "complete"), false);
});

test("a concurrent job change rejects the convergence instead of clearing another pause", async () => {
  const f = fixture({ completeFails: true });
  await assert.rejects(f.run(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.deepEqual(f.chapter, f.chapterBefore);
});

test("blank request identity cannot authorize convergence", async () => {
  const f = fixture();
  assert.equal(await f.run({ novelId: "novel", directorTaskId: " " }), null);
  assert.equal(await f.run({ novelId: "", directorTaskId: "director" }), null);
  assert.equal(f.calls.some(([name]) => name === "complete"), false);
});
