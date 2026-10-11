import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { refreshChapterProductionViews } from "../src/pages/novels/productionRecovery/refreshViews.ts";
import {
  acknowledgeInspectedOperation, resolveChapterOperation, recoveryScope, recoveryInspectionVersion, productionStepLabel, resumeInspectedPipeline,
} from "../src/pages/novels/productionRecovery/contracts.ts";

const paused = { operationId: "old", status: "paused", leaseActive: false, inputChanged: false,
  canResume: true, entry: "stream", steps: [{ key: "stream.save", status: "failed" }], savedDraft: "原稿" };

test("independent pipeline resumes only the inspected original operation and job", async () => {
  const inspected = { ...paused, entry: "pipeline", pipelineJobId: "original-job", canResume: false,
    canResumePipeline: true, pipelineRange: { startOrder: 2, endOrder: 4 } };
  const calls = [];
  await resumeInspectedPipeline({ inspected, latest: structuredClone(inspected), jobId: "original-job",
    submit: async (operationId) => { calls.push(operationId); } });
  assert.deepEqual(calls, ["old"]);
  for (const patch of [{ workflowTaskId: "director" }, { canResumePipeline: false }, { leaseActive: true },
    { inputChanged: true }, { canAcknowledge: true }, { pipelineJobId: "other" }, { operationId: "other" }]) {
    await assert.rejects(resumeInspectedPipeline({ inspected, latest: { ...inspected, ...patch }, jobId: "original-job",
      submit: async () => { throw new Error("must not resume"); } }), /恢复条件/);
  }
});

test("pipeline recovery lives on the source page and submits no new job or model options", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const panel = read("../src/pages/novels/productionRecovery/PipelineJobRecoveryPanel.tsx");
  assert.match(panel, /record\?\.canResumePipeline \?/);
  assert.match(panel, /resumeInspectedPipeline/);
  assert.match(panel, /onClick=\{\(\) => resume\.mutate\(\)\}/);
  assert.doesNotMatch(panel, /runNovelPipeline|resumeRecoveryCandidate|productionOperationId|randomUUID|llmOverride|\.split\("[:]"\)/);
  const api = read("../src/pages/novels/productionRecovery/api.ts");
  assert.match(api, /runtime\/recovery\/resume-pipeline`,\s*\{ operationId \}/);
  assert.match(read("../src/pages/novels/components/PipelineTab.tsx"), /<PipelineJobRecoveryPanel novelId=\{novelId\} chapterId=\{selectedChapterId\}/);
});

test("a failed finalization refresh reveals retained proposals without starting execution", async () => {
  const resourcesKey = JSON.stringify(["novels", "character-resources", "book"]);
  const contextKey = JSON.stringify(["novels", "character-resource-context", "book", "chapter"]);
  const cache = new Map([[resourcesKey, []], [contextKey, { pending: [] }]]);
  const persisted = new Map([[resourcesKey, [{ id: "pending-after-save", status: "pending_review" }]],
    [contextKey, { pending: ["pending-after-save"] }]]);
  const calls = [];
  await refreshChapterProductionViews({ invalidateQueries: async ({ queryKey }) => {
    calls.push(queryKey);
    const key = JSON.stringify(queryKey);
    if (persisted.has(key)) cache.set(key, persisted.get(key));
  } }, "book", "chapter");
  assert.equal(cache.get(resourcesKey)[0].id, "pending-after-save");
  assert.deepEqual(cache.get(contextKey), { pending: ["pending-after-save"] });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((key) => key[0] === "novels"));
});

test("manual progress refresh and all chapter execution exits refresh retained proposal views", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const panel = read("../src/pages/novels/productionRecovery/ChapterProductionRecoveryPanel.tsx");
  assert.match(panel, /async function refreshInspection\(\)[\s\S]*?query\.refetch\(\), refreshChapterProductionViews\(client, novelId, chapterId\)/);
  assert.match(panel, /finally \{[\s\S]*?await refreshInspection\(\)/);
  assert.match(panel, /onClick=\{\(\) => void refreshInspection\(\)\}>刷新保留进度/);
  const hook = read("../src/pages/novels/hooks/useNovelEditChapterRuntime.ts");
  assert.equal((hook.match(/finally \{\s*productionRequestPending\.current = false;\s*await refreshChapterProductionViews\(/g) ?? []).length, 2);
});

test("a fresh chapter can start without creating a replacement operation id", () => {
  assert.equal(resolveChapterOperation(null), undefined);
});
test("unknown-outcome acknowledgement records only the same operation and never starts recovery", async () => {
  const inspected = { ...paused, canResume: false, canAcknowledge: true, entry: "pipeline", workflowTaskId: "parent",
    steps: [{ key: "actual:extract", status: "unknown" }, { key: "draft", status: "done" }], partialText: "保留片段" };
  const calls = [];
  await acknowledgeInspectedOperation({ inspected, latest: structuredClone(inspected), accepted: true,
    submit: async (operationId) => { calls.push(operationId); } });
  assert.deepEqual(calls, ["old"]);
  assert.equal(inspected.steps[1].status, "done");
  assert.equal(inspected.partialText, "保留片段");
  for (const patch of [{ canAcknowledge: false }, { leaseActive: true }, { inputChanged: true },
    { operationId: "another" }, { partialText: "新的片段" }]) {
    await assert.rejects(acknowledgeInspectedOperation({ inspected, latest: { ...inspected, ...patch }, accepted: true,
      submit: async () => { throw new Error("must not submit"); } }), /核对内容/);
  }
  await assert.rejects(acknowledgeInspectedOperation({ inspected, latest: inspected, accepted: false,
    submit: async () => { throw new Error("must not submit"); } }), /核对内容/);
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
  const acknowledgement = panel.slice(panel.indexOf("async function acknowledgeUnknown"), panel.indexOf("if (!chapterId) return null"));
  assert.match(acknowledgement, /acknowledgeInspectedOperation/);
  assert.doesNotMatch(acknowledgement, /stream\.start|authorize\(|randomUUID|resume\(/);
  assert.match(panel, /record\.canAcknowledge \?/);
  const edit = read("../src/pages/novels/NovelEdit.tsx");
  assert.match(edit, /onRepairChapter: \(\) => void startChapterRepair\(reviewResult\?\.issues \?\? \[\]\)/);
  assert.doesNotMatch(edit, /repairSSE\.start\(/);
});
