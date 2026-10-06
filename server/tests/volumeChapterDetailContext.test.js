const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildChapterDetailDraft,
  buildChapterNeighborContext,
  buildRecentChapterExecutionContext,
} = require("../dist/prompting/prompts/novel/volume/shared.js");
const {
  buildVolumeChapterDetailContextBlocks,
} = require("../dist/prompting/prompts/novel/volume/contextBlocks.js");
const {
  volumeChapterBoundaryPrompt,
  volumeChapterExecutionContractPrompt,
  volumeChapterTaskSheetPrompt,
} = require("../dist/prompting/prompts/novel/volume/chapterDetail.prompts.js");

function createScenePlan(sceneTitles) {
  return JSON.stringify({
    targetWordCount: 3000,
    lengthBudget: {
      targetWordCount: 3000,
      softMinWordCount: 2550,
      softMaxWordCount: 3450,
      hardMaxWordCount: 3750,
    },
    scenes: sceneTitles.map((title, index) => ({
      key: `scene_${index + 1}`,
      title,
      purpose: `${title} 的推进职责`,
      mustAdvance: [`${title} 的关键推进`],
      mustPreserve: ["卷内压力持续存在"],
      entryState: `${title} 前的局面`,
      exitState: `${title} 后的局面`,
      forbiddenExpansion: [`不要把 ${title} 写成重复套路`],
      targetWordCount: 1000,
    })),
  });
}

