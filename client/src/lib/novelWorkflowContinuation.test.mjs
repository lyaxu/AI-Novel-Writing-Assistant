import test from "node:test";
import assert from "node:assert/strict";

import { resolveDirectorContinueMode, resolvePendingRecoveryGuidance } from "./novelWorkflowContinuation.ts";

test("professional recovery replans instead of skipping a replan checkpoint", () => {
  assert.equal(resolveDirectorContinueMode({
    checkpointType: "replan_required",
    currentItemKey: "quality_repair",
    currentStage: "质量修复",
    pendingManualRecovery: false,
  }), "auto_execute_range");
});

test("review pause tells the user the single next action and that saved prose is kept", () => {
  const guidance = resolvePendingRecoveryGuidance({
    checkpointType: "chapter_batch_ready",
    currentItemKey: "quality_repair",
    pendingManualRecovery: true,
  });
  assert.ok(guidance);
  assert.equal(guidance.actionLabel, "从最近检查点恢复审查");
  assert.match(guidance.description, /重新完成章节检查与审查/);
  assert.match(guidance.description, /不会重写已保存的正文/);
});

test("other chapter-range pauses keep the generic checkpoint recovery wording", () => {
  const guidance = resolvePendingRecoveryGuidance({
    checkpointType: "chapter_batch_ready",
    currentItemKey: "chapter_range_incomplete",
    pendingManualRecovery: true,
  });
  assert.deepEqual(guidance, {
    actionLabel: "从最近检查点恢复",
    description: "会从最近保存的进度继续；已经保存的章节正文不会重写。",
  });
});

test("non-recovery tasks get no recovery guidance", () => {
  assert.equal(resolvePendingRecoveryGuidance({
    checkpointType: "chapter_batch_ready",
    currentItemKey: "quality_repair",
    pendingManualRecovery: false,
  }), null);
  assert.equal(resolvePendingRecoveryGuidance(null), null);
});
