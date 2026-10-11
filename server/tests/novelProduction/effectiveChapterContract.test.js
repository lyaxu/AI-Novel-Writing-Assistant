const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeChapterScenePlan } = require("../../../shared/dist/types/chapterLengthControl.js");
const { projectEffectiveChapterPlan, isPlanForCurrentContract } = require("../../dist/services/planner/contracts/index.js");
const { buildChapterExecutionContractHash, persistStoryPlan } = require("../../dist/services/planner/plannerPersistence.js");
const { prisma } = require("../../dist/db/prisma.js");

function contract() {
  return { expectation: "守住递信承诺", taskSheet: "进入后门，交付信件，承受选择后果", targetWordCount: 2800,
    mustAvoid: "不得提前揭开收信者身份", hook: "门内传来熟悉的声音",
    sceneCards: JSON.stringify(normalizeChapterScenePlan(Array.from({ length: 3 }, (_, index) => ({
      key: `approved-${index}`, title: `场景${index}`, purpose: `交信步骤${index}`, mustAdvance: [`义务${index}`],
      mustPreserve: ["递信动机"], entryState: "等待", exitState: "承担后果", targetWordCount: 900,
      resistance: "守卫质疑", turn: "出示信封", emotionalShift: "犹豫转为坚决",
    })), 2800)),
  };
}

test("writer plan view uses the approved contract while retaining detailed creative turns", () => {
  const chapter = contract();
  const plan = { id: "p", objective: "改走正门并揭密", mustAdvance: ["互斥义务"], mustPreserve: [],
    reveals: ["收信者身份"], participants: ["messenger"], riskNotes: [], hookTarget: "离城", scenes: [],
    rawPlanJson: JSON.stringify({ executionContractHash: buildChapterExecutionContractHash(chapter) }),
  };
  const view = projectEffectiveChapterPlan(plan, chapter);
  assert.equal(view.objective, chapter.expectation);
  assert.equal(view.hookTarget, chapter.hook);
  assert.deepEqual(view.mustAdvance, ["义务0", "义务1", "义务2"]);
  assert.equal(view.scenes[0].conflict, "守卫质疑");
  assert.equal(view.scenes[0].emotionBeat, "犹豫转为坚决");
  assert.deepEqual(view.participants, ["messenger"]);
  assert.equal(JSON.stringify(view.scenes).includes("正门"), false);
  assert.equal(projectEffectiveChapterPlan(plan, { ...chapter, taskSheet: "人工修订" }), null);
  assert.equal(isPlanForCurrentContract({ rawPlanJson: null }, chapter), false);
});

test("unstructured saved legacy contract is read without inventing scene cards", () => {
  const chapter = { taskSheet: "旧任务", sceneCards: null };
  const plan = { rawPlanJson: JSON.stringify({ executionContractHash: buildChapterExecutionContractHash(chapter) }), scenes: [{ title: "旧场景" }] };
  assert.equal(projectEffectiveChapterPlan(plan, chapter), plan);
  assert.equal(projectEffectiveChapterPlan(null, chapter), null);
});

for (const change of [{ taskSheet: "human change" }, { content: "human prose" }, { novelId: "other-book" }]) {
  test(`planning commit rejects concurrent chapter changes before any writes: ${Object.keys(change)[0]}`, async () => {
    const original = { transaction: prisma.$transaction, find: prisma.storyPlan.findFirst };
    const base = contract(); let writes = 0;
    prisma.storyPlan.findFirst = async () => null;
    prisma.$transaction = async (work) => work({
      chapter: { findUnique: async () => ({ ...base, novelId: "n", content: "", ...change }) },
      storyPlan: { create: async () => { writes++; } },
    });
    try {
      await assert.rejects(persistStoryPlan({ novelId: "n", chapterId: "c", level: "chapter", title: "chapter", objective: "goal",
        participants: [], reveals: [], riskNotes: [], mustAdvance: [], mustPreserve: [], sourceIssueIds: [],
        replannedFromPlanId: null, hookTarget: null, scenes: [], baseExecutionContract: base, baseChapterContent: "",
      }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
      assert.equal(writes, 0);
    } finally { prisma.$transaction = original.transaction; prisma.storyPlan.findFirst = original.find; }
  });
}