function createTargetVolume() {
  const now = new Date().toISOString();
  return {
    id: "volume-1",
    novelId: "novel-1",
    sortOrder: 1,
    title: "第一卷",
    summary: "测试卷摘要",
    openingHook: "主角被迫入局",
    mainPromise: "前期建立高压并完成第一次实质破局",
    primaryPressureSource: "高层压迫",
    coreSellingPoint: "持续压迫与反压回路",
    escalationMode: "从生存压迫切到主动试探",
    protagonistChange: "从被动求生到开始试探规则",
    midVolumeRisk: "压力正在升级",
    climax: "第一次大反压",
    payoffType: "阶段性收益",
    nextVolumeHook: "更大的规则浮出水面",
    resetPoint: null,
    openPayoffs: [],
    status: "active",
    sourceVersionId: null,
    createdAt: now,
    updatedAt: now,
    chapters: [
      {
        id: "chapter-1",
        volumeId: "volume-1",
        chapterOrder: 1,
        title: "寒夜街头",
        summary: "主角在寒夜与饥饿中确认自己没有退路。",
        purpose: null,
        exclusiveEvent: "确认无处可退，只能继续潜伏求生。",
        endingState: "主角确认自己暂时只能继续忍耐和潜伏。",
        nextChapterEntryState: "主角带着更强的警惕进入第二天劳作环境。",
        conflictLevel: 70,
        revealLevel: 25,
        targetWordCount: 3000,
        mustAvoid: null,
        taskSheet: "以环境压迫开场，主角被迫躲避风险，结尾留下更强追索压力。",
        sceneCards: createScenePlan(["寒夜压迫", "被动躲避", "危险逼近"]),
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "chapter-2",
        volumeId: "volume-1",
        chapterOrder: 2,
        title: "人群异样",
        summary: "主角在围观和怀疑中暴露异常，只能继续规避。",
        purpose: null,
        exclusiveEvent: "第一次被人群与怀疑正面锁定。",
        endingState: "主角意识到继续被动躲避只会让怀疑升级。",
        nextChapterEntryState: "主角必须换一种推进方式，不能再只靠挨压。",
        conflictLevel: 78,
        revealLevel: 35,
        targetWordCount: 3000,
        mustAvoid: null,
        taskSheet: "继续外部压迫推进，主角在围观和怀疑中暴露异常，结尾必须留下身份风险。",
        sceneCards: createScenePlan(["围观压迫", "被动试探", "身份风险钩子"]),
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "chapter-3",
        volumeId: "volume-1",
        chapterOrder: 3,
        title: "第一次换路",
        summary: "主角需要把推进方式切到主动试探和关系建立。",
        purpose: "把推进方式切到主动试探和关系建立，不能继续只靠被动挨压。",
        exclusiveEvent: "第一次正式把推进方式切到主动试探。",
        endingState: "主角已经找到可执行的主动试探切口。",
        nextChapterEntryState: "主角带着新的试探方案进入下一章执行。",
        conflictLevel: 82,
        revealLevel: 40,
        targetWordCount: 3000,
        mustAvoid: null,
        taskSheet: null,
        sceneCards: null,
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function createPromptInput() {
  const targetVolume = createTargetVolume();
  return {
    novel: {
      title: "测试小说",
      description: "测试简介",
      targetAudience: "新手读者",
      bookSellingPoint: "降低门槛的强引导写作",
      competingFeel: null,
      first30ChapterPromise: "前30章持续兑现推进感",
      commercialTagsJson: JSON.stringify(["高压开局", "持续反压"]),
      estimatedChapterCount: 60,
      narrativePov: "third_person",
      pacePreference: "fast",
      emotionIntensity: "high",
      storyModePromptBlock: null,
      genre: { name: "都市异能" },
      characters: [
        { name: "主角", role: "主角", currentGoal: "活下来并找到破局点", currentState: "被压制" },
      ],
    },
    workspace: {
      novelId: "novel-1",
      workspaceVersion: "v2",
      volumes: [targetVolume],
      strategyPlan: null,
      critiqueReport: null,
      beatSheets: [],
      rebalanceDecisions: [],
      readiness: {
        volumeCountReady: true,
        beatSheetReady: true,
        chapterListReady: true,
      },
      source: "volume",
      activeVersionId: null,
    },
    storyMacroPlan: null,
    strategyPlan: null,
    targetVolume,
    targetBeatSheet: null,
    targetChapter: targetVolume.chapters[2],
    detailMode: "task_sheet",
  };
}

test("recent chapter execution context exposes prior task sheets and scene trajectories", () => {
  const targetVolume = createTargetVolume();
  const context = buildRecentChapterExecutionContext(targetVolume, "chapter-3");

  assert.match(context, /chapter 1: 寒夜街头/);
  assert.match(context, /task sheet: 以环境压迫开场/);
  assert.match(context, /opening scene: 寒夜压迫/);
  assert.match(context, /ending scene: 危险逼近/);
  assert.match(context, /chapter 2: 人群异样/);
  assert.match(context, /opening scene: 围观压迫/);
  assert.match(context, /ending scene: 身份风险钩子/);
});

test("volume chapter detail context blocks include recent execution contracts for anti-repeat planning", () => {
  const input = createPromptInput();
  const blocks = buildVolumeChapterDetailContextBlocks(input);
  const block = blocks.find((item) => item.id === "recent_execution_contracts");

  assert.ok(block);
  assert.match(block.content, /Recent execution contracts:/);
  assert.match(block.content, /chapter 2: 人群异样/);
  assert.match(block.content, /task sheet: 继续外部压迫推进/);
  assert.match(block.content, /opening scene: 围观压迫/);
});

test("task sheet draft context keeps current chapter purpose and boundary fields", () => {
  const targetVolume = createTargetVolume();
  const draft = buildChapterDetailDraft(targetVolume.chapters[2], "task_sheet");

  assert.match(draft, /current chapter title: 第一次换路/);
  assert.match(draft, /current chapter summary: 主角需要把推进方式切到主动试探和关系建立。/);
  assert.match(draft, /current purpose draft: 把推进方式切到主动试探和关系建立，不能继续只靠被动挨压。/);
  assert.match(draft, /exclusive event: 第一次正式把推进方式切到主动试探。/);
  assert.match(draft, /ending state: 主角已经找到可执行的主动试探切口。/);
  assert.match(draft, /next chapter entry state: 主角带着新的试探方案进入下一章执行。/);
  assert.match(draft, /conflict level: 82/);
  assert.match(draft, /reveal level: 40/);
  assert.match(draft, /target word count: 3000/);
});

test("chapter neighbor context exposes exclusive event and chapter state handoff", () => {
  const targetVolume = createTargetVolume();
  const context = buildChapterNeighborContext(targetVolume, "chapter-3");

  assert.match(context, /previous chapter: 2 人群异样/);
  assert.match(context, /exclusiveEvent=第一次被人群与怀疑正面锁定。/);
  assert.match(context, /endingState=主角意识到继续被动躲避只会让怀疑升级。/);
  assert.match(context, /nextEntry=主角必须换一种推进方式，不能再只靠挨压。/);
  assert.match(context, /current chapter: 3 第一次换路/);
  assert.match(context, /exclusiveEvent=第一次正式把推进方式切到主动试探。/);
});

test("task sheet post-validate rejects adjacent chapter event leakage", () => {
  const now = new Date().toISOString();
  const targetVolume = {
    id: "volume-boundary",
    novelId: "novel-1",
    sortOrder: 1,
    title: "第一卷",
    summary: "测试卷摘要",
    openingHook: "主角被迫入局",
    mainPromise: "前期建立高压并完成第一次实质破局",
    primaryPressureSource: "高层压迫",
    coreSellingPoint: "持续压迫与反压回路",
    escalationMode: "从生存压迫切到主动试探",
    protagonistChange: "从被动求生到开始试探规则",
    midVolumeRisk: "压力正在升级",
    climax: "第一次大反压",
    payoffType: "阶段性收益",
    nextVolumeHook: "更大的规则浮出水面",
    resetPoint: null,
    openPayoffs: [],
    status: "active",
    sourceVersionId: null,
    createdAt: now,
    updatedAt: now,
    chapters: [
      {
        id: "chapter-a",
        volumeId: "volume-boundary",
        chapterOrder: 1,
        title: "五代乱世，开局杂役",
        summary: "程秩穿越成节度使府最底层杂役，先建立乱世困境与底层处境。",
        purpose: "建立穿越困境与底层生存压迫，不提前兑现系统核心能力。",
        conflictLevel: 70,
        revealLevel: 20,
        targetWordCount: 3000,
        mustAvoid: "不要提前写系统激活和首次取银。",
        taskSheet: null,
        sceneCards: null,
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "chapter-b",
        volumeId: "volume-boundary",
        chapterOrder: 2,
        title: "脑中异响，系统激活",
        summary: "程秩在搬运杂物时意外激活系统，正式确认规则与第一笔奖励。",
        purpose: "承接前章困境，完成系统激活与风险认知。",
        conflictLevel: 78,
        revealLevel: 35,
        targetWordCount: 3200,
        mustAvoid: null,
        taskSheet: null,
        sceneCards: null,
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const input = {
    ...createPromptInput(),
    targetVolume,
    targetChapter: targetVolume.chapters[0],
  };
  const context = {
    blocks: [],
    selectedBlockIds: [],
    droppedBlockIds: [],
    summarizedBlockIds: [],
    estimatedInputTokens: 0,
  };
  const leakedOutput = {
    taskSheet: "本章要在高压劳作后直接写到系统激活，正式亮出金手指。",
    sceneCards: [
      {
        key: "scene_1",
        title: "系统激活",
        purpose: "让主角在本章末正式激活系统。",
        mustAdvance: ["完成系统激活"],
        mustPreserve: ["乱世压迫氛围"],
        entryState: "主角仍在杂役处境里苦撑。",
        exitState: "系统激活后看见新的翻身希望。",
        forbiddenExpansion: ["不要拖到下一章"],
        targetWordCount: 1000,
      },
    ],
  };

  // Adjacent-chapter ownership is no longer inferred from title verbs: that missed every
  // real title of a test book, including ones whose milestone word sat outside the 18-item
  // list. The model now declares the relationship in neighborEventUse, and the declaration is
  // checked against the neighbour's real contract. Either way the leak is refused: either the
  // neighbour has no contract to own a milestone (nothing to pre-empt), or it does and the
  // one-time node would be taken twice.
  const declaredLeak = {
    ...leakedOutput,
    neighborEventUse: [
      { relation: "next", consumesExclusiveEvent: true, evidence: "本章末直接写系统激活。" },
    ],
    mustAvoidConflicts: [],
  };
  assert.throws(
    () => volumeChapterTaskSheetPrompt.postValidate(declaredLeak, input, context),
    /独占事件/,
  );
});

test("boundary post-validate rejects duplicated exclusive event and mirrored state handoff", () => {
  const now = new Date().toISOString();
  const targetVolume = {
    id: "volume-boundary-2",
    novelId: "novel-1",
    sortOrder: 1,
    title: "第一卷",
    summary: "测试卷摘要",
    openingHook: "主角被迫入局",
    mainPromise: "前期建立高压并完成第一次实质破局",
    primaryPressureSource: "高层压迫",
    coreSellingPoint: "持续压迫与反压回路",
    escalationMode: "从生存压迫切到主动试探",
    protagonistChange: "从被动求生到开始试探规则",
    midVolumeRisk: "压力正在升级",
    climax: "第一次大反压",
    payoffType: "阶段性收益",
    nextVolumeHook: "更大的规则浮出水面",
    resetPoint: null,
    openPayoffs: [],
    status: "active",
    sourceVersionId: null,
    createdAt: now,
    updatedAt: now,
    chapters: [
      {
        id: "chapter-a",
        volumeId: "volume-boundary-2",
        chapterOrder: 1,
        title: "脑中异响，系统激活",
        summary: "程秩正式激活系统，明确第一笔奖励与风险。",
        purpose: "完成系统激活与风险认知。",
        exclusiveEvent: "系统正式激活。",
        endingState: "程秩知道系统能发钱，但还不敢取现。",
        nextChapterEntryState: "程秩带着已知规则进入下一章验证。",
        conflictLevel: 78,
        revealLevel: 35,
        targetWordCount: 3200,
        mustAvoid: "不要提前写第一次资源合理化。",
        taskSheet: null,
        sceneCards: null,
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "chapter-b",
        volumeId: "volume-boundary-2",
        chapterOrder: 2,
        title: "碎银入手，危机暗藏",
        summary: "程秩第一次把银子提到现实，并意识到财富与身份冲突。",
        purpose: "完成第一次取银和藏银判断。",
        exclusiveEvent: null,
        endingState: null,
        nextChapterEntryState: null,
        conflictLevel: 82,
        revealLevel: 42,
        targetWordCount: 3200,
        mustAvoid: null,
        taskSheet: null,
        sceneCards: null,
        payoffRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const input = {
    ...createPromptInput(),
    targetVolume,
    targetChapter: targetVolume.chapters[1],
    detailMode: "boundary",
  };
  const context = {
    blocks: [],
    selectedBlockIds: [],
    droppedBlockIds: [],
    summarizedBlockIds: [],
    estimatedInputTokens: 0,
  };

  assert.throws(
    () => volumeChapterBoundaryPrompt.postValidate({
      exclusiveEvent: "系统正式激活。",
      endingState: "程秩把银子藏好，准备继续观察。",
      nextChapterEntryState: "程秩把银子藏好，准备继续观察。",
      conflictLevel: 82,
      revealLevel: 42,
      targetWordCount: 3200,
      mustAvoid: "不要直接暴露财富。",
      payoffRefs: [],
    }, input, context),
    /独占事件|endingState 与 nextChapterEntryState/,
  );
});

test("due ledger promises become a required planning block only when something is actually due", () => {
  const base = createPromptInput();

  const withDue = buildVolumeChapterDetailContextBlocks({
    ...base,
    payoffCadence: { dueCount: 2, text: "本章（第 3 章）到期的账本承诺，共 2 条：\n- [L1] 首单结算" },
  });
  const dueBlock = withDue.find((item) => item.id === "payoff_cadence");
  assert.ok(dueBlock, "a due list must reach the planning prompt");
  assert.equal(dueBlock.group, "payoff_cadence");
  assert.equal(dueBlock.required, true);
  assert.match(dueBlock.content, /\[L1\] 首单结算/);

  // Nothing due must stay optional and must not invite inventing work to fill the slot.
  const empty = buildVolumeChapterDetailContextBlocks({
    ...base,
    payoffCadence: { dueCount: 0, text: "本章（第 3 章）没有到期的账本承诺。" },
  });
  const emptyBlock = empty.find((item) => item.id === "payoff_cadence");
  assert.ok(emptyBlock);
  assert.equal(emptyBlock.required, false);

  // Absent cadence data behaves like an empty list rather than silently dropping the block.
  const absent = buildVolumeChapterDetailContextBlocks(base);
  const absentBlock = absent.find((item) => item.id === "payoff_cadence");
  assert.ok(absentBlock);
  assert.equal(absentBlock.required, false);
  assert.match(absentBlock.content, /不要为了填满这个位置而新造承诺/);
});

// Regression cover for the chapter 1 -> chapter 2 duplication of 《外卖小道士：这单是阴单》.
//
// The old guard inferred "one-time milestone" from an 18-word verb list in chapter
// titles. All five real titles of that book yielded no anchor (including "翻出"),
// so a contract that re-staged chapter 1's closing scene passed untouched. Comparing
// mustAvoid against scene text cannot replace it either: the prohibition and the
// scheduled scene paraphrase each other and share only 2-4 characters.
//
// So the model now declares both relationships and the code only checks that each
// declaration refers to something that actually exists.

function createDeclarationVolume() {
  const now = new Date().toISOString();
  const chapter = (chapterOrder, title, extra) => ({
    id: `chapter-${chapterOrder}`,
    volumeId: "volume-decl",
    novelId: "novel-1",
    chapterOrder,
    title,
    summary: `第${chapterOrder}章摘要`,
    purpose: null,
    // Unwritten chapters carry no exclusiveEvent at all; that is the real DB shape.
    exclusiveEvent: null,
    endingState: null,
    nextChapterEntryState: null,
    conflictLevel: 50,
    conflictLevelSource: "ai",
    revealLevel: 40,
    targetWordCount: 3000,
    mustAvoid: null,
    taskSheet: null,
    sceneCards: null,
    payoffRefs: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  const chapters = [
    chapter(1, "加价三倍的凶宅单", { exclusiveEvent: "种下妖记" }),
    chapter(2, "最后一张真符", { exclusiveEvent: "背周婆冲出老楼并被咬下妖记" }),
    chapter(3, "翻出停用通道"),
  ];
  return { chapters, target: chapters[1] };
}

function createDeclarationInput() {
  const { chapters, target } = createDeclarationVolume();
  return {
    ...createPromptInput(),
    targetVolume: {
      id: "volume-decl",
      novelId: "novel-1",
      sortOrder: 1,
      title: "第一卷",
      summary: "测试卷摘要",
      openingHook: "接单",
      mainPromise: "推进",
      primaryPressureSource: "妖物",
      coreSellingPoint: "民俗悬疑",
      escalationMode: "从受压到反查",
      protagonistChange: "从求生到追查",
      midVolumeRisk: "被盯上",
      climax: "当面对质",
      payoffType: "线索推进",
      nextVolumeHook: "更大势力",
      resetPoint: null,
      openPayoffs: [],
      status: "active",
      sourceVersionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chapters,
    },
    // Same object identity: the validators look the target up by identity.
    targetChapter: target,
    detailMode: "execution_contract",
  };
}

function createDeclarationContract() {
  return {
    purpose: "拍符封门背人冲楼。",
    exclusiveEvent: "背周婆冲出老楼并被咬下妖记",
    endingState: "带妖记回到出租屋",
    nextChapterEntryState: "次日找老邱对质",
    conflictLevel: 50,
    revealLevel: 45,
    targetWordCount: 2800,
    mustAvoid: "不得让周婆死亡；不得让劳梓凡在本章再次'发现'通道A停用三年这一第1章已知信息。",
    payoffRefs: [],
    requiredElements: ["拍出最后一张真符", "回站点后台复核通道A记录"],
    taskSheet: "回站点后台复核第1章已截图的通道A记录。",
    readerExperience: {
      readerQuestion: "谁在派单",
      promisedReward: "确认有人盯着",
      rewardLevel: "partial",
      protagonistWant: "查清通道A",
      primaryResistance: "权限不足",
      keyTurn: "日志出现非本人查询",
      emotionalShift: "意识到被盯",
      informationReveal: "通道A停用三年仍派单",
      netChange: "从可疑来源变成有人盯",
      inheritedHookResponsibilities: [],
      endingHook: "次日对质",
    },
    sceneCards: [
      { key: "scene_1", title: "门框火线", purpose: "p", mustAdvance: ["拍符封门"], mustPreserve: [], entryState: "六楼", exitState: "封门", forbiddenExpansion: [] },
      { key: "scene_2", title: "背人冲楼", purpose: "p", mustAdvance: ["冲下老楼"], mustPreserve: [], entryState: "里屋", exitState: "肩被咬", forbiddenExpansion: [] },
      { key: "scene_3", title: "回站点复核", purpose: "p", mustAdvance: ["查订单来源"], mustPreserve: [], entryState: "站点", exitState: "决定次日找老邱", forbiddenExpansion: [] },
    ],
    neighborEventUse: [
      { relation: "previous", consumesExclusiveEvent: false, evidence: "承接上一章种下妖记后的状态，不重演接单遇妖。" },
      { relation: "next", consumesExclusiveEvent: false, evidence: "不占用下一章翻查通道的职责。" },
    ],
    mustAvoidConflicts: [],
  };
}

const emptyContext = { blocks: [], selectedBlockIds: [], droppedBlockIds: [], summarizedBlockIds: [], estimatedInputTokens: 0 };

test("an honest contract with no declared conflict or neighbour claim is accepted", () => {
  const input = createDeclarationInput();
  const contract = createDeclarationContract();
  assert.doesNotThrow(() => volumeChapterExecutionContractPrompt.postValidate(contract, input, emptyContext));
});

test("a contract that forbids an event in mustAvoid while scheduling it is rejected", () => {
  const input = createDeclarationInput();
  const contract = {
    ...createDeclarationContract(),
    mustAvoidConflicts: [{
      forbiddenClause: "不得让劳梓凡在本章再次'发现'通道A停用三年这一第1章已知信息。",
      scheduledIn: "sceneCards[2]",
      reason: "禁止再次发现通道A，但 scene_3 安排回站点后台复核同一记录。",
    }],
  };
  assert.throws(
    () => volumeChapterExecutionContractPrompt.postValidate(contract, input, emptyContext),
    /自相矛盾/,
  );
});

test("a declared conflict that cites a clause absent from mustAvoid is rejected as fabricated", () => {
  const input = createDeclarationInput();
  const contract = {
    ...createDeclarationContract(),
    mustAvoidConflicts: [{ forbiddenClause: "不得让周婆说出银镯", scheduledIn: "sceneCards[2]", reason: "x" }],
  };
  assert.throws(
    () => volumeChapterExecutionContractPrompt.postValidate(contract, input, emptyContext),
    /不是 mustAvoid 中的原文条目/,
  );
});

test("a declared conflict pointing at a non-existent slot is rejected", () => {
  const input = createDeclarationInput();
  const contract = {
    ...createDeclarationContract(),
    mustAvoidConflicts: [{ forbiddenClause: "不得让周婆死亡", scheduledIn: "sceneCards[9]", reason: "x" }],
  };
  assert.throws(
    () => volumeChapterExecutionContractPrompt.postValidate(contract, input, emptyContext),
    /不存在/,
  );
});

test("claiming a written previous chapter's exclusive event is rejected", () => {
  const input = createDeclarationInput();
  const contract = {
    ...createDeclarationContract(),
    neighborEventUse: [
      { relation: "previous", consumesExclusiveEvent: true, evidence: "本章再次写种下妖记。" },
      { relation: "next", consumesExclusiveEvent: false, evidence: "不占用下一章。" },
    ],
  };
  assert.throws(
    () => volumeChapterExecutionContractPrompt.postValidate(contract, input, emptyContext),
    /一次性节点不能跨章重复占用/,
  );
});

test("claiming an unwritten neighbour's exclusive event is rejected as invented", () => {
  const input = createDeclarationInput();
  const contract = {
    ...createDeclarationContract(),
    neighborEventUse: [
      { relation: "previous", consumesExclusiveEvent: false, evidence: "不占用上一章。" },
      { relation: "next", consumesExclusiveEvent: true, evidence: "本章负责翻出停用通道。" },
    ],
  };
  assert.throws(
    () => volumeChapterExecutionContractPrompt.postValidate(contract, input, emptyContext),
    /没有任何独占事件可占用/,
  );
});

test("the title verb whitelist is gone: no fixed word list decides boundary conflicts", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "prompting", "prompts", "novel", "volume", "chapterDetail.prompts.ts"),
    "utf8",
  );
  // The constant name survives only inside the comment explaining why it was removed.
  assert.doesNotMatch(source, /const TITLE_EVENT_ANCHOR_HINTS/);
  assert.doesNotMatch(source, /function extractEventAnchorsFromTitle/);
  assert.doesNotMatch(source, /extractEventAnchorsFromTitle\(/);
});
