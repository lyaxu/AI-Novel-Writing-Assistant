const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWorkflowExplainability } = require("../dist/services/task/novelWorkflowExplainability.js");

test("workflow explainability exposes chapter-batch readiness for the default 1-10 range", () => {
  const result = buildWorkflowExplainability({
    status: "waiting_approval",
    currentStage: "chapter_execution",
    currentItemKey: "chapter_execution",
    checkpointType: "chapter_batch_ready",
    lastError: null,
  });

  assert.match(result.displayStatus, /1-10/);
  assert.match(result.resumeAction, /1-10/);
  assert.ok(result.blockingReason?.includes("1-10"));
  assert.equal(result.lastHealthyStage, "节奏 / 拆章");
});

test("workflow explainability exposes recovery guidance for a failed chapter batch", () => {
  const result = buildWorkflowExplainability({
    status: "failed",
    currentStage: "quality_repair",
    currentItemKey: "quality_repair",
    checkpointType: "chapter_batch_ready",
    lastError: "chapter 3 still needs repair",
  });

  assert.match(result.displayStatus, /1-10/);
  assert.match(result.resumeAction, /1-10/);
  assert.equal(result.lastHealthyStage, "章节执行");
  assert.ok(result.blockingReason);
});

test("workflow explainability uses the actual chapter range scope", () => {
  const result = buildWorkflowExplainability({
    status: "waiting_approval",
    currentStage: "chapter_execution",
    currentItemKey: "chapter_execution",
    checkpointType: "chapter_batch_ready",
    executionScopeLabel: "第 11-20 章",
    lastError: null,
  });

  assert.match(result.displayStatus, /11-20/);
  assert.match(result.resumeAction, /11-20/);
  assert.ok(result.blockingReason?.includes("11-20"));
});

test("workflow explainability keeps a fully written window distinct from a prepared range", () => {
  const result = buildWorkflowExplainability({
    status: "waiting_approval",
    currentStage: "质量修复",
    currentItemKey: "quality_repair",
    checkpointType: "chapter_batch_ready",
    checkpointSummary: "旧摘要",
    executionScopeLabel: "第 1-3 章",
    autoExecution: {
      enabled: true,
      mode: "chapter_range",
      startOrder: 1,
      endOrder: 3,
      totalChapterCount: 3,
      completedChapterCount: 3,
      remainingChapterCount: 0,
      volumeChapterListComplete: false,
      pipelineJobId: "job-3",
      pipelineStatus: "succeeded",
    },
  });

  assert.equal(result.displayStatus, "第 1-3 章已完成，可继续写后续章节");
  assert.equal(result.resumeAction, "继续写后续章节");
  assert.ok(result.blockingReason?.includes("会先确认续写终点"));
  assert.ok(result.blockingReason?.includes("第 4 章起的正文"));
  assert.ok(result.blockingReason?.includes("不会重写已完成章节"));
  assert.equal(result.lastHealthyStage, "章节执行");
});

test("workflow explainability keeps the continuation entry after the range is closed", () => {
  const result = buildWorkflowExplainability({
    status: "succeeded",
    currentStage: "质量修复",
    currentItemKey: "quality_repair",
    checkpointType: "workflow_completed",
    executionScopeLabel: "第 1-3 章",
    autoExecution: {
      enabled: true,
      mode: "chapter_range",
      startOrder: 1,
      endOrder: 3,
      totalChapterCount: 3,
      completedChapterCount: 3,
      remainingChapterCount: 0,
      volumeChapterListComplete: false,
      pipelineJobId: "job-3",
      pipelineStatus: "succeeded",
    },
  });

  assert.equal(result.displayStatus, "第 1-3 章已完成，可继续写后续章节");
  assert.equal(result.resumeAction, "继续写后续章节");
  assert.equal(result.blockingReason, null);
  assert.equal(result.lastHealthyStage, "章节执行");
});

test("workflow explainability keeps the generic completed copy when no next scope is pending", () => {
  const result = buildWorkflowExplainability({
    status: "succeeded",
    checkpointType: "workflow_completed",
    executionScopeLabel: "全书",
    autoExecution: {
      enabled: true,
      mode: "book",
      startOrder: 1,
      endOrder: 80,
      totalChapterCount: 80,
      completedChapterCount: 80,
      remainingChapterCount: 0,
      volumeChapterListComplete: true,
    },
  });

  assert.equal(result.displayStatus, "自动导演已完成");
  assert.equal(result.resumeAction, "进入章节执行");
});

test("workflow explainability only applies continuation copy when the batch completion state matches", () => {
  const prepared = buildWorkflowExplainability({
    status: "waiting_approval",
    checkpointType: "chapter_batch_ready",
    executionScopeLabel: "第 1-3 章",
    autoExecution: {
      enabled: true,
      mode: "chapter_range",
      startOrder: 1,
      endOrder: 3,
      totalChapterCount: 3,
      completedChapterCount: 2,
      remainingChapterCount: 1,
      volumeChapterListComplete: false,
    },
  });
  assert.equal(prepared.displayStatus, "第 1-3 章已可进入章节执行");
  assert.equal(prepared.resumeAction, "继续自动执行第 1-3 章");

  const answered = buildWorkflowExplainability({
    status: "waiting_approval",
    checkpointType: "chapter_batch_ready",
    executionScopeLabel: "第 1-3 章",
    autoExecution: {
      enabled: true,
      mode: "chapter_range",
      startOrder: 1,
      endOrder: 3,
      totalChapterCount: 3,
      completedChapterCount: 3,
      remainingChapterCount: 0,
      volumeChapterListComplete: true,
    },
  });
  assert.equal(answered.resumeAction, "继续自动执行第 1-3 章");
  assert.notEqual(answered.displayStatus, "第 1-3 章已完成，可继续写后续章节");
});

test("workflow explainability treats restart recovery as recovery-in-progress", () => {
  const result = buildWorkflowExplainability({
    status: "running",
    currentStage: "节奏 / 拆章",
    currentItemKey: "beat_sheet",
    checkpointType: null,
    lastError: "service restarted and recovery is in progress",
  });

  assert.equal(result.displayStatus, "节奏 / 拆章进行中");
  assert.equal(result.resumeAction, "查看当前进度");
  assert.equal(result.lastHealthyStage, "节奏 / 拆章");
  assert.equal(result.blockingReason, null);
});
