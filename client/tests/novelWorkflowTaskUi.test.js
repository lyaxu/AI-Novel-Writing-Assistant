import test from "node:test";
import assert from "node:assert/strict";
import {
  canCancelDirectorTask,
  canContinueChapterBatchAutoExecution,
  canContinueDirector,
  getCandidateSelectionLink,
  getWorkflowBadge,
  getWorkflowDescription,
  isAwaitingNextChapterScope,
} from "../src/lib/novelWorkflowTaskUi.ts";

function buildTask(overrides = {}) {
  return {
    id: "task-1",
    status: "waiting_approval",
    checkpointType: "chapter_batch_ready",
    ...overrides,
  };
}

test("waiting chapter batch approval waits for the batch execution continuation", () => {
  const task = buildTask();

  assert.equal(canContinueChapterBatchAutoExecution(task), false);
  assert.equal(canContinueDirector(task), false);
});

test("failed chapter batch can still use automatic execution continuation", () => {
  const task = buildTask({ status: "failed" });

  assert.equal(canContinueChapterBatchAutoExecution(task), true);
  assert.equal(canContinueDirector(task), false);
});

test("pending manual recovery tasks can still be cancelled", () => {
  const task = buildTask({
    status: "queued",
    pendingManualRecovery: true,
  });

  assert.equal(canCancelDirectorTask(task), true);
});

test("waiting approval tasks can be cancelled from the editor and task center", () => {
  const task = buildTask({
    status: "waiting_approval",
    pendingManualRecovery: false,
  });

  assert.equal(canCancelDirectorTask(task), true);
});

test("completed tasks are not cancelable", () => {
  const task = buildTask({
    status: "succeeded",
    pendingManualRecovery: false,
  });

  assert.equal(canCancelDirectorTask(task), false);
});

test("candidate selection links use the auto-director route taskId parameter", () => {
  assert.equal(getCandidateSelectionLink("task-1"), "/novels/auto-director?taskId=task-1");
});

test("a fully written window offers continuation scope instead of the batch continue action", () => {
  const task = buildTask({ status: "waiting_approval", awaitingNextChapterScope: true });

  assert.equal(isAwaitingNextChapterScope(task), true);
  assert.equal(canContinueChapterBatchAutoExecution(task), false);
  assert.equal(canContinueDirector(task), false);
});

test("continuation copy survives the range being closed as completed", () => {
  const closedTask = buildTask({
    status: "succeeded",
    checkpointType: "workflow_completed",
    awaitingNextChapterScope: true,
  });

  assert.equal(isAwaitingNextChapterScope(closedTask), true);
  assert.equal(isAwaitingNextChapterScope(buildTask({ status: "running", awaitingNextChapterScope: true })), false);
  assert.equal(isAwaitingNextChapterScope(buildTask({ status: "failed", awaitingNextChapterScope: true })), false);
  assert.equal(isAwaitingNextChapterScope(buildTask({
    status: "waiting_approval",
    checkpointType: "workflow_completed",
    awaitingNextChapterScope: true,
  })), true);
  assert.equal(isAwaitingNextChapterScope(buildTask()), false);
});

test("workflow badge and description use the completed-window copy from the projection", () => {
  const task = {
    ...buildTask({ awaitingNextChapterScope: true }),
    executionScopeLabel: "第 1-3 章",
    displayStatus: "第 1-3 章已完成，可继续写后续章节",
    blockingReason: "第 1-3 章正文已完成并保留。继续写后续章节时会先确认续写终点，再补齐下一段章节规划并审查，然后生成第 4 章起的正文，不会重写已完成章节。",
  };

  assert.equal(getWorkflowBadge(task)?.label, "第 1-3 章已完成，可继续写后续章节");
  assert.match(getWorkflowDescription(task) ?? "", /会先确认续写终点/);
});
