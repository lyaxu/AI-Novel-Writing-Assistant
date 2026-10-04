const test = require("node:test");
const assert = require("node:assert/strict");

const { candidateBatchMaxTokens } = require("../dist/services/novel/director/phases/novelDirectorCandidateStage.js");

test("the batch budget grows with the candidate count instead of being fixed", () => {
  // The reported failure: a 4-candidate batch was cut off at a flat 10000 tokens.
  assert.ok(candidateBatchMaxTokens(4) > 10_000, "a 4-candidate batch must exceed the old fixed cap");
  assert.equal(candidateBatchMaxTokens(1), 12_000);
  assert.equal(candidateBatchMaxTokens(2), 18_000);
  assert.equal(candidateBatchMaxTokens(3), 24_000);
});

test("the budget is monotonic and capped at what a provider will accept", () => {
  const values = [1, 2, 3, 4, 5, 8, 20].map((n) => candidateBatchMaxTokens(n));
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] >= values[i - 1], `budget must not shrink: ${values[i - 1]} -> ${values[i]}`);
  }
  assert.equal(candidateBatchMaxTokens(4), 24_000);
  assert.equal(candidateBatchMaxTokens(100), 24_000, "a runaway count must not request an unbounded output");
});

test("a nonsense count still yields a usable budget rather than zero or NaN", () => {
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
    const value = candidateBatchMaxTokens(bad);
    assert.ok(Number.isFinite(value) && value > 0, `count=${String(bad)} produced ${value}`);
    assert.equal(value, 12_000);
  }
});
