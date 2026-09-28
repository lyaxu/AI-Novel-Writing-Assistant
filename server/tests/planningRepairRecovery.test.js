const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const useSource = process.env.PLANNING_REPAIR_TEST_SOURCE === "1";
if (useSource) {
  const ts = require("typescript");
  const fs = require("node:fs");
  require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
}
const artifact = path => `../${useSource ? "src" : "dist"}/${path}.${useSource ? "ts" : "js"}`;
// Block all database access before importing services, including SQLite initialization pragmas.
require.cache[require.resolve(artifact("db/prisma"))] = { exports: { prisma: new Proxy({}, {
  get: () => new Proxy(() => { throw new Error("Unexpected database access in offline repair tests"); }, {
    get: () => () => { throw new Error("Unexpected database access in offline repair tests"); },
  }),
}) } };
const { createPlanningRepairRouter } = require(artifact("services/novel/director/http/planningRepairRoutes"));
const { PlanningRepairRecoveryService } = require(artifact("services/novel/director/recovery/planningRepair/PlanningRepairRecoveryService"));
const { assertPlanningRepairResumeAllowed, isPlanningRepairConfirmationError, resolvePlanningRepairResumePhase } = require(artifact("services/novel/director/recovery/planningRepair/planningRepairRecovery"));
const { NovelDirectorContinueRuntime } = require(artifact("services/novel/director/runtime/novelDirectorContinueRuntime"));
const { errorHandler } = require(artifact("middleware/errorHandler"));
const { getPlanningRepairCheckpointStage, overlayPlanningRepairPause } = require(artifact("services/novel/director/recovery/planningRepair/planningRepairProjection"));
const { DirectorNodeRunner } = require(artifact("services/novel/director/runtime/DirectorNodeRunner"));
const { DirectorRuntimeStore } = require(artifact("services/novel/director/runtime/DirectorRuntimeStore"));

test("explicit planning pause supersedes current failure text without erasing historical evidence", () => {
  const history = [{ type: "node_failed", summary: "old semantic failure 3000" }];
  const projection = { status: "failed", blockedReason: history[0].summary, blockingReason: history[0].summary,
    detail: history[0].summary, lastErrorMessage: history[0].summary, recentEvents: history };
  for (const phase of ["waiting_confirmation", "uncertain", "committed", "assessing"]) {
    const task = { status: "waiting_approval", checkpointType: "step_review_required",
      checkpointSummary: "Current planning checkpoint", seedPayloadJson: JSON.stringify({ planningRepair: state({ phase }) }) };
    const next = overlayPlanningRepairPause(projection, task);
    assert.equal(next.status, "waiting_approval");
    for (const key of ["blockedReason", "blockingReason", "detail", "currentAction"]) assert.equal(next[key], task.checkpointSummary);
    assert.equal(next.lastErrorMessage, null);
    assert.equal(next.requiresUserAction, true);
    assert.equal(next.isAutopilotRecoverable, false);
    assert.strictEqual(next.recentEvents, history);
    assert.equal(projection.status, "failed");
    assert.equal(projection.blockedReason, "old semantic failure 3000");
    for (const patch of [{ status: "failed" }, { status: "running" }, { checkpointType: "production_experience_required" },
      { seedPayloadJson: "{}" }, { seedPayloadJson: "broken" }, { checkpointSummary: "" },
      { seedPayloadJson: JSON.stringify({ planningRepair: state({ phase: "technical_failed" }) }) }]) {
      assert.strictEqual(overlayPlanningRepairPause(projection, { ...task, ...patch }), projection);
    }
  }
});

