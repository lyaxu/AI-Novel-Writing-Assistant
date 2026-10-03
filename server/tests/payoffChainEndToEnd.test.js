const test = require("node:test");
const assert = require("node:assert/strict");

const { selectDuePromises, renderPayoffCadenceContext, checkPromiseCoverage } = require("../dist/services/payoff/payoffCadence.js");
const { selectVolumeRevealObligations, checkRevealCoverage, renderForeshadowObligationsContext, evaluateVolumeRevealRate } = require("../dist/services/payoff/foreshadowRevealObligations.js");
const { extractPromiseTokens, extractForeshadowTokens } = require("../dist/services/payoff/planningToken.js");
const { detectProseQuality } = require("../dist/services/novel/runtime/proseQuality/ProseQualityDetector.js");
const { evaluateVolumeAcceptance } = require("../dist/services/novel/volume/volumeAcceptanceEvaluation.js");

/**
 * The payoff chain, exercised end to end with one coherent fixture.
 *
 * Each module has its own unit tests; this file exists because the interesting failures live
 * between them — a token written by one module and read by another, a due list that reaches the
 * planner but whose result never gets checked, a volume verdict assembled from signals that were
 * never actually produced together.
 */

const ledgerItem = (overrides = {}) => ({
  id: "p", novelId: "novel-1", ledgerKey: "L001", title: "夹层来源", summary: "餐盒夹层那半张图的来历",
  scopeType: "book", currentStatus: "pending_payoff", sourceRefs: [], evidence: [], riskSignals: [],
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const CHAPTER_ORDER = 12;
const VOLUME_RANGE = { startOrder: 10, endOrder: 20 };

test("chain: a due promise reaches the planner brief as a checkable token", () => {
  const items = [
    ledgerItem({ ledgerKey: "L001", nextProgressChapter: 12, payoffIntensity: "medium" }),
    ledgerItem({ ledgerKey: "L002", nextProgressChapter: 15 }),
  ];
  const due = selectDuePromises(items, CHAPTER_ORDER);
  assert.deepEqual(due.map((row) => row.ledgerKey), ["L001"]);

  const brief = renderPayoffCadenceContext(due, CHAPTER_ORDER);
  // The planner must be able to see exactly which token to carry forward.
  assert.ok(brief.includes("[承诺:L001]"));
  // And a promise that is not due must not be smuggled into the brief.
  assert.ok(!brief.includes("[承诺:L002]"));
  assert.deepEqual(extractPromiseTokens(brief), ["L001"]);
});

test("chain: a promise the planner mapped is covered; one it ignored is not", () => {
  const items = [
    ledgerItem({ ledgerKey: "L001", nextProgressChapter: 12 }),
    ledgerItem({ ledgerKey: "L002", nextProgressChapter: 12 }),
  ];
  const due = selectDuePromises(items, CHAPTER_ORDER);

  const chapters = [{
    chapterOrder: CHAPTER_ORDER,
    requiredElements: [
      "黄蓉点破餐盒夹层来源 [承诺:L001]",
      "主角继续赶路",
    ],
  }];
  const coverage = checkPromiseCoverage(due, chapters);
  assert.deepEqual(coverage.mapped, [{ ledgerKey: "L001", chapterOrder: CHAPTER_ORDER }]);
  assert.deepEqual(coverage.unmapped.map((row) => row.ledgerKey), ["L002"]);
  assert.deepEqual(coverage.unexpectedTokens, []);
});

test("chain: the same requiredElements that carry a promise token drive the writer brief", () => {
  // A token in requiredElements is planning-only; the prose must show the event without it.
  const requiredElements = ["黄蓉点破餐盒夹层来源 [承诺:L001]"];
  const prose = "黄蓉把那张纸摊在桌上，指了指夹层。\n\n「这半张图不是你的。」";
  assert.deepEqual(extractPromiseTokens(requiredElements.join("\n")), ["L001"]);
  const clean = detectProseQuality(prose).findings.filter((f) => f.code.startsWith("prose_") && f.code.endsWith("token_leak"));
  assert.deepEqual(clean, []);
  // But if either marker kind is copied into the prose, the leak check must catch it.
  const promiseLeak = detectProseQuality(`${prose}\n\n[承诺:L001]`).findings.filter((f) => f.code === "prose_promise_token_leak");
  assert.equal(promiseLeak.length, 1);
  const foreshadowLeak = detectProseQuality(`${prose}\n\n[伏笔:M001]`).findings.filter((f) => f.code === "prose_foreshadow_token_leak");
  assert.equal(foreshadowLeak.length, 1);
});

test("chain: a volume's reveal obligations and its acceptance verdict agree", () => {
  const items = [
    ledgerItem({ ledgerKey: "M1", targetEndChapterOrder: 14, scopeType: "volume" }),
    ledgerItem({ ledgerKey: "M2", targetEndChapterOrder: 16, scopeType: "volume" }),
    ledgerItem({ ledgerKey: "M3", targetEndChapterOrder: 40, scopeType: "volume" }), // later volume
  ];
  const obligations = selectVolumeRevealObligations(items, VOLUME_RANGE);
  assert.deepEqual(obligations.map((row) => row.ledgerKey), ["M1", "M2"]);

  // The planner schedules one of the two; M2 is left without a landing point.
  const chapters = [{ chapterOrder: 14, requiredElements: ["交代那半张图的来历 [伏笔:M1]"] }];
  const coverage = checkRevealCoverage(obligations, chapters);
  const rate = evaluateVolumeRevealRate(coverage, obligations, { volumeSortOrder: 2 });
  assert.equal(rate.plannedRate, 0.5);
  assert.equal(rate.meetsRequiredRate, false);

  // The same signal must reach the volume verdict rather than being computed and dropped.
  const verdict = evaluateVolumeAcceptance(
    [{ chapterOrder: 14, accepted: true, blockingIssueCount: 0, hasQualityDebt: false, missingObligationCount: 0 }],
    { plannedRate: rate.plannedRate, requiredRate: rate.requiredRate, meetsRequiredRate: rate.meetsRequiredRate, unmappedCount: rate.unmappedCount },
  );
  assert.equal(verdict.verdict, "accepted_with_debt");
  assert.ok(verdict.reasons.some((reason) => reason.includes("伏笔回收安排率")));
});

test("chain: a fully scheduled volume clears the bar and is accepted", () => {
  const items = [ledgerItem({ ledgerKey: "M1", targetEndChapterOrder: 14, scopeType: "volume" })];
  const obligations = selectVolumeRevealObligations(items, VOLUME_RANGE);
  const chapters = [{ chapterOrder: 14, requiredElements: ["交代来历 [伏笔:M1]"] }];
  const coverage = checkRevealCoverage(obligations, chapters);
  const rate = evaluateVolumeRevealRate(coverage, obligations, { volumeSortOrder: 2 });
  assert.ok(rate.meetsRequiredRate);

  const verdict = evaluateVolumeAcceptance(
    [{ chapterOrder: 14, accepted: true, blockingIssueCount: 0, hasQualityDebt: false, missingObligationCount: 0 }],
    { plannedRate: rate.plannedRate, requiredRate: rate.requiredRate, meetsRequiredRate: rate.meetsRequiredRate, unmappedCount: rate.unmappedCount },
  );
  assert.equal(verdict.verdict, "accepted");
});

test("chain: the two token kinds never read each other's markers", () => {
  const mixed = "回收 [伏笔:M1] 并推进 [承诺:L001]";
  assert.deepEqual(extractForeshadowTokens(mixed), ["M1"]);
  assert.deepEqual(extractPromiseTokens(mixed), ["L001"]);

  // A wrong-kind marker must never satisfy promise coverage. Note the asymmetry this exposes:
  // coverage reads only its own kind, so a marker of the wrong kind is not counted as covered
  // (safe) but is also not reported as a mistake (a known limitation — it would need both the
  // promise and the foreshadow obligations to tell "wrong kind" apart from "not mine").
  const due = selectDuePromises([ledgerItem({ ledgerKey: "L001", nextProgressChapter: CHAPTER_ORDER })], CHAPTER_ORDER);
  const coverage = checkPromiseCoverage(due, [{ chapterOrder: CHAPTER_ORDER, requiredElements: ["[伏笔:L001] 写错了标记类型"] }]);
  assert.deepEqual(coverage.mapped, []);
  assert.deepEqual(coverage.unmapped.map((row) => row.ledgerKey), ["L001"]);
});

test("chain: both rendered briefs can be concatenated without the tokens colliding", () => {
  // volumeGenerationOrchestrator joins them into a single context block.
  const due = selectDuePromises([ledgerItem({ ledgerKey: "L001", nextProgressChapter: CHAPTER_ORDER })], CHAPTER_ORDER);
  const obligations = selectVolumeRevealObligations(
    [ledgerItem({ ledgerKey: "M1", targetEndChapterOrder: 11, scopeType: "volume" })],
    VOLUME_RANGE,
  );
  const combined = [
    renderPayoffCadenceContext(due, CHAPTER_ORDER),
    renderForeshadowObligationsContext(obligations, CHAPTER_ORDER),
  ].join("\n\n");

  assert.deepEqual(extractPromiseTokens(combined), ["L001"]);
  assert.deepEqual(extractForeshadowTokens(combined), ["M1"]);
  // Each block names only its own kind, so concatenation cannot cross-contaminate them.
  assert.ok(combined.includes("[承诺:L001]"));
  assert.ok(combined.includes("[伏笔:M1]"));
});

test("chain: with nothing due, both blocks still guard against inventing work", () => {
  // The empty-list wording lives in the empty branch, so it must be asserted there.
  const combined = [
    renderPayoffCadenceContext([], CHAPTER_ORDER),
    renderForeshadowObligationsContext([], CHAPTER_ORDER),
  ].join("\n\n");
  assert.deepEqual(extractPromiseTokens(combined), []);
  assert.deepEqual(extractForeshadowTokens(combined), []);
  assert.match(combined, /没有到期的账本承诺/);
  assert.match(combined, /不要为了填满这个清单而新造承诺/);
  assert.match(combined, /没有到期的伏笔回收义务/);
  assert.match(combined, /不要为了填满这里而提前揭晓留待后卷的真相/);
});
