const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAssessment } = require("../dist/services/novel/runtime/ChapterAcceptanceAssessmentService.js");
const { acceptanceOutputBudget, buildAcceptancePromptInput } = require("../dist/services/novel/runtime/acceptance/index.js");

function assessment(verdict) {
  return {
    status: "accepted", score: { coherence: 89, pacing: 89, repetition: 89, engagement: 89, voice: 89, overall: 89 },
    summary: "事件都已出现", blockingIssues: [], repairDirectives: [], missingObligations: [],
    repairability: "none", riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "正常", requiresFullPayoffReconcile: false },
    sceneCausalityVerdicts: [{ sceneKey: "scene_1", outcomeObserved: true, verdict,
      prerequisiteEvidence: ["主角此前没有钥匙"], choiceAndResistanceEvidence: "主角要求保管员开门，保管员拒绝。",
      outcomeMechanismEvidence: "主角忽然从口袋取出钥匙。", constraintEvidence: [], explanation: "钥匙取得过程没有建立，结果出现但缺少前提。" }],
  };
}

test("high overall score and all outcomes cannot hide a failed causal verdict", () => {
  const result = normalizeAssessment(assessment("unearned"), "章节正文");
  assert.equal(result.status, "repairable");
  assert.equal(result.continuePolicy, "repair_once");
  assert.equal(result.blockingIssues[0].code, "scene_causality_unearned_scene_1");
  assert.equal(result.repairDirectives.length, 1);
  assert.equal(result.sceneCausalityVerdicts[0].outcomeObserved, true);
  assert.equal(result.repairability, "none"); // No forced global replan.
});

test("unknown evidence stays visible without instructing an invented scene", () => {
  const result = normalizeAssessment(assessment("insufficient_evidence"), "章节正文");
  assert.equal(result.status, "continue_with_risk");
  assert.equal(result.continuePolicy, "continue");
  assert.equal(result.repairDirectives.length, 0);
  assert.ok(result.riskTags.some((tag) => tag.includes("insufficient_evidence")));
});

test("contradicted causal verdict is local repair and projection is idempotent", () => {
  const result = normalizeAssessment(assessment("contradicted"), "章节正文");
  assert.equal(result.status, "repairable");
  assert.equal(result.blockingIssues[0].severity, "high");
  assert.deepEqual(normalizeAssessment(result, "章节正文"), result);
});

test("legacy assessment and earned causal judgments preserve existing acceptance", () => {
  const legacy = assessment("earned");
  assert.equal(normalizeAssessment(legacy, "正文").status, "accepted");
  delete legacy.sceneCausalityVerdicts;
  assert.equal(normalizeAssessment(legacy, "正文").status, "accepted");
});

test("prompt and cache coverage derive only from persisted causal scenes", () => {
  const input = { novelTitle: "测试", chapterTitle: "测试", chapterOrder: 1, content: "正文", contextPackage: {
    chapterReviewContext: { scenePlan: { scenes: [{ key: "old" }, { key: "new", causality: {} }] } },
  } };
  assert.deepEqual(buildAcceptancePromptInput(input).expectedSceneKeys, ["new"]);
  delete input.contextPackage.chapterReviewContext;
  assert.deepEqual(buildAcceptancePromptInput(input).expectedSceneKeys, []);
});

test("evidence output allowance scales within the eight-scene contract", () => {
  assert.equal(acceptanceOutputBudget(0), 5760);
  assert.equal(acceptanceOutputBudget(3), 10368);
  assert.equal(acceptanceOutputBudget(8), 18048);
  assert.equal(acceptanceOutputBudget(100), 18048);
});
