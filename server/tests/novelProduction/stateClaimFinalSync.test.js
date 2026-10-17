const test = require("node:test");
const assert = require("node:assert/strict");
const { createPipelineHarness } = require("./sourceHarness.cjs");
const dataset = require("../fixtures/planningSemanticCases.js");

test("synthetic semantic fixture covers three genres and keeps answer keys separate from story inputs", () => {
  assert.equal(new Set(dataset.cases.map(item => item.id)).size, dataset.cases.length);
  assert.deepEqual([...new Set(dataset.cases.map(item => item.genre))].sort(), ["修仙", "寒灾", "武侠"].sort());
  const pairs = Map.groupBy(dataset.cases, item => item.pairId);
  assert.ok([...pairs.values()].every(items => items.length === 2));
  assert.ok(dataset.cases.every(item => item.expected && item.facts.length && item.plan));
  for (const stage of ["planning", "acceptance", "artifact_sync", "review_consistency", "final_selection"]) {
    assert.ok(dataset.cases.some(item => item.stage === stage));
  }
});

test("final-only state sync uses retained original after a non-improving repair candidate", async () => {
  const data = dataset.cases.find(item => item.id === "ps-23");
  const h = createPipelineHarness({ content: data.originalDraft, scores: [60, 50] });
  await h.run({ maxRetries: 1 });
  assert.deepEqual(h.committedContents, [data.originalDraft]);
  assert.deepEqual(h.syncedContents, [data.originalDraft]);
  assert.ok(!h.syncedContents.includes(data.plan));
  assert.ok(!h.syncedContents.includes("repair candidate"));
});

test("final-only state sync uses selected candidate once after actual acceptance", async () => {
  const data = dataset.cases.find(item => item.id === "ps-24");
  const h = createPipelineHarness({ content: data.originalDraft, scores: [60, 90] });
  await h.run({ maxRetries: 1 });
  assert.deepEqual(h.committedContents, ["repair candidate"]);
  assert.deepEqual(h.syncedContents, ["repair candidate"]);
  assert.ok(!h.syncedContents.includes(data.originalDraft));
  assert.ok(!h.syncedContents.includes(data.plan));
});
