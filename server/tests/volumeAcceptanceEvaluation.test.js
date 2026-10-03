const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateVolumeAcceptance } = require("../dist/services/novel/volume/volumeAcceptanceEvaluation.js");

const chapter = (overrides = {}) => ({
  chapterOrder: 1,
  accepted: true,
  blockingIssueCount: 0,
  hasQualityDebt: false,
  missingObligationCount: 0,
  ...overrides,
});

test("a volume whose chapters all passed is accepted", () => {
  const report = evaluateVolumeAcceptance([chapter(), chapter({ chapterOrder: 2 }), chapter({ chapterOrder: 3 })]);
  assert.equal(report.verdict, "accepted");
  assert.equal(report.chapterCount, 3);
  assert.equal(report.blockingChapterCount, 0);
});

test("recorded debt is reported without pretending the volume is clean", () => {
  const report = evaluateVolumeAcceptance([chapter(), chapter({ chapterOrder: 2, hasQualityDebt: true })]);
  assert.equal(report.verdict, "accepted_with_debt");
  assert.equal(report.debtChapterCount, 1);
  assert.ok(report.reasons.some((reason) => reason.includes("质量债")));
});

test("unresolved blocking issues make the volume need attention, not acceptance", () => {
  const report = evaluateVolumeAcceptance([
    chapter(),
    chapter({ chapterOrder: 2, accepted: false, blockingIssueCount: 2 }),
  ]);
  assert.equal(report.verdict, "needs_attention");
  assert.equal(report.blockingChapterCount, 1);
  assert.ok(report.reasons.some((reason) => reason.includes("未通过自身验收")));
  assert.ok(report.reasons.some((reason) => reason.includes("阻塞问题")));
});

test("undischarged chapter obligations count even when the chapter itself passed", () => {
  const report = evaluateVolumeAcceptance([chapter({ missingObligationCount: 3 })]);
  assert.equal(report.verdict, "accepted_with_debt");
  assert.equal(report.unmetObligationChapterCount, 1);
  assert.ok(report.reasons.some((reason) => reason.includes("未兑现的章节义务")));
});

test("an unevaluable volume must never be handed back as accepted", () => {
  // A gate that silently passes what it could not judge is worse than no gate.
  const report = evaluateVolumeAcceptance([]);
  assert.equal(report.verdict, "needs_attention");
  assert.equal(report.chapterCount, 0);
  assert.ok(report.reasons.some((reason) => reason.includes("还没有可评估的章节")));
});

test("a missed reveal bar is surfaced, and meets the bar cleanly when it is met", () => {
  const missed = evaluateVolumeAcceptance([chapter()], {
    plannedRate: 0.4, requiredRate: 0.6, meetsRequiredRate: false, unmappedCount: 5,
  });
  assert.equal(missed.verdict, "accepted_with_debt");
  assert.ok(missed.reasons.some((reason) => reason.includes("低于要求的")));

  const met = evaluateVolumeAcceptance([chapter()], {
    plannedRate: 0.8, requiredRate: 0.6, meetsRequiredRate: true, unmappedCount: 2,
  });
  assert.equal(met.verdict, "accepted");
  assert.ok(met.reasons.some((reason) => reason.includes("已达到要求")));
});

test("with no reveal signal the evaluation still works and does not invent one", () => {
  const report = evaluateVolumeAcceptance([chapter()], null);
  assert.equal(report.verdict, "accepted");
  assert.ok(!report.reasons.some((reason) => reason.includes("伏笔")));
});

test("chapters are counted by order and the report is not affected by input order", () => {
  const forward = evaluateVolumeAcceptance([chapter({ chapterOrder: 1 }), chapter({ chapterOrder: 2, hasQualityDebt: true })]);
  const reversed = evaluateVolumeAcceptance([chapter({ chapterOrder: 2, hasQualityDebt: true }), chapter({ chapterOrder: 1 })]);
  assert.deepEqual(forward, reversed);
});
