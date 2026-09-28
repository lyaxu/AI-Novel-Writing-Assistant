const test = require("node:test");
const assert = require("node:assert/strict");
const dataset = require("../../docs/evals/framework-quality/cases.v1.json");
const { challengePack, evaluate } = require("../scripts/framework-quality-eval.cjs");

test("challenge export excludes answer keys and pairs", () => {
  const pack = challengePack(dataset);
  assert.equal(pack.cases.length, 16);
  for (const item of pack.cases) assert.deepEqual(Object.keys(item), ["id", "genre", "facts", "plan"]);
  assert.equal(new Set(pack.cases.map((c) => c.genre)).size, 8);
  assert.ok(!JSON.stringify(pack).includes("rationale"));
});

test("missing responses cannot pass and incur false negatives", () => {
  const result = evaluate(dataset, { version: dataset.version, results: [] });
  assert.equal(result.complete, false);
  assert.equal(result.developmentGatePassed, false);
  assert.ok(result.falseNegative > 0);
});

test("fabricated evidence and duplicate judgments are rejected", () => {
  const version = dataset.version;
  const row = { id: "case-01", issues: [{ code: "unearned_prerequisite", evidence: "根本未提供的故事句子", explanation: "这是一段不存在的证据" }] };
  assert.throws(() => evaluate(dataset, { version, results: [row] }), /证据无法定位/);
  assert.throws(() => evaluate(dataset, { version, results: [{ id: "case-01", issues: [] }, { id: "case-01", issues: [] }] }), /重复样例/);
});

test("known answer mapping tests scorer only, including positive-control false alarms", () => {
  const response = { version: dataset.version, results: dataset.cases.map((c) => ({ id: c.id, issues: c.expected.map((code) => ({ code, evidence: c.plan, explanation: c.rationale })) })) };
  assert.equal(evaluate(dataset, response).developmentGatePassed, true);
  const sound = dataset.cases.find((c) => !c.expected.length);
  response.results.find((r) => r.id === sound.id).issues.push({ code: "motivation_gap", evidence: sound.plan, explanation: "模拟评审者的误报，用于检验统计" });
  const result = evaluate(dataset, response);
  assert.equal(result.developmentGatePassed, false);
  assert.equal(result.falsePositive, 1);
  assert.ok(result.soundCaseFalseAlarmRate > 0);
});
