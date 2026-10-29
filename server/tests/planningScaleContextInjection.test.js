const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCommonNovelContext,
  buildVolumeCountGuidanceContext,
} = require("../dist/prompting/prompts/novel/volume/shared.js");
const {
  buildVolumeChapterDetailContextBlocks,
  buildVolumeChapterListContextBlocks,
} = require("../dist/prompting/prompts/novel/volume/contextBlocks.js");
const {
  buildChapterPlanContextBlocks,
} = require("../dist/services/planner/plannerContextBlocks.js");
const {
  plannerChapterPlanPrompt,
} = require("../dist/prompting/prompts/planner/plannerPlan.prompts.js");
const {
  buildVolumeChapterBudget,
  formatVolumeChapterBudgetLines,
} = require("../../shared/dist/types/planningScale.js");
const {
  buildVolumeCountGuidance,
} = require("../../shared/dist/types/volumePlanning.js");

function storyMacroPlanFixture() {
  return {
    expansion: {
      expanded_premise: "旧城里的人情账", protagonist_core: "主角替父亲还账",
      conflict_engine: "每还一笔账就揭开新的旧事", conflict_layers: { external: "债务", internal: "愧疚", relational: "邻里" },
      mystery_box: "父亲的旧案", emotional_line: "压抑到释然", setpiece_seeds: ["公开账本"], tone_reference: "冷峻市井",
    },
    decomposition: {
      selling_point: "旧城人情账", core_conflict: "留下还是离开", main_hook: "父亲旧案",
      progression_loop: "还账换真相", growth_path: "从躲避到担当", major_payoffs: ["账本公开"], ending_flavor: "余味",
    },
    constraints: ["不靠巧合解决债务"],
    bookBlueprint: {
      phases: [
        { stage: "opening", chapterStart: 1, chapterEnd: 20, goal: "建立困局", summary: "接下第一笔账" },
        { stage: "development", chapterStart: 21, chapterEnd: 50, goal: "扩展关系", summary: "旧账浮出" },
        { stage: "escalation", chapterStart: 51, chapterEnd: 75, goal: "外部压力", summary: "代价升级" },
        { stage: "climax", chapterStart: 76, chapterEnd: 95, goal: "正面对决", summary: "真相摊开" },
        { stage: "ending", chapterStart: 96, chapterEnd: 100, goal: "终局选择", summary: "支线收束" },
      ],
      ending: { outcome: "公开账本", cost: "失去退路", subplotClosures: ["父亲旧案", "邻里欠款"] },
    },
    foreshadowSchedule: [
      { id: "F01", question: "半张图是谁画的？", truth: "父亲留下的", content: "图上印鉴", plannedPayoff: "找到另一半图", plantChapter: 3, progressChapters: [20], revealChapter: 90 },
      { id: "F02", question: "账本缺页写了什么？", truth: "邻里欠款", content: "缺最后一页", plannedPayoff: "账本公开", plantChapter: 5, progressChapters: [40], revealChapter: 100 },
    ],
  };
}

