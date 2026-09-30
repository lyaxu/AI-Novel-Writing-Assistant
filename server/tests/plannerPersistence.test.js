const assert = require("node:assert/strict");
const test = require("node:test");
const { prisma } = require("../dist/db/prisma.js");
const {
  buildChapterExecutionContractHash,
  persistStoryPlan,
  readPlanExecutionContractHash,
  STORY_PLAN_PERSISTENCE_TRANSACTION_TIMEOUT_MS,
} = require("../dist/services/planner/plannerPersistence.js");
const { normalizeChapterScenePlan, parseChapterScenePlan } = require("../../shared/dist/types/chapterLengthControl.js");

test("persistStoryPlan uses an explicit timeout for planning writes", async () => {
  const original = {
    findFirst: prisma.storyPlan.findFirst,
    findUnique: prisma.storyPlan.findUnique,
    transaction: prisma.$transaction,
  };
  let receivedOptions = null;

  prisma.storyPlan.findFirst = async () => null;
  prisma.$transaction = async (callback, options) => {
    receivedOptions = options;
    return callback({
      storyPlan: {
        create: async () => ({ id: "plan-timeout" }),
      },
      chapterPlanScene: {
        deleteMany: async () => undefined,
      },
    });
  };
  prisma.storyPlan.findUnique = async () => ({
    id: "plan-timeout",
    novelId: "novel-1",
    chapterId: null,
    level: "book",
    title: "全书规划",
    objective: "建立全书主线",
    participantsJson: JSON.stringify([]),
    revealsJson: JSON.stringify([]),
    riskNotesJson: JSON.stringify([]),
    mustAdvanceJson: JSON.stringify([]),
    mustPreserveJson: JSON.stringify([]),
    sourceIssueIdsJson: JSON.stringify([]),
    replannedFromPlanId: null,
    hookTarget: null,
    status: "draft",
    externalRef: null,
    rawPlanJson: JSON.stringify({ ok: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
    scenes: [],
  });

  try {
    await persistStoryPlan({
      novelId: "novel-1",
      level: "book",
      title: "全书规划",
      objective: "建立全书主线",
      participants: [],
      reveals: [],
      riskNotes: [],
      mustAdvance: [],
      mustPreserve: [],
      sourceIssueIds: [],
      replannedFromPlanId: null,
      hookTarget: null,
      scenes: [],
    });

    assert.ok(receivedOptions);
    assert.equal(receivedOptions.timeout, STORY_PLAN_PERSISTENCE_TRANSACTION_TIMEOUT_MS);
    assert.ok(receivedOptions.timeout > 5000);
  } finally {
    prisma.storyPlan.findFirst = original.findFirst;
    prisma.storyPlan.findUnique = original.findUnique;
    prisma.$transaction = original.transaction;
  }
});

test("chapter execution contract hash is stable and readable from plan metadata", () => {
  const hash = buildChapterExecutionContractHash({
    expectation: "  第一章目标\n",
    targetWordCount: 3000,
    revealLevel: 1,
    mustAvoid: "不要提前揭密",
    taskSheet: "任务单\n必须推进",
    sceneCards: "场景卡",
    hook: "章末钩子",
  });

  assert.equal(hash.length, 64);
  assert.equal(
    hash,
    buildChapterExecutionContractHash({
      expectation: "第一章目标",
      targetWordCount: 3000,
      revealLevel: 1,
      mustAvoid: "不要提前揭密",
      taskSheet: "任务单 必须推进",
      sceneCards: "场景卡",
      hook: "章末钩子",
    }),
  );
  assert.equal(readPlanExecutionContractHash(JSON.stringify({ executionContractHash: hash })), hash);
  assert.equal(readPlanExecutionContractHash(JSON.stringify({ ok: true })), null);
});

test("persistStoryPlan syncs chapter assets and promotes empty chapters to pending_generation", async () => {
  const original = {
    findFirst: prisma.storyPlan.findFirst,
    findUnique: prisma.storyPlan.findUnique,
    transaction: prisma.$transaction,
  };
  const captured = {
    chapterUpdate: null,
    persistedSceneRows: null,
  };

  prisma.storyPlan.findFirst = async () => null;
  prisma.$transaction = async (callback) => callback({
    storyPlan: {
      create: async () => ({ id: "plan-1" }),
    },
    chapterPlanScene: {
      deleteMany: async () => undefined,
      createMany: async ({ data }) => {
        captured.persistedSceneRows = data;
      },
    },
    chapter: {
      findUnique: async () => ({
        content: "",
        chapterStatus: "unplanned",
      }),
      update: async ({ data }) => {
        captured.chapterUpdate = data;
        return { id: "chapter-1", ...data };
      },
    },
  });
  prisma.storyPlan.findUnique = async () => ({
    id: "plan-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    level: "chapter",
    title: "第1章计划",
    objective: "推进主线冲突并建立章节悬念",
    participantsJson: JSON.stringify(["主角", "对手"]),
    revealsJson: JSON.stringify(["关键线索"]),
    riskNotesJson: JSON.stringify(["不要提前泄底"]),
    mustAdvanceJson: JSON.stringify(["推动冲突升级"]),
    mustPreserveJson: JSON.stringify(["保留主角求生动机"]),
    sourceIssueIdsJson: JSON.stringify([]),
    replannedFromPlanId: null,
    hookTarget: "结尾抛出更大的风险",
    status: "draft",
    externalRef: null,
    rawPlanJson: JSON.stringify({ ok: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
    scenes: [
      {
        id: "scene-1",
        planId: "plan-1",
        sortOrder: 1,
        title: "初次交锋",
        objective: "把主角逼进选择",
        conflict: "双方试探并施压",
        reveal: "线索第一次露面",
        emotionBeat: "压迫感上升",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "scene-2",
        planId: "plan-1",
        sortOrder: 2,
        title: "被迫应对",
        objective: "让主角做出第一次反击",
        conflict: "对手压迫升级",
        reveal: "主角发现对手并非临时起意",
        emotionBeat: "怒意压过恐惧",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "scene-3",
        planId: "plan-1",
        sortOrder: 3,
        title: "尾段钩子",
        objective: "把下一轮风险钉死",
        conflict: "更大势力准备下场",
        reveal: "幕后黑手露出轮廓",
        emotionBeat: "危机继续抬高",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });

  try {
    const persisted = await persistStoryPlan({
      novelId: "novel-1",
      chapterId: "chapter-1",
      level: "chapter",
      title: "第1章计划",
      objective: "推进主线冲突并建立章节悬念",
      targetWordCount: 3600,
      participants: ["主角", "对手"],
      reveals: ["关键线索"],
      riskNotes: ["不要提前泄底"],
      mustAdvance: ["推动冲突升级"],
      mustPreserve: ["保留主角求生动机"],
      sourceIssueIds: [],
      replannedFromPlanId: null,
      hookTarget: "结尾抛出更大的风险",
      scenes: [
        {
          title: "初次交锋",
          objective: "把主角逼进选择",
          conflict: "双方试探并施压",
          reveal: "线索第一次露面",
          emotionBeat: "压迫感上升",
        },
        {
          title: "被迫应对",
          objective: "让主角做出第一次反击",
          conflict: "对手压迫升级",
          reveal: "主角发现对手并非临时起意",
          emotionBeat: "怒意压过恐惧",
        },
        {
          title: "尾段钩子",
          objective: "把下一轮风险钉死",
          conflict: "更大势力准备下场",
          reveal: "幕后黑手露出轮廓",
          emotionBeat: "危机继续抬高",
        },
      ],
    });

    assert.equal(persisted.id, "plan-1");
    assert.equal(captured.persistedSceneRows.length, 3);
    assert.equal(captured.chapterUpdate.expectation, "推进主线冲突并建立章节悬念");
    assert.equal(captured.chapterUpdate.chapterStatus, "pending_generation");
    assert.match(captured.chapterUpdate.taskSheet, /章节目标：推进主线冲突并建立章节悬念/);
    assert.match(captured.chapterUpdate.taskSheet, /必须推进：/);
    assert.match(captured.chapterUpdate.taskSheet, /保留主角求生动机/);
    assert.match(captured.chapterUpdate.taskSheet, /收尾钩子：结尾抛出更大的风险/);
    const parsedScenePlan = parseChapterScenePlan(captured.chapterUpdate.sceneCards, {
      targetWordCount: 3600,
    });
    assert.ok(parsedScenePlan);
    assert.equal(parsedScenePlan.targetWordCount, 3600);
    assert.equal(parsedScenePlan.scenes.length, 3);
    assert.ok(parsedScenePlan.scenes.every((scene) => scene.mustPreserve.length === 0));
    assert.equal(parsedScenePlan.scenes[0].title, "初次交锋");
    assert.deepEqual(parsedScenePlan.scenes[0].mustAdvance, [
      "把主角逼进选择",
      "线索第一次露面",
      "双方试探并施压",
    ]);
    assert.equal(parsedScenePlan.scenes[1].entryState, "线索第一次露面");
    assert.equal(parsedScenePlan.scenes[2].exitState, "幕后黑手露出轮廓");
    assert.equal(captured.chapterUpdate.hook, "结尾抛出更大的风险");
  } finally {
    prisma.storyPlan.findFirst = original.findFirst;
    prisma.storyPlan.findUnique = original.findUnique;
    prisma.$transaction = original.transaction;
  }
});

test("persistStoryPlan skips sceneCards sync when planner scenes cannot form a canonical contract", async () => {
  const original = {
    findFirst: prisma.storyPlan.findFirst,
    findUnique: prisma.storyPlan.findUnique,
    transaction: prisma.$transaction,
  };
  let chapterUpdate = null;

  prisma.storyPlan.findFirst = async () => null;
  prisma.$transaction = async (callback) => callback({
    storyPlan: {
      create: async () => ({ id: "plan-3" }),
    },
    chapterPlanScene: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    chapter: {
      findUnique: async () => ({
        content: "",
        chapterStatus: "unplanned",
      }),
      update: async ({ data }) => {
        chapterUpdate = data;
        return { id: "chapter-3", ...data };
      },
    },
  });
  prisma.storyPlan.findUnique = async () => ({
    id: "plan-3",
    novelId: "novel-1",
    chapterId: "chapter-3",
    level: "chapter",
    title: "第3章计划",
    objective: "推进单一场景冲突",
    participantsJson: JSON.stringify(["主角"]),
    revealsJson: JSON.stringify([]),
    riskNotesJson: JSON.stringify([]),
    mustAdvanceJson: JSON.stringify(["推进单一场景冲突"]),
    mustPreserveJson: JSON.stringify(["保留压迫感"]),
    sourceIssueIdsJson: JSON.stringify([]),
    replannedFromPlanId: null,
    hookTarget: null,
    status: "draft",
    externalRef: null,
    rawPlanJson: JSON.stringify({ ok: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
    scenes: [{
      id: "scene-1",
      planId: "plan-3",
      sortOrder: 1,
      title: "唯一场景",
      objective: "单点推进",
      conflict: "正面压迫",
      reveal: "危险坐实",
      emotionBeat: "紧绷",
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  });

  try {
    await persistStoryPlan({
      novelId: "novel-1",
      chapterId: "chapter-3",
      level: "chapter",
      title: "第3章计划",
      objective: "推进单一场景冲突",
      targetWordCount: 1800,
      participants: ["主角"],
      reveals: [],
      riskNotes: [],
      mustAdvance: ["推进单一场景冲突"],
      mustPreserve: ["保留压迫感"],
      sourceIssueIds: [],
      replannedFromPlanId: null,
      hookTarget: null,
      scenes: [{
        title: "唯一场景",
        objective: "单点推进",
        conflict: "正面压迫",
        reveal: "危险坐实",
        emotionBeat: "紧绷",
      }],
    });

    assert.equal(chapterUpdate.expectation, "推进单一场景冲突");
    assert.equal(chapterUpdate.sceneCards, undefined);
    assert.match(chapterUpdate.taskSheet, /章节目标：推进单一场景冲突/);
    assert.equal(chapterUpdate.chapterStatus, "pending_generation");
  } finally {
    prisma.storyPlan.findFirst = original.findFirst;
    prisma.storyPlan.findUnique = original.findUnique;
    prisma.$transaction = original.transaction;
  }
});

test("persistStoryPlan keeps chapter status unchanged when正文 already exists", async () => {
  const original = {
    findFirst: prisma.storyPlan.findFirst,
    findUnique: prisma.storyPlan.findUnique,
    transaction: prisma.$transaction,
  };
  let chapterUpdate = null;

  prisma.storyPlan.findFirst = async () => null;
  prisma.$transaction = async (callback) => callback({
    storyPlan: {
      create: async () => ({ id: "plan-2" }),
    },
    chapterPlanScene: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    chapter: {
      findUnique: async () => ({
        content: "已有正文",
        chapterStatus: "pending_review",
      }),
      update: async ({ data }) => {
        chapterUpdate = data;
        return { id: "chapter-2", ...data };
      },
    },
  });
  prisma.storyPlan.findUnique = async () => ({
    id: "plan-2",
    novelId: "novel-1",
    chapterId: "chapter-2",
    level: "chapter",
    title: "第2章计划",
    objective: "调整后续冲突节奏",
    participantsJson: JSON.stringify([]),
    revealsJson: JSON.stringify([]),
    riskNotesJson: JSON.stringify([]),
    mustAdvanceJson: JSON.stringify([]),
    mustPreserveJson: JSON.stringify([]),
    sourceIssueIdsJson: JSON.stringify([]),
    replannedFromPlanId: null,
    hookTarget: null,
    status: "draft",
    externalRef: null,
    rawPlanJson: JSON.stringify({ ok: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
    scenes: [],
  });

  try {
    await persistStoryPlan({
      novelId: "novel-1",
      chapterId: "chapter-2",
      level: "chapter",
      title: "第2章计划",
      objective: "调整后续冲突节奏",
      participants: [],
      reveals: [],
      riskNotes: [],
      mustAdvance: [],
      mustPreserve: [],
      sourceIssueIds: [],
      replannedFromPlanId: null,
      hookTarget: null,
      scenes: [],
    });

    assert.equal(chapterUpdate.expectation, "调整后续冲突节奏");
    assert.equal("chapterStatus" in chapterUpdate, true);
    assert.equal(chapterUpdate.chapterStatus, undefined);
  } finally {
    prisma.storyPlan.findFirst = original.findFirst;
    prisma.storyPlan.findUnique = original.findUnique;
    prisma.$transaction = original.transaction;
  }
});

async function captureChapterPlanPersistence(baseExecutionContract) {
  const original = {
    findFirst: prisma.storyPlan.findFirst,
    findUnique: prisma.storyPlan.findUnique,
    transaction: prisma.$transaction,
  };
  const captured = { chapterUpdate: null, plan: null, scenes: null };
  prisma.storyPlan.findFirst = async () => null;
  prisma.$transaction = async (callback) => callback({
    storyPlan: {
      create: async ({ data }) => {
        captured.plan = data;
        return { id: "runtime-suggestion" };
      },
    },
    chapterPlanScene: {
      deleteMany: async () => undefined,
      createMany: async ({ data }) => { captured.scenes = data; },
    },
    chapter: {
      findUnique: async () => ({ content: "", chapterStatus: "unplanned" }),
      update: async ({ data }) => { captured.chapterUpdate = data; },
    },
  });
  prisma.storyPlan.findUnique = async () => ({
    id: "runtime-suggestion",
    ...captured.plan,
    createdAt: new Date(),
    updatedAt: new Date(),
    scenes: [],
  });
  try {
    await persistStoryPlan({
      novelId: "novel-1",
      chapterId: "chapter-1",
      level: "chapter",
      title: "运行时建议",
      objective: "运行时另拟章节目标",
      targetWordCount: 2800,
      participants: ["新角色"],
      reveals: ["新揭示"],
      riskNotes: ["新风险"],
      mustAdvance: ["另行推进冲突"],
      mustPreserve: ["新保留事项"],
      sourceIssueIds: [],
      replannedFromPlanId: null,
      hookTarget: "运行时另拟钩子",
      baseExecutionContract,
      scenes: Array.from({ length: 5 }, (_, index) => ({
        title: `建议场景 ${index + 1}`,
        objective: `建议行动 ${index + 1}`,
        conflict: "新冲突",
        reveal: "新发现",
      })),
    });
    return captured;
  } finally {
    prisma.storyPlan.findFirst = original.findFirst;
    prisma.storyPlan.findUnique = original.findUnique;
    prisma.$transaction = original.transaction;
  }
}

test("runtime story plan preserves the complete chapter contract and hashes the preserved assets", async () => {
  const baseExecutionContract = {
    expectation: "已审章节目标",
    targetWordCount: 2800,
    conflictLevel: 2,
    revealLevel: 1,
    mustAvoid: "不得提前揭密",
    taskSheet: "已审任务单：保留唯一事件和明确结果",
    sceneCards: JSON.stringify(normalizeChapterScenePlan(Array.from({ length: 4 }, (_, index) => ({
      key: `approved-${index + 1}`,
      title: `已审场景 ${index + 1}`,
      purpose: "推进已审事件",
      resistance: "守卫要求出示通行凭据",
      causality: {
        actor: "信使", choice: "出示已取得的凭据", motive: "兑现递信承诺",
        prerequisites: [{ condition: "持有凭据", sourceKind: "established_in_context", reference: "前章交付凭据" }],
        resistanceResponse: "守卫核对印章", outcomeMechanism: "核验成功后放行",
        resultingConstraints: [{ constraint: "凭据被收回", persistence: "本次通行后" }],
      },
      entryState: "保留原始局势",
      exitState: "完成规定结果",
      targetWordCount: 700,
    })), 2800)),
    hook: "已审收尾钩子",
  };
  const captured = await captureChapterPlanPersistence(baseExecutionContract);

  // The new objective/scenes remain readable as StoryPlan suggestions.
  assert.equal(captured.plan.objective, "运行时另拟章节目标");
  assert.equal(captured.scenes.length, 5);
  assert.equal(captured.scenes[0].title, "建议场景 1");
  // No execution field may be overwritten, including the 2,800-word budget.
  assert.deepEqual(captured.chapterUpdate, { chapterStatus: "pending_generation" });
  const preserved = { ...baseExecutionContract, ...captured.chapterUpdate };
  assert.equal(preserved.targetWordCount, 2800);
  assert.equal(JSON.parse(preserved.sceneCards).targetWordCount, 2800);
  assert.equal(JSON.parse(preserved.sceneCards).scenes[0].causality.outcomeMechanism, "核验成功后放行");
  assert.equal(JSON.parse(preserved.sceneCards).scenes[0].resistance, "守卫要求出示通行凭据");
  assert.equal(preserved.mustAvoid, "不得提前揭密");
  const hash = readPlanExecutionContractHash(captured.plan.rawPlanJson);
  assert.equal(hash, buildChapterExecutionContractHash(baseExecutionContract));
  assert.notEqual(hash, buildChapterExecutionContractHash({
    ...baseExecutionContract,
    expectation: captured.plan.objective,
    hook: captured.plan.hookTarget,
  }));
});

test("runtime story plan can initialize missing chapter assets and hashes those initialized assets", async () => {
  const baseExecutionContract = {
    expectation: "待完善章节目标",
    targetWordCount: 2800,
    conflictLevel: 2,
    revealLevel: 1,
    mustAvoid: "不得提前揭密",
    taskSheet: null,
    sceneCards: null,
    hook: null,
  };
  const captured = await captureChapterPlanPersistence(baseExecutionContract);
  assert.equal(captured.chapterUpdate.expectation, "运行时另拟章节目标");
  assert.match(captured.chapterUpdate.taskSheet, /另行推进冲突/);
  const scenes = parseChapterScenePlan(captured.chapterUpdate.sceneCards);
  assert.equal(scenes.scenes.length, 5);
  assert.equal(scenes.scenes[0].title, "建议场景 1");
  assert.equal(captured.chapterUpdate.hook, "运行时另拟钩子");
  assert.equal(
    readPlanExecutionContractHash(captured.plan.rawPlanJson),
    buildChapterExecutionContractHash({ ...baseExecutionContract, ...captured.chapterUpdate }),
  );
});
