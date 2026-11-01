const test = require("node:test");
const assert = require("node:assert/strict");

const carry = require("../dist/services/novel/volume/planningRepair/capacityCarryOver.js");
const { parseChapterScenePlan } = require("@ai-novel/shared/types/chapterLengthControl");
const { evaluateChapterCapacity } = require("@ai-novel/shared/types/chapterCapacity");

const DEBT = [
  "用批条去城外药铺提货\n交付周明远",
  "三成利第一次实际抽成",
  "用一笔明面亏损交易引开巡查注意力并换得巡查排班情报",
];

test("carry-over plan writes every deferred duty into capacity plan, required elements and scenes", () => {
  const plan = carry.buildCapacityCarryOverChapterPlan({
    novelId: "n", volumeId: "v", chapterOrder: 4, targetWordCount: 2800, debtItems: DEBT,
  });
  assert.equal(plan.chapterOrder, 4);
  assert.equal(plan.volumeId, "v");
  assert.equal(plan.chapterId, null);
  const scenePlan = parseChapterScenePlan(plan.sceneCards, { targetWordCount: plan.targetWordCount });
  assert.ok(scenePlan?.capacityPlan);
  assert.equal(scenePlan.capacityPlan.mustDeliver.length, 3);
  for (const debt of DEBT) {
    const normalized = debt.replace(/\s+/g, " ").trim();
    assert.ok(scenePlan.capacityPlan.mustDeliver.includes(normalized), `mustDeliver missing ${debt}`);
    assert.ok(scenePlan.requiredElements.includes(normalized), `requiredElements missing ${debt}`);
    assert.ok(scenePlan.scenes.some((scene) => scene.mustAdvance.some((action) => action.includes(normalized))),
      `scene action missing ${debt}`);
  }
  const capacity = evaluateChapterCapacity({
    targetWordCount: plan.targetWordCount,
    exclusiveEvent: plan.exclusiveEvent,
    requiredElements: scenePlan.requiredElements,
    sceneMustAdvance: scenePlan.scenes.flatMap((scene) => scene.mustAdvance),
    sceneCount: scenePlan.scenes.length,
    capacityPlan: scenePlan.capacityPlan,
  });
  assert.equal(capacity.passed, true, JSON.stringify(capacity.violations));
  assert.equal(plan.deferable, undefined);
});

test("duplicate deferred duties are carried once", () => {
  const plan = carry.buildCapacityCarryOverChapterPlan({
    novelId: "n", volumeId: "v", chapterOrder: 2, targetWordCount: 2800,
    debtItems: ["同一项职责", "同一项职责", " 同一项职责 "],
  });
  const scenePlan = parseChapterScenePlan(plan.sceneCards, { targetWordCount: plan.targetWordCount });
  assert.equal(scenePlan.capacityPlan.mustDeliver.length, 1);
  assert.equal(scenePlan.requiredElements.length, 1);
});

test("same-volume budget allows one next chapter only while volume and book have room", () => {
  const allowed = carry.decideCapacityExtensionBudget({ volumeOrder: 1, currentLastOrder: 3, targetChapterCount: 100 });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.nextOrder, 4);
  assert.ok(allowed.volumeBudgetEnd >= 4);
  const bookEnd = carry.decideCapacityExtensionBudget({ volumeOrder: 1, currentLastOrder: 100, targetChapterCount: 100 });
  assert.equal(bookEnd.allowed, false);
  assert.equal(bookEnd.reason, "book_target_reached");
  const exhausted = carry.decideCapacityExtensionBudget({
    volumeOrder: 1, currentLastOrder: 50, targetChapterCount: 100,
    budget: { volumes: [{ sortOrder: 1, startChapter: 1, endChapter: 50, chapterCount: 50 }] },
  });
  assert.equal(exhausted.allowed, false);
  assert.equal(exhausted.reason, "volume_budget_exhausted");
  const missingVolume = carry.decideCapacityExtensionBudget({ volumeOrder: 9, currentLastOrder: 3, targetChapterCount: 100 });
  assert.equal(missingVolume.allowed, false);
});

test("auto extension count is configurable but capped at two", () => {
  assert.equal(carry.resolveMaxCapacityAutoExtensions(undefined), 2);
  assert.equal(carry.resolveMaxCapacityAutoExtensions(5), 2);
  assert.equal(carry.resolveMaxCapacityAutoExtensions(1), 1);
  assert.equal(carry.resolveMaxCapacityAutoExtensions(0), 1);
});

test("commit seed patch extends task range instead of leaving it at the old end", () => {
  const seed = {
    autoExecution: { startOrder: 1, endOrder: 3, totalChapterCount: 3, completedChapterCount: 2, remainingChapterCount: 1, scopeLabel: "第 1-3 章" },
    autoExecutionPlan: { mode: "chapter_range", startOrder: 1, endOrder: 3 },
  };
  const patch = carry.buildCapacityExtensionSeedPatch({ seed, chapterOrder: 4, extensionCount: 1, maxExtensions: 2 });
  assert.equal(patch.autoExecution.endOrder, 4);
  assert.equal(patch.autoExecution.totalChapterCount, 4);
  assert.equal(patch.autoExecution.remainingChapterCount, 2);
  assert.equal(patch.autoExecution.scopeLabel, "第 1-4 章");
  assert.equal(patch.autoExecutionPlan.endOrder, 4);
  assert.equal(patch.capacityAutoExtension.count, 1);
  assert.equal(patch.capacityAutoExtension.lastChapterOrder, 4);
});
