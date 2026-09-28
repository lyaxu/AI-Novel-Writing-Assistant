const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCommonNovelContext, buildStoryMacroContext } = require("../dist/prompting/prompts/novel/volume/shared.js");
const blocks = require("../dist/prompting/prompts/novel/volume/contextBlocks.js");
const { selectContextBlocks } = require("../dist/prompting/core/contextSelection.js");
const { createVolumeStrategyPrompt, volumeStrategyCritiquePrompt } = require("../dist/prompting/prompts/novel/volume/strategy.prompts.js");
const { createVolumeSkeletonPrompt } = require("../dist/prompting/prompts/novel/volume/skeleton.prompts.js");
const { volumeBeatSheetPrompt } = require("../dist/prompting/prompts/novel/volume/beatSheet.prompts.js");
const { createVolumeChapterListPrompt } = require("../dist/prompting/prompts/novel/volume/chapterList.prompts.js");
const { volumeChapterTaskSheetPrompt } = require("../dist/prompting/prompts/novel/volume/chapterDetail.prompts.js");
const { volumeRebalancePrompt } = require("../dist/prompting/prompts/novel/volume/rebalance.prompts.js");

function inputFixture() {
  const now = new Date(0).toISOString();
  const chapter = { id: "chapter-1", chapterOrder: 1, title: "ANCHOR_TITLE", summary: "ANCHOR_SUMMARY", payoffRefs: [],
    taskSheet: "EXISTING_TASK_BOUNDARY", createdAt: now, updatedAt: now };
  const volume = { id: "volume-1", sortOrder: 1, title: "第一卷", openPayoffs: [], chapters: [chapter], createdAt: now, updatedAt: now };
  const beat = { key: "opening", label: "开卷", summary: "打开冲突", mustDeliver: ["兑现首次选择"], chapterSpanHint: "3章" };
  return {
    novel: { title: "测试小说", characters: [
      ...Array.from({ length: 13 }, (_, index) => ({ name: `路人${index}`, role: "support", currentGoal: null, currentState: null })),
      { id: "lead", name: "迟建主角", role: "人物", castRole: "protagonist", storyFunction: "亲手承担选择后果",
        currentGoal: "保住家人", currentState: "负伤未愈", innerNeed: "AGENCY_NEED_MARKER", misbelief: "SUBJECTIVE_MISBELIEF",
        secret: "AUTHOR_SECRET_MARKER", development: "FUTURE_DEVELOPMENT_MARKER", prohibitionsJson: '["不能凭空康复"]' },
      { name: "迟建对手", role: "人物", castRole: "antagonist", innerNeed: "OPPONENT_NEED_MARKER" },
    ] },
    storyMacroPlan: { expansion: { expanded_premise: "前提", protagonist_core: "PROTAGONIST_CORE", conflict_engine: "CONFLICT_ENGINE",
      conflict_layers: { external: "外部", internal: "内在", relational: "关系" }, mystery_box: "UNKNOWN_SECRET",
      emotional_line: "情绪", setpiece_seeds: ["FUTURE_SCENE_SEED"], tone_reference: "气质" },
      decomposition: { selling_point: "卖点", core_conflict: "矛盾", main_hook: "问题", progression_loop: "循环", growth_path: "成长",
        major_payoffs: ["MAJOR_PAYOFF_MARKER"], ending_flavor: "终局" }, constraints: ["不靠巧合获胜"] },
    workspace: { novelId: "novel-1", volumes: [volume], beatSheets: [] },
    strategyPlan: null, targetVolume: volume, anchorVolume: volume,
    targetChapter: chapter, detailMode: "task_sheet", targetBeat: beat,
    targetBeatSheet: { volumeId: volume.id, beats: [beat] }, targetChapterCount: 3,
    targetBeatChapterCount: 3, targetChapterStartOrder: 1, targetChapterEndOrder: 3, nextAvailableChapterOrder: 1,
    chapterBudget: 80,
    volumeCountGuidance: { targetChapterRange: { min: 15, max: 35, ideal: 25 }, allowedVolumeCountRange: { min: 2, max: 4 },
      decisionVolumeCountRange: { min: 2, max: 4 }, hardPlannedVolumeRange: { min: 2, max: 4 } },
  };
}

test("macro projection carries every expansion field and major payoff with future boundaries", () => {
  const input = inputFixture();
  const rendered = buildStoryMacroContext(input.storyMacroPlan);
  const data = JSON.parse(rendered.split("\n").at(-1));
  assert.deepEqual(data.expansion, input.storyMacroPlan.expansion);
  assert.deepEqual(data.decomposition, input.storyMacroPlan.decomposition);
  assert.deepEqual(data.constraints, input.storyMacroPlan.constraints);
  assert.match(rendered, /future intentions, not events that already happened/);
  assert.match(rendered, /permission to reveal secrets early/);
});

