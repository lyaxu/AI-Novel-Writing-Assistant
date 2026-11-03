const test = require("node:test");
const assert = require("node:assert/strict");

const debt = require("../dist/services/novel/volume/planningRepair/planningQualityDebt.js");

const semanticIssue = { id: "zhao_batch_authority_unestablished", severity: "medium", target: "semantic", summary: "批条权限缺少桥梁" };

test("exhausted repair + exhausted auto extension + continuable findings is accepted as planning debt", () => {
  const decision = debt.classifyPlanningQualityDebtAcceptance({
    rounds: 2, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: false,
    issues: [semanticIssue, { id: "selected_direction_drift", severity: "medium", target: "semantic" }],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.source, "planning_repair_exhausted");
  assert.ok(decision.reasons.includes("planning_repair_rounds_exhausted"));
  assert.ok(decision.reasons.includes("auto_extension_exhausted"));
});

test("an invalid review response is continuable once budget and extension are exhausted", () => {
  const decision = debt.classifyPlanningQualityDebtAcceptance({
    rounds: 2, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: true, issues: [],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.source, "review_response_invalid");
});

test("high-severity semantic/horizon findings are continuable when no hard boundary is involved", () => {
  const decision = debt.classifyPlanningQualityDebtAcceptance({
    rounds: 2, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: false,
    issues: [
      { id: "prior_debt_and_herbs_unverified", severity: "high", target: "semantic", summary: "第5章引用了第4章候选合同未写入正文的事实" },
      { id: "capacity_must_deliver_over_budget", severity: "high", target: "semantic" },
    ],
  });
  assert.equal(decision.allowed, true);
});

test("auto extension can only resolve debt when the source chapter has no later carrier", () => {
  assert.equal(debt.capacityExtensionCouldResolveDebt({
    capacityDebt: [{ suggestedChapterId: null }], extensionCount: 0, maxExtensions: 2, budgetAllowed: true,
  }), true);
  assert.equal(debt.capacityExtensionCouldResolveDebt({
    capacityDebt: [{ suggestedChapterId: null }, { suggestedChapterId: "chapter-5" }],
    extensionCount: 0, maxExtensions: 2, budgetAllowed: true,
  }), false);
  assert.equal(debt.capacityExtensionCouldResolveDebt({
    capacityDebt: [{ suggestedChapterId: null }], extensionCount: 2, maxExtensions: 2, budgetAllowed: true,
  }), false);
  assert.equal(debt.capacityExtensionCouldResolveDebt({
    capacityDebt: [], extensionCount: 0, maxExtensions: 2, budgetAllowed: true,
  }), false);
});

test("budget or extension still available is never accepted as debt", () => {
  assert.equal(debt.classifyPlanningQualityDebtAcceptance({
    rounds: 1, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: true, issues: [],
  }).allowed, false);
  assert.equal(debt.classifyPlanningQualityDebtAcceptance({
    rounds: 2, maxRounds: 2, autoExtensionExhausted: false, reviewInvalid: true, issues: [],
  }).allowed, false);
});

test("data-integrity / lease / prose / ownership defects never become planning debt", () => {
  for (const issue of [
    { id: "lease_conflict", severity: "high", target: "runtime" },
    { id: "written_prose_changed", severity: "high", target: "content" },
    { id: "chapter_ownership_conflict", severity: "high", target: "runtime" },
    { id: "unknown_external_call", severity: "high", target: "runtime" },
    { id: "data_integrity_broken", severity: "critical", target: "semantic" },
  ]) {
    const decision = debt.classifyPlanningQualityDebtAcceptance({
      rounds: 2, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: false, issues: [issue],
    });
    assert.equal(decision.allowed, false, issue.id);
  }
});

test("a window that requires an author decision is not converted into debt", () => {
  const decision = debt.classifyPlanningQualityDebtAcceptance({
    rounds: 2, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: false,
    issues: [semanticIssue], windowRequiresUserDecision: true,
  });
  assert.equal(decision.allowed, false);
});

test("accepted debt record keeps findings, capacity debt and policy acceptance", () => {
  const decision = debt.classifyPlanningQualityDebtAcceptance({
    rounds: 2, maxRounds: 2, autoExtensionExhausted: true, reviewInvalid: false,
    issues: [semanticIssue, { id: "capacity_deferable_requires_redistribution", severity: "high", target: "semantic" }],
  });
  const record = debt.buildPlanningQualityDebtRecord({
    repairKey: "repair-key", candidateVersionId: "version-1", chapterId: "chapter-3", chapterOrder: 3,
    classification: decision, capacityDebt: [{ item: "提货交付" }], acceptedAt: "2026-11-02T00:00:00.000Z",
  });
  assert.equal(record.kind, "planning_quality_debt");
  assert.equal(record.repairKey, "repair-key");
  assert.equal(record.candidateVersionId, "version-1");
  assert.equal(record.chapterOrder, 3);
  assert.equal(record.issues.length, 2);
  assert.equal(record.capacityDebt.length, 1);
  assert.equal(record.acceptedByPolicy, true);
  assert.equal(record.acceptedAt, "2026-11-02T00:00:00.000Z");
});
