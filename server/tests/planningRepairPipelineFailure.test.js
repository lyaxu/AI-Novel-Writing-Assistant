const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function source(file, mocks) {
  const filename = path.resolve(__dirname, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })(name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }, exports);
  return exports;
}
class AppError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const policy = source("../../shared/types/planningRepair/recovery.ts", {});
const seedTools = source("../src/services/novel/director/recovery/planningRepair/planningRepairRecovery.ts", {
  "../../../../../middleware/errorHandler": { AppError }, "@ai-novel/shared/types/planningRepair/recovery": policy,
});
function harness() {
  const seed = { autoExecution: { pipelineJobId: "job" }, planningRepair: {
    version: 1, key: "repair", novelId: "novel", phase: "reviewing", rounds: 2, maxRounds: 3,
    candidateVersionId: "candidate", pendingOperation: { kind: "review:c3" }, history: [],
  }, planningRepairRecovery: { repairKey: "repair", idempotencyKey: "grant", resumePhase: "chapter_execution" } };
  const row = { id: "task", novelId: "novel", lane: "auto_director", status: "queued", attemptCount: 0,
    startedAt: new Date(1000), updatedAt: new Date(2000), pendingManualRecovery: false, cancelRequestedAt: null,
    seedPayloadJson: JSON.stringify(seed) };
  const job = { novelId: "novel", status: "running", payload: JSON.stringify({ workflowTaskId: "task" }) };
  let writes = 0; let cas = true;
  const { PlanningRepairRecoveryService } = source("../src/services/novel/director/recovery/planningRepair/PlanningRepairRecoveryService.ts", {
    "../../../../../db/prisma": { prisma: { generationJob: { findUnique: async () => job } } },
    "../../../../../middleware/errorHandler": { AppError }, "../../../workflow/NovelWorkflowService": {},
    "../../../workflow/novelWorkflow.shared": { buildNovelEditResumeTarget: value => value },
    "./planningRepairRecovery": seedTools, "../../../volume/planningRepair/PlanningRepairStore": {},
    "@ai-novel/shared/types/planningRepair/recovery": policy, "../pipelinePause": {},
  });
  const service = new PlanningRepairRecoveryService({ getTaskByIdWithoutHealing: async () => ({ ...row }),
    updateTaskManyWithRetry: async ({ where, data }) => {
      assert.equal(where.seedPayloadJson, row.seedPayloadJson); assert.equal(where.updatedAt, row.updatedAt);
      if (!cas) return { count: 0 };
      writes++; Object.assign(row, data); return { count: 1 };
    } }, {});
  const error = Object.assign(new Error("Repair task ownership changed; reopen the session."), { code: "PLANNING_REPAIR_CONFLICT" });
  return { row, seed, job, service, error, get writes() { return writes; }, failCas: () => { cas = false; },
    saveSeed: () => { row.seedPayloadJson = JSON.stringify(seed); } };
}
test("typed pipeline conflict pauses on structured source while preserving candidate, budget and unknown call", async () => {
  const h = harness(); const expected = await h.service.capturePipelineFailureBoundary("task");
  h.row.status = "running";
  assert.equal(await h.service.pauseAfterPipelineFailure("task", "job", h.error, expected), true);
  const saved = JSON.parse(h.row.seedPayloadJson);
  assert.equal(h.row.status, "waiting_approval"); assert.equal(h.row.checkpointType, "step_review_required");
  assert.equal(h.row.pendingManualRecovery, true); assert.equal(saved.planningRepair.phase, "waiting_confirmation");
  for (const field of ["rounds", "maxRounds", "candidateVersionId", "pendingOperation", "history"]) {
    assert.deepEqual(saved.planningRepair[field], h.seed.planningRepair[field]);
  }
  assert.equal(saved.planningRepair.technicalError, h.error.message);
  assert.match(h.row.checkpointSummary, /请回到节奏/); assert.doesNotMatch(h.row.checkpointSummary, /ownership/);
  assert.equal(await h.service.pauseIfNeeded("task"), true);
  assert.equal(h.row.status, "waiting_approval");
});
test("identity, authorization, cancellation and binding changes cannot pause a newer execution", async () => {
  for (const mutate of [h => { h.row.attemptCount++; }, h => { h.row.startedAt = new Date(9999); },
    h => { h.row.novelId = "other"; }, h => { h.row.status = "cancelled"; },
    h => { h.row.cancelRequestedAt = new Date(); }, h => { h.row.pendingManualRecovery = true; },
    h => { h.seed.planningRepair.key = "other"; }, h => { h.seed.planningRepair.phase = "committed"; },
    h => { h.seed.planningRepairRecovery.idempotencyKey = "new-grant"; },
    h => { h.seed.planningRepairRecovery.pendingGrant = true; },
    h => { h.seed.autoExecution.pipelineJobId = "new-job"; }, h => { h.job.payload = "{}"; }]) {
    const h = harness(); const expected = await h.service.capturePipelineFailureBoundary("task");
    mutate(h); h.saveSeed();
    assert.equal(await h.service.pauseAfterPipelineFailure("task", "job", h.error, expected), false);
    assert.equal(h.writes, 0);
  }
});
test("planning confirmation preserves its semantic reason instead of reporting an execution conflict", async () => {
  const h = harness();
  const expected = await h.service.capturePipelineFailureBoundary("task");
  const error = Object.assign(new Error("两轮规划修复后仍有未解决问题，请确认修复方向。"), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(await h.service.pauseAfterPipelineFailure("task", "job", error, expected), true);
  assert.equal(h.row.checkpointSummary, error.message);
  const repair = JSON.parse(h.row.seedPayloadJson).planningRepair;
  assert.equal(repair.summary, error.message); assert.equal(repair.rounds, h.seed.planningRepair.rounds);
});
test("missing capture and CAS conflict never overwrite current state", async () => {
  const h = harness();
  assert.equal(await h.service.pauseAfterPipelineFailure("task", "job", h.error, null), false);
  const expected = await h.service.capturePipelineFailureBoundary("task"); h.failCas();
  await assert.rejects(h.service.pauseAfterPipelineFailure("task", "job", h.error, expected), { statusCode: 409 });
  assert.equal(h.writes, 0);
});
