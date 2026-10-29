const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FORESHADOW_MAX_COUNT,
  extractForeshadowTokenIds,
  findMissingForeshadowActions,
  formatForeshadowToken,
  normalizeForeshadowSchedule,
  normalizeStoryBookBlueprint,
  renderChapterForeshadowActionsContext,
  renderChapterForeshadowActionsForWriter,
  renderForeshadowScheduleSummary,
  renderStoryBookBlueprintSummary,
  selectForeshadowActionsForChapter,
  selectForeshadowActionsForChapterRange,
  validateStoryFramework,
} = require("../../shared/dist/types/storyPlanningFramework.js");

function scheduleFixture() {
  return [
    { id: "F01", question: "那半张图是谁画的？", truth: "是主角父亲留下的", content: "旧图角落有父亲的印鉴",
      plannedPayoff: "主角在废宅找到另一半图并确认笔迹", plantChapter: 3, progressChapters: [20, 60], revealChapter: 90 },
    { id: "F02", question: "账本最后一页写了什么？", truth: "记录着邻居的欠款", content: "账本缺了最后一页",
      plannedPayoff: "账本被公开，欠款关系反转", plantChapter: 5, progressChapters: [40], revealChapter: 100 },
    { id: "F03", question: "谁在夜里敲门？", truth: "是主角自己梦游", content: "门口留下湿脚印",
      plannedPayoff: "主角发现脚印来自自己的鞋", plantChapter: 10, progressChapters: [], revealChapter: 80 },
  ];
}

function blueprintFixture() {
  return {
    phases: [
      { stage: "opening", chapterStart: 1, chapterEnd: 20, goal: "建立城市困局", summary: "主角留在旧城" },
      { stage: "development", chapterStart: 21, chapterEnd: 50, goal: "建立关系网", summary: "旧账浮出" },
      { stage: "escalation", chapterStart: 51, chapterEnd: 75, goal: "外部势力入场", summary: "代价升级" },
      { stage: "climax", chapterStart: 76, chapterEnd: 95, goal: "正面对决", summary: "真相摊开" },
      { stage: "ending", chapterStart: 96, chapterEnd: 100, goal: "做出终局选择", summary: "收束支线" },
    ],
    ending: { outcome: "主角保住旧城并公开账本", cost: "失去唯一退路", subplotClosures: ["父亲旧案", "邻里欠款"] },
  };
}