test("planning recovery checkpoint identifies its source stage independently of stale runtime facts", () => {
  for (const phase of ["waiting_confirmation", "uncertain", "assessing", "committed"]) {
    const repair = state({ phase });
    const task = { status: "waiting_approval", checkpointType: "step_review_required",
      seedPayloadJson: JSON.stringify({ planningRepair: repair,
        planningRepairRecovery: { repairKey: repair.key, resumePhase: "chapter_execution" } }) };
    assert.equal(getPlanningRepairCheckpointStage(task),
      ["assessing", "committed"].includes(phase) ? "chapter_execution" : "structured_outline");
    assert.equal(getPlanningRepairCheckpointStage({ ...task, status: "running" }), null);
    assert.equal(getPlanningRepairCheckpointStage({ ...task, seedPayloadJson: "{}" }), null);
  }
});

test("node runner persists confirmation and conflict as waiting gates; ordinary errors remain failures", async () => {
  const tracking = require(artifact("llm/usageTracking"));
  const originalTracking = tracking.runWithLlmUsageTracking;
  tracking.runWithLlmUsageTracking = async (_context, run) => run();
  try {
    for (const code of ["PLANNING_REPAIR_CONFIRMATION_REQUIRED", "PLANNING_REPAIR_CONFLICT", "ORDINARY_ERROR"]) {
      const error = Object.assign(new Error("Current planning checkpoint"), { code });
      let snapshot = { novelId: "novel-1", steps: [], events: [], artifacts: [] };
      const store = new DirectorRuntimeStore();
      store.getSnapshot = async () => snapshot;
      store.mutateSnapshot = async (_id, mutate) => { snapshot = mutate(snapshot, {}); return snapshot; };
      const runner = new DirectorNodeRunner(store, { decide: () => ({ canRun: true, requiresApproval: false }) });
      await assert.rejects(runner.run({ nodeKey: "planning", label: "Planning", reads: [], writes: [],
        mayModifyUserContent: false, requiresApprovalByDefault: false, supportsAutoRetry: false,
        run: async () => { throw error; } }, { taskId: "task-1", novelId: "novel-1", input: {} }), value => value === error);
      const step = snapshot.steps[0];
      assert.equal(step.status, code === "ORDINARY_ERROR" ? "failed" : "waiting_approval");
      assert.ok(step.finishedAt);
      assert.equal(snapshot.events.at(-1).type, code === "ORDINARY_ERROR" ? "node_failed" : "approval_required");
      if (code !== "ORDINARY_ERROR") {
        assert.equal(step.error, null);
        assert.equal(step.policyDecision.reason, error.message);
        assert.equal(snapshot.events.some(event => event.type === "node_failed"), false);
      }
    }
  } finally { tracking.runWithLlmUsageTracking = originalTracking; }
});

test("persistent projection loader applies planning checkpoint after stale runtime and command overlays", async () => {
  const db = require(artifact("db/prisma"));
  const originalPrisma = db.prisma;
  const usage = require(artifact("services/novel/director/runtime/DirectorUsageTelemetryQueryService")).directorUsageTelemetryQueryService;
  const originalUsage = usage.getTaskUsage;
  const { loadPersistentDirectorRuntimeProjection } = require(artifact("services/novel/director/projections/novelDirectorRuntimeProjection"));
  const now = new Date();
  const event = { id: "old-event", type: "node_failed", taskId: "task-1", summary: "old semantic failure 3000", occurredAt: now };
  db.prisma = {
    directorRun: { findUnique: async () => ({ id: "task-1", novelId: null, updatedAt: now,
      steps: [{ idempotencyKey: "planning", nodeKey: "planning", label: "Planning", status: "failed",
        startedAt: now, finishedAt: now, error: event.summary }], events: [event] }) },
    directorRunCommand: { findFirst: async () => ({ id: "command-1", commandType: "continue", status: "running", updatedAt: now }) },
    directorRuntimeInstance: { findFirst: async () => null },
    novelWorkflowTask: { findUnique: async ({ select }) => {
      assert.equal(select.checkpointSummary, true);
      assert.equal(select.checkpointType, true);
      return { status: "waiting_approval", checkpointType: "step_review_required", checkpointSummary: "Committed; awaiting confirmation",
        seedPayloadJson: JSON.stringify({ planningRepair: state({ phase: "committed" }) }) };
    } },
    directorEvent: { findMany: async () => [] },
  };
  usage.getTaskUsage = async () => ({});
  try {
    const projection = await loadPersistentDirectorRuntimeProjection("task-1");
    assert.equal(projection.status, "waiting_approval");
    assert.equal(projection.blockingReason, "Committed; awaiting confirmation");
    assert.equal(projection.lastErrorMessage, null);
    assert.ok(projection.recentEvents.some(item => item.summary === event.summary));
  } finally { db.prisma = originalPrisma; usage.getTaskUsage = originalUsage; }
});

