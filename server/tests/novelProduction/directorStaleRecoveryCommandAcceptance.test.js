const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

// Explicit continue acceptance: a stale displaced job pointer is converged before the strict
// chapter preflight decides anything. The preflight still owns the safety decision.
function fixture({ convergenceChanged = true, convergeMode = "repoint" } = {}) {
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
        if (convergeMode === "rebuilt") {
          // Adoption + execution rebuild clears the dead binding and points at the first chapter.
          row.seedPayloadJson = JSON.stringify({
            autoExecution: {
              pipelineJobId: null, pipelineStatus: null,
              nextChapterId: "chapter-1", nextChapterOrder: 1,
              startOrder: 1, endOrder: 3,
            },
            planningRepairExecutionRebuild: { version: 1, action: "rebuild_execution", previousJobId: "old-job" },
          });
          return { changed: true, actions: ["adopted_planning_repair_candidate", "rebuilt_stale_plan_repair_execution"] };
        }
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

test("a rebuilt missing-anchor binding clears the pause without the chapter preflight", async () => {
  const f = fixture({ convergeMode: "rebuilt" });
  await f.service.enqueueContinueCommand("director", { forceResume: true });
  assert.equal(f.calls.some(([name]) => name === "preflight"), false, "no anchor error after the rebuild");
  assert.equal(f.calls.some(([name]) => name === "task-cas"), false, "there is no paused job left to confirm");
  const command = f.calls.find(([name]) => name === "create-outside-transaction")[1].data;
  assert.equal(command.commandType, "continue");
  assert.equal(JSON.parse(command.payloadJson).forceResume, true);
  const accepted = f.calls.find(([name]) => name === "task-accepted")[1];
  assert.equal(accepted.data.pendingManualRecovery, false);
  const seed = JSON.parse(f.row.seedPayloadJson);
  assert.equal(seed.autoExecution.pipelineJobId, null);
  assert.equal(seed.autoExecution.nextChapterId, "chapter-1");
});

test("task recovery resume entry uses the same convergence and reaches the rebuilt first chapter", async () => {
  const f = fixture({ convergeMode: "rebuilt" });
  await f.service.enqueueRecoveryCommand("director", {});
  const converge = f.calls.find(([name]) => name === "converge");
  assert.equal(converge[1].trigger, "director_command:resume_from_checkpoint");
  assert.equal(f.calls.some(([name]) => name === "preflight"), false);
  const command = f.calls.find(([name]) => name === "create-outside-transaction")[1].data;
  assert.equal(command.commandType, "resume_from_checkpoint");
  assert.equal(JSON.parse(command.payloadJson).forceResume, true);
  assert.equal(JSON.parse(f.row.seedPayloadJson).autoExecution.nextChapterOrder, 1);
});
