const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const core = loadRuntimeSource("../director/automation/novelDirectorAutoExecution.ts", {
  "@ai-novel/shared/types/chapterLengthControl": require("@ai-novel/shared/types/chapterLengthControl"),
  "../../pipelineJobState": {},
  "../../production/ChapterExecutionStageRunner": {},
  "./novelDirectorAutoExecutionFailure": {},
});
class ProductionError extends Error { constructor(code, message) { super(message); this.code = code; } }

for (const resumedStatus of ["failed", "cancelled", "succeeded"]) test(`explicit director resume keeps original job when service returns ${resumedStatus}`, async () => {
  const calls = [];
  let resumed = false;
  const range = { startOrder: 1, endOrder: 3, totalChapterCount: 3, firstChapterId: "chapter" };
  const state = { mode: "chapter_range", startOrder: 1, endOrder: 3, pipelineJobId: "original", enabled: true,
    totalChapterCount: 3, completedChapterCount: 3, remainingChapterCount: 0,
    remainingChapterOrders: [], remainingChapterIds: [], nextChapterOrder: null, nextChapterId: null };
  const { NovelDirectorAutoExecutionRuntime } = loadRuntimeSource("../director/automation/novelDirectorAutoExecutionRuntime.ts", {
    "@ai-novel/shared/types/novelDirector": { isFullBookAutopilotRunMode: () => true },
    "./novelDirectorAutoExecution": core,
    "./novelDirectorAutoExecutionCheckpointRuntime": { syncAutoExecutionTaskState: async () => {}, recordCompletedCheckpoint: async () => calls.push("completed") },
    "./novelDirectorAutoExecutionFailure": {},
    "./novelDirectorAutoExecutionCircuitBreakerRuntime": { isDirectorCircuitBreakerOpen: () => false },
    "./novelDirectorAutoExecutionRuntimeUtils": { resolveSingleChapterExecutionRange: () => ({ startOrder: 1, endOrder: 1 }) },
    "./novelDirectorAutoExecutionRuntimePreparation": { restoreAutoExecutionBookRequest: request => request,
      readAutoExecutionIdentity: async () => ({}), shouldStopAutoExecution: async () => false,
      prepareRequestedAutoExecution: async () => ({ range, autoExecution: state, pipelineJobId: "original" }),
      resolveAutoExecutionRuntimeRangeAndState: async () => ({ range, autoExecution: state }) },
    "../../../../db/prisma": { prisma: { novelWorkflowTask: { findUnique: async () => null } } },
    "../../production/reliability": { ChapterProductionError: ProductionError },
  });
  const runtime = new NovelDirectorAutoExecutionRuntime({ novelService: {
    getPipelineJobById: async () => ({ id: "original", status: resumed ? resumedStatus : "failed", pendingManualRecovery: !resumed }),
    resumePipelineJob: async (...args) => { calls.push(args); resumed = true; },
    startPipelineJob: async () => assert.fail("never replace a failed paused original task"),
    findActivePipelineJobForRange: async () => null,
  } });
  const run = () => runtime.runFromReady({ taskId: "director", novelId: "novel", request: {}, resumePendingManualRecovery: true });
  if (resumedStatus === "succeeded") await run();
  else await assert.rejects(run(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.deepEqual(calls[0], ["original", { novelId: "novel", directorTaskId: "director" }]);
  assert.deepEqual(calls.slice(1), resumedStatus === "succeeded" ? ["completed"] : []);
});
