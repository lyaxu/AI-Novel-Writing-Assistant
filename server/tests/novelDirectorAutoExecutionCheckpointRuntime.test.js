const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recordCompletedCheckpoint,
} = require("../dist/services/novel/director/automation/novelDirectorAutoExecutionCheckpointRuntime.js");

function buildDeps() {
  const calls = [];
  return {
    calls,
    deps: {
      workflowService: {
        recordCheckpoint: async (taskId, input) => {
          calls.push({ taskId, ...input });
        },
      },
      buildDirectorSeedPayload: () => ({}),
    },
  };
}

function buildInput(mode) {
  const range = { startOrder: 1, endOrder: 3, totalChapterCount: 3, firstChapterId: "chapter-1" };
  return {
    taskId: "task-1",
    novelId: "novel-1",
    request: { candidate: { workingTitle: "示例项目" }, runMode: "full_book_autopilot" },
    range,
    autoExecution: {
      enabled: true,
      mode,
      startOrder: 1,
      endOrder: 3,
      totalChapterCount: 3,
      completedChapterCount: 3,
      remainingChapterCount: 0,
      remainingChapterIds: [],
      remainingChapterOrders: [],
      nextChapterId: null,
      nextChapterOrder: null,
      volumeChapterListComplete: false,
      pipelineJobId: "job-3",
      pipelineStatus: "succeeded",
    },
    pipelineJobId: "job-3",
    pipelineStatus: "succeeded",
  };
}

test("an explicit chapter range closes as completed instead of waiting for the next segment", async () => {
  const { deps, calls } = buildDeps();

  await recordCompletedCheckpoint(deps, buildInput("chapter_range"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].checkpointType, "workflow_completed");
  assert.match(calls[0].checkpointSummary, /第 1-3 章/);
});

test("a volume window with an incomplete beat list keeps the next-segment checkpoint", async () => {
  const { deps, calls } = buildDeps();

  await recordCompletedCheckpoint(deps, buildInput("volume"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].checkpointType, "chapter_batch_ready");
  assert.match(calls[0].checkpointSummary, /会先确认续写终点/);
  assert.match(calls[0].checkpointSummary, /第 4 章起的正文/);
  assert.match(calls[0].checkpointSummary, /不会重写已完成章节/);
  assert.match(calls[0].itemLabel, /正文已完成，等待续写后续章节$/);
});
