const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("./offlineBootstrap.cjs");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const saved = require("./fixtures/firstChapterPausedExecution.json");
const scene = require("./fixtures/firstChapterContinueWorkspace.json");
const { prisma } = require("../../dist/db/prisma");
const { DirectorCommandService } = require("../../dist/services/novel/director/commands/DirectorCommandService");
const reliability = require("../../dist/services/novel/production/reliability");
const { NovelCorePipelineService } = require("../../dist/services/novel/novelCorePipelineService");
const { NovelDirectorContinueRuntime } = require("../../dist/services/novel/director/runtime/novelDirectorContinueRuntime");
const { resolveStructuredOutlineRecoveryCursor } = require("../../dist/services/novel/director/recovery/novelDirectorStructuredOutlineRecovery");
const autoBase = "../../dist/services/novel/director/automation/";
const { NovelDirectorAutoExecutionRuntime } = loadRuntimeSource("../director/automation/novelDirectorAutoExecutionRuntime.ts", {
  "@ai-novel/shared/types/novelDirector": require("@ai-novel/shared/types/novelDirector"),
  "./novelDirectorAutoExecution": require(autoBase + "novelDirectorAutoExecution"),
  "./novelDirectorAutoExecutionCheckpointRuntime": require(autoBase + "novelDirectorAutoExecutionCheckpointRuntime"),
  "./novelDirectorAutoExecutionFailure": require(autoBase + "novelDirectorAutoExecutionFailure"),
  "./novelDirectorAutoExecutionCircuitBreakerRuntime": { ...require(autoBase + "novelDirectorAutoExecutionCircuitBreakerRuntime"), resolveUsageCircuitBreaker: async () => null },
  "./novelDirectorAutoExecutionRuntimeUtils": require(autoBase + "novelDirectorAutoExecutionRuntimeUtils"),
  "./novelDirectorAutoExecutionRuntimePreparation": require(autoBase + "novelDirectorAutoExecutionRuntimePreparation"),
  "../../../../db/prisma": { prisma }, "../../production/reliability": reliability,
});

