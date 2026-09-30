const test = require("node:test");
const assert = require("node:assert/strict");
const { invokePlannerLLM } = require("../dist/services/planner/plannerLlm.js");
const { setPromptRunnerStructuredInvokerForTests } = require("../dist/prompting/core/promptRunner.js");
const { validateChapterPayoffDecisions, PayoffPlanningReplanRequiredError, buildPayoffPlanningEvidenceBlock } = require("../dist/services/planner/payoff/index.js");

// This failure shape reproduces the actual first-new-book response: two numbered
// clauses were joined, the intervening "3." dropped and the final punctuation changed.
const exact = "箱子发光拖他入九洲，展示陌生街景和箱子强制接单";
const joined = `${exact}；箱子弹出第一单和倒计时，明确“超时永久关闭”。`;
const payoffValidation = {
  contract: { taskSheet: `本章执行：1.躲入古庙；2.${exact}；3.箱子弹出第一单和倒计时，明确“超时永久关闭”；4.决定找药铺。` },
  candidates: [{ ledgerKey: "volume1_box_connection_and_selection", currentStatus: "setup" }], chapterOrder: 1, planningWindow: [],
};
function output(quote, operation = "seed") {
  return { title: "古庙里弹出配送单", objective: "建立第一次配送目标", participants: ["林小满"],
    reveals: ["箱子连接两界"], riskNotes: ["不揭示来源"], hookTarget: "找药铺", planRole: "setup", phaseLabel: "第一单",
    mustAdvance: ["接到第一单"], mustPreserve: ["不提前兑现送达"],
    payoffDecisions: [{ ledgerKey: "volume1_box_connection_and_selection", operation, reason: "仅展示连接现象",
      authorizedScope: "展示现象，不解释连接来源", contractEvidence: { sourcePath: "taskSheet", quote }, followUp: null }],
    scenes: [{ title: "古庙", objective: "接单", conflict: "倒计时启动", reveal: "无法立刻返回", emotionBeat: "被迫应对" }] };
}
const invoke = () => invokePlannerLLM({ options: {}, scopeLabel: "章节规划", planLevel: "chapter", payoffValidation,
  contextBlocks: [buildPayoffPlanningEvidenceBlock(payoffValidation, [])] });

test("real joined payoff quote fails exact validation and gets one semantic repair through planner invocation", async () => {
  assert.throws(() => validateChapterPayoffDecisions({ ...payoffValidation, decisions: output(joined).payoffDecisions }), /continuous verbatim/);
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async (request) => {
    calls.push(request);
    return { data: output(calls.length === 1 ? joined : exact), repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await invoke();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].promptMeta.semanticRetryAttempts, 1);
    assert.match(String(calls[1].messages.at(-1).content), /continuous verbatim/);
    assert.equal(result.payoffDecisions[0].contractEvidence.quote, exact);
    assert.deepEqual(validateChapterPayoffDecisions({ ...payoffValidation, decisions: result.payoffDecisions }), result.payoffDecisions);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test("valid explicit replan is not rewritten by semantic retry and remains a service-level replan error", async () => {
  let count = 0;
  setPromptRunnerStructuredInvokerForTests(async () => {
    count++;
    return { data: output(exact, "requires_replan"), repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await invoke();
    assert.equal(count, 1);
    assert.equal(result.payoffDecisions[0].operation, "requires_replan");
    assert.throws(() => validateChapterPayoffDecisions({ ...payoffValidation, decisions: result.payoffDecisions }), PayoffPlanningReplanRequiredError);
    assert.throws(() => validateChapterPayoffDecisions({ ...payoffValidation, decisions: output(joined, "requires_replan").payoffDecisions }, { allowReplan: true }), /absent current chapter contract evidence/);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test("payoff evidence block preserves exact numbered contract without optional summarization", () => {
  const block = buildPayoffPlanningEvidenceBlock(payoffValidation, []);
  assert.equal(block.required, true);
  assert.equal(block.allowSummary, false);
  assert.ok(block.content.includes(payoffValidation.contract.taskSheet));
});
