const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../src/services/novel/director/automation/novelDirectorAutoExecutionRuntimePreparation.ts");
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })(name => {
  if (["@ai-novel/shared/types/novelDirector", "./novelDirectorAutoExecutionScopeRuntime", "./novelDirectorAutoExecutionFailure"].includes(name)) return {};
  throw new Error(`Unexpected dependency ${name}`);
}, api);
function fixture() {
  const seed = { autoExecution: { pipelineJobId: "old-job" }, planningRepairRecovery: { repairKey: "repair", idempotencyKey: "grant" } };
  const row = { id: "task", novelId: "book", lane: "auto_director", status: "queued", attemptCount: 0,
    startedAt: new Date(1000), pendingManualRecovery: false, seedPayloadJson: JSON.stringify(seed) };
  const expected = { ...row }; const cancelled = [];
  const deps = { workflowService: { getTaskByIdWithoutHealing: async () => row,
    getTaskById: async () => { throw new Error("Healing read is forbidden"); } },
    novelService: { cancelPipelineJob: async id => cancelled.push(id) } };
  return { row, seed, expected, cancelled, stop: () => api.shouldStopAutoExecution(deps, "task", "old-job", expected) };
}
test("queued to running is the same execution identity", async () => {
  const h = fixture(); h.row.status = "running"; assert.equal(await h.stop(), false);
  assert.deepEqual(h.cancelled, []);
});
test("old supervision exits on new authorization, ownership, job binding or manual pause", async () => {
  for (const mutate of [h => { h.row.attemptCount++; }, h => { h.row.startedAt = new Date(2000); },
    h => { h.row.id = "other"; }, h => { h.row.novelId = "other"; }, h => { h.row.lane = "manual"; },
    h => { h.seed.planningRepairRecovery.idempotencyKey = "new-grant"; },
    h => { h.seed.planningRepairRecovery.repairKey = "new-repair"; },
    h => { h.seed.autoExecution.pipelineJobId = "new-job"; },
    h => { h.row.pendingManualRecovery = true; }, h => { h.row.status = "waiting_approval"; }]) {
    const h = fixture(); mutate(h); h.row.seedPayloadJson = JSON.stringify(h.seed);
    assert.equal(await h.stop(), true); assert.deepEqual(h.cancelled, []);
  }
});
test("cancellation can stop only the same execution and bound job", async () => {
  const h = fixture(); h.row.status = "cancelled";
  assert.equal(await h.stop(), true); assert.deepEqual(h.cancelled, ["old-job"]);
  const newer = fixture(); newer.row.status = "cancelled"; newer.seed.autoExecution.pipelineJobId = "new-job";
  newer.row.seedPayloadJson = JSON.stringify(newer.seed);
  assert.equal(await newer.stop(), true); assert.deepEqual(newer.cancelled, []);
});

const coreFilename = path.resolve(__dirname, "../src/services/novel/director/workflowStepRuntime/DirectorCoreStepModuleRuntime.ts");
const coreCode = ts.transpileModule(fs.readFileSync(coreFilename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const coreApi = {};
// All collaborators are injected; the chapter-entry method needs no live adapter.
vm.runInThisContext(`(function(require,exports){${coreCode}\n})`, { filename: coreFilename })(() => ({}), coreApi);

test("approved chapter step initializes first execution before supervision captures its identity", async () => {
  const task = { novelId: "book", lane: "auto_director", status: "waiting_approval", startedAt: null };
  const calls = [];
  const runtime = new coreApi.DirectorCoreStepModuleRuntime({
    workflowService: { getTaskByIdWithoutHealing: async () => task,
      markTaskRunning: async () => { calls.push("start"); task.startedAt = new Date(1000); task.status = "running"; } },
    autoExecutionRuntime: { runFromReady: async () => {
      assert.equal(task.status, "running"); assert.equal(task.startedAt.getTime(), 1000); calls.push("supervise");
    } },
  });
  await runtime.executeChapterDraftStep({ taskId: "task", novelId: "book", request: {} });
  await runtime.executeChapterDraftStep({ taskId: "task", novelId: "book", request: {} });
  assert.deepEqual(calls, ["start", "supervise", "supervise"]);
});

test("chapter step initialization cannot clear manual pause, cancellation or novel ownership", async () => {
  for (const state of [{ pendingManualRecovery: true }, { cancelRequestedAt: new Date() },
    { status: "cancelled" }, { novelId: "other" }, { lane: "manual" }]) {
    const task = { novelId: "book", lane: "auto_director", status: "waiting_approval", startedAt: null, ...state };
    const runtime = new coreApi.DirectorCoreStepModuleRuntime({
      workflowService: { getTaskByIdWithoutHealing: async () => task,
        markTaskRunning: async () => { throw new Error("Paused task must stay intact"); } },
      autoExecutionRuntime: { runFromReady: async () => { throw new Error("Must not supervise"); } },
    });
    await runtime.executeChapterDraftStep({ taskId: "task", novelId: "book", request: {} });
  }
});
