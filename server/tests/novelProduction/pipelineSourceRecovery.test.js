const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
class ProductionError extends Error { constructor(code, message) { super(message); this.code = code; } }
const { ChapterPipelineRecoveryService } = loadRuntimeSource("../production/recovery/ChapterPipelineRecoveryService.ts", {
  "../reliability": { ChapterProductionError: ProductionError },
});

function fixture(patch = {}) {
  const inspection = { operationId: "pipeline:job:chapter", entry: "pipeline", status: "paused", steps: [],
    leaseActive: false, inputChanged: false, canAcknowledge: false, canResume: false, ...patch.inspection };
  const job = { id: "job", novelId: "novel", status: "running", startOrder: 1, endOrder: 10,
    currentItemKey: "chapter", pendingManualRecovery: true, cancelRequestedAt: null,
    executionOwner: null, executionLeaseExpiresAt: null, payload: "{}", updatedAt: new Date(1000), ...patch.job };
  const calls = [];
  const target = { novelId: "novel", chapterId: "chapter" };
  const service = new ChapterPipelineRecoveryService({ inspect: async () => inspection, findJob: async () => job,
    findChapter: async () => ({ order: patch.order ?? 3 }), now: () => 2000,
    resumeJob: async (...args) => { calls.push(args); },
  });
  return { service, target, inspection, job, calls };
}

test("standalone pipeline projection is read-only and explicit recovery reuses its job snapshot", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.project(f.target, f.inspection), {
    pipelineJobId: "job", pipelineRange: { startOrder: 1, endOrder: 10 }, canResumePipeline: true,
  });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.service.resume({ ...f.target, operationId: f.inspection.operationId }), { jobId: "job" });
  assert.deepEqual(f.calls, [["job", { ...f.target, updatedAt: f.job.updatedAt, payload: "{}" }]]);
});