function state(patch = {}) {
  return { version: 1, key: "repair-1", novelId: "novel-1", volumeId: "volume-1", chapterId: "plan-1", chapterOrder: 4,
    rounds: 2, maxRounds: 2, phase: "waiting_confirmation", summary: "Needs confirmation", history: [], ...patch };
}

test("task snapshot reads planning repair from state.seedPayload, not the seed-free task DTO", async () => {
  const { DirectorTaskSnapshotService } = require(artifact("services/novel/director/projections/DirectorTaskSnapshotService"));
  const events = [{ type: "node_failed", summary: "old semantic failure 3000" }];
  const oldProjection = { status: "failed", blockingReason: events[0].summary, blockedReason: events[0].summary,
    detail: events[0].summary, requiresUserAction: true, recentEvents: events };
  for (const phase of ["waiting_confirmation", "uncertain", "committed"]) {
    const currentState = {
      task: { id: "task-1", novelId: "novel-1", status: "waiting_approval", checkpointType: "step_review_required",
        checkpointSummary: `Current ${phase} checkpoint`, lastError: null, pendingManualRecovery: false },
      seedPayload: { planningRepair: state({ phase }) },
      activeStep: null, latestCommand: null, run: null,
    };
    assert.equal(Object.hasOwn(currentState.task, "seedPayloadJson"), false);
    const service = new DirectorTaskSnapshotService({
      stateReader: { readByTaskId: async () => currentState },
      runtimeStore: { getSnapshot: async () => ({ events, artifacts: [] }) },
      projectionService: { buildSnapshotProjection: () => oldProjection },
      factSummaryService: {},
    });
    service.inspectFacts = async () => ({ factStep: null, factSummary: null });
    const { snapshot } = await service.getTaskSnapshot("task-1");
    assert.equal(snapshot.projection.status, "waiting_approval");
    assert.equal(snapshot.projection.blockingReason, currentState.task.checkpointSummary);
    assert.equal(snapshot.displayState.currentAction, currentState.task.checkpointSummary);
    assert.equal(snapshot.dashboardView.currentAction, currentState.task.checkpointSummary);
    assert.deepEqual(snapshot.recentEvents, events);
    assert.equal(oldProjection.blockingReason, "old semantic failure 3000");
    currentState.seedPayload = {};
    const ordinary = await service.getTaskSnapshot("task-1");
    assert.strictEqual(ordinary.snapshot.projection, oldProjection);
  }
});