test("late-created lead and opponent retain motivation while omitted details remain explicit", () => {
  const context = buildCommonNovelContext(inputFixture().novel);
  assert.match(context, /AGENCY_NEED_MARKER/);
  assert.match(context, /OPPONENT_NEED_MARKER/);
  assert.match(context, /SUBJECTIVE_MISBELIEF/);
  assert.match(context, /不能凭空康复/);
  assert.match(context, /author-only constraints, not character knowledge/);
  assert.match(context, /future possibility, not accomplished history/);
  assert.match(context, /Compact roster \(other details omitted\)/);
});

for (const [name, builder, asset] of [
  ["strategy", blocks.buildVolumeStrategyContextBlocks, createVolumeStrategyPrompt()],
  ["critique", blocks.buildVolumeStrategyCritiqueContextBlocks, volumeStrategyCritiquePrompt],
  ["skeleton", blocks.buildVolumeSkeletonContextBlocks, createVolumeSkeletonPrompt(3)],
  ["beat", blocks.buildVolumeBeatSheetContextBlocks, volumeBeatSheetPrompt],
  ["chapter list", blocks.buildVolumeChapterListContextBlocks, createVolumeChapterListPrompt(3)],
  ["chapter detail", blocks.buildVolumeChapterDetailContextBlocks, volumeChapterTaskSheetPrompt],
  ["rebalance", blocks.buildVolumeRebalanceContextBlocks, volumeRebalancePrompt],
]) {
  test(`${name} actual policy and rendering preserve foundations and pre-existing required boundaries`, () => {
    const input = inputFixture();
    // Exceed normal soft budgets to exercise actual selection instead of only builder output.
    input.storyMacroPlan.expansion.expanded_premise = "前提".repeat(450);
    input.storyMacroPlan.expansion.protagonist_core = "人物".repeat(250);
    const raw = builder(input);
    const selected = selectContextBlocks(raw, asset.contextPolicy);
    for (const block of raw.filter(item => item.required)) {
      assert.equal(selected.selectedBlocks.find(item => item.id === block.id)?.content, block.content);
      assert.equal(selected.summarizedBlockIds.includes(block.id), false);
    }
    const rendered = asset.render(input, {
      blocks: selected.selectedBlocks, selectedBlockIds: selected.selectedBlocks.map(item => item.id),
      droppedBlockIds: selected.droppedBlockIds, summarizedBlockIds: selected.summarizedBlockIds,
      estimatedInputTokens: selected.estimatedTokens,
    }).map(message => message.content).join("\n");
    assert.match(rendered, /AGENCY_NEED_MARKER/);
    assert.match(rendered, /OPPONENT_NEED_MARKER/);
    assert.match(rendered, /MAJOR_PAYOFF_MARKER/);
    assert.match(rendered, /author-only constraints/);
    if (name === "chapter detail") {
      assert.match(rendered, /ANCHOR_SUMMARY/);
      assert.match(rendered, /EXISTING_TASK_BOUNDARY/);
    }
  });
}

test("large legacy fields and a large cast produce explicit bounded projections", () => {
  const input = inputFixture();
  input.storyMacroPlan.expansion.expanded_premise = "x".repeat(20000);
  input.storyMacroPlan.constraints = Array.from({ length: 50 }, () => "约束".repeat(1000));
  const macro = buildStoryMacroContext(input.storyMacroPlan);
  assert.ok(macro.length < 7000);
  assert.match(macro, /excerpt; source continues/);
  assert.match(macro, /42 additional source items omitted/);
  input.novel.characters = Array.from({ length: 100 }, (_, index) => ({
    name: `角色${index}`, role: "配角", currentGoal: "求生", currentState: null, innerNeed: "需要".repeat(500),
  }));
  const characters = buildCommonNovelContext(input.novel);
  assert.ok(characters.length < 14000);
  assert.match(characters, /64 additional characters omitted/);
});

test("generation context actually selects the saved character motivation fields before model invocation", async () => {
  const { prisma } = require("../dist/db/prisma.js");
  const { generateVolumePlanDocument } = require("../dist/services/novel/volume/volumeGenerationOrchestrator.js");
  const original = prisma.novel.findUnique;
  let fields;
  prisma.novel.findUnique = async ({ select }) => { fields = select.characters.select; throw new Error("stop before model"); };
  try {
    await assert.rejects(() => generateVolumePlanDocument({
      novelId: "novel-1", workspace: { novelId: "novel-1", volumes: [], beatSheets: [], rebalanceDecisions: [] },
      options: { scope: "strategy" }, storyMacroPlanService: { getPlan: async () => null },
    }), /stop before model/);
    for (const field of ["castRole", "storyFunction", "relationToProtagonist", "outerGoal", "innerNeed", "fear", "wound", "misbelief",
      "moralLine", "secret", "development", "prohibitionsJson", "powerLevel", "availability"]) assert.equal(fields[field], true, field);
  } finally { prisma.novel.findUnique = original; }
});