test("expired local running step is recoverable while external running remains blocked by inspection", async () => {
  const local = fixture({ inspection: { status: "running", steps: [{ key: "save", status: "running" }] } });
  assert.equal((await local.service.project(local.target, local.inspection)).canResumePipeline, true);
  await local.service.resume({ ...local.target, operationId: local.inspection.operationId });
  assert.equal(local.calls.length, 1);
  const external = fixture({ inspection: { status: "running", canAcknowledge: true, steps: [{ key: "review", status: "running" }] } });
  assert.equal((await external.service.project(external.target, external.inspection)).canResumePipeline, false);
  await assert.rejects(external.service.resume({ ...external.target, operationId: external.inspection.operationId }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
});

for (const [reason, patch] of Object.entries({
  directorJournal: { inspection: { workflowTaskId: "director" } },
  directorJob: { job: { payload: JSON.stringify({ workflowTaskId: "director" }) } },
  randomLegacyId: { inspection: { operationId: "random-historical" } },
  wrongChapterIdentity: { inspection: { operationId: "pipeline:job:other" } },
  wrongNovel: { job: { novelId: "other" } },
  outOfRange: { order: 12 },
  inputChanged: { inspection: { inputChanged: true } },
  unknownResult: { inspection: { canAcknowledge: true } },
  unknownStep: { inspection: { steps: [{ key: "review", status: "unknown" }] } },
  activeChapter: { inspection: { leaseActive: true } },
  completedChapter: { inspection: { status: "completed" } },
  failedJob: { job: { status: "failed" } },
  notPaused: { job: { pendingManualRecovery: false } },
  cancelled: { job: { cancelRequestedAt: new Date(1000) } },
  activeParent: { job: { executionOwner: "owner", executionLeaseExpiresAt: new Date(9000) } },
  differentCursor: { job: { currentItemKey: "other" } },
  malformedPayload: { job: { payload: "broken" } },
})) {
  test(`standalone source recovery refuses ${reason} without scheduling`, async () => {
    const f = fixture(patch);
    assert.equal((await f.service.project(f.target, f.inspection)).canResumePipeline, false);
    await assert.rejects(f.service.resume({ ...f.target, operationId: f.inspection.operationId }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
    assert.equal(f.calls.length, 0);
  });
}

test("pipeline recovery route awaits preflight and returns its error instead of an asynchronous success", async () => {
  const routes = []; const calls = []; let reject = false;
  const { registerNovelChapterGenerationRoutes } = loadRuntimeSource("../../../modules/novel/production/http/novelChapterGeneration.ts", {
    zod: require("zod"), "../../../../llm/streaming": { streamToSSE: () => assert.fail("must not stream") },
    "../../../../middleware/validate": { validate: value => value },
    "../../../../services/novel/runtime/chapterRuntimeSchema": { chapterRuntimeRequestSchema: {} },
    "../../../../services/novel/director/workflowStepRuntime/StepModuleRunner": { stepModuleRunner: { runStep: () => assert.fail("must not execute a new chapter") } },
    "../../../../services/novel/director/workflowStepRuntime/directorWorkflowStepIds": { DIRECTOR_EXECUTION_STEP_IDS: {} },
    "../../../../services/novel/production/reliability": {},
    "../../../../services/novel/production/recovery": { createChapterPipelineRecoveryService: () => ({ resume: async input => {
      calls.push(input); if (reject) throw new ProductionError("CHAPTER_PRODUCTION_CONFLICT", "state changed");
      return { jobId: "job" };
    } }) },
  });
  registerNovelChapterGenerationRoutes({ router: { get() {}, post: (...args) => routes.push(args) }, chapterParamsSchema: {}, forwardBusinessError: () => false });
  const route = routes.find(item => item[0].endsWith("/resume-pipeline"));
  assert.throws(() => route[1].body.parse({}));
  let response; let error;
  const req = { params: { id: "novel", chapterId: "chapter" }, body: { operationId: "pipeline:job:chapter" } };
  await route.at(-1)(req, { json: value => { response = value; } }, value => { error = value; });
  assert.deepEqual(response.data, { jobId: "job" }); assert.equal(error, undefined);
  assert.deepEqual(calls[0], { novelId: "novel", chapterId: "chapter", operationId: "pipeline:job:chapter" });
  reject = true; response = undefined;
  await route.at(-1)(req, { json: value => { response = value; } }, value => { error = value; });
  assert.equal(response, undefined); assert.equal(error.code, "CHAPTER_PRODUCTION_CONFLICT");
});

for (const cancelledDuringPreflight of [false, true]) {
  test(`original resume service guards its snapshot with CAS (cancellation race=${cancelledDuringPreflight})`, async () => {
    const job = { id: "job", novelId: "novel", status: "running", startOrder: 1, endOrder: 10, payload: "{}", maxRetries: 1 };
    const writes = []; const schedules = [];
    const { NovelCorePipelineService } = loadRuntimeSource("../novelCorePipelineService.ts", {
      "node:crypto": require("node:crypto"), "@ai-novel/shared/types/directorIssue": {},
      "../../db/prisma": { prisma: { generationJob: { findUnique: async () => job,
        updateMany: async input => { writes.push(input); return { count: cancelledDuringPreflight ? 0 : 1 }; } } } },
      "./novelCoreShared": {}, "./novelCoreSupport": {},
      "./runtime/ChapterRuntimeCoordinator": { ChapterRuntimeCoordinator: class {} },
      "./runtime/artifactSync": {}, "./pipelineJobDedup": {}, "./pipelineJobState": {},
      "./production/NovelPipelineExecutor": { NovelPipelineExecutor: class {} },
      "./production/completion": {}, "./production/reliability": { ChapterProductionError: ProductionError },
      "./production/executionLease": { PipelineExecutionLeaseService: class {} }, "./director/issues": {},
    });
    const service = new NovelCorePipelineService();
    service.parsePipelinePayload = () => ({ provider: "offline", model: "never-called" });
    service.schedulePipelineExecution = (...args) => schedules.push(args);
    const expected = { novelId: "novel", chapterId: "chapter", updatedAt: new Date(1000), payload: "{}" };
    if (cancelledDuringPreflight) await assert.rejects(service.resumePipelineJob("job", expected), { code: "CHAPTER_PRODUCTION_CONFLICT" });
    else await service.resumePipelineJob("job", expected);
    assert.equal(schedules.length, cancelledDuringPreflight ? 0 : 1);
    assert.equal(writes[0].where.cancelRequestedAt, null); assert.equal(writes[0].where.pendingManualRecovery, true);
    assert.equal(writes[0].where.updatedAt, expected.updatedAt); assert.equal(writes[0].where.payload, "{}");
    assert.equal(writes[0].where.currentItemKey, "chapter"); assert.equal(writes[0].where.OR.length, 3);
    assert.equal(writes[0].data.cancelRequestedAt, undefined, "never erase a concurrent cancellation");
    assert.equal(writes[0].data.retryCount, undefined, "never reset the existing job budget");
  });
}