function harness(patch = {}) {
  let row = { id: "task-1", novelId: "novel-1", lane: "auto_director", status: "waiting_approval",
    pendingManualRecovery: true, updatedAt: new Date("2026-01-01"), cancelRequestedAt: null,
    seedPayloadJson: JSON.stringify({ untouched: true, planningRepair: state(), ...patch }) };
  const writes = [];
  const rebases = [];
  const workflow = {
    volumeService: { getVolumes: async () => ({ novelId: "novel-1", volumes: [] }) },
    getTaskByIdWithoutHealing: async () => ({ ...row }),
    updateTaskManyWithRetry: async ({ where, data }) => {
      if (where.seedPayloadJson !== row.seedPayloadJson) return { count: 0 };
      writes.push({ where, data }); row = { ...row, ...data }; return { count: 1 };
    },
  };
  const repairStore = { rebase: async input => {
    assert.equal(input.expectedSeedPayloadJson, row.seedPayloadJson);
    rebases.push(input);
    const seed = JSON.parse(row.seedPayloadJson);
    seed.planningRepair = { ...seed.planningRepair, phase: seed.planningRepair.candidateVersionId ? "reviewing" : "assessing", pendingOperation: undefined, quality: undefined };
    row = { ...row, seedPayloadJson: JSON.stringify(seed) };
    return { eligibleChapterIds: seed.planningRepairSnapshot?.eligibleChapterIds ?? ["plan-1"] };
  } };
  return { service: new PlanningRepairRecoveryService(workflow, repairStore), workflow, repairStore, rebases, writes, row: () => row };
}

test("continue cannot bypass planning confirmation, force resume or reset budget", async () => {
  for (const phase of ["waiting_confirmation", "uncertain", "technical_failed"]) {
    const json = JSON.stringify({ planningRepair: state({ phase }) });
    assert.throws(() => assertPlanningRepairResumeAllowed(json), { statusCode: 409 });
    const runtime = new NovelDirectorContinueRuntime({ workflowService: { getTaskById: async () => ({ lane: "auto_director", seedPayloadJson: json }) } });
    await assert.rejects(runtime.continueTask("task-1", { forceResume: true, continuationMode: "skip_quality_repair" }), { statusCode: 409 });
  }
  assert.doesNotThrow(() => assertPlanningRepairResumeAllowed(JSON.stringify({ planningRepair: state({ phase: "committed" }) })));
  assert.throws(() => assertPlanningRepairResumeAllowed("broken"), { statusCode: 409 });
});

test("clean restart reuses intermediate results without granting budget, but pending calls remain blocked", () => {
  for (const phase of ["assessing", "repairing", "reviewing", "ready"]) {
    const seed = { planningRepair: state({ phase }) };
    const before = JSON.stringify(seed);
    assert.doesNotThrow(() => assertPlanningRepairResumeAllowed(before));
    assert.equal(JSON.stringify(seed), before);
    assert.throws(() => assertPlanningRepairResumeAllowed(JSON.stringify({ planningRepair: { ...seed.planningRepair, pendingOperation: { kind: "review" } } })), { statusCode: 409 });
    assert.throws(() => assertPlanningRepairResumeAllowed(JSON.stringify({ ...seed, planningRepairRecovery: { repairKey: seed.planningRepair.key, pendingGrant: true } })), { statusCode: 409 });
  }
});

test("explicit grant rebases before budget change, preserves candidate and rounds and clears uncertain call", async () => {
  const quality = { chapters: { "plan-1": { status: "failed", safeToSync: false } } };
  const { service, row, rebases } = harness({ planningRepair: state({ candidateVersionId: "candidate-1", quality, pendingOperation: { kind: "review" } }) });
  await service.grant("task-1", { action: "retry", repairKey: "repair-1", guidance: "Keep the reveal", idempotencyKey: "request-1" });
  const seed = JSON.parse(row().seedPayloadJson);
  assert.equal(seed.planningRepair.rounds, 2);
  assert.equal(seed.planningRepair.maxRounds, 3);
  assert.equal(seed.planningRepair.phase, "reviewing");
  assert.equal(seed.planningRepair.pendingOperation, undefined);
  assert.equal(seed.planningRepair.quality, undefined);
  assert.equal(rebases.length, 1);
  assert.equal(JSON.parse(rebases[0].expectedSeedPayloadJson).planningRepair.maxRounds, 2);
  assert.equal(seed.planningRepair.candidateVersionId, "candidate-1");
  assert.equal(seed.untouched, true);
  assert.doesNotThrow(() => assertPlanningRepairResumeAllowed(row().seedPayloadJson, "request-1"));
  assert.doesNotThrow(() => assertPlanningRepairResumeAllowed(row().seedPayloadJson));
});

