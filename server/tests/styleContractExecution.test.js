const test = require("node:test");
const assert = require("node:assert/strict");

const { StyleCompiler } = require("../dist/services/styleEngine/StyleCompiler.js");
const {
  buildWriterStyleContractText,
  hasStyleRuleContent,
} = require("../dist/services/styleEngine/styleContractText.js");
const { DEFAULT_STYLE_TEMPLATES } = require("../dist/services/styleEngine/defaults.js");
const { StyleBindingService } = require("../dist/services/styleEngine/StyleBindingService.js");
const { prisma } = require("../dist/db/prisma.js");
const styleEngineSeedService = require("../dist/services/styleEngine/StyleEngineSeedService.js");
const { buildChapterWriterContextBlocks } = require("../dist/prompting/prompts/novel/context/chapterContextBlocks.js");
const { createContextBlock } = require("../dist/prompting/core/contextBudget.js");
const { selectContextBlocks } = require("../dist/prompting/core/contextSelection.js");
const {
  buildDirectorWorkflowSeedPayload,
  getDirectorInputFromSeedPayload,
} = require("../dist/services/novel/director/runtime/novelDirectorHelpers.js");
const xiniProfile = require("../../docs/style-profiles/shijing-xini.json");

function findTemplate(key) {
  const template = DEFAULT_STYLE_TEMPLATES.find((item) => item.key === key);
  assert.ok(template, `missing default style template ${key}`);
  return template;
}

function compileText(rules, antiAiRules = []) {
  const compiled = new StyleCompiler().compile({
    styleProfile: {
      narrativeRules: rules.narrativeRules ?? {},
      characterRules: rules.characterRules ?? {},
      languageRules: rules.languageRules ?? {},
      rhythmRules: rules.rhythmRules ?? {},
    },
    antiAiRules,
    weight: 1,
    effectiveStyleProfileId: rules.id ?? "profile-1",
  });
  return { compiled, text: buildWriterStyleContractText(compiled.contract) };
}

function buildWriteContext(styleContract) {
  return {
    bookContract: {
      title: "测试小说",
      genre: "武侠",
      targetAudience: "男频读者",
      sellingPoint: "江湖恩怨",
      first30ChapterPromise: "尽快进入江湖冲突",
      narrativePov: "third_person",
      pacePreference: "fast",
      emotionIntensity: "medium",
      toneGuardrails: [],
      hardConstraints: [],
    },
    macroConstraints: null,
    volumeWindow: null,
    chapterMission: {
      chapterId: "chapter-1",
      chapterOrder: 3,
      title: "客栈风波",
      objective: "让主角在客栈里被卷入一场冲突",
      expectation: "冲突升级并留下追兵线索",
      targetWordCount: 2800,
      planRole: "pressure",
      hookTarget: "追兵看到主角的脸",
      mustAdvance: ["主角暴露"],
      mustPreserve: ["幕后身份"],
      riskNotes: [],
    },
    nextAction: "write_chapter",
    chapterStateGoal: null,
    protectedSecrets: [],
    payoffDirectives: [],
    obligationContract: {
      mustHitNow: [],
      mustPreserve: [],
      requiredPayoffTouches: [],
      requiredCharacterAppearances: [],
      requiredGoalChanges: [],
      canDefer: [],
      forbiddenCrossings: [],
    },
    chapterBoundary: null,
    lengthBudget: null,
    scenePlan: null,
    participants: [{
      id: "char-1",
      name: "主角",
      role: "主角",
      personality: "谨慎",
      currentState: "赶路",
      currentGoal: "找到落脚处",
    }],
    characterHardFacts: [],
    characterBehaviorGuides: [],
    activeRelationStages: [],
    pendingCandidateGuards: [],
    localStateSummary: "主角刚进客栈。",
    openConflictSummaries: [],
    ledgerPendingItems: [],
    ledgerUrgentItems: [],
    ledgerOverdueItems: [],
    ledgerSummary: null,
    characterResourceContext: null,
    writtenEvidence: null,
    recentChapterSummaries: ["上一章主角在官道遇袭。"],
    previousChapterTail: null,
    openingAntiRepeatHint: "不要用环境铺陈开场。",
    styleContract: styleContract ?? null,
    styleConstraints: [],
    continuationConstraints: [],
    ragFacts: [],
    completedMilestones: [],
    recentScenePatterns: [],
  };
}

