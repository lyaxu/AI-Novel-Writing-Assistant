const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function source(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${js}\n})`, { filename })(name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return exports;
}
class AppError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const policy = source("../../shared/types/planningRepair/recovery.ts", {});
const recovery = source("../src/services/novel/director/recovery/planningRepair/planningRepairRecovery.ts", {
  "../../../../../middleware/errorHandler": { AppError }, "@ai-novel/shared/types/planningRepair/recovery": policy,
});
function fixture() {
  const seed = { planningRepair: { version: 1, key: "repair", phase: "reviewing", maxRounds: 3 },
    planningRepairRecovery: { repairKey: "repair", idempotencyKey: "grant" }, autoExecution: { pipelineJobId: "job" } };
  const row = { id: "task", lane: "auto_director", novelId: "book", status: "queued", pendingManualRecovery: false };
  const job = { id: "job", novelId: "book", status: "queued", pendingManualRecovery: true,
    payload: JSON.stringify({ workflowTaskId: "task" }), executionOwner: null, executionLeaseExpiresAt: null };
  const commands = [];
  const match = (c, w) => (!w.taskId || c.taskId === w.taskId)
    && (!w.idempotencyKey || c.idempotencyKey === w.idempotencyKey)
    && (!w.status || w.status.in.includes(c.status))
    && (!w.OR || w.OR.some(x => typeof x.idempotencyKey === "string" ? c.idempotencyKey === x.idempotencyKey
      : c.idempotencyKey.startsWith(x.idempotencyKey.startsWith)));
  const prisma = { directorRunCommand: {
    findFirst: async ({ where }) => commands.filter(c => match(c, where)).at(-1) ?? null,
    create: async ({ data }) => {
      if (commands.some(c => c.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      const command = { ...data, id: `command-${commands.length + 1}` }; commands.push(command); return command;
    },
  }, generationJob: { findUnique: async () => job }, novelWorkflowTask: { updateMany: async () => {} } };
  const { DirectorCommandService } = source("../src/services/novel/director/commands/DirectorCommandService.ts", {
    "@ai-novel/shared/types/novelFraming": {}, "../../../../db/prisma": { prisma },
    "../../../../db/sqliteRetry": { withSqliteRetry: fn => fn() }, "../../../../middleware/errorHandler": { AppError },
    "../../workflow/NovelWorkflowService": {}, "../runtime/novelDirectorHelpers": {},
    "../../workflow/novelWorkflow.shared": { parseSeedPayload: json => JSON.parse(json || "{}") },
    "./DirectorCommandServiceHelpers": { hashPayload: () => "fingerprint", parsePayload: json => JSON.parse(json || "{}"),
      toAcceptedResponse: c => ({ commandId: c.id }), stableJson: JSON.stringify, buildAcceptedTaskState: () => ({}),
      isUniqueConstraintError: error => error.code === "P2002" },
    "../../../../workers/TaskDispatcher": { taskDispatcher: { notify() {} } }, "./leases/DirectorCommandLeaseService": {},
    "../recovery/planningRepair/planningRepairRecovery": recovery,
    "@ai-novel/shared/types/planningRepair/recovery": policy,
  });
  const read = async () => ({ ...row, seedPayloadJson: JSON.stringify(seed) });
  const service = new DirectorCommandService({ getTaskByIdWithoutHealing: read, getTaskById: read });
  service.recoverStaleLeases = async () => 0;
  const dispatch = (repairKey = "repair") => service.enqueuePlanningRepairRecoveryCommand("task", repairKey, "grant");
  return { seed, row, job, commands, dispatch };
}
test("canonical retries reuse active work; terminal paused retries dispatch once without changing authorization", async () => {
  const f = fixture(); const before = JSON.stringify(f.seed);
  const first = await f.dispatch(); assert.deepEqual(await f.dispatch(), first);
  f.commands[0].status = "succeeded";
  const next = await Promise.all([f.dispatch(), f.dispatch()]);
  assert.deepEqual(next[0], next[1]); assert.notDeepEqual(next[0], first);
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[1].idempotencyKey, "planning_repair:fingerprint:after:command-1");
  assert.equal(f.commands[0].status, "succeeded"); assert.equal(JSON.stringify(f.seed), before);
});
test("wrong repair, unknown operations, pending grant and cancellation cannot replay or redispatch", async () => {
  for (const patch of [f => { f.requestRepairKey = "wrong"; }, f => { f.seed.planningRepair.pendingOperation = {}; },
    f => { f.seed.planningRepairRecovery.pendingGrant = true; }, f => { f.row.status = "cancelled"; }]) {
    const f = fixture(); await f.dispatch(); f.commands[0].status = "succeeded"; patch(f);
    await assert.rejects(f.dispatch(f.requestRepairKey || "repair"), { statusCode: 409 });
    assert.equal(f.commands.length, 1);
  }
});
test("a paused task can redispatch without a job, but another active operation prevents it", async () => {
  const f = fixture(); const first = await f.dispatch(); f.commands[0].status = "succeeded";
  f.seed.autoExecution.pipelineJobId = null; f.row.status = "waiting_approval";
  f.commands.push({ id: "other", taskId: "task", status: "running", idempotencyKey: "other", payloadJson: "{}" });
  await assert.rejects(f.dispatch(), { statusCode: 409 });
  f.commands.pop(); assert.notDeepEqual(await f.dispatch(), first);
});
test("live or unrelated pipeline and committed repair cannot authorize another dispatch", async () => {
  for (const patch of [f => { f.job.pendingManualRecovery = false; }, f => { f.job.executionOwner = "worker"; },
    f => { f.job.executionLeaseExpiresAt = new Date(); }, f => { f.job.payload = "{}"; },
    f => { f.seed.planningRepair.phase = "committed"; }]) {
    const f = fixture(); const first = await f.dispatch(); f.commands[0].status = "succeeded"; patch(f);
    assert.deepEqual(await f.dispatch(), first); assert.equal(f.commands.length, 1);
  }
});