function chapterFixture(order, id) {
  return {
    id: id ?? `chapter-${order}`,
    chapterOrder: order,
    title: `第${order}章`,
    summary: `第${order}章摘要`,
    purpose: null,
    exclusiveEvent: null,
    endingState: null,
    nextChapterEntryState: null,
    conflictLevel: null,
    revealLevel: null,
    targetWordCount: null,
    mustAvoid: null,
    payoffRefs: [],
    taskSheet: null,
    sceneCards: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function novelFixture(overrides = {}) {
  return {
    title: "旧城账本",
    description: "市井长篇",
    targetAudience: "男频",
    bookSellingPoint: "人情债与旧案",
    competingFeel: "市井悬疑",
    first30ChapterPromise: "前十章兑现第一笔账",
    commercialTagsJson: "[]",
    estimatedChapterCount: 100,
    defaultChapterLength: 2800,
    completionProfile: {
      mode: "serial_book",
      targetChapterCount: 100,
      maxChapterCount: 100,
      promiseScope: "first_30_chapters",
      structure: "serial_staged",
      endingRequiredBy: 100,
    },
    narrativePov: "third_person",
    pacePreference: "balanced",
    emotionIntensity: "medium",
    storyModePromptBlock: "",
    genre: { name: "都市" },
    characters: [],
    ...overrides,
  };
}

function workspaceFixture() {
  return {
    novelId: "novel-1",
    workspaceVersion: "v2",
    volumes: [],
    strategyPlan: null,
    critiqueReport: null,
    beatSheets: [],
    rebalanceDecisions: [],
    readiness: { ready: true, issues: [] },
    source: "volume",
    activeVersionId: null,
  };
}

test("volume planning context states the deterministic per-volume chapter budget", () => {
  const guidance = buildVolumeCountGuidance({ chapterBudget: 100, maxVolumeCount: 24 });
  const context = buildVolumeCountGuidanceContext(guidance);
  assert.match(context, /第 1 卷：50 章（第 1-50 章）/);
  assert.match(context, /第 2 卷：50 章（第 51-100 章）/);
  assert.match(context, /不得把所有章节挤进第一卷/);

  const novelContext = buildCommonNovelContext(novelFixture());
  assert.match(novelContext, /book volume budget/);
  assert.match(novelContext, /第 2 卷：50 章/);

  const defaultGuidance = buildVolumeCountGuidance({ chapterBudget: 80 });
  assert.match(buildVolumeCountGuidanceContext(defaultGuidance), /第 2 卷：40 章/);
});

test("chapter list context receives target volume budget and volume-filtered foreshadow schedule", () => {
  const storyMacroPlan = storyMacroPlanFixture();
  const volume = { id: "volume-1", sortOrder: 1, title: "第一卷", openPayoffs: [], chapters: [], createdAt: "", updatedAt: "" };
  const beat = { key: "opening", label: "开卷", summary: "打开冲突", mustDeliver: [], chapterSpanHint: "1-5章" };
  const blocks = buildVolumeChapterListContextBlocks({
    novel: novelFixture(),
    workspace: workspaceFixture(),
    storyMacroPlan,
    strategyPlan: null,
    targetVolume: volume,
    targetBeatSheet: { volumeId: volume.id, beats: [beat] },
    targetBeat: beat,
    targetBeatChapterCount: 5,
    targetChapterStartOrder: 1,
    targetChapterEndOrder: 5,
    nextAvailableChapterOrder: 1,
    guidance: undefined,
  });

  const budgetBlock = blocks.find((block) => block.id === "volume_chapter_budget");
  assert.ok(budgetBlock);
  assert.match(budgetBlock.content, /本卷预算/);
  assert.match(budgetBlock.content, /应拆 50 章/);
  assert.match(budgetBlock.content, /不能把所有章节都挤进第一卷/);

  const foreshadowBlock = blocks.find((block) => block.id === "foreshadow_schedule");
  assert.ok(foreshadowBlock);
  assert.match(foreshadowBlock.content, /\[伏笔:F01\]/);
  assert.match(foreshadowBlock.content, /埋设/);
  assert.match(foreshadowBlock.content, /第 3 章/);
  assert.match(foreshadowBlock.content, /不能把所有伏笔都挤到第一卷/);
});

test("chapter detail context only carries the actions scheduled for that chapter", () => {
  const storyMacroPlan = storyMacroPlanFixture();
  const volume = {
    id: "volume-1", sortOrder: 1, title: "第一卷", openPayoffs: [], createdAt: "", updatedAt: "",
    chapters: [chapterFixture(1), chapterFixture(3), chapterFixture(5), chapterFixture(7), chapterFixture(20)],
  };
  const buildInput = (chapterOrder) => ({
    novel: novelFixture(),
    workspace: workspaceFixture(),
    storyMacroPlan,
    strategyPlan: null,
    targetVolume: volume,
    targetBeatSheet: null,
    targetChapter: volume.chapters.find((chapter) => chapter.chapterOrder === chapterOrder) ?? chapterFixture(chapterOrder),
    detailMode: "task_sheet",
    guidance: undefined,
  });

  const plantBlocks = buildVolumeChapterDetailContextBlocks(buildInput(3));
  const plantBlock = plantBlocks.find((block) => block.id === "chapter_foreshadow_actions");
  assert.ok(plantBlock);
  assert.equal(plantBlock.required, true);
  assert.match(plantBlock.content, /\[伏笔:F01\]/);
  assert.match(plantBlock.content, /埋设/);
  assert.match(plantBlock.content, /要求：每条动作都必须在章纲 requiredElements/);

  const progressBlocks = buildVolumeChapterDetailContextBlocks(buildInput(20));
  const progressBlock = progressBlocks.find((block) => block.id === "chapter_foreshadow_actions");
  assert.match(progressBlock.content, /推进/);

  const noActionBlocks = buildVolumeChapterDetailContextBlocks(buildInput(7));
  const noActionBlock = noActionBlocks.find((block) => block.id === "chapter_foreshadow_actions");
  assert.ok(noActionBlock);
  assert.match(noActionBlock.content, /没有安排伏笔埋设、推进或回收动作/);
});

test("planner chapter plan context and post-validation enforce scheduled foreshadow actions", () => {
  const storyMacroPlan = storyMacroPlanFixture();
  const actions = [{
    entry: storyMacroPlan.foreshadowSchedule[0],
    actions: ["plant"],
  }];
  const contextBlocks = buildChapterPlanContextBlocks({
    novelTitle: "旧城账本",
    description: "市井长篇",
    genreName: "都市",
    targetAudience: "男频",
    bookSellingPoint: "人情债与旧案",
    competingFeel: "市井悬疑",
    first30ChapterPromise: "前十章兑现第一笔账",
    narrativePov: "third_person",
    pacePreference: "balanced",
    emotionIntensity: "medium",
    styleTone: "冷峻",
    chapterExpectation: "接下第一笔账",
    chapterTaskSheet: "完成任务单",
    chapterTargetWordCount: 2800,
    bible: "作品圣经",
    outline: null,
    structuredOutline: null,
    mappedVolumes: [],
    bookPlan: "全书规划",
    arcPlans: "阶段规划",
    characters: "主角",
    recentSummaries: "无",
    plotBeats: "无",
    stateSnapshot: "无",
    openAuditIssues: "无",
    recentDecisions: "无",
    characterDynamicsSummary: "无",
    characterVolumeAssignments: "无",
    characterRelationStages: "无",
    characterCandidateGuards: "无",
    defaultMetadata: "progress",
    stateDrivenDirective: "无",
    stateDrivenGoal: "无",
    replanContext: "无",
    storyMacroSummary: "故事宏观约束",
    chapterForeshadowActions: "[伏笔:F01] 埋设：旧图印鉴出现",
    currentVolumeWindow: "第一卷",
    payoffLedgerSummary: "无",
    storyModeBlock: "无",
  });
  const block = contextBlocks.find((item) => item.id === "chapter_foreshadow_actions");
  assert.ok(block);
  assert.match(block.content, /本章伏笔动作/);
  assert.match(block.content, /\[伏笔:F01\]/);

  const output = {
    title: "第3章",
    objective: "接下第一笔账",
    participants: ["主角"],
    reveals: ["旧图印鉴"],
    riskNotes: ["不要提前说破"],
    hookTarget: "新的旧案线索",
    planRole: "progress",
    phaseLabel: "开局",
    mustAdvance: ["[伏笔:F01] 埋设：旧图印鉴出现"],
    mustPreserve: ["不提前揭底"],
    payoffDecisions: [],
    scenes: [{ title: "翻旧图", objective: "找到印鉴", conflict: "邻居阻拦", reveal: "印鉴出现", emotionBeat: "怀疑" }],
  };
  const accepted = plannerChapterPlanPrompt.postValidate(output, { scopeLabel: "第3章", foreshadowActions: actions });
  assert.ok(accepted);

  assert.throws(
    () => plannerChapterPlanPrompt.postValidate({ ...output, mustAdvance: ["普通推进"] }, { scopeLabel: "第3章", foreshadowActions: actions }),
    /F01/,
  );
});

test("deterministic budget lines remain readable for multi-volume plans", () => {
  const budget = buildVolumeChapterBudget(130);
  const lines = formatVolumeChapterBudgetLines(budget).join("\n");
  assert.match(lines, /第 1 卷：44 章（第 1-44 章）/);
  assert.match(lines, /第 2 卷：43 章（第 45-87 章）/);
  assert.match(lines, /第 3 卷：43 章（第 88-130 章）/);
});
