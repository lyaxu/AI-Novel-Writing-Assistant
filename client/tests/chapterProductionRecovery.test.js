import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveChapterOperation, recoveryScope, recoveryInspectionVersion, productionStepLabel,
} from "../src/pages/novels/productionRecovery/contracts.ts";

const paused = { operationId: "old", status: "paused", leaseActive: false, inputChanged: false,
  canResume: true, entry: "stream", steps: [{ key: "stream.save", status: "failed" }], savedDraft: "原稿" };

test("a fresh chapter can start without creating a replacement operation id", () => {
  assert.equal(resolveChapterOperation(null), undefined);
});
test("ordinary clicks never replace paused, completed, uncertain or edited operations", () => {
  for (const record of [paused, { ...paused, status: "completed" }, { ...paused, inputChanged: true },
    { ...paused, steps: [{ key: "stream.started", status: "unknown" }] }]) {
    assert.throws(() => resolveChapterOperation(record), /稿件与恢复/);
  }
});
test("explicit replacement uses only the reviewed operation and rejects changed or active work", () => {
  const permit = { previousOperationId: "old", operationId: "explicit-new" };
  assert.equal(resolveChapterOperation(paused, permit), "explicit-new");
  assert.throws(() => resolveChapterOperation({ ...paused, leaseActive: true }, permit));
  assert.throws(() => resolveChapterOperation({ ...paused, operationId: "other" }, permit));
  assert.throws(() => resolveChapterOperation(null, permit));
});
test("new outputs and step changes invalidate the user's previous inspection", () => {
  const original = recoveryInspectionVersion(paused);
  for (const record of [{ ...paused, partialText: "新片段" }, { ...paused, savedDraft: "另一份稿" },
    { ...paused, inputChanged: true }, { ...paused, steps: [{ key: "stream.save", status: "done" }] }]) {
    assert.notEqual(recoveryInspectionVersion(record), original);
  }
});
test("uncertain calls, edited drafts and normal resume have distinct explanations", () => {
  assert.match(recoveryScope({ ...paused, steps: [{ key: "stream.started", status: "unknown" }] }), /先核对/);
  assert.match(recoveryScope({ ...paused, inputChanged: true }), /不会覆盖/);
  assert.match(recoveryScope(paused), /只继续未完成/);
  assert.equal(productionStepLabel("stream.save"), "保存正文");
  assert.equal(productionStepLabel("pipeline.commit.facts"), "提交故事状态与同步资料");
  assert.equal(recoveryScope({ ...paused, canResume: false, resumeBlockedReason: "输出尚未确认" }), "输出尚未确认");
});
test("source actions await inspection and rewriting does not pre-delete the chapter", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const runtime = read("../src/pages/novels/hooks/useNovelEditChapterRuntime.ts");
  assert.equal((runtime.match(/await prepareChapterOperation\(/g) ?? []).length, 2);
  const actions = read("../src/pages/novels/hooks/useChapterExecutionActions.ts");
  const rewrite = actions.slice(actions.indexOf("const rewriteChapter"), actions.indexOf("const expandChapter"));
  assert.doesNotMatch(rewrite, /content:\s*""|patchChapterMutation\.mutate/);
  const panel = read("../src/pages/novels/productionRecovery/ChapterProductionRecoveryPanel.tsx");
  assert.match(panel, /record\.canResume \?/);
  assert.match(panel, /recoveryInspectionVersion\(fresh\.data\) !== inspectionVersion/);
  assert.match(panel, /runtime\/recovery\/resume/);
  assert.doesNotMatch(panel, /updateNovelChapter|setContentDraft/);
  assert.doesNotMatch(panel, /directorTaskId=/);
  const edit = read("../src/pages/novels/NovelEdit.tsx");
  assert.match(edit, /onRepairChapter: \(\) => void startChapterRepair\(reviewResult\?\.issues \?\? \[\]\)/);
  assert.doesNotMatch(edit, /repairSSE\.start\(/);
});
