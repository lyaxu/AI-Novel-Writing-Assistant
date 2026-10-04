const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateVolumeAcceptance, decideVolumeGate, deriveVolumeOutcomes } = require("../dist/services/novel/volume/volumeAcceptanceEvaluation.js");

test("gate: only a volume that is not finished blocks the next outline", () => {
  const blocked = decideVolumeGate(evaluateVolumeAcceptance([
    chapter({ chapterOrder: 1 }),
    chapter({ chapterOrder: 2, accepted: false }),
  ]), "上一卷（第 1 卷）");
  assert.equal(blocked.blocked, true);
  assert.match(blocked.message, /暂不生成下一卷大纲/);
  // The message must be actionable, and must say prose is not touched.
  assert.match(blocked.message, /补齐未完成的章节/);
  assert.match(blocked.message, /已写的正文不会被改动/);

  // Recorded debt is already visible; blocking on it would stop most volumes.
  const debt = decideVolumeGate(evaluateVolumeAcceptance([chapter({ hasQualityDebt: true })]));
  assert.equal(debt.blocked, false);
  assert.match(debt.message, /带质量债完成/);

  const clean = decideVolumeGate(evaluateVolumeAcceptance([chapter()]));
  assert.equal(clean.blocked, false);
  assert.match(clean.message, /已通过验收/);
});

test("gate: an unevaluable volume blocks, because it cannot be called finished", () => {
  const decision = decideVolumeGate(evaluateVolumeAcceptance([]));
  assert.equal(decision.blocked, true);
});

test("outcomes are derived from chapter status without inventing acceptance detail", () => {
  const outcomes = deriveVolumeOutcomes([
    { order: 3, chapterStatus: "completed" },
    { order: 1, chapterStatus: "completed" },
    { order: 2, chapterStatus: "needs_repair" },
    { order: 4, chapterStatus: "pending_generation" },
    { order: 5, chapterStatus: null },
  ]);
  assert.deepEqual(outcomes.map((row) => row.chapterOrder), [1, 2, 3, 4, 5]);
  assert.deepEqual(outcomes.map((row) => row.accepted), [true, false, true, false, false]);
  assert.deepEqual(outcomes.map((row) => row.hasQualityDebt), [false, true, false, true, false]);
  // The row does not carry issue counts; reporting zero is honest, inventing them is not.
  assert.ok(outcomes.every((row) => row.blockingIssueCount === 0 && row.missingObligationCount === 0));
});

test("gate end to end: an unfinished previous volume stops the next outline", () => {
  // This is the actual product policy: derive from the database rows, evaluate, then decide.
  const rows = [
    { order: 1, chapterStatus: "completed" },
    { order: 2, chapterStatus: "completed" },
    { order: 3, chapterStatus: "pending_generation" },
  ];
  const decision = decideVolumeGate(evaluateVolumeAcceptance(deriveVolumeOutcomes(rows)));
  assert.equal(decision.blocked, true);
  // And a fully finished volume lets planning continue.
  const done = decideVolumeGate(evaluateVolumeAcceptance(deriveVolumeOutcomes(rows.slice(0, 2))));
  assert.equal(done.blocked, false);
});

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