test("typed recovery mode is durable and replay cannot add another round or change operation", async () => {
  const h = harness({ planningRepair: state({ candidateVersionId: "candidate-1" }) });
  const input = { action: "retry", repairKey: "repair-1", guidance: "Apply concrete change", idempotencyKey: "typed", executionMode: "repair_then_review" };
  await h.service.grant("task-1", input);
  await h.service.grant("task-1", input);
  const seed = JSON.parse(h.row().seedPayloadJson);
  assert.equal(seed.planningRepair.maxRounds, 3);
  assert.deepEqual(seed.planningRepair.recoveryAction, { requestId: "typed", mode: "repair_then_review" });
  assert.equal(h.rebases.length, 1);
  await assert.rejects(h.service.grant("task-1", { ...input, executionMode: "review_existing" }));
});

test("authorized window survives queue failure replay and invalid scopes never reserve a grant", async () => {
  const h = harness({ planningRepair: state({ chapterId: "plan-1", candidateVersionId: "candidate-1" }),
    planningRepairSnapshot: { eligibleChapterIds: ["plan-1", "plan-2"] } });
  const input = { action: "retry", repairKey: "repair-1", guidance: "Repair both", idempotencyKey: "window",
    executionMode: "repair_then_review", affectedChapterIds: ["plan-1", "plan-2"] };
  await assert.rejects(h.service.grant("task-1", { ...input, affectedChapterIds: ["plan-1", "written"] }));
  assert.equal(h.writes.length, 0);
  await h.service.grant("task-1", input);
  const recovery = JSON.parse(h.row().seedPayloadJson).planningRepairRecovery;
  await h.service.grant("task-1", { action: "retry", repairKey: recovery.repairKey,
    guidance: recovery.guidance, idempotencyKey: recovery.idempotencyKey,
    executionMode: recovery.executionMode, affectedChapterIds: recovery.affectedChapterIds });
  assert.equal(h.rebases.length, 1);
  assert.equal(JSON.parse(h.row().seedPayloadJson).planningRepair.maxRounds, 3);
  assert.deepEqual(recovery.affectedChapterIds, ["plan-1", "plan-2"]);
});

test("review-only authorization cannot silently enlarge the repair budget", async () => {
  const h = harness({ planningRepair: state({ candidateVersionId: "candidate-1" }) });
  const input = { action: "retry", repairKey: "repair-1", guidance: "Reassess disagreement", idempotencyKey: "review",
    executionMode: "review_existing" };
  await h.service.grant("task-1", input);
  await h.service.grant("task-1", input);
  const saved = JSON.parse(h.row().seedPayloadJson).planningRepair;
  assert.equal(saved.maxRounds, 2);
  assert.equal(saved.rounds, 2);
  assert.equal(saved.recoveryAction.mode, "review_existing");
});

