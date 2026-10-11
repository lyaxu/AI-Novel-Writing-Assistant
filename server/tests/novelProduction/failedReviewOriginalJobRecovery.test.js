const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const saved = require("./fixtures/firstChapterPausedExecution.json");
const contracts = loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": crypto });
const { createChapterProductionJournal } = loadRuntimeSource("../production/reliability/session.ts", {
  "node:crypto": crypto, "./types": contracts,
});
const { ChapterPipelineRecoveryService } = loadRuntimeSource("../production/recovery/ChapterPipelineRecoveryService.ts", { "../reliability": contracts });

function fixture({ cancelledDuringCas = false, editAfterPreflight = false } = {}) {
  let row = { metadataJson: JSON.stringify(saved.journal), status: saved.journal.status };
  const chapter = structuredClone(saved.journal.expectedChapter);
  const job = { ...saved.job, pendingManualRecovery: Boolean(saved.job.pendingManualRecovery), updatedAt: new Date(saved.job.updatedAt) };
  const calls = { review: 0, schedule: [], updates: [] };
  const journal = createChapterProductionJournal({ repository: { transaction: async fn => fn({
    readChapter: async () => structuredClone(chapter), readJournal: async () => row,
    archiveJournal: async () => assert.fail("original operation must not be replaced"),
    writeContent: async () => assert.fail("saved manuscript must not be written again"),
    writeJournal: async (_n, _c, expected, next) => { assert.equal(row.metadataJson, expected); row = { metadataJson: next, status: JSON.parse(next).status }; },
  }) } });
  const recovery = new ChapterPipelineRecoveryService({ inspect: target => journal.inspect(target),
    findJob: async () => job, findChapter: async () => ({ order: 1 }), resumeJob: async () => assert.fail("preflight only") });
  const { NovelCorePipelineService } = loadRuntimeSource("../novelCorePipelineService.ts", {
    "node:crypto": crypto, "@ai-novel/shared/types/directorIssue": {},
    "../../db/prisma": { prisma: { generationJob: { findUnique: async () => job,
      updateMany: async input => {
        calls.updates.push(input);
        if (cancelledDuringCas) return { count: 0 };
        Object.assign(job, input.data);
        if (editAfterPreflight) chapter.content += "人工编辑";
        return { count: 1 };
      } } } },
    "./novelCoreShared": {}, "./novelCoreSupport": {},
    "./runtime/ChapterRuntimeCoordinator": { ChapterRuntimeCoordinator: class {} },
    "./runtime/artifactSync": {}, "./pipelineJobDedup": {}, "./pipelineJobState": {},
    "./production/NovelPipelineExecutor": { NovelPipelineExecutor: class {} },
    "./production/completion": {}, "./production/reliability": contracts,
    "./production/recovery": { createChapterPipelineRecoveryService: () => recovery },
    "./production/executionLease": { PipelineExecutionLeaseService: class {} }, "./director/issues": {},
  });
  const service = new NovelCorePipelineService();
  service.parsePipelinePayload = value => JSON.parse(value);
  service.schedulePipelineExecution = (...args) => calls.schedule.push(args);
  return { journal, job, chapter, service, calls, record: () => JSON.parse(row.metadataJson),
    resume: () => service.resumePipelineJob(job.id, { novelId: job.novelId, directorTaskId: saved.journal.request.workflowTaskId }) };
}

