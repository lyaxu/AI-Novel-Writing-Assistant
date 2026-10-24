import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContinueAutoExecutionActionLabel,
  buildTakeoverDescription,
  buildTakeoverTitle,
  formatTakeoverCheckpoint,
  isTaskAwaitingNextChapterScope,
} from "../src/pages/novels/novelEditTakeover.shared.ts";

function buildTask(overrides = {}) {
  return {
    id: "task-1",
    status: "waiting_approval",
    checkpointType: "chapter_batch_ready",
    awaitingNextChapterScope: true,
    meta: {
      seedPayload: {
        autoExecution: {
          scopeLabel: "第 1-3 章",
          startOrder: 1,
          endOrder: 3,
          totalChapterCount: 3,
          completedChapterCount: 3,
          remainingChapterCount: 0,
          volumeChapterListComplete: false,
        },
      },
    },
    ...overrides,
  };
}

test("takeover card describes the written window and the confirmed continuation endpoint", () => {
  const title = buildTakeoverTitle({
    mode: "waiting",
    novelTitle: "示例书",
    checkpointType: "chapter_batch_ready",
    scopeLabel: "第 1-3 章",
    awaitingNextChapterScope: true,
  });
  const description = buildTakeoverDescription({
    mode: "waiting",
    checkpointType: "chapter_batch_ready",
    reviewScope: null,
    scopeLabel: "第 1-3 章",
    awaitingNextChapterScope: true,
  });

  assert.match(title, /第 1-3 章正文已完成/);
  assert.match(description, /会先确认续写终点/);
  assert.match(description, /不会重写已完成章节/);
  assert.match(description, /生成后续章节正文/);
});

test("takeover card keeps the prepared-range copy before the window is written", () => {
  const description = buildTakeoverDescription({
    mode: "waiting",
    checkpointType: "chapter_batch_ready",
    reviewScope: null,
    scopeLabel: "第 1-3 章",
    awaitingNextChapterScope: false,
  });

  assert.doesNotMatch(description, /会先确认续写终点/);
  assert.equal(
    buildContinueAutoExecutionActionLabel("第 1-3 章", false, false),
    "继续自动执行第 1-3 章",
  );
});

test("primary action label for a written window opens continuation instead of re-running the range", () => {
  assert.equal(buildContinueAutoExecutionActionLabel("第 1-3 章", false, true), "继续写后续章节");
  assert.equal(buildContinueAutoExecutionActionLabel("第 1-3 章", true, true), "准备中...");
});

test("checkpoint label and structured helper agree on the written-window state", () => {
  const task = buildTask();

  assert.equal(isTaskAwaitingNextChapterScope(task), true);
  assert.equal(formatTakeoverCheckpoint("chapter_batch_ready", task, true), "第 1-3 章正文已完成");
  assert.equal(formatTakeoverCheckpoint("chapter_batch_ready", task, false), "第 1-3 章自动执行已暂停");
  assert.equal(isTaskAwaitingNextChapterScope(buildTask({ status: "running" })), false);
});

test("a closed completed range keeps the continuation entry and copy", () => {
  const closedTask = buildTask({
    status: "succeeded",
    checkpointType: "workflow_completed",
  });
  const title = buildTakeoverTitle({
    mode: "completed",
    novelTitle: "示例书",
    checkpointType: "workflow_completed",
    scopeLabel: "第 1-3 章",
    awaitingNextChapterScope: true,
  });
  const description = buildTakeoverDescription({
    mode: "completed",
    checkpointType: "workflow_completed",
    reviewScope: null,
    scopeLabel: "第 1-3 章",
    awaitingNextChapterScope: true,
  });

  assert.equal(isTaskAwaitingNextChapterScope(closedTask), true);
  assert.equal(formatTakeoverCheckpoint("workflow_completed", closedTask, true), "第 1-3 章正文已完成");
  assert.match(title, /第 1-3 章正文已完成/);
  assert.match(description, /会先确认续写终点/);
  assert.match(description, /不会重写已完成章节/);
});