function fixture({ wrongBinding = false, editDraft = false, cancelled = false, continueRange = false, reviewFailures = 0, nonmanualFailed = false } = {}) {
  const row = structuredClone(scene.row);
  row.startedAt = new Date(row.startedAt); row.updatedAt = new Date(row.updatedAt);
  // Actual command acceptance clears task pause before continueTask; the job pause remains authoritative.
  row.pendingManualRecovery = false; row.status = "queued";
  const seed = JSON.parse(row.seedPayloadJson);
  if (!wrongBinding) seed.autoExecution.pipelineJobId = saved.job.id;
  row.seedPayloadJson = JSON.stringify(seed);
  const job = { ...saved.job, pendingManualRecovery: true, updatedAt: new Date(saved.job.updatedAt) };
  if (cancelled) job.cancelRequestedAt = new Date();
  if (nonmanualFailed) job.pendingManualRecovery = false;
  const chapters = structuredClone(scene.chapters);
  if (continueRange) chapters.push({ ...structuredClone(chapters[1]), id: "offline-chapter-3", order: 3, content: "" });
  const futureJobs = new Map();
  if (editDraft) chapters[0].content += "人工编辑";
  let journalRow = { status: saved.journal.status, metadataJson: JSON.stringify(saved.journal) };
  const calls = { scheduled: [], review: 0, writer: 0, save: 0, newJobs: [], checkpoints: [], phase: [] };
  const background = [];
  prisma.$transaction = async fn => fn(prisma);
  prisma.chapter.findFirst = async ({where}) => chapters.find(c => c.id === where.id && c.novelId === where.novelId) ?? null;
  prisma.chapter.findMany = async () => chapters;
  prisma.chapter.updateMany = async () => { calls.save++; assert.fail("first chapter must not be rewritten"); };
  prisma.chapterArtifactSyncCheckpoint.findUnique = async () => journalRow;
  prisma.chapterArtifactSyncCheckpoint.updateMany = async ({where,data}) => {
    assert.equal(where.metadataJson, journalRow.metadataJson); journalRow = { ...journalRow, ...data }; return { count: 1 };
  };
  prisma.generationJob.findUnique = async ({where}) => where.id === job.id ? job : null;
  prisma.generationJob.findFirst = async ({where} = {}) => where?.id === job.id ? job : null;
  prisma.generationJob.updateMany = async ({where,data}) => {
    assert.equal(where.id, job.id); assert.equal(where.updatedAt, job.updatedAt);
    Object.assign(job, data); return { count: 1 };
  };
  prisma.novelWorkflowTask.findUnique = async () => row;
  prisma.novel.findUnique = async () => ({ id: row.novelId, title: "离线验收", bookContract: { createdAt: new Date(), updatedAt: new Date() }, worldId: "world" });
  const mergeSeed = extra => { row.seedPayloadJson = JSON.stringify({ ...JSON.parse(row.seedPayloadJson), ...extra }); };
  const workflowService = {
    getTaskById: async () => row, getTaskByIdWithoutHealing: async () => row,
    findActiveTaskByNovelAndLane: async () => null, findLatestVisibleTaskByNovelId: async () => row,
    markTaskRunning: async (_id, patch) => { row.status = "running"; if (patch.seedPayload) mergeSeed(patch.seedPayload); },
    bootstrapTask: async input => { mergeSeed(input.seedPayload); },
    recordCheckpoint: async (_id, input) => { calls.checkpoints.push(input); if (input.seedPayload) mergeSeed(input.seedPayload); },
    requeueTaskForRecovery: async () => assert.fail("unexpected recovery pause"),
  };
  const commands = [];
  prisma.directorRunCommand.findFirst = async () => null;
  prisma.directorRunCommand.create = async ({data}) => { const command = { id: "offline-command", ...data }; commands.push(command); return command; };
  prisma.novelWorkflowTask.updateMany = async ({where,data}) => {
    assert.equal(where.seedPayloadJson, row.seedPayloadJson); assert.equal(where.pendingManualRecovery, true);
    Object.assign(row,data); return { count: 1 };
  };
  const commandService = new DirectorCommandService(workflowService);
  commandService.recoverStaleLeases = async () => 0;
  const journal = reliability.createDefaultChapterProductionJournal();
  const core = Object.create(NovelCorePipelineService.prototype);
  core.parsePipelinePayload = JSON.parse;
  core.schedulePipelineExecution = (...args) => { calls.scheduled.push(args); };
  let drained = false;
  const novelService = {
    getPipelineJobById: async id => {
      if (futureJobs.has(id)) return futureJobs.get(id);
      assert.equal(id, job.id);
      if (calls.scheduled.length && !drained) {
        drained = true;
        const [jobId, novelId, options] = calls.scheduled[0];
        assert.equal(jobId, saved.job.id); assert.equal(options.startOrder, 1); assert.equal(options.endOrder, 1);
        const { ChapterRuntimeCoordinator } = require("../../dist/services/novel/runtime/ChapterRuntimeCoordinator");
        const { ChapterPipelineRuntimeAdapter } = require("../../dist/services/novel/runtime/ChapterPipelineRuntimeAdapter");
        const coordinator = Object.create(ChapterRuntimeCoordinator.prototype);
        coordinator.productionJournal = journal;
        coordinator.pipelineAdapter = new ChapterPipelineRuntimeAdapter({
          ensureNovelCharacters: async () => {},
          streamOrchestrator: {
            prepareRuntimeChapter: async () => ({ request: saved.journal.request,
              assembled: { novel: { title: "offline" }, chapter: chapters[0], contextPackage: {} } }),
            generateDraftFromWriter: async () => { calls.writer++; assert.fail("must not invoke writer for saved chapter"); },
            markChapterStatus: async () => assert.fail("saved pipeline.start must replay"),
          },
          artifactSyncService: {
            saveDraftAndArtifacts: async () => { calls.save++; assert.fail("saved manuscript must not be saved again"); },
            syncChapterArtifacts: async () => ({ status: "completed", completedArtifacts: ["artifact_delta"] }),
          },
          contentFinalizationService: {
            finalizeChapterContent: async ({content}) => {
              calls.review++;
              if (calls.review <= reviewFailures) throw Object.assign(new Error("offline repeated review failure"), { code: "CHAPTER_REVIEW_INCOMPLETE" });
              return reliability.productionStep("evaluation:" + crypto.createHash("sha256").update(content).digest("hex"), async () => ({
                finalContent: content, needsRepair: false, runtimePackage: { novelId, chapterId: chapters[0].id,
                  audit: { score: { coherence: 90, pacing: 90, repetition: 90, engagement: 90, voice: 90, overall: 90 }, openIssues: [], reports: [] },
                  context: {}, meta: { acceptanceStatus: "accepted" } },
              }), true);
            },
            commitFinalizedChapterContent: async ({evaluation}) => assert.equal(evaluation.finalContent, chapters[0].content),
          },
          timelineFinalizer: { finalizeCurrentContent: async () => ({ checkpointWritten: true }) },
          lifecycleService: { markGenerationState: async (_id, state) => { chapters[0].generationState = state; } },
        });
        const { entry, ...originalOptions } = saved.journal.request;
        let result;
        try { result = await coordinator.runPipelineChapter(novelId, chapters[0].id, {
          ...originalOptions, productionOperationId: saved.journal.operationId,
        }); } catch (error) {
          job.status = "failed"; job.pendingManualRecovery = true; row.pendingManualRecovery = true;
          throw error;
        }
        assert.equal(result.pass, true); assert.equal(result.reviewExecuted, true);
        chapters[0].generationState = "approved"; job.status = "succeeded";
        // End this focused test at the first completed saved boundary; subsequent generation is separately exercised.
        if (!continueRange) row.pendingManualRecovery = true;
      }
      return job;
    },
    resumePipelineJob: (...args) => { drained = false; return core.resumePipelineJob(...args); },
    startPipelineJob: async (novelId, options) => {
      calls.newJobs.push(options);
      if (!continueRange) assert.fail("must not replace saved job");
      assert.equal(options.startOrder, options.endOrder);
      assert.ok(options.startOrder > 1 && options.startOrder <= 3);
      const chapter = chapters.find(c => c.order === options.startOrder);
      assert.equal(chapter.content, "");
      // External chapter executor double: this test checks director sequencing, not literary quality.
      chapter.content = "offline next chapter " + chapter.order; chapter.generationState = "approved";
      const next = { id: "offline-job-" + chapter.order, status: "succeeded", pendingManualRecovery: false,
        startOrder: chapter.order, endOrder: chapter.order };
      futureJobs.set(next.id,next); return next;
    },
    findActivePipelineJobForRange: async () => null,
  };
  const buildDirectorSeedPayload = (directorInput, novelId, extra) => ({ directorInput, novelId, ...extra });
  const common = { workflowService, novelService, buildDirectorSeedPayload,
    novelContextService: { listChapters: async () => chapters }, volumeWorkspaceService: { getVolumes: async () => scene.workspace } };
  const auto = new NovelDirectorAutoExecutionRuntime(common);
  const runtime = new NovelDirectorContinueRuntime({ ...common, autoExecutionRuntime: auto,
    directorRuntime: { initializeRun: async () => {}, recordRunResumed: async () => {} },
    candidateRuntime: { continueTask: async () => false },
    storyMacroService: { getPlan: async () => ({ storyInput: "existing", decomposition: {} }) },
    volumeService: { getVolumes: async () => scene.workspace },
    getDirectorAssetSnapshot: async () => ({ characterCount: 3, chapterCount: 2, volumeCount: scene.workspace.volumes.length,
      hasVolumeStrategyPlan: true, firstVolumeId: scene.workspace.volumes[0].id, firstVolumeChapterCount: 2,
      volumeChapterRanges: [{ volumeOrder: 1, startOrder: 1, endOrder: 30 }], structuredOutlineChapterOrders: [1,2] }),
    assertHighMemoryStartAllowed: async () => {},
    runDirectorPipeline: async input => { calls.phase.push(input.startPhase); assert.fail("saved review must precede future planning"); },
    scheduleBackgroundRun: (_id, run) => background.push(run),
  });
  const runFromHttp = async () => {
    row.pendingManualRecovery = true;
    const previousCommandCount = commands.length;
    const routes = [];
    loadRuntimeSource("../director/http/novelWorkflows.ts", {
      express: { Router: () => ({ use() {}, get() {}, post: (...args) => routes.push(args) }) }, zod: require("zod"),
      "../../../../middleware/auth": {}, "../../../../middleware/validate": { validate: schema => schema },
      "../commands/DirectorCommandService": { DirectorCommandService: class { constructor() { return commandService; } } },
      "../commands/DirectorProductionExperienceService": { DirectorProductionExperienceService: class {} },
      "../../workflow/NovelWorkflowService": { NovelWorkflowService: class {} },
      "../../../task/adapters/NovelWorkflowTaskAdapter": { NovelWorkflowTaskAdapter: class {} },
      "./planningRepairRoutes": { createPlanningRepairRouter: () => ({}) },
    });
    let status, error;
    await routes.find(route => route[0] === "/:id/continue").at(-1)(
      { params: { id: row.id }, body: { continuationMode: "resume" } },
      { status: value => { status = value; return { json() {} }; } }, value => { error = value; });
    if (error) throw error;
    assert.equal(status, 202); assert.equal(commands.length, previousCommandCount + 1); assert.equal(row.pendingManualRecovery, false);
    assert.equal(commands.at(-1).commandType, "approve_gate");
    await runtime.continueTask(row.id, JSON.parse(commands.at(-1).payloadJson));
    for (const run of background.splice(0)) await run();
  };
  return { runtime, auto, common, row, job, chapters, calls, runFromHttp, record: () => JSON.parse(journalRow.metadataJson),
    run: async (input = { continuationMode: "resume", forceResume: true }) => {
      await runtime.continueTask(row.id, input); for (const run of background.splice(0)) await run();
    } };
}