test("recorded failed first-chapter review resumes original job and operation, with no writer/save repeat", async () => {
  const f = fixture();
  await f.service.resumePipelineJob(f.job.id); // A background restart is not user authorization.
  assert.equal(f.calls.schedule.length, 0);
  await f.resume();
  assert.equal(f.calls.schedule.length, 1);
  const [jobId, novelId, options] = f.calls.schedule[0];
  assert.equal(jobId, saved.job.id); assert.equal(novelId, saved.job.novelId);
  assert.equal(options.startOrder, 1); assert.equal(options.endOrder, 1);
  assert.equal(f.job.retryCount, saved.job.retryCount);
  assert.deepEqual(options.controlPolicy, JSON.parse(saved.job.payload).controlPolicy);
  assert.equal(f.calls.updates[0].where.status, "failed");
  assert.equal(f.calls.updates[0].data.cancelRequestedAt, undefined);
  assert.equal(f.job.finishedAt, null);
  const session = await f.journal.open({ novelId, chapterId: f.chapter.id,
    request: saved.journal.request, operationId: saved.journal.operationId, replaceCompletedOnly: true });
  for (const step of ["prepare", "pipeline.draft", "pipeline.save_draft"]) {
    await session.runStep(step, async () => assert.fail(`must not repeat ${step}`));
  }
  await session.runStep("pipeline.review:0", async () => {
    f.calls.review++;
    return session.runStep(`evaluation:${crypto.createHash("sha256").update(f.chapter.content).digest("hex")}`,
      async () => ({ accepted: true, source: "offline reviewer double" }), { external: true });
  }, { external: true });
  await session.close();
  assert.equal(f.calls.review, 1);
  assert.equal(f.record().operationId, saved.journal.operationId);
  assert.equal(f.record().steps["pipeline.review:0"].status, "done");
  assert.equal(crypto.createHash("sha256").update(f.chapter.content).digest("hex"), "d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6");
});

test("recorded paused job CAS loses to cancellation without scheduling", async () => {
  const f = fixture({ cancelledDuringCas: true });
  await assert.rejects(f.resume(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.schedule.length, 0);
  assert.equal(f.job.pendingManualRecovery, true);
});

test("manuscript edited after parent preflight still fails journal CAS before review", async () => {
  const f = fixture({ editAfterPreflight: true });
  await f.resume();
  await assert.rejects(f.journal.open({ novelId: f.job.novelId, chapterId: f.chapter.id,
    request: saved.journal.request, operationId: saved.journal.operationId }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.review, 0);
});

test("real coordinator accepts recorded request identity with exhausted remaining budget and replays frozen options", async () => {
  const f = fixture();
  const context = loadRuntimeSource("../production/reliability/executionContext.ts", {
    "../../../../llm/invocation/executionPolicy": { withUnknownOutcomeProtection: fn => fn() }, "node:async_hooks": require("node:async_hooks"),
  });
  const execution = loadRuntimeSource("../production/reliability/ChapterProductionExecution.ts", { "./executionContext": context });
  const emptyImports = ["../../../db/prisma", "../../audit/AuditService", "../../planner/PlannerService", "../chapterWritingGraph",
    "./ChapterArtifactSyncService", "./GenerationContextAssembler", "./ChapterAcceptanceAssessmentService", "./ChapterRuntimeReadinessService",
    "./chapterRuntimeSchema", "./repair/ChapterRepairStreamRuntime", "./ChapterQualityGateService", "./ChapterContentFinalizationService",
    "./ChapterStreamGenerationOrchestrator", "./ChapterPipelineRuntimeAdapter", "./ChapterTimelineFinalizationService", "./lifecycle",
    "./ChapterRuntimeDefaultDeps", "../production/preparation"];
  const { ChapterRuntimeCoordinator } = loadRuntimeSource("ChapterRuntimeCoordinator.ts", {
    ...Object.fromEntries(emptyImports.map(key => [key, {}])), "../production/reliability": execution,
  });
  const coordinator = Object.create(ChapterRuntimeCoordinator.prototype);
  coordinator.productionJournal = f.journal;
  coordinator.pipelineAdapter = { runPipelineChapter: async (_novel, _chapter, input, hooks) => {
    await hooks.onCheckCancelled();
    assert.equal(input.maxRetries, 0);
    const frozen = await context.productionStep("pipeline.options", async () => assert.fail("options must be retained"));
    assert.deepEqual(frozen, saved.journal.steps["pipeline.options"].output);
    assert.equal(frozen.maxRetries, 1);
    const session = context.currentProductionSession();
    assert.equal(session.operationId, saved.journal.operationId);
    return { pass: true };
  } };
  const { entry, ...options } = saved.journal.request;
  await coordinator.runPipelineChapter(f.job.novelId, f.chapter.id, {
    ...options, maxRetries: 0, productionOperationId: saved.journal.operationId,
  });
  assert.equal(f.record().status, "completed");
  assert.equal(f.chapter.content, saved.journal.expectedChapter.content);
});
