const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("./offlineBootstrap.cjs");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const scene = require("./fixtures/firstChapterContinueWorkspace.json");
const { prisma } = require("../../dist/db/prisma");
const { DirectorCommandService } = require("../../dist/services/novel/director/commands/DirectorCommandService");
const { NovelDirectorContinueRuntime } = require("../../dist/services/novel/director/runtime/novelDirectorContinueRuntime");
const autoBase = "../../dist/services/novel/director/automation/";

function fixture({ changedAtAcceptance = false, changedAfterAcceptance = false } = {}) {
  const original = JSON.parse(scene.row.seedPayloadJson);
  const novelId = "offline-five-chapters", taskId = "offline-director", jobId = "offline-completed-chapter-five";
  const usageBudget = { taskTokenLimit: 9000000, chapterTokenLimit: 2000000 };
  const directorInput = { ...original.directorInput, workflowTaskId: taskId,
    autoExecutionPlan: { mode: "chapter_range", startOrder: 4, endOrder: 10, autoReview: true, autoRepair: true } };
  const seed = { runMode: directorInput.runMode, novelId, directorInput,
    productionExperience: original.productionExperience, productionScope: original.productionScope,
    autoExecution: { ...original.autoExecution, startOrder: 4, endOrder: 10, totalChapterCount: 7,
      scopeLabel: "第 4-10 章", firstChapterId: "offline-chapter-4", completedChapterCount: 2,
      remainingChapterCount: 5, remainingChapterIds: [], remainingChapterOrders: [6,7,8,9,10],
      nextChapterId: null, nextChapterOrder: 6, pipelineJobId: jobId, pipelineStatus: "succeeded", usageBudget,
      circuitBreaker: { status: "open", reason: "usage_anomaly", openedAt: "2026-10-16T07:35:00.000Z" } } };
  const row = { ...scene.row, id: taskId, novelId, status: "running", pendingManualRecovery: true,
    currentItemKey: "chapter_execution", checkpointType: "chapter_batch_ready", cancelRequestedAt: null,
    startedAt: new Date("2026-10-16T07:00:00Z"), updatedAt: new Date("2026-10-16T07:35:00Z"),
    seedPayloadJson: JSON.stringify(seed), resumeTargetJson: JSON.stringify({ novelId, taskId, stage: "chapter" }) };
  const job = { id: jobId, novelId, status: "succeeded", startOrder: 5, endOrder: 5,
    currentItemKey: null, currentStage: "reviewing", pendingManualRecovery: false, cancelRequestedAt: null,
    executionOwner: null, executionLeaseExpiresAt: null, updatedAt: new Date("2026-10-16T07:34:00Z"),
    payload: JSON.stringify({ workflowTaskId: taskId }), retryCount: 0 };
  // This reproduces the recorded state shape, with synthetic prose; no live assets are opened.
  const chapters = Array.from({ length: 5 }, (_, i) => ({ id: `offline-chapter-${i + 1}`, novelId,
    order: i + 1, content: `preserved offline manuscript ${i + 1}`, generationState: "approved", chapterStatus: "completed" }));
  const manuscriptHash = () => crypto.createHash("sha256").update(JSON.stringify(chapters.slice(0,5))).digest("hex");
  const beforeHash = manuscriptHash();
  const workspace = structuredClone(scene.workspace);
  workspace.novelId = novelId;
  workspace.volumes[0].chapters = workspace.volumes[0].chapters.slice(0,2);
  const calls = { commands: [], background: [], phases: [], plans: [], budgets: [], resumes: 0, starts: 0, writes: 0 };
  prisma.$transaction = async fn => fn(prisma);
  prisma.generationJob.findUnique = async ({ where }) => where.id === jobId ? job : null;
  prisma.generationJob.findFirst = async ({ where }) => {
    if (!where.id) return null;
    assert.equal(where.id, jobId); assert.equal(where.status, "succeeded");
    assert.equal(where.currentItemKey, null); assert.equal(where.pendingManualRecovery, false);
    assert.equal(where.payload, job.payload); assert.equal(where.updatedAt, job.updatedAt);
    return changedAtAcceptance ? null : job;
  };
  prisma.generationJob.updateMany = async () => { calls.writes++; assert.fail("successful job must not be mutated"); };
  prisma.chapter.updateMany = async () => { calls.writes++; assert.fail("completed manuscript must not be mutated"); };
  prisma.chapter.findMany = async () => chapters;
  prisma.novelWorkflowTask.findUnique = async () => row;
  prisma.novelWorkflowTask.updateMany = async ({ where, data }) => {
    assert.equal(where.seedPayloadJson, row.seedPayloadJson); assert.equal(where.updatedAt, row.updatedAt);
    assert.equal(where.pendingManualRecovery, true); Object.assign(row,data); return { count: 1 };
  };
  prisma.novel.findUnique = async () => ({ id: novelId, title: "离线五章继续", worldId: "offline-world",
    bookContract: { createdAt: new Date(), updatedAt: new Date() } });
  prisma.directorRunCommand.findFirst = async () => null;
  prisma.directorRunCommand.create = async ({ data }) => {
    const command = { id: "offline-command", ...data }; calls.commands.push(command); return command;
  };
  const mergeSeed = extra => { row.seedPayloadJson = JSON.stringify({ ...JSON.parse(row.seedPayloadJson), ...extra }); };
  const workflowService = {
    getTaskById: async () => row, getTaskByIdWithoutHealing: async () => row,
    findActiveTaskByNovelAndLane: async () => null, findLatestVisibleTaskByNovelId: async () => row,
    markTaskRunning: async (_id, patch) => { row.status = "running"; if (patch.seedPayload) mergeSeed(patch.seedPayload); },
    bootstrapTask: async input => mergeSeed(input.seedPayload),
    recordCheckpoint: async (_id, patch) => { if (patch.seedPayload) mergeSeed(patch.seedPayload); },
    requeueTaskForRecovery: async () => assert.fail("unexpected recovery before next route"),
  };
  const commandService = new DirectorCommandService(workflowService);
  commandService.recoverStaleLeases = async () => 0;
  const { NovelDirectorAutoExecutionRuntime } = loadRuntimeSource("../director/automation/novelDirectorAutoExecutionRuntime.ts", {
    "@ai-novel/shared/types/novelDirector": require("@ai-novel/shared/types/novelDirector"),
    "./novelDirectorAutoExecution": require(autoBase + "novelDirectorAutoExecution"),
    "./novelDirectorAutoExecutionCheckpointRuntime": require(autoBase + "novelDirectorAutoExecutionCheckpointRuntime"),
    "./novelDirectorAutoExecutionFailure": require(autoBase + "novelDirectorAutoExecutionFailure"),
    "./novelDirectorAutoExecutionCircuitBreakerRuntime": { ...require(autoBase + "novelDirectorAutoExecutionCircuitBreakerRuntime"),
      resolveUsageCircuitBreaker: async input => { calls.budgets.push(structuredClone(input.autoExecution)); return null; } },
    "./novelDirectorAutoExecutionRuntimeUtils": require(autoBase + "novelDirectorAutoExecutionRuntimeUtils"),
    "./novelDirectorAutoExecutionRuntimePreparation": require(autoBase + "novelDirectorAutoExecutionRuntimePreparation"),
    "../../../../db/prisma": { prisma }, "../../production/reliability": require("../../dist/services/novel/production/reliability"),
  });
  const common = { workflowService,
    novelService: { getPipelineJobById: async () => job, findActivePipelineJobForRange: async () => null,
      resumePipelineJob: async () => { calls.resumes++; assert.fail("succeeded job cannot resume"); },
      startPipelineJob: async () => { calls.starts++; assert.fail("stop at next planning entrance"); } },
    buildDirectorSeedPayload: (input, id, extra) => ({ directorInput: input, novelId: id, ...extra }),
    novelContextService: { listChapters: async () => chapters },
    volumeWorkspaceService: { getVolumes: async () => workspace },
    ensureRouteWindow: async (id, order, options) => {
      calls.plans.push({ novelId: id, order, options, seed: JSON.parse(row.seedPayloadJson) });
      // The only planning double: materialize a placeholder then simulate a new user pause.
      chapters.push({ ...structuredClone(scene.chapters[1]), id: "offline-chapter-6", novelId, order: 6,
        content: "", generationState: "idle" });
      row.pendingManualRecovery = true;
    },
  };
  const runtime = new NovelDirectorContinueRuntime({ ...common, autoExecutionRuntime: new NovelDirectorAutoExecutionRuntime(common),
    directorRuntime: { initializeRun: async () => {}, recordRunResumed: async () => {} },
    candidateRuntime: { continueTask: async () => false },
    storyMacroService: { getPlan: async () => ({ storyInput: "existing", decomposition: {} }) },
    volumeService: { getVolumes: async () => workspace },
    getDirectorAssetSnapshot: async () => ({ characterCount: 3, chapterCount: 5, volumeCount: workspace.volumes.length,
      hasVolumeStrategyPlan: true, firstVolumeId: workspace.volumes[0].id, firstVolumeChapterCount: 5,
      volumeChapterRanges: [{ volumeOrder: 1, startOrder: 1, endOrder: 30 }], structuredOutlineChapterOrders: [1,2,3,4,5] }),
    assertHighMemoryStartAllowed: async () => {},
    runDirectorPipeline: async input => { calls.phases.push(input.startPhase); assert.fail("saved execution must precede whole-book restructuring"); },
    scheduleBackgroundRun: (_id, run) => calls.background.push(run),
  });
  async function runFromHttp() {
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
      { params: { id: taskId }, body: { continuationMode: "resume" } },
      { status: value => { status = value; return { json() {} }; } }, value => { error = value; });
    if (error) throw error;
    assert.equal(status, 202); assert.equal(calls.commands.length, 1); assert.equal(row.pendingManualRecovery, false);
    const command = calls.commands[0]; assert.equal(command.commandType, "approve_gate");
    const payload = JSON.parse(command.payloadJson); assert.equal(payload.forceResume, true);
    if (changedAfterAcceptance) job.payload = JSON.stringify({ workflowTaskId: "other-director" });
    await runtime.continueTask(taskId, payload);
    for (const run of calls.background.splice(0)) await run();
  }
  return { row, job, calls, runtime, runFromHttp, manuscriptHash, beforeHash, usageBudget, directorInput };
}

