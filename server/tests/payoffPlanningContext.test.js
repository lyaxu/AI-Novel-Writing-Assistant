const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPayoffPlanningEvidenceBlock } = require("../dist/services/planner/payoff/index.js");
const { selectContextBlocks } = require("../dist/prompting/core/contextSelection.js");
const { validateChapterPayoffDecisions } = require("../dist/services/planner/payoff/index.js");

test("exact payoff contract, bounded candidates and future evidence survive severe budget pressure", () => {
  const taskSheet = '2.箱子发光拖他入九洲；3.箱子弹出第一单，明确“超时永久关闭”；4.决定找药铺。';
  const validation = { contract: { taskSheet, mustAvoid: "不解释来源" },
    candidates: [{ ledgerKey: "origin", currentStatus: "pending_payoff" }], chapterOrder: 1,
    planningWindow: [{ chapters: [{ chapterOrder: 3, summary: "第三章交药，奖励到账" }] }] };
  const block = buildPayoffPlanningEvidenceBlock(validation, { chapters: [] });
  const selected = selectContextBlocks([block], { maxTokensBudget: 1 });
  assert.equal(block.required, true);
  assert.equal(block.allowSummary, false);
  assert.equal(selected.selectedBlocks[0].content, block.content);
  assert.ok(selected.selectedBlocks[0].content.includes(taskSheet));
  assert.ok(selected.selectedBlocks[0].content.includes('第三章交药，奖励到账'));
  assert.ok(selected.selectedBlocks[0].content.includes('"ledgerKey": "origin"'));
  assert.deepEqual(selected.summarizedBlockIds, []);
  assert.deepEqual(selected.droppedBlockIds, []);
});

test("future ledger dates cannot stand in for a chapter plan and optional seed follow-up can be null", () => {
  const input = { contract: {taskSheet: "接到第一单"}, chapterOrder: 1,
    candidates: [{ledgerKey: "loop", currentStatus: "pending_payoff", targetEndChapterOrder: 10}],
    planningWindow: [{chapters: [{chapterOrder: 3, summary: "完成第一单"}]}] };
  const decision = {ledgerKey: "loop",operation: "seed",reason:"当前播种",authorizedScope:"接单",contractEvidence:{sourcePath:"taskSheet",quote:"接到第一单"},
    followUp:{chapterOrder:4,expectedChange:"多单交付",planningQuote:"三到五单配送"}};
  assert.throws(()=>validateChapterPayoffDecisions({...input,decisions:[decision]}), /Chapter 4 is not a supplied future chapter.*not due/);
  assert.equal(validateChapterPayoffDecisions({...input,decisions:[{...decision,followUp:null}]}).length,1);
  assert.throws(()=>validateChapterPayoffDecisions({...input,candidates:[{...input.candidates[0],currentStatus:"overdue"}],decisions:[{...decision,followUp:null}]}),/requires a concrete follow-up/);
});
