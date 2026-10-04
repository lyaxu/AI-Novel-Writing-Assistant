const test = require("node:test");
const assert = require("node:assert/strict");
const { validateChapterPayoffDecisions, buildPayoffEvidenceHash, readCurrentPayoffDecisions, PayoffPlanningReplanRequiredError } = require("../dist/services/planner/payoff/index.js");
const { plannerService } = require("../dist/services/planner/PlannerService.js");
const { prisma } = require("../dist/db/prisma.js");

const decision = { ledgerKey: "reward", operation: "payoff", reason: "当前章兑现已确认奖励", authorizedScope: "获得听风能力并救下同伴",
  contractEvidence: { sourcePath: "taskSheet", quote: "获得听风能力并救下同伴" }, followUp: null };
const input = { decisions: [decision], contract: { taskSheet: decision.contractEvidence.quote },
  candidates: [{ ledgerKey: "reward", currentStatus: "overdue", targetEndChapterOrder: 2 }], chapterOrder: 3,
  planningWindow: [{ chapters: [{ chapterOrder: 4, summary: "第四章兑现听风奖励" }] }] };

test("explicit payoff/partial authorization passes while due pressure without follow-up fails", () => {
  assert.deepEqual(validateChapterPayoffDecisions(input), [decision]);
  for (const operation of ["seed", "touch", "pressure", "defer"]) {
    assert.throws(() => validateChapterPayoffDecisions({ ...input, decisions: [{ ...decision, operation }] }));
  }
  assert.throws(() => validateChapterPayoffDecisions({ ...input, decisions: [{ ...decision, operation: "partial_reveal" }] }));
  assert.equal(validateChapterPayoffDecisions({ ...input, decisions: [{ ...decision, operation: "partial_reveal", remainingObligation: "完整应用待第四章", followUp: { chapterOrder: 4, expectedChange: "获得完整应用", planningQuote: "第四章兑现听风奖励" } }] })[0].operation, "partial_reveal");
});

test("deferral requires an exact future chapter reference, not an invented later promise", () => {
  const delayed = { ...decision, operation: "defer", followUp: { chapterOrder: 4, expectedChange: "第四章获得能力", planningQuote: "第四章兑现听风奖励" } };
  assert.equal(validateChapterPayoffDecisions({ ...input, decisions: [delayed] })[0].operation, "defer");
  assert.throws(() => validateChapterPayoffDecisions({ ...input, decisions: [{ ...delayed, followUp: { ...delayed.followUp, chapterOrder: 5 } }] }));
  assert.throws(() => validateChapterPayoffDecisions({ ...input, decisions: [{ ...decision, contractEvidence: { sourcePath: "taskSheet", quote: "旧章目标" } }] }));
  assert.throws(() => validateChapterPayoffDecisions({ ...input, decisions: [{ ...decision, operation: "requires_replan" }] }), PayoffPlanningReplanRequiredError);
  assert.throws(() => validateChapterPayoffDecisions({ ...input, decisions: [] }));
  assert.deepEqual(validateChapterPayoffDecisions({ ...input, candidates: [], decisions: [] }), []);
  assert.equal(validateChapterPayoffDecisions({ ...input, decisions: [{ ...decision, operation: "out_of_scope", reason: "当前任务单属于另一条支线" }] })[0].operation, "out_of_scope");
});

test("a verbatim quote from sceneCards is accepted even though raw JSON escapes it", () => {
  // Reported failure at chapter 3: "Payoff decision cites absent current chapter contract evidence".
  // The quote was verbatim, but the check searched the raw JSON serialization, where a quotation
  // mark is escaped and newlines are not literal. The follow-up check in the same function already
  // searched decoded leaves; this keeps both halves consistent.
  const quote = '他说"这葫芦有问题"';
  const sceneCards = JSON.stringify({ scenes: [{ key: "s1", turn: quote, requiredElements: ["检查葫芦"] }] });
  assert.ok(!sceneCards.includes(quote), "precondition: the raw serialization escapes the quote");

  const sceneDecision = { ...decision, authorizedScope: quote, contractEvidence: { sourcePath: "sceneCards", quote } };
  assert.deepEqual(
    validateChapterPayoffDecisions({ ...input, contract: { sceneCards }, decisions: [sceneDecision] }),
    [sceneDecision],
  );
});

test("a quote that appears nowhere in the contract is still rejected", () => {
  // The guard must keep rejecting invented evidence: only the search method changed, not the bar.
  const sceneCards = JSON.stringify({ scenes: [{ key: "s1", turn: "他摸了摸葫芦" }] });
  assert.throws(
    () => validateChapterPayoffDecisions({ ...input, contract: { sceneCards },
      decisions: [{ ...decision, contractEvidence: { sourcePath: "sceneCards", quote: "他确认葫芦是茅山信物" } }] }),
    /cites absent current chapter contract evidence/,
  );
});

test("legacy plan, contract changes and rewritten prior prose cannot authorize stale payoff", () => {
  const evidenceHash = buildPayoffEvidenceHash({ chapters: [{ content: "旧前文" }] });
  const key = { contractHash: "current", evidenceHash };
  const plan = { payoffDecisionVersion: 1, executionContractHash: "current", payoffEvidenceHash: evidenceHash, payoffDecisions: [decision] };
  assert.deepEqual(readCurrentPayoffDecisions(JSON.stringify(plan), key), [decision]);
  assert.equal(readCurrentPayoffDecisions(JSON.stringify({ executionContractHash: "current" }), key), null);
  assert.equal(readCurrentPayoffDecisions(JSON.stringify(plan), { ...key, contractHash: "new" }), null);
  assert.equal(readCurrentPayoffDecisions(JSON.stringify(plan), { ...key, evidenceHash: buildPayoffEvidenceHash({ chapters: [{ content: "重写前文" }] }) }), null);
});

test("ensure leaves saved prose plans untouched even if legacy payoff decisions are missing", async () => {
  const get = plannerService.getChapterPlan, generate = plannerService.generateChapterPlan, find = prisma.chapter.findFirst;
  const existing = { id: "saved", scenes: [{}], rawPlanJson: "{}" };
  plannerService.getChapterPlan = async () => existing;
  plannerService.generateChapterPlan = async () => { throw new Error("must not regenerate saved prose"); };
  prisma.chapter.findFirst = async () => ({ content: "已保存正文", order: 3 });
  try { assert.equal(await plannerService.ensureChapterPlan("novel", "chapter"), existing); }
  finally { plannerService.getChapterPlan = get; plannerService.generateChapterPlan = generate; prisma.chapter.findFirst = find; }
});

test("ensure refreshes an unwritten legacy plan instead of silently bypassing payoff decisions", async () => {
  const get = plannerService.getChapterPlan, generate = plannerService.generateChapterPlan;
  const find = prisma.chapter.findFirst, transaction = prisma.$transaction;
  plannerService.getChapterPlan = async () => ({ id: "old", scenes: [{}], rawPlanJson: "{}" });
  plannerService.generateChapterPlan = async () => ({ id: "refreshed" });
  prisma.chapter.findFirst = async () => ({ content: "", order: 3, taskSheet: "章级合同" });
  prisma.$transaction = async (run) => run({ chapter: { findMany: async () => [] }, novelFactEntry: { findMany: async () => [] } });
  try { assert.equal((await plannerService.ensureChapterPlan("novel", "chapter")).id, "refreshed"); }
  finally { plannerService.getChapterPlan = get; plannerService.generateChapterPlan = generate; prisma.chapter.findFirst = find; prisma.$transaction = transaction; }
});