test("foreshadow schedule normalizes ids, progress chapters and aliases", () => {
  const normalized = normalizeForeshadowSchedule([
    {
      key: "f7",
      readerQuestion: "谁在夜里敲门？",
      answer: "是主角自己梦游",
      clue: "门口留下湿脚印",
      payoff: "主角发现脚印来自自己的鞋",
      plant: 10,
      progress: "20, 40",
      reveal: 80,
    },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "F07");
  assert.equal(normalized[0].question, "谁在夜里敲门？");
  assert.equal(normalized[0].truth, "是主角自己梦游");
  assert.equal(normalized[0].content, "门口留下湿脚印");
  assert.deepEqual(normalized[0].progressChapters, [20, 40]);

  const unnamed = normalizeForeshadowSchedule([{
    question: "问题", truth: "真相", content: "线索", plannedPayoff: "兑现",
    plantChapter: 1, progressChapters: [2], revealChapter: 3,
  }]);
  assert.equal(unnamed[0].id, "F01");
});

test("story framework validation accepts a coherent plan and rejects broken timing", () => {
  const valid = validateStoryFramework({
    bookBlueprint: blueprintFixture(),
    foreshadowSchedule: scheduleFixture(),
    targetChapterCount: 100,
  });
  assert.deepEqual(valid.filter((issue) => issue.severity === "error"), []);

  const broken = validateStoryFramework({
    bookBlueprint: blueprintFixture(),
    foreshadowSchedule: [
      { ...scheduleFixture()[0], plantChapter: 95, progressChapters: [99], revealChapter: 90 },
      { ...scheduleFixture()[1], revealChapter: 120 },
    ],
    targetChapterCount: 100,
  });
  const codes = new Set(broken.map((issue) => issue.code));
  assert.equal(codes.has("foreshadow_plant_not_before_reveal"), true);
  assert.equal(codes.has("foreshadow_progress_after_reveal"), true);
  assert.equal(codes.has("foreshadow_reveal_out_of_bounds"), true);

  const incompleteBlueprint = normalizeStoryBookBlueprint({
    phases: blueprintFixture().phases.slice(0, 4),
    ending: blueprintFixture().ending,
  });
  assert.equal(incompleteBlueprint, null);
  const missingEndingClosure = validateStoryFramework({
    bookBlueprint: {
      ...blueprintFixture(),
      ending: { outcome: "结果", cost: "代价", subplotClosures: [] },
    },
    foreshadowSchedule: scheduleFixture(),
    targetChapterCount: 100,
  });
  assert.equal(missingEndingClosure.some((issue) => issue.code === "ending_subplot_missing"), true);
});

test("chapter foreshadow actions are selected by structured chapter fields", () => {
  const schedule = scheduleFixture();
  assert.deepEqual(
    selectForeshadowActionsForChapter(schedule, 3).map((action) => [action.entry.id, action.actions]),
    [["F01", ["plant"]]],
  );
  assert.deepEqual(
    selectForeshadowActionsForChapter(schedule, 20).map((action) => [action.entry.id, action.actions]),
    [["F01", ["progress"]]],
  );
  assert.deepEqual(
    selectForeshadowActionsForChapter(schedule, 90).map((action) => [action.entry.id, action.actions]),
    [["F01", ["reveal"]]],
  );
  assert.deepEqual(selectForeshadowActionsForChapter(schedule, 7), []);
  assert.deepEqual(
    selectForeshadowActionsForChapterRange(schedule, 1, 10).map((action) => action.entry.id),
    ["F01", "F02", "F03"],
  );
});

test("coverage check uses planning tokens rather than prose keyword matching", () => {
  const schedule = scheduleFixture();
  const missing = findMissingForeshadowActions({
    schedule,
    chapterOrder: 20,
    plannedTexts: ["完成一次对峙", "带出旧图印鉴"],
  });
  assert.deepEqual(missing.map((action) => action.entry.id), ["F01"]);

  const satisfied = findMissingForeshadowActions({
    schedule,
    chapterOrder: 20,
    plannedTexts: ["[伏笔:F01] 推进：旧图印鉴出现新的比对结果"],
  });
  assert.deepEqual(satisfied, []);

  const wrongToken = findMissingForeshadowActions({
    schedule,
    chapterOrder: 20,
    plannedTexts: ["[伏笔:F02] 推进：账本翻到缺页"],
  });
  assert.deepEqual(wrongToken.map((action) => action.entry.id), ["F01"]);

  assert.deepEqual(extractForeshadowTokenIds("[伏笔:F01] x [伏笔:F02] [承诺:L001]"), ["F01", "F02"]);
  assert.equal(formatForeshadowToken("F01"), "[伏笔:F01]");
});

test("planning and writer renderings expose obligations without leaking future truth", () => {
  const schedule = scheduleFixture();
  const plantActions = selectForeshadowActionsForChapter(schedule, 3);
  const planningText = renderChapterForeshadowActionsContext({ chapterOrder: 3, actions: plantActions });
  assert.match(planningText, /\[伏笔:F01\]/);
  assert.match(planningText, /埋设/);
  assert.match(planningText, /作者真相/);
  assert.match(planningText, /requiredElements 或章节规划 mustAdvance/);

  const writerPlant = renderChapterForeshadowActionsForWriter(plantActions);
  assert.equal(writerPlant.length, 1);
  assert.match(writerPlant[0], /\[伏笔:F01\]/);
  assert.match(writerPlant[0], /旧图角落有父亲的印鉴/);
  assert.doesNotMatch(writerPlant[0], /是主角父亲留下的/);

  const revealActions = selectForeshadowActionsForChapter(schedule, 90);
  const writerReveal = renderChapterForeshadowActionsForWriter(revealActions);
  assert.match(writerReveal[0], /回收/);
  assert.match(writerReveal[0], /是主角父亲留下的/);

  const summary = renderForeshadowScheduleSummary(schedule);
  assert.match(summary, /埋设第 3 章/);
  assert.match(summary, /回收第 90 章/);
  assert.ok(summary.split("\n").length <= FORESHADOW_MAX_COUNT);
  const blueprintText = renderStoryBookBlueprintSummary(blueprintFixture());
  assert.match(blueprintText, /开局（第 1-20 章）/);
  assert.match(blueprintText, /结局代价/);
});
