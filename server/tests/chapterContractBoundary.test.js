const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildChapterPayoffDirectives,
  buildChapterStateGoal,
  buildChapterPlanningReferenceCandidates,
} = require("../dist/services/novel/production/ContextAssemblyService.js");

function createPayoff(overrides) {
  return {
    id: overrides.id ?? overrides.ledgerKey,
    ledgerKey: overrides.ledgerKey,
    title: overrides.title,
    summary: overrides.summary ?? `${overrides.title} summary`,
    currentStatus: overrides.currentStatus,
    targetStartChapterOrder: overrides.targetStartChapterOrder ?? null,
    targetEndChapterOrder: overrides.targetEndChapterOrder ?? null,
    statusReason: overrides.statusReason ?? null,
  };
}

function createSnapshot(payoffs) {
  return {
    narrative: {
      currentChapterOrder: 3,
      overduePayoffs: payoffs.filter((item) => item.currentStatus === "overdue"),
      urgentPayoffs: payoffs.filter((item) => item.currentStatus === "pending_payoff"),
      pendingPayoffs: payoffs.filter((item) => item.currentStatus === "setup" || item.currentStatus === "hinted"),
    },
  };
}

test("ledger age alone authorizes neither pressure nor payoff", () => {
  const directives = buildChapterPayoffDirectives(createSnapshot([
    createPayoff({
      ledgerKey: "setup-later",
      title: "后续规则伏笔",
      currentStatus: "setup",
      targetStartChapterOrder: 8,
    }),
    createPayoff({
      ledgerKey: "hinted-now",
      title: "已经轻触的订单异常",
      currentStatus: "hinted",
    }),
    createPayoff({
      ledgerKey: "pending-now",
      title: "临近兑现的代价",
      currentStatus: "pending_payoff",
    }),
    createPayoff({
      ledgerKey: "overdue-now",
      title: "逾期未兑现的读者承诺",
      currentStatus: "overdue",
    }),
  ]), []);

  assert.deepEqual(
    directives.map((item) => [item.ledgerKey, item.operation]),
    [],
  );
});

test("chapter state keeps global conflicts and multi-stage arcs as inspectable references after rewrites", () => {
  for (const currentChapterGoal of ["普通新章目标", "前章重写后抵达新的落点"]) {
    const snapshot = createSnapshot([]);
    Object.assign(snapshot.narrative, {
      currentChapterId: "chapter-5", currentChapterGoal, hiddenKnowledge: ["不能提前公开的答案"],
      openConflicts: [{ id: "conflict-1", title: "someone goal changed", summary: "前章目标改变" },
        { id: "conflict-2", title: "continuity/issue", summary: "尚待核实的问题" }],
    });
    snapshot.characters = [{ name: "角色甲", relationStageLabels: ["初识", "合作", "最终收束"] }];
    const before = JSON.stringify(snapshot);
    const goal = buildChapterStateGoal(snapshot);
    assert.equal(goal.summary, currentChapterGoal);
    assert.deepEqual(goal.targetConflicts, []);
    assert.deepEqual(goal.targetRelationships, []);
    assert.deepEqual(goal.protectedSecrets, ["不能提前公开的答案"]);
    const references = buildChapterPlanningReferenceCandidates(snapshot);
    assert.equal(references.scope, "reference_candidates_not_chapter_obligations");
    assert.deepEqual(references.openConflicts, snapshot.narrative.openConflicts);
    assert.deepEqual(references.relationshipStages[0].stages, ["初识", "合作", "最终收束"]);
    assert.equal(JSON.stringify(snapshot), before);
  }
});

test("chapter payoff directives preserve explicitly selected AI forbid scope", () => {
  const directives = buildChapterPayoffDirectives(createSnapshot([
    createPayoff({
      ledgerKey: "self-recipient",
      title: "收件人其实是主角自己",
      summary: "订单真相会揭示收件人其实是主角自己。",
      currentStatus: "pending_payoff",
    }),
  ]), ["收件人其实是主角自己"], [{ ledgerKey: "self-recipient", operation: "forbid", reason: "模型判断本章不得揭露", authorizedScope: "收件人其实是主角自己" }]);

  assert.equal(directives.length, 1);
  assert.equal(directives[0].operation, "forbid");
  assert.equal(directives[0].forbiddenReveal, "收件人其实是主角自己");
});

test("AI-authorized reward is not forbidden merely because its ledger also mentions a secret origin", () => {
  const snapshot = createSnapshot([createPayoff({
    ledgerKey: "gift-with-secret-origin", title: "获得听风能力",
    summary: "信标来自旧文明，修好后可立即获得听风能力；来源仍保密。", currentStatus: "overdue",
  })]);
  Object.assign(snapshot.narrative, { currentChapterId: "chapter-3", hiddenKnowledge: ["信标来自旧文明"] });
  const goal = buildChapterStateGoal(snapshot, [{
    ledgerKey: "gift-with-secret-origin", operation: "payoff", reason: "能力获得与来源揭密是不同事项",
    authorizedScope: "获得并使用听风能力，不说明来源",
  }]);
  assert.equal(goal.targetPayoffDirectives[0].operation, "payoff");
  assert.equal(goal.targetPayoffDirectives[0].forbiddenReveal, null);
  assert.deepEqual(goal.protectedSecrets, ["信标来自旧文明"]);
});

test("AI-selected immediate and partial rewards reach writer without mandatory training or pressure", () => {
  const snapshot = createSnapshot([
    createPayoff({ ledgerKey: "gift", title: "确认设定允许突然获得能力", currentStatus: "overdue" }),
    createPayoff({ ledgerKey: "mystery", title: "线索局部答案", currentStatus: "pending_payoff" }),
    createPayoff({ ledgerKey: "later", title: "远期承诺", currentStatus: "setup" }),
  ]);
  const directives = buildChapterPayoffDirectives(snapshot, [], [
    { ledgerKey: "gift", operation: "payoff", reason: "已确认本章奖励", authorizedScope: "得到能力并现场使用" },
    { ledgerKey: "mystery", operation: "partial_reveal", reason: "只揭示位置", authorizedScope: "幕后身份不揭示" },
    { ledgerKey: "later", operation: "defer", reason: "未来章处理", authorizedScope: "不在本章处理" },
    { ledgerKey: "missing", operation: "payoff", reason: "无效旧项", authorizedScope: "忽略" },
  ]);
  assert.deepEqual(directives.map((item) => item.operation), ["payoff", "partial_reveal"]);
  assert.match(directives[0].reason, /得到能力并现场使用/);
});