test("金庸/天下霸唱/细腻三个写法都能编译出可执行的正文风格合同", () => {
  const jinyong = findTemplate("jinyong-wuxia-classic");
  const tianxia = findTemplate("tianxia-bachang-folk-horror");

  const jinyongText = compileText(jinyong).text;
  for (const marker of [
    "【写法合同速览】",
    "【叙事写法合同】",
    "【语言写法合同】",
    "【节奏写法合同】",
    "传奇式成长弧",
    "文白相间、不掉书袋",
    "中快节奏",
    "张弛分明",
    "对白文白相间",
    "【正文完成前自查】",
    "执行顺序",
  ]) {
    assert.ok(jinyongText.includes(marker), `金庸合同缺少可执行规则：${marker}`);
  }
  for (const rawToken of ["legend_arc", "classical_vernacular", "medium_fast", "must keep", "[compat]", "Narrative contract"]) {
    assert.equal(jinyongText.includes(rawToken), false, `金庸合同不应再输出原始 token：${rawToken}`);
  }

  const tianxiaText = compileText(tianxia).text;
  for (const marker of [
    "探险层层升级",
    "北方口语",
    "快节奏",
    "段落偏短偏密",
    "对白口语化、带调侃",
    "冷处理",
  ]) {
    assert.ok(tianxiaText.includes(marker), `天下霸唱合同缺少可执行规则：${marker}`);
  }
  assert.equal(tianxiaText.includes("expedition_escalation"), false);

  const xiniText = compileText(xiniProfile).text;
  for (const marker of [
    "以贴近当事人的有限视角",
    "写具体盘算",
    "允许不完整句",
    "写法示例",
    "一场戏至少改变处境",
    "细腻不等于副词加倍",
    "写进选取的细节",
  ]) {
    assert.ok(xiniText.includes(marker), `细腻合同缺少可执行规则：${marker}`);
  }
});

test("写法合同进入 writer context：核心段完整、顺序靠前且保留速览", () => {
  const jinyong = findTemplate("jinyong-wuxia-classic");
  const { compiled, text } = compileText(jinyong);
  const blocks = buildChapterWriterContextBlocks(buildWriteContext(compiled.contract));
  const styleBlock = blocks.find((block) => block.group === "style_contract");
  assert.ok(styleBlock, "writer context 应包含 style_contract 块");
  assert.equal(styleBlock.required, true);
  assert.ok(styleBlock.content.includes("传奇式成长弧"));
  assert.ok(styleBlock.content.includes("文白相间、不掉书袋"));
  assert.ok(styleBlock.content.includes("中快节奏"));
  assert.ok(styleBlock.content.includes("对白文白相间"));
  assert.ok(styleBlock.content.includes("【写法合同速览】"));
  // 裁剪时优先保留：叙事 → 语言 → 节奏 → 人物。
  const narrativeIndex = styleBlock.content.indexOf("【叙事写法合同】");
  const languageIndex = styleBlock.content.indexOf("【语言写法合同】");
  const rhythmIndex = styleBlock.content.indexOf("【节奏写法合同】");
  const characterIndex = styleBlock.content.indexOf("【人物写法合同】");
  assert.ok(narrativeIndex >= 0 && languageIndex > narrativeIndex && rhythmIndex > languageIndex && characterIndex > rhythmIndex);
  assert.equal(styleBlock.content, text);
});

