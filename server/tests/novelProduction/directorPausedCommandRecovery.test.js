const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const scope = loadRuntimeSource("../production/recovery/ChapterPipelineRecoveryService.ts", { "../reliability": { ChapterProductionError: class extends Error {} } });

function fixture({ preflightFails = false, taskCasFails = false, jobCasFails = false, completed = false } = {}) {
  const calls = [];
  const row = { id: "director", novelId: "novel", lane: "auto_director", status: "queued", pendingManualRecovery: true,
    updatedAt: new Date(1000), cancelRequestedAt: null, seedPayloadJson: JSON.stringify({ autoExecution: { pipelineJobId: "original" } }) };
  const expected = { kind: completed ? "completed" : "paused", novelId: "novel", chapterId: completed ? null : "chapter", updatedAt: new Date(900), payload: '{"workflowTaskId":"director"}' };
  class AppError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const tx = {
    generationJob: { findFirst: async query => { calls.push(["job-cas", query]); return jobCasFails ? null : { id: "original" }; } },
    novelWorkflowTask: { updateMany: async query => { calls.push(["task-cas", query]); return { count: taskCasFails ? 0 : 1 }; } },
    directorRunCommand: { create: async query => { calls.push(["create", query]); return { id: "command", ...query.data }; } },
  };
  const { DirectorCommandService } = loadRuntimeSource("../director/commands/DirectorCommandService.ts", {
    "../workflowStepRuntime/directorWorkflowStepIds": require("../../dist/services/novel/director/workflowStepRuntime/directorWorkflowStepIds"),
    "@ai-novel/shared/types/novelFraming": {},
    "../../../../db/prisma": { prisma: {
      directorRunCommand: { findFirst: async () => null, create: async () => assert.fail("must create inside transaction") },
      novelWorkflowTask: { updateMany: async () => assert.fail("must preserve task CAS") },
      $transaction: async fn => { calls.push(["transaction"]); return fn(tx); },
    } },
    "../../../../db/sqliteRetry": { withSqliteRetry: fn => fn() },
    "../../../../middleware/errorHandler": { AppError }, "../../workflow/NovelWorkflowService": {},
    "../runtime/novelDirectorHelpers": {}, "../../workflow/novelWorkflow.shared": { parseSeedPayload: JSON.parse },
    "./DirectorCommandServiceHelpers": { buildAcceptedTaskState: () => ({ currentStage: "queued" }),
      hashPayload: () => "hash", stableJson: JSON.stringify, isUniqueConstraintError: () => false, toAcceptedResponse: value => value },
    "../../../../workers/TaskDispatcher": { taskDispatcher: { notify: () => calls.push(["notify"]) } },
    "./leases/DirectorCommandLeaseService": {},
    "../recovery/planningRepair/planningRepairRecovery": { assertPlanningRepairResumeAllowed: () => {} },
    "../recovery/rangeCompletion": {},
    "../recovery/DirectorRecoveryConvergenceService": { createDirectorRecoveryConvergenceService: () => ({ converge: async () => ({ changed: false, actions: [] }) }) },
    "../../novelCoreShared": { logPipelineWarn: () => {} },
    "@ai-novel/shared/types/planningRepair/recovery": {},
    "../../production/recovery": { assertUnchangedPipelineRecoveryScope: scope.assertUnchangedPipelineRecoveryScope, createChapterPipelineRecoveryService: () => ({ prepareDirectorContinuation: async (...args) => {
      calls.push(["preflight", ...args]); if (preflightFails) throw new AppError("unknown or changed manuscript", 409); return expected;
    } }) },
  });
  const service = new DirectorCommandService({ getTaskById: async () => row });
  service.recoverStaleLeases = async () => 0;
  return { service, row, expected, calls };
}

test("director command checks original saved execution before clearing task pause, atomically accepts command", async () => {
  const f = fixture();
  await f.service.enqueueContinueCommand("director", { forceResume: true });
  assert.deepEqual(f.calls.map(c => c[0]), ["preflight", "transaction", "job-cas", "task-cas", "create", "notify"]);
  assert.deepEqual(f.calls[0].slice(1), ["original", { novelId: "novel", directorTaskId: "director" }]);
  const jobWhere = f.calls.find(c => c[0] === "job-cas")[1].where;
  assert.equal(jobWhere.updatedAt, f.expected.updatedAt); assert.equal(jobWhere.currentItemKey, "chapter");
  const taskMutation = f.calls.find(c => c[0] === "task-cas")[1];
  assert.equal(taskMutation.where.updatedAt, f.row.updatedAt); assert.equal(taskMutation.where.cancelRequestedAt, null);
  assert.equal(taskMutation.data.cancelRequestedAt, undefined);
  assert.equal(taskMutation.data.pendingManualRecovery, false);
});

