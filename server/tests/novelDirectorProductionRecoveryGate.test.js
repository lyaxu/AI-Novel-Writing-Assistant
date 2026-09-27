const test = require("node:test");
const assert = require("node:assert/strict");
const { NovelDirectorContinueRuntime } = require("../dist/services/novel/director/runtime/novelDirectorContinueRuntime.js");

for (const experience of [undefined, "simple", "professional"]) {
  test(`ready-asset recovery respects production choice: ${experience ?? "not selected"}`, async () => {
    const plan = experience
      ? { mode: "chapter_range", startOrder: 1, endOrder: 3, autoReview: true, autoRepair: true }
      : { mode: "book", autoReview: true, autoRepair: true };
    const seed = {
      productionExperience: experience, productionScope: experience ? "sample3" : undefined,
      retainedMarker: "keep-existing-assets",
      autoExecution: {
        enabled: true, mode: "book", startOrder: 1, endOrder: 80,
        pipelineJobId: "old-book-job", pipelineStatus: "cancelled",
        totalChapterCount: 80, remainingChapterCount: 80, nextChapterOrder: 60,
        qualityDebtSummaries: [{ chapterOrder: 1, reason: "retain" }],
        qualityLoopLedger: { retainedBudget: true },
      },
      directorInput: {
        idea: "test", candidate: { workingTitle: "test" }, runMode: "full_book_autopilot",
        autoExecutionPlan: plan, provider: "deepseek", model: "test",
      },
    };
    const checkpoints = [], runs = [], running = [], scheduled = [];
    const runtime = new NovelDirectorContinueRuntime({
      workflowService: {
        getTaskById: async () => ({
          id: "task", lane: "auto_director", novelId: "novel", status: "failed",
          currentItemKey: "chapter_list", checkpointType: null, seedPayloadJson: JSON.stringify(seed),
        }),
        recordCheckpoint: async (_id, data) => checkpoints.push(data),
        markTaskRunning: async (_id, data) => running.push(data),
      },
      directorRuntime: { initializeRun: async () => {}, recordRunResumed: async () => {} },
      continueCandidateStageTask: async () => false,
      resolveAssetFirstRecovery: async () => ({ type: "auto_execution", resumeCheckpointType: "chapter_batch_ready" }),
      buildDirectorSeedPayload: (request, novelId, extra) => ({ directorInput: request, novelId, ...extra }),
      autoExecutionRuntime: { runFromReady: async (input) => runs.push(input) },
      scheduleBackgroundRun: (_id, runner) => scheduled.push(runner),
    });
    await runtime.continueTask("task", { forceResume: true, continuationMode: "auto_execute_range" });
    if (!experience) {
      assert.equal(checkpoints.length, 1);
      assert.equal(checkpoints[0].checkpointType, "production_experience_required");
      assert.equal(checkpoints[0].seedPayload.retainedMarker, "keep-existing-assets");
      assert.equal(checkpoints[0].seedPayload.directorSession.isBackgroundRunning, false);
      assert.equal(running.length, 0);
      assert.equal(scheduled.length, 0);
    } else {
      assert.equal(checkpoints.length, 0);
      assert.equal(scheduled.length, 1);
      await scheduled[0]();
      assert.deepEqual(runs[0].request.autoExecutionPlan, plan);
      assert.equal(runs[0].existingPipelineJobId, null);
      assert.equal(runs[0].existingState.pipelineJobId, null);
      assert.equal(runs[0].existingState.mode, "chapter_range");
      assert.equal(runs[0].existingState.startOrder, 1);
      assert.equal(runs[0].existingState.endOrder, 3);
      assert.equal(runs[0].existingState.totalChapterCount, undefined);
      assert.equal(runs[0].existingState.nextChapterOrder, null);
      assert.deepEqual(runs[0].existingState.qualityDebtSummaries, seed.autoExecution.qualityDebtSummaries);
      assert.deepEqual(runs[0].existingState.qualityLoopLedger, seed.autoExecution.qualityLoopLedger);
    }
  });
}
