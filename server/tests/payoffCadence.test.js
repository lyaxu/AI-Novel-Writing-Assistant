const test = require("node:test");
const assert = require("node:assert/strict");
const { selectDuePromises, renderPayoffCadenceContext, rollForwardNextProgressChapter, checkPromiseCoverage } = require("../dist/services/payoff/payoffCadence.js");

const item = (overrides = {}) => ({
  id: "p1",
  novelId: "n",
  ledgerKey: "L1",
  title: "首单结算",
  summary: "完成第一单并拿到回报",
  scopeType: "book",
  currentStatus: "pending_payoff",
  sourceRefs: [],
  evidence: [],
  riskSignals: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

test("a promise whose nextProgressChapter has arrived is due", () => {
  const due = selectDuePromises([item({ nextProgressChapter: 7 })], 7);
  assert.equal(due.length, 1);
  assert.equal(due[0].reason, "cadence");
  assert.equal(due[0].dueChapterOrder, 7);
  assert.equal(due[0].overdueChapters, 0);
});

test("a promise due later is not returned early", () => {
  assert.deepEqual(selectDuePromises([item({ nextProgressChapter: 9 })], 7), []);
});

test("cadence is derived from progressEvery when nextProgressChapter is absent", () => {
  const due = selectDuePromises([item({ progressEvery: 5, lastTouchedChapterOrder: 3 })], 8);
  assert.equal(due.length, 1);
  assert.equal(due[0].dueChapterOrder, 8);
  assert.equal(due[0].reason, "cadence");
});

test("cadence derived from progressEvery that has not elapsed is not due", () => {
  assert.deepEqual(selectDuePromises([item({ progressEvery: 5, lastTouchedChapterOrder: 5 })], 8), []);
});

test("a promise with no declared cadence is never turned into a fabricated deadline", () => {
  assert.deepEqual(selectDuePromises([item({})], 30), []);
  // progressEvery without any touch record still cannot be scheduled.
  assert.deepEqual(selectDuePromises([item({ progressEvery: 4 })], 30), []);
});

test("a hard payoff deadline is due on its own even without cadence", () => {
  const due = selectDuePromises([item({ targetEndChapterOrder: 6 })], 8);
  assert.equal(due.length, 1);
  assert.equal(due[0].reason, "deadline");
  assert.equal(due[0].dueChapterOrder, 6);
  assert.equal(due[0].overdueChapters, 2);
});

test("terminal promises are never due", () => {
  assert.deepEqual(selectDuePromises([
    item({ currentStatus: "paid_off", nextProgressChapter: 2 }),
    item({ currentStatus: "failed", targetEndChapterOrder: 2 }),
  ], 9), []);
});

test("an already-flagged overdue promise is due", () => {
  const due = selectDuePromises([item({ currentStatus: "overdue", targetEndChapterOrder: 5 })], 9);
  assert.equal(due.length, 1);
  assert.equal(due[0].overdueChapters, 4);
});

test("results are ordered most overdue first, then strongest intended payoff", () => {
  const due = selectDuePromises([
    item({ ledgerKey: "recent", nextProgressChapter: 9, payoffIntensity: "major" }),
    item({ ledgerKey: "very-late", nextProgressChapter: 4, payoffIntensity: "tiny" }),
    item({ ledgerKey: "late-major", nextProgressChapter: 7, payoffIntensity: "major" }),
    item({ ledgerKey: "late-small", nextProgressChapter: 7, payoffIntensity: "small" }),
  ], 9);
  assert.deepEqual(due.map((row) => row.ledgerKey), ["very-late", "late-major", "late-small", "recent"]);
});

test("an invalid chapter order yields nothing instead of a guess", () => {
  assert.deepEqual(selectDuePromises([item({ nextProgressChapter: 1 })], 0), []);
  assert.deepEqual(selectDuePromises([item({ nextProgressChapter: 1 })], Number.NaN), []);
});

test("rendered context names every due promise and forbids inventing work to fill the list", () => {
  const due = selectDuePromises([item({ ledgerKey: "L1", nextProgressChapter: 7 })], 9);
  const text = renderPayoffCadenceContext(due, 9);
  assert.match(text, /L1/);
  assert.match(text, /已逾期 2 章/);
  // advancing is not the same as paying off, and the contract must say so
  assert.match(text, /推进不等于兑现/);
  assert.match(text, /不得为了满足清单而临时新造能力、道具或人物/);
});

test("an empty cadence block must not invite new promises", () => {
  const text = renderPayoffCadenceContext([], 4);
  assert.match(text, /没有到期的账本承诺/);
  assert.match(text, /不要为了填满这个清单而新造承诺/);
});

test("a promise touched at or after its due chapter rolls forward by its own cadence", () => {
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 7, lastTouchedChapterOrder: 7, currentStatus: "pending_payoff",
  }), 12);
  // touched past the due point also rolls, otherwise it would stay permanently due
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 7, lastTouchedChapterOrder: 9, currentStatus: "hinted",
  }), 14);
});