for (const failure of [null, "taskCasFails", "jobCasFails"]) test(`between-chapter continuation checks succeeded job and task atomically: ${failure ?? "accepted"}`, async () => {
  const f = fixture({ completed: true, ...(failure ? { [failure]: true } : {}) });
  const run = () => f.service.enqueueContinueCommand("director", { forceResume: true });
  if (failure) await assert.rejects(run(), { status: 409 });
  else await run();
  const where = f.calls.find(c => c[0] === "job-cas")[1].where;
  assert.equal(where.status, "succeeded");
  assert.equal(where.pendingManualRecovery, false);
  assert.equal(where.currentItemKey, null);
  assert.equal(where.cancelRequestedAt, null);
  assert.equal(where.payload, f.expected.payload);
  assert.equal(where.updatedAt, f.expected.updatedAt);
  assert.equal(f.calls.some(c => c[0] === "create"), !failure);
  assert.equal(f.calls.some(c => c[0] === "notify"), !failure);
});

for (const reason of ["preflightFails", "taskCasFails", "jobCasFails"]) test(`director command cannot queue on ${reason}`, async () => {
  const f = fixture({ [reason]: true });
  await assert.rejects(f.service.enqueueContinueCommand("director", { forceResume: true }), { status: 409 });
  assert.equal(f.calls.some(c => c[0] === "create" || c[0] === "notify"), false);
  if (reason === "preflightFails") assert.equal(f.calls.some(c => c[0] === "transaction"), false);
});

test("director command requires explicit recovery confirmation and does not clear cancellation", async () => {
  const f = fixture();
  await assert.rejects(f.service.enqueueContinueCommand("director"), { status: 409 });
  f.row.cancelRequestedAt = new Date();
  await assert.rejects(f.service.enqueueContinueCommand("director", { forceResume: true }), { status: 409 });
  assert.equal(f.calls.length, 0);
});

test("paused task scope is frozen even when its pipeline status projection says running", async () => {
  const f = fixture();
  f.row.seedPayloadJson = JSON.stringify({ autoExecution: { pipelineJobId: "original", pipelineStatus: "running", mode: "chapter_range", startOrder: 1, endOrder: 3 },
    directorInput: { autoExecutionPlan: { mode: "chapter_range", startOrder: 1, endOrder: 10 } } });
  await assert.rejects(f.service.enqueueContinueCommand("director", { forceResume: true }));
  assert.equal(f.calls.length, 0);
});

for (const continuationMode of ["resume", "auto_execute_range"]) test(`source workflow ${continuationMode} HTTP action injects explicit authorization`, async () => {
  const f = fixture();
  const routes = [];
  loadRuntimeSource("../director/http/novelWorkflows.ts", {
    express: { Router: () => ({ use() {}, get() {}, post: (...args) => routes.push(args) }) }, zod: require("zod"),
    "../../../../middleware/auth": {}, "../../../../middleware/validate": { validate: schema => schema },
    "../commands/DirectorCommandService": { DirectorCommandService: class { constructor() { return f.service; } } },
    "../commands/DirectorProductionExperienceService": { DirectorProductionExperienceService: class {} },
    "../../workflow/NovelWorkflowService": { NovelWorkflowService: class {} },
    "../../../task/adapters/NovelWorkflowTaskAdapter": { NovelWorkflowTaskAdapter: class {} },
    "./planningRepairRoutes": { createPlanningRepairRouter: () => ({}) },
  });
  const route = routes.find(r => r[0] === "/:id/continue");
  let response, error, status;
  await route.at(-1)({ params: { id: "director" }, body: { continuationMode } },
    { status: value => { status = value; return { json: value => { response = value; } }; } }, value => { error = value; });
  assert.equal(error, undefined); assert.equal(status, 202); assert.equal(response.success, true);
  const acceptedPayload = JSON.parse(f.calls.find(c => c[0] === "create")[1].data.payloadJson);
  assert.equal(acceptedPayload.forceResume, true);
  assert.equal(acceptedPayload.continuationMode, continuationMode);
});
