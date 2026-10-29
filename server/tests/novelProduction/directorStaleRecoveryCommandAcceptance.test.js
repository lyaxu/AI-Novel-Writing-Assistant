const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

// Explicit continue acceptance: a stale displaced job pointer is converged before the strict
// chapter preflight decides anything. The preflight still owns the safety decision.
function fixture({ convergenceChanged = true } = {}) {
  const calls = [];
  const seed = { autoExecution: { pipelineJobId: "displaced-job", pipelineStatus: "failed" } };
  const row = {
    id: "director", novelId: "novel", lane: "auto_director", status: "queued", pendingManualRecovery: true,
    updatedAt: new Date(1000), cancelRequestedAt: null, seedPayloadJson: JSON.stringify(seed),
    checkpointType: "chapter_batch_ready", currentItemKey: "quality_repair",
    lastError: "章节正文、执行约定或执行所有权已变化，已停止写入，请回到章节工作区核对。",
  };
  class AppError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const expected = {
    kind: "paused", novelId: "novel", chapterId: "chapter-5",
    updatedAt: new Date(900), payload: JSON.stringify({ workflowTaskId: "director" }),
  };
  const tx = {
    generationJob: { findFirst: async () => ({ id: "original-job" }) },
    novelWorkflowTask: { updateMany: async (query) => { calls.push(["task-cas", query]); return { count: 1 }; } },
    directorRunCommand: { create: async (query) => { calls.push(["create", query]); return { id: "command", ...query.data }; } },
  };
  const { DirectorCommandService } = loadRuntimeSource("../director/commands/DirectorCommandService.ts", {
    "../workflowStepRuntime/directorWorkflowStepIds": require("../../dist/services/novel/director/workflowStepRuntime/directorWorkflowStepIds"),
    "@ai-novel/shared/types/novelFraming": {},
    "../../../../db/prisma": { prisma: {
      directorRunCommand: {
        findFirst: async () => null,
        create: async (query) => { calls.push(["create-outside-transaction", query]); return { id: "command", ...query.data }; },
      },
      novelWorkflowTask: { updateMany: async (query) => { calls.push(["task-accepted", query]); return { count: 1 }; } },
      $transaction: async fn => fn(tx),
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
    "@ai-novel/shared/types/planningRepair/recovery": {},
    "../../production/recovery": {
      assertUnchangedPipelineRecoveryScope: () => {},
      createChapterPipelineRecoveryService: () => ({ prepareDirectorContinuation: async (jobId, request) => {
        calls.push(["preflight", jobId, request]); return expected;
      } }),
    },
    "../recovery/DirectorRecoveryConvergenceService": { createDirectorRecoveryConvergenceService: () => ({
      converge: async (input) => {
        calls.push(["converge", input]);
        if (!convergenceChanged) return { changed: false, actions: [] };
        // The application service re-points the seed at the journal-owning original job.
        row.seedPayloadJson = JSON.stringify({ autoExecution: { pipelineJobId: "original-job", pipelineStatus: "failed" } });
        return { changed: true, actions: ["repointed_displaced_pipeline_job"] };
      },
    }) },
    "../../novelCoreShared": { logPipelineWarn: () => {} },
  });
  const workflowService = {
    getTaskById: async () => row,
    getTaskByIdWithoutHealing: async () => row,
  };
  const service = new DirectorCommandService(workflowService);
  service.recoverStaleLeases = async () => 0;
  return { service, row, calls };
}

test("converged stale recovery state is re-read before the chapter preflight", async () => {
  const f = fixture();
  await f.service.enqueueContinueCommand("director", { forceResume: true });
  const converge = f.calls.find(([name]) => name === "converge");
  assert.deepEqual(converge[1], {
    taskId: "director", trigger: "director_command:continue", preservePlanningRepairSession: false,
  });
  const preflight = f.calls.find(([name]) => name === "preflight");
  assert.equal(preflight[1], "original-job", "preflight must use the reconciled original job pointer");
  assert.equal(preflight[2].directorTaskId, "director");
  assert.equal(f.calls.some(([name]) => name === "create"), true);
  assert.equal(f.calls.some(([name]) => name === "notify"), true);
});

test("an explicit planning repair authorization preserves the repair session during convergence", async () => {
  const f = fixture();
  await f.service.enqueueContinueCommand("director", {
    forceResume: true,
    planningRepairRecoveryKey: "repair-key",
  });
  const converge = f.calls.find(([name]) => name === "converge");
  assert.equal(converge[1].preservePlanningRepairSession, true);
});

test("without a convergence the original displaced pointer keeps the strict preflight path", async () => {
  const f = fixture({ convergenceChanged: false });
  await f.service.enqueueContinueCommand("director", { forceResume: true });
  const preflight = f.calls.find(([name]) => name === "preflight");
  assert.equal(preflight[1], "displaced-job");
});
