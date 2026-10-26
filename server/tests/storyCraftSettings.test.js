const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createApp } = require("../dist/app.js");
const { prisma } = require("../dist/db/prisma.js");
const {
  DEFAULT_STORY_CRAFT_DEFAULTS,
  STORY_CRAFT_DEFAULTS_SETTING_KEY,
} = require("@ai-novel/shared/types/storyCraft");
const {
  renderStoryCraftContractText,
  loadStoryCraftContractBlock,
  appendStoryCraftContractBlock,
} = require("../dist/services/settings/storyCraftContractContext.js");
const {
  getStoryCraftDefaults,
  saveStoryCraftDefaults,
} = require("../dist/services/settings/StoryCraftSettingsService.js");
const { chapterWriterPrompt } = require("../dist/prompting/prompts/novel/chapterWriter.prompts.js");
const {
  chapterTaskSheetQualityPrompt,
} = require("../dist/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.js");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

function createAppSettingMock(initialValue = null) {
  const state = { savedValue: initialValue, upsertCalls: [] };
  const originals = {
    findUnique: prisma.appSetting.findUnique,
    upsert: prisma.appSetting.upsert,
  };
  prisma.appSetting.findUnique = async ({ where }) => {
    if (where?.key !== STORY_CRAFT_DEFAULTS_SETTING_KEY || state.savedValue == null) {
      return null;
    }
    return { key: STORY_CRAFT_DEFAULTS_SETTING_KEY, value: state.savedValue };
  };
  prisma.appSetting.upsert = async ({ where, create, update }) => {
    state.upsertCalls.push({ where, create, update });
    state.savedValue = update.value;
    return {
      key: create.key,
      value: create.value,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  return {
    state,
    restore() {
      prisma.appSetting.findUnique = originals.findUnique;
      prisma.appSetting.upsert = originals.upsert;
    },
  };
}

function renderPromptText(asset, promptInput, blocks) {
  const messages = asset.render(promptInput, {
    blocks,
    selectedBlockIds: blocks.map((block) => block.id),
    droppedBlockIds: [],
    summarizedBlockIds: [],
    estimatedInputTokens: 0,
  });
  return messages.map((message) => String(message.content)).join("\n");
}

test("generic story craft defaults are genre-neutral and cover the four engineering contracts", () => {
  assert.equal(DEFAULT_STORY_CRAFT_DEFAULTS.enabled, true);
  assert.equal(DEFAULT_STORY_CRAFT_DEFAULTS.pressureContract.escalationIntervalChapters, 5);
  assert.equal(DEFAULT_STORY_CRAFT_DEFAULTS.pressureContract.visibleCostEveryChapter, true);
  assert.equal(DEFAULT_STORY_CRAFT_DEFAULTS.chapterObligations.forbidRepeatedSceneLoop, true);
  assert.equal(DEFAULT_STORY_CRAFT_DEFAULTS.characterPlanning.protagonists, 1);
  assert.ok(DEFAULT_STORY_CRAFT_DEFAULTS.characterPlanning.namedNpcMinPerVolume
    <= DEFAULT_STORY_CRAFT_DEFAULTS.characterPlanning.namedNpcMaxPerVolume);
  assert.equal(DEFAULT_STORY_CRAFT_DEFAULTS.specialAbility.requireVisibleCost, true);

  const planningText = renderStoryCraftContractText(DEFAULT_STORY_CRAFT_DEFAULTS, "planning");
  for (const marker of [
    "压力契约",
    "章节义务",
    "人物规划",
    "特殊能力/金手指",
    "每 5 章至少安排一次不可逆升级",
    "禁止纯铺垫章",
    "避免连续同场景循环",
    "主角 1 人",
    "反制手段",
    "按本书题材",
  ]) {
    assert.ok(planningText.includes(marker), `planning contract should mention ${marker}`);
  }
  // 规则必须是题材无关的元规则：默认文本不出现任何具体题材设定。
  assert.equal(planningText.includes("末世"), false);
  assert.equal(planningText.includes("修仙"), false);

  const writingText = renderStoryCraftContractText(DEFAULT_STORY_CRAFT_DEFAULTS, "writing");
  assert.ok(writingText.includes("正文写作底线"));
  assert.ok(writingText.includes("每次使用都要有可见代价"));
  assert.equal(writingText.includes("三、人物规划"), false);

  const reviewText = renderStoryCraftContractText(DEFAULT_STORY_CRAFT_DEFAULTS, "review");
  assert.ok(reviewText.includes("规划复核元规则"));
  assert.ok(reviewText.includes("压力契约"));
});

test("generic story craft contract text honors toggles and global disable", () => {
  const disabled = { ...DEFAULT_STORY_CRAFT_DEFAULTS, enabled: false };
  assert.equal(renderStoryCraftContractText(disabled, "planning"), "");

  const noPressure = {
    ...DEFAULT_STORY_CRAFT_DEFAULTS,
    pressureContract: { ...DEFAULT_STORY_CRAFT_DEFAULTS.pressureContract, enabled: false },
  };
  const noPressureText = renderStoryCraftContractText(noPressure, "planning");
  assert.equal(noPressureText.includes("一、压力契约"), false);
  assert.ok(noPressureText.includes("二、章节义务"));

  const noAbility = {
    ...DEFAULT_STORY_CRAFT_DEFAULTS,
    specialAbility: { ...DEFAULT_STORY_CRAFT_DEFAULTS.specialAbility, enabled: false },
  };
  assert.equal(renderStoryCraftContractText(noAbility, "planning").includes("特殊能力/金手指"), false);

  const customEscalation = {
    ...DEFAULT_STORY_CRAFT_DEFAULTS,
    pressureContract: { ...DEFAULT_STORY_CRAFT_DEFAULTS.pressureContract, escalationIntervalChapters: 8 },
  };
  assert.ok(renderStoryCraftContractText(customEscalation, "planning").includes("每 8 章至少安排一次不可逆升级"));
});

test("story craft settings expose defaults, reject invalid values, persist and read back", async () => {
  const mock = createAppSettingMock();
  const app = createApp();
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const getResponse = await fetch(`http://127.0.0.1:${port}/api/settings/story-craft`);
    assert.equal(getResponse.status, 200);
    const getPayload = await getResponse.json();
    assert.equal(getPayload.success, true);
    assert.equal(getPayload.data.enabled, true);
    assert.equal(getPayload.data.pressureContract.escalationIntervalChapters, 5);
    assert.equal(getPayload.data.specialAbility.revealPacing, "staged");

    const invalidInterval = await fetch(`http://127.0.0.1:${port}/api/settings/story-craft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pressureContract: { escalationIntervalChapters: 0 } }),
    });
    assert.equal(invalidInterval.status, 400);

    const invalidRange = await fetch(`http://127.0.0.1:${port}/api/settings/story-craft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterPlanning: { namedNpcMinPerVolume: 9, namedNpcMaxPerVolume: 3 },
      }),
    });
    assert.equal(invalidRange.status, 400);

    const putResponse = await fetch(`http://127.0.0.1:${port}/api/settings/story-craft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        pressureContract: { escalationIntervalChapters: 7, notes: "每章都要让读者看到时钟在走。" },
        specialAbility: { revealPacing: "gradual" },
      }),
    });
    assert.equal(putResponse.status, 200);
    const putPayload = await putResponse.json();
    assert.equal(putPayload.success, true);
    assert.equal(putPayload.data.pressureContract.escalationIntervalChapters, 7);
    assert.equal(putPayload.data.pressureContract.notes, "每章都要让读者看到时钟在走。");
    assert.equal(putPayload.data.specialAbility.revealPacing, "gradual");

    assert.equal(mock.state.upsertCalls.length, 1);
    assert.equal(mock.state.upsertCalls[0].where.key, STORY_CRAFT_DEFAULTS_SETTING_KEY);
    const stored = JSON.parse(mock.state.upsertCalls[0].update.value);
    assert.equal(stored.pressureContract.escalationIntervalChapters, 7);
    assert.equal(stored.chapterObligations.openingHook, true);

    const readBack = await fetch(`http://127.0.0.1:${port}/api/settings/story-craft`);
    assert.equal(readBack.status, 200);
    const readBackPayload = await readBack.json();
    assert.equal(readBackPayload.data.pressureContract.escalationIntervalChapters, 7);
    assert.equal(readBackPayload.data.specialAbility.revealPacing, "gradual");
  } finally {
    mock.restore();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("story craft service falls back to defaults on missing data, missing table and DB unavailability", async () => {
  const mock = createAppSettingMock();
  try {
    assert.deepEqual(await getStoryCraftDefaults(), DEFAULT_STORY_CRAFT_DEFAULTS);

    const saved = await saveStoryCraftDefaults({ pressureContract: { escalationIntervalChapters: 9 } });
    assert.equal(saved.pressureContract.escalationIntervalChapters, 9);
    assert.deepEqual(await getStoryCraftDefaults(), saved);

    prisma.appSetting.findUnique = async () => {
      const error = new Error("The table `main.AppSetting` does not exist in the current database.");
      error.code = "P2021";
      throw error;
    };
    assert.deepEqual(await getStoryCraftDefaults(), DEFAULT_STORY_CRAFT_DEFAULTS);

    prisma.appSetting.findUnique = async () => {
      const error = new Error("Can't reach database server");
      error.code = "P1001";
      throw error;
    };
    assert.deepEqual(await getStoryCraftDefaults(), DEFAULT_STORY_CRAFT_DEFAULTS);

    prisma.appSetting.findUnique = async () => ({ value: "{not valid json" });
    assert.deepEqual(await getStoryCraftDefaults(), DEFAULT_STORY_CRAFT_DEFAULTS);
  } finally {
    mock.restore();
  }
});

test("story craft contract block loads as a required context block and never blocks on failure", async () => {
  const mock = createAppSettingMock();
  try {
    const block = await loadStoryCraftContractBlock("planning");
    assert.ok(block);
    assert.equal(block.id, "story_craft_contract");
    assert.equal(block.group, "story_craft_contract");
    assert.equal(block.required, true);

    const appended = await appendStoryCraftContractBlock([
      { id: "book_contract", group: "book_contract", priority: 100, required: true, content: "合约", estimatedTokens: 1 },
    ], "writing");
    assert.equal(appended.length, 2);
    assert.equal(appended[1].group, "story_craft_contract");
    assert.ok(appended[1].content.includes("正文写作底线"));

    prisma.appSetting.findUnique = async () => ({
      value: JSON.stringify({ ...DEFAULT_STORY_CRAFT_DEFAULTS, enabled: false }),
    });
    assert.equal(await loadStoryCraftContractBlock("planning"), null);
    assert.equal((await appendStoryCraftContractBlock([], "planning")).length, 0);

    prisma.appSetting.findUnique = async () => {
      throw new Error("unexpected settings failure");
    };
    assert.equal(await loadStoryCraftContractBlock("planning"), null);
  } finally {
    mock.restore();
  }
});

test("story craft contract appears in chapter writing and planning review prompt context", async () => {
  const mock = createAppSettingMock();
  try {
    const block = await loadStoryCraftContractBlock("writing");
    assert.ok(block);
    const writerText = renderPromptText(chapterWriterPrompt, {
      novelTitle: "测试书",
      chapterOrder: 3,
      chapterTitle: "第三章",
      mode: "draft",
      targetWordCount: 2500,
      minWordCount: 2200,
      maxWordCount: 2900,
    }, [block]);
    assert.ok(writerText.includes("【通用创作规则｜正文写作底线】"));
    assert.ok(writerText.includes("每次使用都要有可见代价"));

    const reviewBlock = await loadStoryCraftContractBlock("review");
    assert.ok(reviewBlock);
    const reviewText = renderPromptText(chapterTaskSheetQualityPrompt, {
      candidate: {
        novelId: "novel-1",
        volumeId: "volume-1",
        chapterId: "chapter-1",
        chapterOrder: 2,
        title: "第二章",
        summary: "本章推进主线",
        purpose: "推进主线",
        exclusiveEvent: "主角做出不可逆选择",
        endingState: "局面变得更危险",
        nextChapterEntryState: "主角带着代价进入下一章",
        conflictLevel: 55,
        revealLevel: 30,
        targetWordCount: 2500,
        mustAvoid: "避免重复上一章场景",
        payoffRefs: [],
        taskSheet: "目标-阻力-转折-结果",
        sceneCards: JSON.stringify({ scenes: [] }),
      },
      mode: "manual",
      reviewContextJson: "{}",
    }, [reviewBlock]);
    assert.ok(reviewText.includes("通用创作规则（题材无关元规则"));
    assert.ok(reviewText.includes("【通用创作规则｜规划复核元规则】"));

    // 设置为空时，提示词输出保持可运行，不因缺少契约块而中断。
    const withoutContract = renderPromptText(chapterTaskSheetQualityPrompt, {
      candidate: {
        novelId: "novel-1",
        chapterId: "chapter-1",
        chapterOrder: 1,
        title: "第一章",
        summary: "开场",
        purpose: "开场",
        exclusiveEvent: "主角登场",
        endingState: "留下悬念",
        nextChapterEntryState: "进入下一章",
        conflictLevel: 30,
        revealLevel: 10,
        targetWordCount: 2500,
        mustAvoid: "无",
        payoffRefs: [],
        taskSheet: "",
        sceneCards: "{}",
      },
      mode: "manual",
      reviewContextJson: "{}",
    }, []);
    assert.equal(withoutContract.includes("【通用创作规则｜规划复核元规则】"), false);
  } finally {
    mock.restore();
  }
});
