const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => mocks[name] ?? {}, exports);
  return exports;
}
let job; const writes = [];
const prisma = { generationJob: { findUnique: async () => job },
  novelWorkflowTask: { update: async (args) => { writes.push(args); return args.data; } } };
const parseSeedPayload = text => text ? JSON.parse(text) : null;
const reconciliation = load("../src/services/novel/workflow/novelWorkflowAutoDirectorReconciliation.ts", {
  "../../../db/prisma": { prisma }, "../../../db/sqliteRetry": { withSqliteRetry: fn => fn() },
  "./novelWorkflow.shared": { parseSeedPayload },
});
const { NovelWorkflowHealingService } = load("../src/services/novel/workflow/NovelWorkflowHealingService.ts", {
  "../../../db/prisma": { prisma }, "./novelWorkflowAutoDirectorReconciliation": reconciliation,
  "./novelWorkflow.shared": { parseSeedPayload },
  "./novelWorkflow.helpers": { isTaskCancellationRequested: row => Boolean(row?.cancelRequestedAt),
    isHistoricalAutoDirectorFront10RecoveryUnsupportedFailure: () => true },
});
function row() {
  return { id: "task", lane: "auto_director", novelId: "novel", status: "waiting_approval", pendingManualRecovery: false,
    checkpointType: "production_experience_required", checkpointSummary: "选择本次执行方式", lastError: "保留真实停点",
    heartbeatAt: new Date("2026-10-01T05:07:31Z"), seedPayloadJson: JSON.stringify({
      directorSession: { phase: "chapter_execution", isBackgroundRunning: false },
      autoExecution: { mode: "range", pipelineJobId: "job", startOrder: 3, endOrder: 3 },
    }) };
}
function pipeline(overrides = {}) {
  return { id: "job", novelId: "novel", status: "queued", pendingManualRecovery: true,
    cancelRequestedAt: null, payload: JSON.stringify({ workflowTaskId: "task" }), ...overrides };
}
test("repeated read synchronization cannot clear a checkpoint or fabricate a heartbeat from a paused or cancelling job", async () => {
  for (const patch of [{}, { pendingManualRecovery: false, cancelRequestedAt: new Date() }]) {
    job = pipeline(patch); writes.length = 0;
    const task = row(); const before = structuredClone(task);
    for (let i = 0; i < 3; i++) {
      assert.equal(await reconciliation.resolveActiveAutoDirectorAutoExecution({ taskId: "task", row: task }), null);
      assert.deepEqual(await reconciliation.syncActiveAutoDirectorAutoExecutionTaskState({ taskId: "task", row: task }), { active: false, healed: false });
    }
    assert.deepEqual(task, before); assert.equal(writes.length, 0);
  }
});
test("GET healing stops before all legacy and stale write paths when the linked batch is paused", async () => {
  job = pipeline(); writes.length = 0; const task = row();
  const service = new NovelWorkflowHealingService({ getTaskByIdWithoutHealing: async () => task });
  service.healBrokenAutoDirectorCandidateSeedPayload = async () => { throw new Error("must not enter write healing"); };
  assert.equal(await service.healAutoDirectorTaskState("task", task), false);
  assert.equal(await service.healAutoDirectorTaskState("task"), false);
  assert.equal(writes.length, 0);
});
test("historical recovery also rejects paused, cancelled and foreign jobs instead of projecting activity", async () => {
  const task = row();
  const service = new NovelWorkflowHealingService({ getTaskByIdWithoutHealing: async () => task,
    updateTaskWithRetry: async args => writes.push(args) });
  for (const patch of [{}, { pendingManualRecovery: false, cancelRequestedAt: new Date() },
    { pendingManualRecovery: false, novelId: "other" },
    { pendingManualRecovery: false, payload: JSON.stringify({ workflowTaskId: "another-task" }) }]) {
    job = pipeline(patch); writes.length = 0;
    assert.equal(await service.healHistoricalAutoDirectorFront10RecoveryFailure("task", task), false);
    assert.equal(await reconciliation.resolveActiveAutoDirectorAutoExecution({ taskId: "task", row: task }), null);
    assert.equal(writes.length, 0);
  }
});
test("a legacy job without task metadata still requires matching novel and preserves the pause", async () => {
  job = pipeline({ payload: "{}" });
  assert.equal(await reconciliation.hasPausedAutoDirectorPipelineJob("task", row()), true);
  job = pipeline({ novelId: "other" });
  assert.equal(await reconciliation.hasPausedAutoDirectorPipelineJob("task", row()), false);
});
