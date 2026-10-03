const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatForeshadowToken,
  extractForeshadowTokens,
  selectVolumeRevealObligations,
  checkRevealCoverage,
  findForeshadowTokenLeaks,
  evaluateVolumeRevealRate,
} = require("../dist/services/payoff/foreshadowRevealObligations.js");

const item = (overrides = {}) => ({
  id: "p1",
  novelId: "n",
  ledgerKey: "L1",
  title: "夹层来源",
  summary: "餐盒夹层里那半张图的来历",
  scopeType: "volume",
  currentStatus: "pending_payoff",
  sourceRefs: [],
  evidence: [],
  riskSignals: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

test("token format round-trips through extraction", () => {
  const token = formatForeshadowToken("L007");
  assert.equal(token, "[伏笔:L007]");
  assert.deepEqual(extractForeshadowTokens(`回收：${token} 黄蓉点破来源`), ["L007"]);
  assert.deepEqual(extractForeshadowTokens(""), []);
  assert.deepEqual(extractForeshadowTokens(null), []);
  // Duplicates collapse; an unterminated token is ignored rather than guessed.
  assert.deepEqual(extractForeshadowTokens("[伏笔:L1] x [伏笔:L1]"), ["L1"]);
  assert.deepEqual(extractForeshadowTokens("[伏笔:L1 x"), []);
});

test("only promises whose window ends inside the volume are this volume's obligations", () => {
  const obligations = selectVolumeRevealObligations([
    item({ ledgerKey: "inside", targetEndChapterOrder: 12 }),
    item({ ledgerKey: "at-start", targetStartChapterOrder: 10 }),
    item({ ledgerKey: "later", targetEndChapterOrder: 40 }),
    item({ ledgerKey: "already-done", targetEndChapterOrder: 11, currentStatus: "paid_off" }),
    item({ ledgerKey: "no-window" }),
  ], { startOrder: 10, endOrder: 20 });
  assert.deepEqual(obligations.map((row) => row.ledgerKey), ["at-start", "inside"]);
});

test("an invalid volume range yields nothing instead of a guess", () => {
  assert.deepEqual(selectVolumeRevealObligations([item({ targetEndChapterOrder: 12 })], { startOrder: 0, endOrder: 20 }), []);
  assert.deepEqual(selectVolumeRevealObligations([item({ targetEndChapterOrder: 12 })], { startOrder: 20, endOrder: 10 }), []);
});

test("coverage is by explicit token, not by prose similarity", () => {
  const obligations = selectVolumeRevealObligations([
    item({ ledgerKey: "L1", targetEndChapterOrder: 12 }),
    item({ ledgerKey: "L2", targetEndChapterOrder: 14 }),
  ], { startOrder: 10, endOrder: 20 });
  const chapters = [
    { chapterOrder: 12, requiredElements: ["黄蓉点破餐盒夹层来源 [伏笔:L1]"] },
    // Mentions the same subject in words, but never links the promise: still unmapped.
    { chapterOrder: 14, requiredElements: ["把那半张图的来历说清楚"] },
  ];
  const coverage = checkRevealCoverage(obligations, chapters);
  assert.deepEqual(coverage.mapped, [{ ledgerKey: "L1", chapterOrder: 12 }]);
  assert.deepEqual(coverage.unmapped.map((row) => row.ledgerKey), ["L2"]);
});

test("a token citing a promise outside the volume is reported instead of silently accepted", () => {
  const obligations = selectVolumeRevealObligations([item({ ledgerKey: "L1", targetEndChapterOrder: 12 })], { startOrder: 10, endOrder: 20 });
  const coverage = checkRevealCoverage(obligations, [
    { chapterOrder: 11, requiredElements: ["[伏笔:L1] 回收", "[伏笔:OUTSIDE] 顺手埋一条"] },
  ]);
  assert.deepEqual(coverage.unexpectedTokens, [{ chapterOrder: 11, ledgerKey: "OUTSIDE" }]);
  // The unexpected token does not count as covering anything.
  assert.deepEqual(coverage.mapped.map((row) => row.ledgerKey), ["L1"]);
});

test("the first obligation to cite a promise wins, and a duplicate citation is not double counted", () => {
  const obligations = selectVolumeRevealObligations([item({ ledgerKey: "L1", targetEndChapterOrder: 12 })], { startOrder: 10, endOrder: 20 });
  const coverage = checkRevealCoverage(obligations, [
    { chapterOrder: 15, requiredElements: ["[伏笔:L1] 回收"] },
    { chapterOrder: 12, requiredElements: ["[伏笔:L1] 回收"] },
  ]);
  assert.deepEqual(coverage.mapped, [{ ledgerKey: "L1", chapterOrder: 12 }]);
});

test("tokens belong to the plan, never to finished prose", () => {
  assert.deepEqual(findForeshadowTokenLeaks("黄蓉把图摊开，看了很久。"), []);
  assert.deepEqual(findForeshadowTokenLeaks("黄蓉把图摊开 [伏笔:L1]，看了很久。"), ["L1"]);
});

test("volume one may only seed; later volumes must schedule most of their obligations", () => {
  const obligations = selectVolumeRevealObligations([
    item({ ledgerKey: "L1", targetEndChapterOrder: 12 }),
    item({ ledgerKey: "L2", targetEndChapterOrder: 13 }),
    item({ ledgerKey: "L3", targetEndChapterOrder: 14 }),
    item({ ledgerKey: "L4", targetEndChapterOrder: 15 }),
  ], { startOrder: 10, endOrder: 20 });
  const coverage = checkRevealCoverage(obligations, [
    { chapterOrder: 12, requiredElements: ["[伏笔:L1] 回收"] },
    { chapterOrder: 13, requiredElements: ["[伏笔:L2] 回收"] },
    { chapterOrder: 14, requiredElements: ["[伏笔:L3] 回收"] },
  ]);

  const volumeOne = evaluateVolumeRevealRate(coverage, obligations, { volumeSortOrder: 1 });
  assert.equal(volumeOne.requiredRate, 0);
  assert.ok(volumeOne.meetsRequiredRate);
  assert.equal(volumeOne.unmappedCount, 1);

  const volumeTwo = evaluateVolumeRevealRate(coverage, obligations, { volumeSortOrder: 2 });
  assert.equal(volumeTwo.requiredRate, 0.6);
  assert.equal(volumeTwo.plannedRate, 0.75);
  assert.ok(volumeTwo.meetsRequiredRate);

  const thin = evaluateVolumeRevealRate(
    checkRevealCoverage(obligations, [{ chapterOrder: 12, requiredElements: ["[伏笔:L1] 回收"] }]),
    obligations,
    { volumeSortOrder: 3 },
  );
  assert.equal(thin.plannedRate, 0.25);
  assert.equal(thin.meetsRequiredRate, false);
});

test("a volume with nothing to reveal passes trivially instead of reporting a false gap", () => {
  const report = evaluateVolumeRevealRate(checkRevealCoverage([], []), [], { volumeSortOrder: 4 });
  assert.equal(report.plannedRate, 1);
  assert.equal(report.unmappedCount, 0);
  assert.ok(report.meetsRequiredRate);
});
