const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function source(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  }, exports);
  return exports;
}
class AppError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const policy = source("../../shared/types/planningRepair/recovery.ts");
const seedTools = source("../src/services/novel/director/recovery/planningRepair/planningRepairRecovery.ts", {
  "../../../../../middleware/errorHandler": { AppError },
  "@ai-novel/shared/types/planningRepair/recovery": policy,
});
let readRow;
const { PlanningRepairRecoveryService } = source("../src/services/novel/director/recovery/planningRepair/PlanningRepairRecoveryService.ts", {
  "../../../../../db/prisma": { prisma: { novelWorkflowTask: { findUnique: async () => readRow } } },
  "../../../../../middleware/errorHandler": { AppError },
  "../../../workflow/NovelWorkflowService": {},
  "../../../workflow/novelWorkflow.shared": { buildNovelEditResumeTarget: (input) => input },
  "./planningRepairRecovery": seedTools,
  "../../../volume/planningRepair/PlanningRepairStore": {},
  "@ai-novel/shared/types/planningRepair/recovery": policy,
});
const { assertAdvicePaused } = source("../src/services/novel/director/recovery/planningRepair/advice/AdviceSource.ts", {
  "../../../../../../middleware/errorHandler": { AppError },
  "../planningRepairRecovery": seedTools,
  "./AdviceContext": {},
  "@ai-novel/shared/types/planningRepair/recovery": policy,
});
function harness(status = "running", pendingManualRecovery = true) {
  let row = { id: "task", novelId: "novel", lane: "auto_director", status, pendingManualRecovery, cancelRequestedAt: null,
    seedPayloadJson: JSON.stringify({ directorSession: { phase: "chapter_execution" }, planningRepair: {
      version: 1, key: "repair", novelId: "novel", volumeId: "volume", chapterId: "c3", chapterOrder: 3,
      rounds: 1, maxRounds: 2, phase: "technical_failed", summary: "复核未完成", technicalError: "Promise source missing", history: [],
    } }) };
  const writes = [];
  const workflow = {
    getTaskByIdWithoutHealing: async () => row,
    volumeService: { getVolumes: async () => ({}) },
    updateTaskManyWithRetry: async ({ data }) => { writes.push(data); row = { ...row, ...data }; return { count: 1 }; },
  };
  const store = { rebase: async () => {
    const seed = JSON.parse(row.seedPayloadJson);
    seed.planningRepair.phase = "reviewing";
    row.seedPayloadJson = JSON.stringify(seed);
    return { eligibleChapterIds: ["c3"] };
  } };
  return { service: new PlanningRepairRecoveryService(workflow, store), get row() { return row; }, writes };
}

test("technical failure enters the structured manual gate without losing its failure evidence", async () => {
  const h = harness();
  assert.equal(await h.service.pauseIfNeeded("task"), true);
  assert.equal(h.row.status, "waiting_approval");
  assert.equal(h.row.checkpointType, "step_review_required");
  assert.equal(h.row.currentItemKey, "planning_repair_confirmation");
  const seed = JSON.parse(h.row.seedPayloadJson);
  assert.equal(seed.planningRepair.phase, "technical_failed");
  assert.equal(seed.planningRepair.technicalError, "Promise source missing");
  assert.equal(seed.resumeTarget.stage, "structured");
});

test("legacy pending running and queued tasks are readable and explicitly recoverable, never auto-resumed", async () => {
  for (const status of ["running", "queued"]) {
    const h = harness(status);
    readRow = h.row;
    const snapshot = await h.service.status("task");
    assert.equal(policy.isPlanningRepairTaskPaused(snapshot), true);
    assert.equal(h.writes.length, 0);
    await h.service.grant("task", { action: "retry", repairKey: "repair", guidance: "保留有效推进", idempotencyKey: "explicit" });
    seedTools.assertPlanningRepairResumeAllowed(h.row.seedPayloadJson, "explicit");
    const seed = JSON.parse(h.row.seedPayloadJson);
    assert.equal(seed.planningRepair.maxRounds, 3);
    assert.equal(seed.planningRepairRecovery.resumePhase, "chapter_execution");
    assert.equal(h.row.pendingManualRecovery, true);
  }
});

test("actual running tasks and cancellation never authorize planning repair", async () => {
  for (const state of [{ status: "running", pendingManualRecovery: false }, { status: "queued", pendingManualRecovery: false },
    { status: "cancelled", pendingManualRecovery: true }, { status: "running", pendingManualRecovery: true, cancelRequestedAt: new Date() }]) {
    assert.equal(policy.isPlanningRepairTaskPaused(state), false);
    const h = harness(state.status, state.pendingManualRecovery);
    Object.assign(h.row, state);
    await assert.rejects(h.service.grant("task", { action: "retry", repairKey: "repair", guidance: "方向", idempotencyKey: "explicit" }), { statusCode: 409 });
    assert.equal(h.writes.length, 0);
  }
});

test("a successful grant can replay after execution starts without new budget, but cancellation rejects it", async () => {
  const h = harness();
  const request = { action: "retry", repairKey: "repair", guidance: "保留有效推进", idempotencyKey: "explicit" };
  await h.service.grant("task", request);
  h.row.status = "running";
  h.row.pendingManualRecovery = false;
  const writeCount = h.writes.length;
  const savedSeed = h.row.seedPayloadJson;
  assert.equal((await h.service.grant("task", request)).replayed, true);
  assert.equal(h.writes.length, writeCount);
  assert.equal(h.row.seedPayloadJson, savedSeed);
  await assert.rejects(h.service.grant("task", { ...request, idempotencyKey: "new" }), { statusCode: 409 });
  h.row.cancelRequestedAt = new Date();
  await assert.rejects(h.service.grant("task", request), { statusCode: 409 });
  assert.equal(h.writes.length, writeCount);
});

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === "NOT") return !matches(row, value);
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}
test("advice ignores only this director's explicitly paused unleased job; other jobs and commands block", async () => {
  const h = harness();
  const base = { id: "own", novelId: "novel", status: "queued", pendingManualRecovery: true, executionOwner: null, executionLeaseExpiresAt: null };
  const input = { row: h.row, repair: JSON.parse(h.row.seedPayloadJson).planningRepair, recovery: null, seed: { autoExecution: { pipelineJobId: "own" } } };
  let jobs = [base];
  let command = null;
  const tx = { generationJob: { findFirst: async ({ where }) => jobs.find(job => matches(job, where)) ?? null },
    directorRunCommand: { findFirst: async () => command } };
  await assertAdvicePaused(tx, input);
  for (const patch of [{ id: "other" }, { pendingManualRecovery: false }, { executionOwner: "worker" }, { executionLeaseExpiresAt: new Date() }]) {
    jobs = [{ ...base, ...patch }];
    await assert.rejects(assertAdvicePaused(tx, input), { statusCode: 409 });
  }
  jobs = [base];
  command = { status: "queued" };
  await assert.rejects(assertAdvicePaused(tx, input), { statusCode: 409 });
  command = null;
  await assert.rejects(assertAdvicePaused(tx, { ...input, seed: {} }), { statusCode: 409 });
});
