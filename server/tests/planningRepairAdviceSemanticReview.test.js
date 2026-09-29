const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAdviceSemanticReview } = require("../dist/services/novel/director/recovery/planningRepair/advice/semanticReview");
const context = { candidateAuthority: { versionId: "v1" }, candidateWindow: [{ chapters: [
  { id: "c1", taskSheet: "已经交付的包裹仍从箱内消失。" }, { id: "c2", taskSheet: "邻章证据" },
] }] };
function fixture() {
  return { advice: { summary: "纠正矛盾事件", recommendedOptionId: "a", options: [{
    id: "a", title: "修复前后事实", reason: "当前执行稿与交付事实矛盾", changes: ["统一事件安排和回收引用"],
    preserves: ["保留威胁义务"], tradeoffs: [], diagnosis: "real_gap", executionMode: "repair_then_review",
    affectedChapterIds: ["c1"], changesHardConstraints: false, requiresSourceEdit: false,
    blockerResolution: { status: "complete", remainingBlockers: [], rationale: "同时纠正执行字段与引用" },
    guidance: { intent: "消除事实矛盾", actions: ["逐字段纠正并显式revise原义务"], preserve: ["保留威胁作用"], verification: ["核对交付事实与新引用"] },
  }] }, checks: [{ optionId: "a", verdict: "corrected", rationale: "原句反驳无需修改的判断，最终方案必须修复", evidence: [
    { sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "已经交付的包裹仍从箱内消失。", relation: "contradicts" },
  ] }] };
}
function reviewExisting(value) {
  Object.assign(value.advice.options[0], { executionMode: "review_existing", diagnosis: "review_disagreement", changes: [],
    candidateVersionId: "v1", candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "已经交付" }] });
  return value;
}
test("real current quote cannot certify review-only when independent check finds contradiction", () => {
  assert.throws(() => validateAdviceSemanticReview(reviewExisting(fixture()), context), /反证/);
});
test("independently corrected repair with exact counterevidence can proceed to ordinary repair review", () => {
  assert.doesNotThrow(() => validateAdviceSemanticReview(fixture(), context));
});
test("invented quote, other chapter and missing or duplicate checks fail provenance contract", () => {
  for (const mutate of [
    x => { x.checks[0].evidence[0].quote = "修复已完成"; },
    x => { x.checks[0].evidence[0] = { sourcePath: "candidateWindow[0].chapters[1].taskSheet", quote: "邻章证据", relation: "supports" }; },
    x => { x.checks = []; }, x => { x.checks.push(structuredClone(x.checks[0])); },
    x => { x.checks[0].optionId = "other"; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => validateAdviceSemanticReview(value, context)); }
});
test("blocked source-edit remains a readable recommendation without an executable recovery", () => {
  const value = fixture(); value.checks[0].verdict = "blocked";
  assert.throws(() => validateAdviceSemanticReview(value, context));
  Object.assign(value.advice.options[0], { executionMode: "source_edit", requiresSourceEdit: true });
  assert.doesNotThrow(() => validateAdviceSemanticReview(value, context));
});
test("corrected final review-only option still requires current version and supporting evidence", () => {
  const value = reviewExisting(fixture()); value.checks[0].evidence[0].relation = "supports";
  assert.doesNotThrow(() => validateAdviceSemanticReview(value, context));
  value.advice.options[0].candidateVersionId = "old";
  assert.throws(() => validateAdviceSemanticReview(value, context));
});

test("missing source may produce blocked guidance without invented evidence, but cannot support execution", () => {
  const value = fixture(); value.checks[0].evidence = [];
  assert.throws(() => validateAdviceSemanticReview(value, context), /每个候选章节/);
  value.checks[0].verdict = "blocked";
  Object.assign(value.advice.options[0], { executionMode: "source_edit", requiresSourceEdit: true });
  assert.doesNotThrow(() => validateAdviceSemanticReview(value, {}));
});
test("every affected chapter needs independent final-option evidence", () => {
  const value = fixture(); value.advice.options[0].affectedChapterIds.push("c2");
  assert.throws(() => validateAdviceSemanticReview(value, context), /每个候选章节/);
  value.checks[0].evidence.push({ sourcePath: "candidateWindow[0].chapters[1].taskSheet", quote: "邻章证据", relation: "supports" });
  assert.doesNotThrow(() => validateAdviceSemanticReview(value, context));
});

test("cross-source evidence accepts exact supplied prose without replacing candidate coverage", () => {
  const withProse = { ...context, chapterEvidence: [{ id: "written-previous", content: "他递出包裹，对方当面展开油纸。", summary: "收件人开包" }] };
  const value = fixture();
  const prose = { sourcePath: "chapterEvidence[0].content", quote: "对方当面展开油纸", relation: "supports" };
  value.checks[0].evidence.push(prose);
  assert.doesNotThrow(() => validateAdviceSemanticReview(value, withProse));
  value.checks[0].evidence = [prose];
  assert.throws(() => validateAdviceSemanticReview(value, withProse), /每个候选章节/);
  for (const bad of [
    { ...prose, quote: "对方打开了包裹" },
    { ...prose, sourcePath: "chapterEvidence[1].content" },
    { ...prose, sourcePath: "chapterEvidence[0].summary", quote: "收件人开包" },
    { ...prose, sourcePath: "repair.history[0].output.content" },
  ]) {
    const invalid = fixture(); invalid.checks[0].evidence.push(bad);
    assert.throws(() => validateAdviceSemanticReview(invalid, withProse), /正文原文/);
  }
  const blank = fixture(); blank.checks[0].evidence.push(prose);
  assert.throws(() => validateAdviceSemanticReview(blank, { ...context, chapterEvidence: [{ content: "" }] }));
});

const fs = require("node:fs"), path = require("node:path");
const capture = path.resolve(__dirname, "../../.codex-run/delivery-box-prose-evidence");
test("captured rejected review passes unchanged when its exact written prose source is allowed", {
  skip: !fs.existsSync(path.join(capture, "seed.json")),
}, () => {
  const read = name => JSON.parse(fs.readFileSync(path.join(capture, `${name}.json`), "utf8"));
  const seed = read("seed"), candidate = read("candidate"), chapters = read("chapters");
  const { buildAdviceContext } = require("../dist/services/novel/director/recovery/planningRepair/advice/AdviceContext");
  const ctx = buildAdviceContext({ novel: {}, volumes: [], macro: null, chapters, candidate, seed,
    eligibleChapterIds: seed.planningRepairSnapshot.eligibleChapterIds });
  const result = seed.planningRepairAdvice.failureDiagnostics.rejectedOutput.parsed;
  const before = JSON.stringify({ seed, candidate, chapters });
  assert.equal(result.checks[0].evidence.filter(e => e.sourcePath === "chapterEvidence[0].content").length, 1);
  assert.doesNotThrow(() => validateAdviceSemanticReview(result, ctx));
  assert.equal(JSON.stringify({ seed, candidate, chapters }), before);
});