test("CAS prevents concurrent grants; replay never grants twice; mismatched key and empty guidance do not write", async () => {
  const { service, writes, row } = harness();
  await assert.rejects(service.grant("task-1", { action: "retry", repairKey: "wrong", guidance: "Direction", idempotencyKey: "request" }), { statusCode: 409 });
  await assert.rejects(service.grant("task-1", { action: "retry", repairKey: "repair-1", guidance: " ", idempotencyKey: "request" }), { statusCode: 400 });
  const payload = { action: "retry", repairKey: "repair-1", guidance: "Direction", idempotencyKey: "request" };
  const results = await Promise.allSettled([service.grant("task-1", payload), service.grant("task-1", payload)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(writes.length, 2);
  assert.equal((await service.grant("task-1", payload)).replayed, true);
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(row().seedPayloadJson).planningRepair.maxRounds, 3);
});

test("rebase safety rejection does not append a round and pending request cannot authorize generic continue", async () => {
  const { service, row, repairStore } = harness();
  repairStore.rebase = async () => { throw Object.assign(new Error("Protected chapter"), { code: "PLANNING_REPAIR_CONFLICT" }); };
  await assert.rejects(service.grant("task-1", { action: "retry", repairKey: "repair-1", guidance: "Direction", idempotencyKey: "request" }), { code: "PLANNING_REPAIR_CONFLICT" });
  assert.equal(JSON.parse(row().seedPayloadJson).planningRepair.maxRounds, 2);
  assert.throws(() => assertPlanningRepairResumeAllowed(row().seedPayloadJson, "request"), { statusCode: 409 });
});

test("pause keeps waiting without writes or budget changes", async () => {
  const { service, writes } = harness();
  assert.equal((await service.grant("task-1", { action: "pause", repairKey: "repair-1" })).granted, false);
  assert.equal(writes.length, 0);
});

test("safety conflict pauses on structured source and preserves original JIT resume anchor", async () => {
  const { service, row } = harness({ directorSession: { phase: "chapter_execution" }, planningRepair: state({ phase: "technical_failed", candidateVersionId: "candidate-1" }) });
  const error = Object.assign(new Error("Source changed"), { code: "PLANNING_REPAIR_CONFLICT" });
  assert.equal(isPlanningRepairConfirmationError(error), true);
  await service.pauseAfterFailure("task-1", error);
  assert.equal(row().status, "waiting_approval");
  assert.equal(row().checkpointType, "step_review_required");
  assert.equal(row().pendingManualRecovery, true);
  assert.equal(JSON.parse(row().resumeTargetJson).stage, "structured");
  const seed = JSON.parse(row().seedPayloadJson);
  assert.equal(seed.planningRepair.phase, "waiting_confirmation");
  assert.equal(seed.planningRepair.candidateVersionId, "candidate-1");
  assert.equal(seed.planningRepairRecovery.resumePhase, "chapter_execution");
  assert.equal(resolvePlanningRepairResumePhase(row()), "chapter_execution");
});

test("authorized recovery resumes original phase and never invokes replan or asset-first routing", async () => {
  for (const resumePhase of ["structured_outline", "chapter_execution"]) {
    const repair = state({ phase: "reviewing", maxRounds: 3 });
    const input = { runMode: "full_book_autopilot", candidate: { workingTitle: "Book", targetChapterCount: 30 } };
    // This recovery case starts after the author chose the production experience.
    const seed = { planningRepair: repair, directorInput: input, productionExperience: "professional",
      planningRepairRecovery: { repairKey: repair.key, resumePhase, idempotencyKey: "grant", grantedAtRound: 2 },
      autoExecution: { enabled: true, pipelineJobId: "old-failed-job" },
      resumeTarget: { stage: "structured", volumeId: "volume-1", chapterId: "plan-1" } };
    const row = { id: "task-1", novelId: "novel-1", lane: "auto_director", status: "waiting_approval",
      pendingManualRecovery: true, checkpointType: "step_review_required", seedPayloadJson: JSON.stringify(seed),
      resumeTargetJson: JSON.stringify(seed.resumeTarget) };
    let scheduled; let run;
    const runtime = new NovelDirectorContinueRuntime({
      workflowService: { getTaskById: async () => row, bootstrapTask: async () => {}, markTaskRunning: async () => {} },
      directorRuntime: { initializeRun: async () => {}, recordRunResumed: async () => {} },
      continueCandidateStageTask: async () => false,
      assertHighMemoryStartAllowed: async () => {},
      resolveAssetFirstRecovery: async () => { throw new Error("Must preserve repair resume phase"); },
      replanNovel: async () => { throw new Error("Planning repair cannot use pipeline replan"); },
      buildDirectorSeedPayload: (_input, _novel, extra) => extra,
      scheduleBackgroundRun: (_taskId, fn) => { scheduled = fn; },
      runDirectorPipeline: async args => { run = args; },
      autoExecutionRuntime: { runFromReady: async args => { run = args; } },
    });
    await runtime.continueTask("task-1", { planningRepairRecoveryKey: "grant", forceResume: true });
    await scheduled();
    if (resumePhase === "structured_outline") {
      assert.equal(run.startPhase, "structured_outline");
      assert.equal(run.scope, "chapter:plan-1");
    } else {
      assert.equal(run.existingPipelineJobId, null);
      assert.equal(run.existingState.pipelineJobId, null);
      assert.equal(run.skipCurrentQualityRepair, false);
      assert.equal(run.allowSkipReviewBlockedChapter, false);
    }
  }
});

test("HTTP handlers validate guidance and idempotency, GET is read-only, pause never dispatches", async () => {
  const calls = [];
  const recovery = {
    status: async id => { calls.push(["read", id]); return { taskId: id, planningRepair: state() }; },
    statusByNovel: async id => { calls.push(["readNovel", id]); return null; },
    grant: async (id, input) => { calls.push(["grant", id, input]); return { granted: input.action === "retry", replayed: false, taskId: id }; },
  };
  const commands = { enqueuePlanningRepairRecoveryCommand: async (...args) => { calls.push(["dispatch", ...args]); return { commandId: "command-1" }; } };
  const app = express(); app.use(express.json()); app.use(createPlanningRepairRouter(recovery, commands)); app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${url}/task-1/planning-repair/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${url}/task-1/planning-repair`)).status, 200);
    assert.equal((await fetch(`${url}/novels/novel-1/planning-repair`)).status, 200);
    assert.deepEqual(calls.map(c => c[0]), ["read", "readNovel"]);
    for (const input of [
      { action: "retry", repairKey: "repair-1", guidance: " " },
      { action: "retry", repairKey: "repair-1", guidance: "Valid" },
      { action: "retry", repairKey: "repair-1", guidance: "Valid", idempotencyKey: "id", extraRounds: 100 },
    ]) assert.equal((await post(input)).status, 400);
    assert.equal(calls.length, 2);
    assert.equal((await post({ action: "pause", repairKey: "repair-1" })).status, 200);
    assert.equal(calls.filter(c => c[0] === "dispatch").length, 0);
    assert.equal((await post({ action: "retry", repairKey: "repair-1", guidance: "Valid", idempotencyKey: "id" })).status, 202);
    assert.deepEqual(calls.at(-1), ["dispatch", "task-1", "repair-1", "id"]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("advice HTTP separates read, paid request and adoption and dispatches the server-owned recovery key", async () => {
  const calls = [];
  const advice = {
    status: async id => { calls.push(["read", id]); return { status: "none" }; },
    request: async (id, input) => { calls.push(["request", id, input]); return { status: "running", adviceId: "a" }; },
    select: async (id, input) => { calls.push(["select", id, input]); return { granted: true, idempotencyKey: "advice:a:option" }; },
  };
  const commands = { enqueuePlanningRepairRecoveryCommand: async (...args) => { calls.push(["dispatch", ...args]); return { commandId: "c" }; } };
  const app = express(); app.use(express.json()); app.use(createPlanningRepairRouter({}, commands, advice)); app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/task-1/planning-repair/advice`;
  const post = (suffix, body) => fetch(`${url}${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.deepEqual(calls, [["read", "task-1"]]);
    assert.equal((await post("", { repairKey: "r", idempotencyKey: "request" })).status, 202);
    assert.equal(calls.filter(call => call[0] === "dispatch").length, 0);
    const selection = { repairKey: "r", idempotencyKey: "client-click", adviceId: "a", optionId: "option" };
    assert.equal((await post("/select", { ...selection, guidance: "tampered" })).status, 400);
    assert.equal((await post("/select", selection)).status, 202);
    assert.deepEqual(calls.at(-1), ["dispatch", "task-1", "r", "advice:a:option"]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
