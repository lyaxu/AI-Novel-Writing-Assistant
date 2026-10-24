const test = require("node:test");
const assert = require("node:assert/strict");

const { mapNovelAutoDirectorTaskSummary } = require("../dist/services/task/novelWorkflowTaskSummary.js");

function buildRow(overrides = {}) {
  const autoExecution = {
    enabled: true,
    mode: "chapter_range",
    scopeLabel: "第 1-3 章",
    startOrder: 1,
    endOrder: 3,
    totalChapterCount: 3,
    completedChapterCount: 3,
    remainingChapterCount: 0,
    nextChapterId: null,
    nextChapterOrder: null,
    volumeChapterListComplete: false,
    pipelineJobId: "job-3",
    pipelineStatus: "succeeded",
  };
  return {
    id: "task-live-stop",
    status: "waiting_approval",
    pendingManualRecovery: false,
    progress: 0.98,
    currentStage: "质量修复",
    currentItemKey: "quality_repair",
    currentItemLabel: "第 1-3 章正文已完成，等待续写后续章节",
    checkpointType: "chapter_batch_ready",
    checkpointSummary: "《示例》第 1-3 章正文已完成并保留。",
    lastError: null,
    updatedAt: new Date("2026-10-24T08:24:14.000Z"),
    seedPayloadJson: JSON.stringify({
      autoExecution,
      productionExperience: "professional",
      directorInput: { autoExecutionPlan: { mode: "chapter_range", startOrder: 1, endOrder: 3 } },
    }),
    ...overrides,
  };
}

test("task summary projects a fully written window as ready to continue writing", () => {
  const task = mapNovelAutoDirectorTaskSummary(buildRow());

  assert.equal(task.awaitingNextChapterScope, true);
  assert.equal(task.displayStatus, "第 1-3 章已完成，可继续写后续章节");
  assert.equal(task.resumeAction, "继续写后续章节");
  assert.equal(task.nextActionLabel, "继续写后续章节");
  assert.match(task.blockingReason ?? "", /第 4 章起的正文/);
  assert.match(task.blockingReason ?? "", /不会重写已完成章节/);
  assert.equal(task.executionScopeLabel, "第 1-3 章");
});

test("task summary keeps the prepared-range copy while chapters are still pending", () => {
  const row = buildRow();
  const seed = JSON.parse(row.seedPayloadJson);
  seed.autoExecution.remainingChapterCount = 1;
  seed.autoExecution.completedChapterCount = 2;
  seed.autoExecution.nextChapterOrder = 3;
  row.seedPayloadJson = JSON.stringify(seed);

  const task = mapNovelAutoDirectorTaskSummary(row);

  assert.equal(task.awaitingNextChapterScope, false);
  assert.equal(task.displayStatus, "第 1-3 章已可进入章节执行");
  assert.equal(task.resumeAction, "继续自动执行第 1-3 章");
  assert.equal(task.nextActionLabel, "进入已准备章节");
});

test("task summary keeps workflow completion copy when the volume chapter list is complete", () => {
  const row = buildRow();
  const seed = JSON.parse(row.seedPayloadJson);
  seed.autoExecution.volumeChapterListComplete = true;
  row.seedPayloadJson = JSON.stringify(seed);

  const task = mapNovelAutoDirectorTaskSummary(row);

  assert.equal(task.awaitingNextChapterScope, false);
  assert.equal(task.resumeAction, "继续自动执行第 1-3 章");
  assert.equal(task.nextActionLabel, "进入已准备章节");
});