test("a due chapter still ahead of the last touch is left alone", () => {
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 12, lastTouchedChapterOrder: 7, currentStatus: "pending_payoff",
  }), 12);
});

test("without a cadence or a touch record the reported value stands, never invented", () => {
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: null, nextProgressChapter: 7, lastTouchedChapterOrder: 9, currentStatus: "pending_payoff",
  }), 7);
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 7, lastTouchedChapterOrder: null, currentStatus: "pending_payoff",
  }), 7);
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: null, lastTouchedChapterOrder: null, currentStatus: "pending_payoff",
  }), null);
});

test("a missing due chapter is derived once the cadence and touch are known", () => {
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 4, nextProgressChapter: null, lastTouchedChapterOrder: 6, currentStatus: "setup",
  }), 10);
});

test("terminal promises keep whatever the model reported", () => {
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 3, lastTouchedChapterOrder: 20, currentStatus: "paid_off",
  }), 3);
  assert.equal(rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 3, lastTouchedChapterOrder: 20, currentStatus: "failed",
  }), 3);
});

test("a rolled-forward promise stops being reported as due", () => {
  const next = rollForwardNextProgressChapter({
    progressEvery: 5, nextProgressChapter: 7, lastTouchedChapterOrder: 7, currentStatus: "pending_payoff",
  });
  assert.deepEqual(selectDuePromises([item({ progressEvery: 5, nextProgressChapter: next, lastTouchedChapterOrder: 7 })], 8), []);
});

test("the rendered cadence block asks for a promise token, not just a landing point", () => {
  const due = selectDuePromises([item({ ledgerKey: "L1", nextProgressChapter: 9 })], 9);
  const text = renderPayoffCadenceContext(due, 9);
  assert.match(text, /\[承诺:L1\]/);
  assert.match(text, /requiredElements/);
  assert.match(text, /正文里绝对不能出现/);
  // A promise the chapter genuinely cannot advance must not be marked to pad the list.
  assert.match(text, /不要挂标记充数/);
});

test("promise coverage matches by explicit token, never by prose similarity", () => {
  const due = selectDuePromises([
    item({ ledgerKey: "L1", nextProgressChapter: 9 }),
    item({ ledgerKey: "L2", nextProgressChapter: 9 }),
  ], 9);
  const coverage = checkPromiseCoverage(due, [
    { chapterOrder: 9, requiredElements: ["把药包交给黄蓉并拿到回执 [承诺:L1]"] },
    // Describes the same business in words but never links it: still unmapped.
    { chapterOrder: 9, requiredElements: ["顺便把欠账的事提一提"] },
  ]);
  assert.deepEqual(coverage.mapped, [{ ledgerKey: "L1", chapterOrder: 9 }]);
  assert.deepEqual(coverage.unmapped.map((row) => row.ledgerKey), ["L2"]);
});

test("a promise token for a promise that is not due is reported, not silently accepted", () => {
  const due = selectDuePromises([item({ ledgerKey: "L1", nextProgressChapter: 9 })], 9);
  const coverage = checkPromiseCoverage(due, [
    { chapterOrder: 9, requiredElements: ["[承诺:L1] 推进", "[承诺:NOT-DUE] 顺手带一句"] },
  ]);
  assert.deepEqual(coverage.unexpectedTokens, [{ chapterOrder: 9, ledgerKey: "NOT-DUE" }]);
  assert.deepEqual(coverage.mapped.map((row) => row.ledgerKey), ["L1"]);
});

test("a planner that ignores the cadence block leaves every promise unmapped", () => {
  // This is the case the check exists for: without it the omission left no trace at all.
  const due = selectDuePromises([
    item({ ledgerKey: "L1", nextProgressChapter: 9 }),
    item({ ledgerKey: "L2", nextProgressChapter: 9 }),
  ], 9);
  const coverage = checkPromiseCoverage(due, [{ chapterOrder: 9, requiredElements: ["主角继续赶路", "遇到一个熟人"] }]);
  assert.deepEqual(coverage.mapped, []);
  assert.equal(coverage.unmapped.length, 2);
});