test("recorded full continue entry resumes original failed review despite incomplete future chapter list", async () => {
  const f = fixture();
  const seed = JSON.parse(f.row.seedPayloadJson);
  const cursor = resolveStructuredOutlineRecoveryCursor({ workspace: scene.workspace, plan: seed.directorInput.autoExecutionPlan });
  assert.equal(cursor.step, "chapter_list"); assert.equal(cursor.volumeChapterListComplete, false);
  const historicalRoute = await f.runtime.resolveAssetFirstRecovery({ novelId: f.row.novelId, directorInput: seed.directorInput });
  assert.deepEqual(historicalRoute, { type: "phase", phase: "structured_outline" });
  await f.run();
  assert.equal(f.calls.review, 1); assert.equal(f.calls.scheduled.length, 1);
  assert.equal(f.calls.newJobs.length, 0); assert.equal(f.calls.phase.length, 0);
  assert.equal(f.calls.writer, 0); assert.equal(f.calls.save, 0);
  assert.equal(f.job.retryCount, saved.job.retryCount);
  assert.equal(f.record().operationId, saved.journal.operationId);
  assert.equal(crypto.createHash("sha256").update(f.chapters[0].content).digest("hex"), "d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6");
});

for (const option of ["wrongBinding", "editDraft", "cancelled"]) test("full continue fails closed for " + option, async () => {
  const f = fixture({ [option]: true });
  await assert.rejects(f.run(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.scheduled.length, 0); assert.equal(f.calls.review, 0);
  assert.equal(f.calls.newJobs.length, 0); assert.equal(f.calls.phase.length, 0);
});

test("full continue without explicit recovery cannot schedule the paused original", async () => {
  const f = fixture();
  await assert.rejects(f.run({ continuationMode: "resume" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.scheduled.length, 0); assert.equal(f.calls.phase.length, 0);
});


test("source HTTP approve-gate command through full continue resumes original review after command clears manual flag", async () => {
  const f = fixture();
  await f.runFromHttp();
  assert.equal(f.calls.scheduled.length, 1); assert.equal(f.calls.review, 1);
  assert.equal(f.calls.newJobs.length, 0); assert.equal(f.calls.phase.length, 0);
  assert.equal(f.chapters[0].content, saved.journal.expectedChapter.content);
});


test("full source recovery finishes saved review then sequences only remaining chapters within original range", async () => {
  const f = fixture({ continueRange: true });
  await f.runFromHttp();
  assert.equal(f.calls.review, 1); assert.equal(f.calls.scheduled.length, 1);
  assert.deepEqual(f.calls.newJobs.map(job => [job.startOrder, job.endOrder]), [[2,2],[3,3]]);
  assert.equal(f.chapters[0].content, saved.journal.expectedChapter.content);
  assert.equal(f.job.retryCount, saved.job.retryCount);
  assert.ok(f.calls.checkpoints.some(checkpoint => checkpoint.checkpointType === "workflow_completed"));
});


test("planning completion through actual chapter orchestrator preserves saved job and explicit recovery", async () => {
  const f = fixture();
  const { NovelDirectorPipelineRuntime } = require("../../dist/services/novel/director/novelDirectorPipelineRuntime");
  const { NovelDirectorRuntimeOrchestrator } = require("../../dist/services/novel/director/runtime/novelDirectorRuntimeOrchestrator");
  const orchestrator = new NovelDirectorRuntimeOrchestrator({ ...f.common, autoExecutionRuntime: f.auto });
  // Runtime step persistence/approval UI is outside this forwarding boundary; runner and its input stay real.
  orchestrator.runStepModule = async ({runner}) => runner();
  const pipeline = new NovelDirectorPipelineRuntime({ runtimeOrchestrator: orchestrator });
  const seed = JSON.parse(f.row.seedPayloadJson);
  const request = { ...seed.directorInput, runMode: "full_book_autopilot", autoApproval: {} };
  await pipeline.maybeRunAutoApprovedChapters({ taskId: f.row.id, novelId: f.row.novelId, input: request,
    startPhase: "structured_outline", approveCurrentGate: true, approveAutoExecutionScope: true,
    existingPipelineJobId: saved.job.id, existingState: seed.autoExecution, resumePendingManualRecovery: true });
  assert.equal(f.calls.review, 1); assert.equal(f.calls.newJobs.length, 0);
  assert.equal(f.calls.scheduled[0][0], saved.job.id);
});

test("runtime rejects an entry that loses all saved identity arguments before creating a replacement", async () => {
  const f = fixture();
  const seed = JSON.parse(f.row.seedPayloadJson);
  await assert.rejects(f.auto.runFromReady({ taskId: f.row.id, novelId: f.row.novelId, request: seed.directorInput }),
    { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.scheduled.length, 0); assert.equal(f.calls.newJobs.length, 0);
});


test("saved review overrides stale replan projection without replan or skipping the saved chapter", async () => {
  const f = fixture();
  f.row.checkpointType = "replan_required";
  await f.runFromHttp();
  assert.equal(f.calls.review, 1); assert.equal(f.calls.newJobs.length, 0);
  assert.equal(f.calls.phase.length, 0); assert.equal(f.chapters[0].content, saved.journal.expectedChapter.content);
});

test("saved job scope remains frozen after command already cleared task pause and projection status is stale", async () => {
  const f = fixture();
  const seed = JSON.parse(f.row.seedPayloadJson);
  seed.directorInput.autoExecutionPlan.endOrder = 10;
  seed.autoExecution.pipelineStatus = "running";
  f.row.seedPayloadJson = JSON.stringify(seed);
  await assert.rejects(f.run(), /原章节审查尚未完成|原任务范围/);
  assert.equal(f.calls.scheduled.length, 0); assert.equal(f.calls.newJobs.length, 0); assert.equal(f.calls.phase.length, 0);
});


test("repeated review failure preserves the same job and draft for a second explicit source recovery", async () => {
  const f = fixture({ reviewFailures: 1 });
  await assert.rejects(f.runFromHttp(), { code: "CHAPTER_REVIEW_INCOMPLETE" });
  assert.equal(f.record().status, "paused");
  assert.equal(f.record().steps["pipeline.review:0"].status, "failed");
  assert.equal(f.chapters[0].content, saved.journal.expectedChapter.content);
  assert.equal(f.calls.newJobs.length, 0);
  await f.runFromHttp();
  assert.equal(f.calls.review, 2);
  assert.deepEqual(f.calls.scheduled.map(args => args[0]), [saved.job.id, saved.job.id]);
  assert.equal(f.calls.writer, 0); assert.equal(f.calls.save, 0);
  assert.equal(f.job.retryCount, saved.job.retryCount);
  assert.equal(f.record().steps["pipeline.review:0"].status, "done");
  assert.equal(f.chapters[0].content, saved.journal.expectedChapter.content);
});

test("nonmanual failed saved job also blocks an entry that loses its identity and resume flag", async () => {
  const f = fixture({ nonmanualFailed: true });
  const seed = JSON.parse(f.row.seedPayloadJson);
  await assert.rejects(f.auto.runFromReady({ taskId: f.row.id, novelId: f.row.novelId, request: seed.directorInput }),
    { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.scheduled.length, 0); assert.equal(f.calls.newJobs.length, 0);
});