test("HTTP resume of completed chapter five preserves range and budget through the sixth chapter planning entrance", async () => {
  const f = fixture();
  assert.deepEqual(await f.runtime.resolveAssetFirstRecovery({ novelId: f.row.novelId, directorInput: f.directorInput }),
    { type: "phase", phase: "structured_outline" });
  await f.runFromHttp();
  assert.equal(f.calls.plans.length, 1); assert.equal(f.calls.phases.length, 0);
  const plan = f.calls.plans[0]; assert.equal(plan.order, 6); assert.equal(plan.options.endOrder, 6);
  assert.equal(plan.options.completionProfile.targetChapterCount, 100);
  assert.deepEqual([plan.seed.autoExecution.startOrder, plan.seed.autoExecution.endOrder], [4,10]);
  assert.equal(plan.seed.autoExecution.pipelineJobId, null);
  assert.deepEqual(plan.seed.autoExecution.usageBudget, f.usageBudget);
  assert.ok(f.calls.budgets.length >= 2);
  assert.ok(f.calls.budgets.every(state => state.circuitBreaker.status === "closed"));
  assert.ok(f.calls.budgets.every(state => JSON.stringify(state.usageBudget) === JSON.stringify(f.usageBudget)));
  assert.equal(f.calls.resumes, 0); assert.equal(f.calls.starts, 0); assert.equal(f.calls.writes, 0);
  assert.equal(f.manuscriptHash(), f.beforeHash); assert.equal(f.job.status, "succeeded"); assert.equal(f.job.retryCount, 0);
});

test("completed-job CAS rejection keeps the source pause and creates no command", async () => {
  const f = fixture({ changedAtAcceptance: true });
  await assert.rejects(f.runFromHttp(), /原章节任务状态已变化/);
  assert.equal(f.row.pendingManualRecovery, true); assert.equal(f.calls.commands.length, 0);
  assert.equal(f.calls.plans.length, 0); assert.equal(f.manuscriptHash(), f.beforeHash);
});

test("completed-job ownership is rechecked after command acceptance before runtime schedules", async () => {
  const f = fixture({ changedAfterAcceptance: true });
  await assert.rejects(f.runFromHttp(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.calls.commands.length, 1); assert.equal(f.calls.background.length, 0);
  assert.equal(f.calls.plans.length, 0); assert.equal(f.calls.resumes, 0); assert.equal(f.manuscriptHash(), f.beforeHash);
});

test("ordinary non-force continuation of an active director retains its previous no-op behavior", async () => {
  const f = fixture(); f.row.pendingManualRecovery = false;
  await f.runtime.continueTask(f.row.id, { continuationMode: "resume" });
  assert.equal(f.calls.background.length, 0); assert.equal(f.calls.phases.length, 0); assert.equal(f.calls.plans.length, 0);
});