test("未选风格时不注入空壳写法合同，只保留可用的反 AI 底线", () => {
  const antiAiRule = {
    id: "rule-1",
    key: "rule-1",
    name: "反 AI 底线",
    type: "forbidden",
    severity: "high",
    description: "禁止总结主题。",
    detectPatterns: [],
    rewriteSuggestion: "改成具体场景。",
    promptInstruction: "禁止总结主题或替读者提炼中心思想。",
    autoRewrite: false,
    enabled: true,
    globalBaselineEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const { compiled } = compileText({}, [antiAiRule]);
  assert.equal(hasStyleRuleContent(compiled.contract), false);
  const baselineText = buildWriterStyleContractText(compiled.contract);
  assert.ok(baselineText.includes("【反 AI 底线】"));
  assert.equal(baselineText.includes("【叙事写法合同】"), false);
  assert.equal(baselineText.includes("【语言写法合同】"), false);

  const blocks = buildChapterWriterContextBlocks(buildWriteContext(compiled.contract));
  assert.equal(blocks.some((block) => block.group === "style_contract"), false);
  assert.ok(blocks.some((block) => block.group === "anti_ai_baseline"), "仅有全局反 AI 底线时应使用独立块");

  const noContractBlocks = buildChapterWriterContextBlocks(buildWriteContext(null));
  assert.equal(noContractBlocks.some((block) => block.group === "style_contract"), false);
  assert.equal(noContractBlocks.some((block) => block.group === "anti_ai_baseline"), false);
  assert.ok(noContractBlocks.length > 0, "没有写法时 writer context 仍应可正常构建");
});

test("写法上下文被预算压缩时优先保留速览与语言/节奏方向", () => {
  const jinyong = findTemplate("jinyong-wuxia-classic");
  const { compiled } = compileText(jinyong);
  const styleBlock = createContextBlock({
    id: "style_contract",
    group: "style_contract",
    priority: 74,
    required: true,
    content: buildWriterStyleContractText(compiled.contract),
  });
  const filler = createContextBlock({
    id: "filler",
    group: "filler",
    priority: 99,
    required: true,
    allowSummary: false,
    content: "上下文占位。".repeat(700),
  });
  const remainingForStyle = 300;
  const result = selectContextBlocks(
    [filler, styleBlock],
    { maxTokensBudget: filler.estimatedTokens + remainingForStyle },
  );
  assert.ok(result.summarizedBlockIds.includes("style_contract"), "style_contract 应在预算不足时进入摘要路径");
  const selected = result.selectedBlocks.find((block) => block.id === "style_contract");
  assert.ok(selected, "required 的写法块不能被直接丢弃");
  assert.ok(selected.content.includes("【写法合同速览】"), "摘要后仍应保留速览");
  assert.ok(selected.content.includes("叙事写法："), "摘要后仍应保留叙事方向速览");
});

function buildProfileRow(id, name, narrativeSummary, antiAiRules = []) {
  const now = new Date();
  return {
    id,
    name,
    description: null,
    category: null,
    tagsJson: "[]",
    applicableGenresJson: "[]",
    sourceType: "manual",
    sourceRefId: null,
    sourceContent: null,
    extractedFeaturesJson: "[]",
    extractionPresetsJson: "[]",
    extractionAntiAiRuleKeysJson: "[]",
    selectedExtractionPresetKey: null,
    analysisMarkdown: null,
    status: "active",
    narrativeRulesJson: JSON.stringify({ summary: narrativeSummary }),
    characterRulesJson: "{}",
    languageRulesJson: "{}",
    rhythmRulesJson: "{}",
    antiAiBindings: antiAiRules.map((antiAiRule) => ({ antiAiRule })),
    createdAt: now,
    updatedAt: now,
  };
}

test("书级绑定优先级相同时，新选写法覆盖旧写法而不是反过来", async () => {
  const originalEnsure = styleEngineSeedService.ensureStyleEngineSeedData;
  const originalFindBindings = prisma.styleBinding.findMany;
  const originalFindAntiAiRules = prisma.antiAiRule.findMany;
  const older = new Date(Date.now() - 60_000);
  const newer = new Date();
  styleEngineSeedService.ensureStyleEngineSeedData = async () => ({});
  prisma.antiAiRule.findMany = async () => [];
  // 与线上查询一致：priority desc, updatedAt desc；同优先级时新绑定排在前面。
  prisma.styleBinding.findMany = async () => [
    {
      id: "binding-new", styleProfileId: "profile-new", targetType: "novel", targetId: "novel-1",
      priority: 1, weight: 1, enabled: true,
      styleProfile: buildProfileRow("profile-new", "新选的天下霸唱", "新写法：冷处理诡谲探险"),
      createdAt: newer, updatedAt: newer,
    },
    {
      id: "binding-old", styleProfileId: "profile-old", targetType: "novel", targetId: "novel-1",
      priority: 1, weight: 1, enabled: true,
      styleProfile: buildProfileRow("profile-old", "旧的细腻", "旧写法：市井细腻"),
      createdAt: older, updatedAt: older,
    },
  ];

  try {
    const resolved = await new StyleBindingService().resolveForGeneration({ novelId: "novel-1" });
    assert.equal(resolved.effectiveStyleProfileId, "profile-new");
    assert.match(resolved.compiledBlocks.contract.narrative.text, /新写法：冷处理诡谲探险/);
    assert.equal(resolved.compiledBlocks.contract.narrative.text.includes("旧写法：市井细腻"), false);
  } finally {
    styleEngineSeedService.ensureStyleEngineSeedData = originalEnsure;
    prisma.styleBinding.findMany = originalFindBindings;
    prisma.antiAiRule.findMany = originalFindAntiAiRules;
  }
});

test("新绑定自动排到已有绑定之前，重复绑定同一写法不新增记录", async () => {
  const originalFindBindings = prisma.styleBinding.findMany;
  const originalCreate = prisma.styleBinding.create;
  const originalUpdate = prisma.styleBinding.update;
  const originalFindUnique = prisma.styleBinding.findUnique;
  const created = [];
  prisma.styleBinding.findMany = async () => [
    { id: "binding-old", styleProfileId: "profile-old", priority: 3 },
  ];
  prisma.styleBinding.create = async ({ data }) => {
    created.push(data);
    return {
      id: "binding-new",
      ...data,
      styleProfile: buildProfileRow(data.styleProfileId, "新写法", "新写法规则"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  prisma.styleBinding.update = async (args) => {
    assert.equal(args.where.id, "binding-old");
    assert.equal(args.data.priority, 4);
    return {
      id: "binding-old", styleProfileId: "profile-old", targetType: "novel", targetId: "novel-1",
      priority: 4, weight: 1, enabled: true,
      styleProfile: buildProfileRow("profile-old", "旧写法", "旧写法规则"),
      createdAt: new Date(), updatedAt: new Date(),
    };
  };
  prisma.styleBinding.findUnique = async () => ({
    id: "binding-old", styleProfileId: "profile-old", targetType: "novel", targetId: "novel-1",
    priority: 4, weight: 1, enabled: true,
    styleProfile: buildProfileRow("profile-old", "旧写法", "旧写法规则"),
    createdAt: new Date(), updatedAt: new Date(),
  });

  try {
    const service = new StyleBindingService();
    const newBinding = await service.createBinding({
      styleProfileId: "profile-new", targetType: "novel", targetId: "novel-1",
      priority: 1, weight: 1, enabled: true,
    });
    assert.equal(newBinding.priority, 4);
    assert.equal(created.length, 1);
    assert.equal(created[0].priority, 4);

    // 重新选择已在最前面的同一套写法：提升原绑定而不是再插一条同优先级记录。
    const sameBinding = await service.createBinding({
      styleProfileId: "profile-old", targetType: "novel", targetId: "novel-1",
      priority: 1, weight: 1, enabled: true,
    });
    assert.equal(sameBinding.id, "binding-old");
    assert.equal(created.length, 1);
  } finally {
    prisma.styleBinding.findMany = originalFindBindings;
    prisma.styleBinding.create = originalCreate;
    prisma.styleBinding.update = originalUpdate;
    prisma.styleBinding.findUnique = originalFindUnique;
  }
});

test("写法选择会写入导演任务 seed 并可从 seed 恢复", () => {
  const styleProfileId = "cmpv34fbm000efgw00bkxnuz8";
  const styleIntentSummary = {
    source: "style_profile",
    styleProfileId,
    styleProfileName: "金庸古典武侠写法",
    headline: "金庸古典武侠写法",
    antiAiFocus: [],
    stageSummaryLines: ["读感承诺：以白描见情义"],
  };
  const seedPayload = buildDirectorWorkflowSeedPayload({
    idea: "外卖骑手闯江湖",
    title: "外卖骑手闯江湖",
    styleProfileId,
    styleIntentSummary,
    runMode: "auto_to_ready",
    provider: "deepseek",
    model: "deepseek-chat",
    temperature: 0.7,
    candidate: null,
    batchId: null,
    round: 1,
  }, "novel-1");

  assert.equal(seedPayload.styleProfileId, styleProfileId);
  assert.deepEqual(seedPayload.styleIntentSummary, styleIntentSummary);
  const restored = getDirectorInputFromSeedPayload(seedPayload);
  assert.ok(restored);
  assert.equal(restored.styleProfileId, styleProfileId);
  assert.equal(restored.styleIntentSummary.styleProfileName, "金庸古典武侠写法");
});
