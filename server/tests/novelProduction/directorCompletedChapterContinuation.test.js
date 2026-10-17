const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

class ProductionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const { ChapterPipelineRecoveryService } = loadRuntimeSource("../production/recovery/ChapterPipelineRecoveryService.ts", {
  "../reliability": { ChapterProductionError: ProductionError },
});

function fixture({ job: patch = {}, inspection: inspectionPatch = {}, missing = false } = {}) {
  const job = {
    id: "chapter-5-job", novelId: "novel", status: "succeeded", startOrder: 5, endOrder: 5,
    currentItemKey: null, pendingManualRecovery: false, cancelRequestedAt: null,
    executionOwner: null, executionLeaseExpiresAt: null,
    payload: JSON.stringify({ workflowTaskId: "director-4-10", startOrder: 5, endOrder: 5 }),
    updatedAt: new Date(1000), ...patch,
  };
  const inspection = {
    entry: "pipeline", workflowTaskId: "director-4-10", operationId: "pipeline:chapter-5-job:chapter-5",
    status: "paused", leaseActive: false, inputChanged: false, canAcknowledge: false,
    steps: [], ...inspectionPatch,
  };
  const calls = [];
  const service = new ChapterPipelineRecoveryService({
    findJob: async (id) => { calls.push(["job", id]); return missing ? null : job; },
    inspect: async (target) => { calls.push(["journal", target]); return inspection; },
    findChapter: async (target) => { calls.push(["chapter", target]); return { order: 5 }; },
    resumeJob: async () => assert.fail("read-only continuation preflight cannot schedule or mutate the job"),
    now: () => 2000,
  });
  return { service, job, calls,
    prepare: (request = { novelId: "novel", directorTaskId: "director-4-10" }) => service.prepareDirectorContinuation("chapter-5-job", request),
  };
}

test("completed fifth chapter allows original 4-10 director continuation without chapter journal recovery", async () => {
  const f = fixture();
  const before = structuredClone(f.job);
  const result = await f.prepare();
  assert.deepEqual(result, {
    kind: "completed", novelId: "novel", chapterId: null,
    updatedAt: f.job.updatedAt, payload: f.job.payload,
  });
  assert.deepEqual(f.calls, [["job", "chapter-5-job"]]);
  assert.deepEqual(f.job, before, "preflight cannot clear state or change the saved parent workflow");
});

for (const [reason, options] of Object.entries({
  missing: { missing: true },
  wrongJobIdentity: { job: { id: "other-job" } },
  anotherNovel: { job: { novelId: "another-novel" } },
  anotherDirector: { job: { payload: JSON.stringify({ workflowTaskId: "another-director" }) } },
  missingDirector: { job: { payload: "{}" } },
  invalidPayload: { job: { payload: "broken" } },
  nullPayload: { job: { payload: null } },
  arrayPayload: { job: { payload: "[]" } },
  cancelled: { job: { cancelRequestedAt: new Date(1500) } },
  activeLease: { job: { executionOwner: "worker", executionLeaseExpiresAt: new Date(3000) } },
  indeterminateLease: { job: { executionOwner: "worker", executionLeaseExpiresAt: null } },
  invalidLeaseDate: { job: { executionOwner: "worker", executionLeaseExpiresAt: new Date("invalid") } },
  unexpectedCurrentChapter: { job: { currentItemKey: "chapter-5" } },
  emptyCurrentChapter: { job: { currentItemKey: "" } },
  pendingManualRecovery: { job: { pendingManualRecovery: true } },
  cancelledStatus: { job: { status: "cancelled" } },
})) {
  test(`completed continuation rejects ${reason} without invoking a chapter journal or resuming`, async () => {
    const f = fixture(options);
    await assert.rejects(f.prepare(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
    assert.equal(f.calls.some(([name]) => name === "journal" || name === "chapter"), false);
  });
}

test("completed continuation rejects blank request identity but accepts a verifiably expired lease", async () => {
  const f = fixture();
  await assert.rejects(f.prepare({ novelId: "novel", directorTaskId: " " }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await assert.rejects(f.prepare({ novelId: "", directorTaskId: "director-4-10" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  const expired = fixture({ job: { executionOwner: "old-worker", executionLeaseExpiresAt: new Date(1999) } });
  assert.equal((await expired.prepare()).kind, "completed");
});

test("paused continuation delegates to the strict saved chapter preflight and retains the original snapshot", async () => {
  const f = fixture({ job: { status: "failed", currentItemKey: "chapter-5", pendingManualRecovery: true } });
  const before = structuredClone(f.job);
  assert.deepEqual(await f.prepare(), {
    kind: "paused", novelId: "novel", chapterId: "chapter-5", updatedAt: f.job.updatedAt, payload: f.job.payload,
  });
  assert.equal(f.calls.filter(([name]) => name === "journal").length, 1);
  assert.deepEqual(f.job, before);
});

for (const [reason, options] of Object.entries({
  unknownCall: { inspection: { steps: [{ key: "review", status: "unknown" }] } },
  changedDraft: { inspection: { inputChanged: true } },
  chapterLease: { inspection: { leaseActive: true } },
  unacknowledgedOutcome: { inspection: { canAcknowledge: true } },
  anotherDirector: { inspection: { workflowTaskId: "other" } },
  wrongOperation: { inspection: { operationId: "pipeline:other-job:chapter-5" } },
  cancelled: { job: { cancelRequestedAt: new Date(1500) } },
  jobLease: { job: { executionOwner: "worker", executionLeaseExpiresAt: new Date(3000) } },
  notPaused: { job: { pendingManualRecovery: false } },
})) {
  test(`paused continuation cannot bypass ${reason} through the completed branch`, async () => {
    const f = fixture({ ...options, job: { status: "failed", currentItemKey: "chapter-5", pendingManualRecovery: true, ...options.job } });
    await assert.rejects(f.prepare(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  });
}
