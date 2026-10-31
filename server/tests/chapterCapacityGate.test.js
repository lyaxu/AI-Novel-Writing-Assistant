const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
function load(relative, imports) {
  const filename = path.isAbsolute(relative) ? relative : path.resolve(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((id) => {
    if (!Object.hasOwn(imports, id)) throw new Error(`Unmocked dependency: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

const lengthControl = require("../../shared/dist/types/chapterLengthControl.js");
const capacity = require("../../shared/dist/types/chapterCapacity.js");
const qualitySchema = require("../../shared/dist/types/chapterTaskSheetQuality.js");
const storyPlanningFramework = require("../../shared/dist/types/storyPlanningFramework.js");
const qualityGateModule = require("../dist/services/novel/volume/ChapterTaskSheetQualityGateService.js");

const capacityGateSource = load("server/src/services/novel/volume/chapterDetail/chapterCapacityGate.ts", {
  "@ai-novel/shared/types/chapterLengthControl": lengthControl,
  "@ai-novel/shared/types/chapterCapacity": capacity,
  "@ai-novel/shared/types/chapterTaskSheetQuality": qualitySchema,
});

function sceneCards(options = {}) {
  const count = options.sceneCount ?? 3;
  return Array.from({ length: count }, (_, index) => ({
    key: `scene-${index + 1}`,
    title: `场景${index + 1}`,
    purpose: "推进本章唯一主事件",
    mustAdvance: options.mustAdvance?.[index] ?? ["主事件向前一步"],
    mustPreserve: ["不提前揭示作者真相"],
    entryState: index === 0 ? "主角带着疑问入场。" : "承接上一场结果。",
    exitState: "局面发生一次明确变化。",
    forbiddenExpansion: ["不处理下一章主事件"],
    targetWordCount: options.targetWordCount ? Math.round(options.targetWordCount / count) : 900,
    resistance: "对手拒绝配合。",
    turn: "主角用一个具体证据逼出反应。",
    emotionalShift: "急躁转为冷静。",
    readerValue: "读者看到主事件与转折。",
  }));
}

function capacityPlan(overrides = {}) {
  return {
    coreEvent: "主角第一次验货并发现账目被人改过",
    keyTurn: "验货时发现印章是伪造的",
    mustDeliver: ["验货确认账目被改"],
    deferable: [],
    seedOnly: ["账本边角的陌生印鉴"],
    estimatedCoreWordCount: 2200,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  const targetWordCount = overrides.targetWordCount ?? 2800;
  const plan = overrides.capacityPlan ?? capacityPlan();
  const planTexts = overrides.sceneRequiredElements
    ?? (plan ? [...plan.mustDeliver, ...plan.seedOnly] : []);
  const cards = sceneCards({ targetWordCount, mustAdvance: planTexts.length ? planTexts.map((text) => [text]) : undefined });
  return {
    novelId: "novel-1",
    volumeId: "volume-1",
    chapterId: "chapter-1",
    chapterOrder: 1,
    title: "第一章 验货",
    summary: "主角验货。",
    purpose: "完成一次验货并发现账目被改。",
    exclusiveEvent: plan?.coreEvent ?? "主角第一次验货并发现账目被人改过",
    endingState: "主角确认账目被改，但没有声张。",
    nextChapterEntryState: "主角决定顺着伪造印章继续查。",
    conflictLevel: 40,
    revealLevel: 30,
    targetWordCount,
    mustAvoid: "不要提前揭示伪造者。",
    payoffRefs: [],
    taskSheet: "完成验货、发现伪造印章、压住反应。",
    sceneCards: JSON.stringify({ targetWordCount, scenes: cards, requiredElements: planTexts, capacityPlan: plan }),
    requiredElements: planTexts,
    capacityPlan: plan,
    ...overrides,
  };
}

function usableAssessment() {
  return {
    verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is",
    summary: "通过", issues: [], repairGuidance: [], confidence: 0.9,
  };
}

function gateWith(assessment = usableAssessment()) {
  return new qualityGateModule.ChapterTaskSheetQualityGateService(async () => assessment);
}

test("overloaded real-world chapter is rejected before the writer with a window-replan decision", async () => {
  const overloaded = capacityPlan({
    mustDeliver: [
      "进入秘境入口",
      "被卷入秘境",
      "预判机关位置",
      "救下同行",
      "传功给主角",
      "试招成功",
      "答应长老请求",
      "要回欠账",
      "约定次日再入秘境",
      "发现债务线索",
    ],
    estimatedCoreWordCount: 6400,
  });
  const evaluation = capacityGateSource.evaluateCandidateCapacity(candidate({ capacityPlan: overloaded }));
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.requiresWindowReplan, true);
  const codes = evaluation.violations.map((violation) => violation.code);
  assert.ok(codes.includes("capacity_must_deliver_over_budget"));
  assert.ok(codes.includes("capacity_total_words_over_budget"));
  assert.ok(codes.includes("capacity_word_estimate_over_budget"));

  const result = await gateWith().evaluate(candidate({ capacityPlan: overloaded }));
  assert.equal(result.canEnterExecution, false);
  assert.equal(result.recommendedHandling, "replan_window");
  assert.equal(result.capacity.passed, false);
  assert.ok(result.issues.some((issue) => issue.id === "capacity_must_deliver_over_budget"));
  assert.deepEqual(result.issues.map((issue) => issue.id), codes);
});

test("one main event and one clear turn pass the capacity gate", async () => {
  const evaluation = capacityGateSource.evaluateCandidateCapacity(candidate());
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.capacityPlanPresent, true);
  assert.equal(evaluation.violations.length, 0);

  const result = await gateWith().evaluate(candidate());
  assert.equal(result.canEnterExecution, true);
  assert.equal(result.status, "passed");
});

test("mustDeliver over word budget is rejected even when the plan text looks tidy", () => {
  const tooMany = capacityPlan({
    mustDeliver: ["拿到钥匙", "打开暗门", "穿过地道", "救出人质"],
    seedOnly: [],
    estimatedCoreWordCount: 2000,
  });
  const evaluation = capacityGateSource.evaluateCandidateCapacity(candidate({ capacityPlan: tooMany, targetWordCount: 1800 }));
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.violations.some((violation) => violation.code === "capacity_must_deliver_over_budget"));
  assert.equal(evaluation.requiresWindowReplan, true);
});

test("deferable duties must leave the chapter must-do lists", () => {
  const plan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: ["追查伪造印章来源", "向长老要账"],
    seedOnly: ["账本边角的陌生印鉴"],
    estimatedCoreWordCount: 2300,
  });
  const withLeak = candidate({
    capacityPlan: plan,
    sceneRequiredElements: ["验货确认账目被改", "追查伪造印章来源", "账本边角的陌生印鉴"],
    requiredElements: ["验货确认账目被改", "追查伪造印章来源", "账本边角的陌生印鉴"],
  });
  const leaked = capacityGateSource.evaluateCandidateCapacity(withLeak);
  assert.equal(leaked.passed, false);
  assert.ok(leaked.violations.some((violation) => violation.code === "capacity_deferable_leaked"));

  const cleaned = candidate({ capacityPlan: plan });
  const cleanedEvaluation = capacityGateSource.evaluateCandidateCapacity(cleaned, { allowDeferable: false });
  assert.equal(cleanedEvaluation.passed, false);
  assert.ok(cleanedEvaluation.violations.some((violation) => violation.code === "capacity_deferable_requires_redistribution"));
  // Repair rounds may carry the deferable ledger; it is accepted once later chapters are checked.
  const repairedRounds = capacityGateSource.evaluateCandidateCapacity(cleaned, { allowDeferable: true });
  assert.equal(repairedRounds.passed, true);
});

test("core event must match exclusiveEvent and there is exactly one turn", () => {
  const mismatch = capacityGateSource.evaluateCandidateCapacity(candidate({
    capacityPlan: capacityPlan({ coreEvent: "主角在夜市摆摊" }),
    exclusiveEvent: "主角第一次验货并发现账目被人改过",
  }));
  assert.ok(mismatch.violations.some((violation) => violation.code === "capacity_core_event_mismatch"));

  const repeatedTurn = capacityGateSource.evaluateCandidateCapacity(candidate({
    capacityPlan: capacityPlan({ keyTurn: "主角第一次验货并发现账目被人改过" }),
  }));
  assert.ok(repeatedTurn.violations.some((violation) => violation.code === "capacity_key_turn_repeats_event"));
});

test("legacy contract without a capacity plan stays readable and reusable", async () => {
  const legacy = candidate();
  delete legacy.capacityPlan;
  const legacySceneCards = sceneCards({ targetWordCount: 2800 });
  legacy.sceneCards = JSON.stringify({ targetWordCount: 2800, scenes: legacySceneCards, requiredElements: ["验货确认账目被改"] });
  legacy.requiredElements = ["验货确认账目被改"];
  const evaluation = capacityGateSource.evaluateCandidateCapacity(legacy);
  assert.equal(evaluation.capacityPlanPresent, false);
  assert.equal(evaluation.passed, true);

  const result = await gateWith().evaluate(legacy);
  assert.equal(result.canEnterExecution, true);
});

test("persisted scene plan round-trips the capacity plan without a database migration", () => {
  const plan = capacityPlan();
  const normalized = lengthControl.normalizeChapterScenePlan({
    scenes: sceneCards(),
    capacityPlan: plan,
    requiredElements: [...plan.mustDeliver, ...plan.seedOnly],
  }, 2800);
  assert.deepEqual(normalized.capacityPlan, plan);
  const serialized = lengthControl.serializeChapterScenePlan(normalized);
  const reparsed = lengthControl.parseChapterScenePlan(serialized, { targetWordCount: 2800 });
  assert.deepEqual(reparsed.capacityPlan, plan);
  assert.deepEqual(reparsed.requiredElements, [...plan.mustDeliver, ...plan.seedOnly]);
});

// ---------------------------------------------------------------------------
// Generation integration: a rejected capacity attempt must not reach the writer;
// a corrected retry returns a persisted capacity plan.
// ---------------------------------------------------------------------------

function generationHarness(scriptedContracts) {
  const contractCalls = [];
  const qualityCalls = [];
  const guardEvents = [];
  const runner = {
    runStructuredPrompt: async (request) => {
      if (request.asset?.id === "quality") {
        qualityCalls.push(request.promptInput?.candidate);
        return { output: usableAssessment() };
      }
      contractCalls.push(request);
      const next = scriptedContracts.shift();
      if (next instanceof Error) throw next;
      return { output: JSON.parse(JSON.stringify(next)) };
    },
  };
  const gateService = load("server/src/services/novel/volume/ChapterTaskSheetQualityGateService.ts", {
    "@ai-novel/shared/types/chapterTaskSheetQuality": qualitySchema,
    "@ai-novel/shared/types/llm": {},
    "@ai-novel/shared/types/novel/planningPromises": { selectedPlanningPromiseIds: () => [] },
    "../../../prompting/core/promptRunner": runner,
    "../production/reliability": require("../dist/services/novel/production/reliability/index.js"),
    "../../../prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts": {
      chapterTaskSheetQualityPrompt: { id: "quality" }, validatePlanningStateSources: () => {},
    },
    "../../settings/storyCraftContractContext": { loadStoryCraftContractBlock: async () => null },
    "./chapterDetail/chapterCapacityGate": capacityGateSource,
  });
  const generation = load("server/src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts", {
    "@ai-novel/shared/types/chapterTaskSheetQuality": qualitySchema,
    "@ai-novel/shared/types/chapterLengthControl": lengthControl,
    "../../../../prompting/core/promptRunner": runner,
    "../../../../prompting/prompts/novel/promptBudgetProfiles": { PLANNING_OUTPUT_TOKEN_BUDGET: 8192 },
    "../../../../prompting/prompts/novel/volume/chapterDetail.prompts": { volumeChapterExecutionContractPrompt: { id: "novel.volume.chapter_execution_contract" } },
    "../../../../prompting/prompts/novel/volume/contextBlocks": { buildVolumeChapterDetailContextBlocks: () => [] },
    "../../../settings/storyCraftContractContext": { appendStoryCraftContractBlock: async (blocks) => blocks },
    "../storyMacro/StoryMacroPlanService": {},
    "../ChapterTaskSheetQualityGateService": gateService,
    "@ai-novel/shared/types/storyPlanningFramework": storyPlanningFramework,
    "../writtenEvidence": {},
    "../planningPromises": { projectPlanningHorizon: () => ({}) },
    "./chapterContractGuardTrace": { recordChapterContractGuardEvent: async (event) => guardEvents.push(event) },
    "./chapterCapacityGate": capacityGateSource,
    "./chapterCapacityLog": {
      logChapterCapacityEvent: () => {},
      recordChapterCapacityAuditSafely: async () => {},
    },
  });
  const chapter = {
    id: "chapter-1", chapterId: "chapter-1", chapterOrder: 1, title: "第一章 验货",
    summary: "主角验货。", purpose: null, exclusiveEvent: null, endingState: null,
    nextChapterEntryState: null, conflictLevel: null, revealLevel: null,
    targetWordCount: 2800, mustAvoid: null, payoffRefs: [], taskSheet: null, sceneCards: null,
  };
  const volume = { id: "volume-1", sortOrder: 1, title: "第一卷", openPayoffs: [], chapters: [chapter] };
  const params = {
    promptInput: {
      novel: { title: "测试", defaultChapterLength: 2800, characters: [] },
      workspace: { novelId: "novel-1", volumes: [volume], beatSheets: [] },
      storyMacroPlan: null, strategyPlan: null, targetVolume: volume, targetBeatSheet: null,
      targetChapter: chapter, detailMode: "task_sheet",
    },
    options: {},
  };
  return { generation, params, contractCalls, qualityCalls, guardEvents };
}

function contractOutput(plan = capacityPlan()) {
  const planTexts = [...plan.mustDeliver, ...plan.seedOnly];
  return {
    purpose: "完成验货并发现账目被改。",
    exclusiveEvent: plan.coreEvent,
    endingState: "主角确认账目被改，但没有声张。",
    nextChapterEntryState: "主角决定顺着伪造印章继续查。",
    conflictLevel: 40,
    revealLevel: 30,
    targetWordCount: 2800,
    mustAvoid: "不要提前揭示伪造者。",
    payoffRefs: [],
    requiredElements: planTexts,
    capacityPlan: plan,
    taskSheet: "完成验货、发现伪造印章、压住反应。",
    readerExperience: {
      readerQuestion: "账目是谁改的", promisedReward: "一个伪造印章", rewardLevel: "partial",
      protagonistWant: "弄清账目问题", primaryResistance: "对手阻拦", keyTurn: plan.keyTurn,
      emotionalShift: "急躁转为冷静", informationReveal: "印章是伪造的", netChange: "账目被改得到确认",
      inheritedHookResponsibilities: [], endingHook: "伪造印章从哪来",
    },
    stateClaims: [],
    sceneCards: sceneCards({ targetWordCount: 2800, mustAdvance: planTexts.map((text) => [text]) }).map((card, index) => ({
      ...card, targetWordCount: index === 0 ? 934 : index === 1 ? 933 : 933,
    })),
    neighborEventUse: [],
    mustAvoidConflicts: [],
  };
}

test("classification-only capacity problems are corrected once before writing", async () => {
  const plan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [],
    seedOnly: ["账本边角的陌生印鉴"],
    estimatedCoreWordCount: 2300,
  });
  const misclassified = contractOutput(plan);
  // An unclassified duty appears in the flat list but is in no capacity group.
  misclassified.requiredElements = ["验货确认账目被改", "账本边角的陌生印鉴", "顺手查一下隔壁账房"];
  const harness = generationHarness([misclassified, contractOutput(plan)]);
  const result = await harness.generation.generateChapterTaskSheetDetail(harness.params);
  assert.equal(harness.contractCalls.length, 2, "capacity classification problem must be corrected once before writing");
  assert.match(harness.contractCalls[1].promptInput.contractRepairFeedback, /capacity_required_elements_unclassified/);
  const persisted = lengthControl.parseChapterScenePlan(result.sceneCards, { targetWordCount: result.targetWordCount });
  assert.deepEqual(persisted.capacityPlan.mustDeliver, plan.mustDeliver);
  assert.deepEqual(persisted.capacityPlan.deferable, []);
  assert.equal(harness.qualityCalls.length, 1, "corrected contract proceeds to the existing semantic review");
});

test("structural capacity overflow never reaches the writer and exposes a window-replan decision", async () => {
  const overloadedPlan = capacityPlan({
    mustDeliver: ["进入秘境入口", "被卷入秘境", "预判机关位置", "救下同行", "传功给主角", "试招成功"],
    estimatedCoreWordCount: 6000,
  });
  const harness = generationHarness([contractOutput(overloadedPlan)]);
  await assert.rejects(
    () => harness.generation.generateChapterTaskSheetDetail(harness.params),
    (error) => {
      assert.equal(error.name, "ChapterTaskSheetQualityGateError");
      assert.equal(error.result.capacity.passed, false);
      assert.equal(error.result.recommendedHandling, "replan_window");
      return true;
    },
  );
  assert.equal(harness.contractCalls.length, 1, "one-chapter generation cannot fix structural overload locally");
  assert.equal(harness.qualityCalls.length, 0, "semantic review must not run on an over-capacity contract");
});

// ---------------------------------------------------------------------------
// Redistribution through the existing planning repair window.
// ---------------------------------------------------------------------------

const domain = require("../dist/services/novel/volume/planningRepair/planningRepairDomain.js");
const { createSceneCausality } = require("./fixtures/sceneCausality.js");

function repairChapter(id, volumeId, order, extra = {}) {
  const plan = capacityPlan({
    coreEvent: `第${order}章唯一主事件`,
    keyTurn: `第${order}章唯一转折`,
    mustDeliver: [`完成第${order}章主事件`],
    seedOnly: [],
    deferable: [],
  });
  const cards = sceneCards({ targetWordCount: 2800, mustAdvance: [[`完成第${order}章主事件`], ["推进"], ["收尾"]] })
    .map((card) => ({ ...card, causality: createSceneCausality(), entryState: "入口", exitState: "出口" }));
  return {
    id, volumeId, chapterId: `persisted-${id}`, chapterOrder: order, title: `第${order}章`,
    beatKey: null, summary: "摘要", purpose: "目的", exclusiveEvent: plan.coreEvent,
    endingState: "结束", nextChapterEntryState: "入口", mustAvoid: "禁止", taskSheet: "任务",
    sceneCards: JSON.stringify({ targetWordCount: 2800, scenes: cards, requiredElements: plan.mustDeliver, capacityPlan: plan }),
    targetWordCount: 2800, conflictLevel: 40, conflictLevelSource: "ai", revealLevel: 30,
    styleContract: null, payoffRefs: [], requiredElements: plan.mustDeliver,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...extra,
  };
}

function repairDocument() {
  return {
    novelId: "novel-1", workspaceVersion: "v2", source: "volume", activeVersionId: "version-1",
    strategyPlan: null, critiqueReport: null, beatSheets: [], rebalanceDecisions: [],
    readiness: {}, derivedOutline: "", derivedStructuredOutline: "",
    volumes: [{
      id: "volume-1", novelId: "novel-1", title: "第一卷", sortOrder: 1, status: "draft",
      openPayoffs: [], createdAt: "", updatedAt: "",
      chapters: [repairChapter("p1", "volume-1", 1), repairChapter("p2", "volume-1", 2), repairChapter("p3", "volume-1", 3)],
    }],
  };
}

function repairChange(chapterId, plan, extra = {}) {
  const { targetWordCount = 2800, ...rest } = extra;
  const cards = sceneCards({ targetWordCount, mustAdvance: [[plan.mustDeliver[0] ?? "承接职责"], ["推进"], ["收尾"]] })
    .map((card) => ({ ...card, key: `${chapterId}-${card.key}`, causality: createSceneCausality(), entryState: "入口", exitState: "出口" }));
  return {
    chapterId,
    summary: "修复后摘要",
    purpose: "修复后目的",
    exclusiveEvent: plan.coreEvent,
    endingState: "结束状态",
    nextChapterEntryState: "下一章入口",
    taskSheet: "修复后任务",
    mustAvoid: "禁止事项",
    payoffRefs: [],
    sceneCards: cards,
    readerExperience: {
      readerQuestion: "问", promisedReward: "报", rewardLevel: "partial", protagonistWant: "要",
      primaryResistance: "阻", keyTurn: plan.keyTurn, emotionalShift: "变", informationReveal: "露",
      netChange: "变", inheritedHookResponsibilities: [], endingHook: "钩",
    },
    capacityPlan: plan,
    ...rest,
  };
}

test("capacity repair moves deferred duties into the next unwritten chapter and clears them from the source", () => {
  const document = repairDocument();
  const sourcePlan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: ["追查伪造印章来源", "向长老要账"],
    seedOnly: ["账本边角的陌生印鉴"],
    estimatedCoreWordCount: 2600,
  });
  const targetPlan = capacityPlan({
    coreEvent: "主角追查伪造印章来源",
    keyTurn: "发现印章出自长老府",
    mustDeliver: ["追查伪造印章来源", "向长老要账"],
    deferable: [],
    seedOnly: [],
    estimatedCoreWordCount: 2400,
  });
  const repaired = domain.applyPlanningRepairCandidate(
    document,
    "volume-1",
    ["p1", "p2"],
    {
      requiresUserDecision: false,
      reason: "把超出本章容量的职责拆到下一未写章节",
      changes: [
        repairChange("p1", sourcePlan),
        repairChange("p2", targetPlan),
      ],
      obligationMoves: [],
    },
    [],
    [],
  );
  const source = repaired.volumes[0].chapters.find((chapter) => chapter.id === "p1");
  const destination = repaired.volumes[0].chapters.find((chapter) => chapter.id === "p2");
  const sourcePlanPersisted = JSON.parse(source.sceneCards);
  const destinationPlanPersisted = JSON.parse(destination.sceneCards);
  assert.deepEqual(sourcePlanPersisted.capacityPlan.deferable, ["追查伪造印章来源", "向长老要账"]);
  assert.deepEqual(sourcePlanPersisted.requiredElements, ["验货确认账目被改", "账本边角的陌生印鉴"]);
  assert.ok(destinationPlanPersisted.requiredElements.includes("追查伪造印章来源"));
  assert.ok(destinationPlanPersisted.requiredElements.includes("向长老要账"));

  const sourceGate = capacityGateSource.evaluateCandidateCapacity({
    targetWordCount: source.targetWordCount, exclusiveEvent: source.exclusiveEvent, sceneCards: source.sceneCards,
  }, { allowDeferable: true });
  const destinationGate = capacityGateSource.evaluateCandidateCapacity({
    targetWordCount: destination.targetWordCount, exclusiveEvent: destination.exclusiveEvent, sceneCards: destination.sceneCards,
  }, { allowDeferable: true });
  assert.equal(sourceGate.passed, true);
  assert.equal(destinationGate.passed, true);
});

const DEFERRED_LEASE_RULE = "租约到期后身份自动流转回系统池、可被他人续租的规则揭示";

function runRepair(document, allowedIds, output) {
  return domain.applyPlanningRepairCandidate(document, "volume-1", allowedIds, {
    requiresUserDecision: false,
    reason: "容量拆分与兜底",
    changes: output,
    obligationMoves: [],
  }, [], []);
}

test("deferred duty without a carrier is deterministically written into the earliest later writable chapter", () => {
  const document = repairDocument();
  const sourcePlan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [DEFERRED_LEASE_RULE],
    seedOnly: [],
    estimatedCoreWordCount: 2200,
  });
  const targetPlan = capacityPlan({
    coreEvent: "第2章唯一主事件",
    keyTurn: "第2章唯一转折",
    mustDeliver: ["完成第2章主事件"],
    deferable: [],
    seedOnly: [],
  });
  const repaired = runRepair(document, ["p1", "p2"], [
    repairChange("p1", sourcePlan),
    repairChange("p2", targetPlan),
  ]);
  const source = repaired.volumes[0].chapters.find((chapter) => chapter.id === "p1");
  const target = repaired.volumes[0].chapters.find((chapter) => chapter.id === "p2");
  const sourcePersisted = JSON.parse(source.sceneCards);
  const targetPersisted = JSON.parse(target.sceneCards);
  // Source keeps the deferable ledger; the duty is meant to be carried later, not deleted here.
  assert.deepEqual(sourcePersisted.capacityPlan.deferable, [DEFERRED_LEASE_RULE]);
  assert.deepEqual(domain.getPlanningRepairCapacityDebt(repaired), []);
  assert.ok(targetPersisted.capacityPlan.mustDeliver.includes(DEFERRED_LEASE_RULE));
  assert.ok(targetPersisted.requiredElements.includes(DEFERRED_LEASE_RULE));
  assert.ok(targetPersisted.scenes.some((scene) => scene.mustAdvance.includes(`承接前章延期职责：${DEFERRED_LEASE_RULE}`)));
  const targetGate = capacityGateSource.evaluateCandidateCapacity({
    targetWordCount: target.targetWordCount, exclusiveEvent: target.exclusiveEvent, sceneCards: target.sceneCards,
  });
  assert.equal(targetGate.passed, true);
  const sourceGate = capacityGateSource.evaluateCandidateCapacity({
    targetWordCount: source.targetWordCount, exclusiveEvent: source.exclusiveEvent, sceneCards: source.sceneCards,
  }, { allowDeferable: true });
  assert.equal(sourceGate.passed, true);
});

test("deferred duty skips a later chapter with no capacity left and lands on the next writable chapter", () => {
  const document = repairDocument();
  // p2 only has a 1200-word budget; one mustDeliver already saturates it.
  document.volumes[0].chapters[1] = repairChapter("p2", "volume-1", 2, { targetWordCount: 1200 });
  const sourcePlan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [DEFERRED_LEASE_RULE],
    seedOnly: [],
  });
  const p2Plan = capacityPlan({
    coreEvent: "第2章唯一主事件",
    keyTurn: "第2章唯一转折",
    mustDeliver: ["完成第2章主事件"],
    deferable: [],
    seedOnly: [],
  });
  const p3Plan = capacityPlan({
    coreEvent: "第3章唯一主事件",
    keyTurn: "第3章唯一转折",
    mustDeliver: ["完成第3章主事件"],
    deferable: [],
    seedOnly: [],
  });
  const repaired = runRepair(document, ["p1", "p2", "p3"], [
    repairChange("p1", sourcePlan),
    repairChange("p2", p2Plan, { targetWordCount: 1200 }),
    repairChange("p3", p3Plan),
  ]);
  const target2 = JSON.parse(repaired.volumes[0].chapters.find((chapter) => chapter.id === "p2").sceneCards);
  const target3 = JSON.parse(repaired.volumes[0].chapters.find((chapter) => chapter.id === "p3").sceneCards);
  assert.equal(target2.requiredElements.includes(DEFERRED_LEASE_RULE), false);
  assert.ok(target3.capacityPlan.mustDeliver.includes(DEFERRED_LEASE_RULE));
  assert.deepEqual(domain.getPlanningRepairCapacityDebt(repaired), []);
});

test("no later writable chapter records planning capacity debt instead of pausing the whole book", () => {
  const document = repairDocument();
  const plan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [DEFERRED_LEASE_RULE],
    seedOnly: [],
  });
  const repaired = runRepair(document, ["p3"], [repairChange("p3", plan)]);
  const debt = domain.getPlanningRepairCapacityDebt(repaired);
  assert.equal(debt.length, 1);
  assert.deepEqual(debt[0], {
    fromChapterId: "p3",
    fromChapterOrder: 3,
    item: DEFERRED_LEASE_RULE,
    reason: "no_later_writable_chapter",
    suggestedChapterId: null,
    suggestedChapterOrder: null,
  });
  const source = JSON.parse(repaired.volumes[0].chapters.find((chapter) => chapter.id === "p3").sceneCards);
  assert.deepEqual(source.capacityPlan.deferable, [DEFERRED_LEASE_RULE]);
  const sourceGate = capacityGateSource.evaluateCandidateCapacity({
    targetWordCount: 2800,
    exclusiveEvent: repaired.volumes[0].chapters.find((chapter) => chapter.id === "p3").exclusiveEvent,
    sceneCards: source,
  }, { allowDeferable: true });
  assert.equal(sourceGate.passed, true);
});

test("all later chapters over capacity records debt with the earliest suggested chapter", () => {
  const document = repairDocument();
  document.volumes[0].chapters[1] = repairChapter("p2", "volume-1", 2, { targetWordCount: 1200 });
  const sourcePlan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [DEFERRED_LEASE_RULE],
    seedOnly: [],
  });
  const p2Plan = capacityPlan({
    coreEvent: "第2章唯一主事件",
    keyTurn: "第2章唯一转折",
    mustDeliver: ["完成第2章主事件"],
    deferable: [],
    seedOnly: [],
  });
  const repaired = runRepair(document, ["p1", "p2"], [
    repairChange("p1", sourcePlan),
    repairChange("p2", p2Plan, { targetWordCount: 1200 }),
  ]);
  const debt = domain.getPlanningRepairCapacityDebt(repaired);
  assert.equal(debt.length, 1);
  assert.equal(debt[0].reason, "later_chapters_over_capacity");
  assert.equal(debt[0].suggestedChapterId, "p2");
  assert.equal(debt[0].suggestedChapterOrder, 2);
  const source = JSON.parse(repaired.volumes[0].chapters.find((chapter) => chapter.id === "p1").sceneCards);
  assert.deepEqual(source.capacityPlan.deferable, [DEFERRED_LEASE_RULE]);
});

test("an already carried duty is not written twice", () => {
  const document = repairDocument();
  const sourcePlan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [DEFERRED_LEASE_RULE],
    seedOnly: [],
  });
  const targetPlan = capacityPlan({
    coreEvent: "第2章唯一主事件",
    keyTurn: "第2章唯一转折",
    mustDeliver: ["完成第2章主事件", DEFERRED_LEASE_RULE],
    deferable: [],
    seedOnly: [],
  });
  const repaired = runRepair(document, ["p1", "p2"], [
    repairChange("p1", sourcePlan),
    repairChange("p2", targetPlan),
  ]);
  const target = JSON.parse(repaired.volumes[0].chapters.find((chapter) => chapter.id === "p2").sceneCards);
  assert.equal(target.capacityPlan.mustDeliver.filter((item) => item === DEFERRED_LEASE_RULE).length, 1);
  assert.equal(target.requiredElements.filter((item) => item === DEFERRED_LEASE_RULE).length, 1);
  assert.deepEqual(domain.getPlanningRepairCapacityDebt(repaired), []);
});

test("a later chapter without a capacity plan is never mutated; debt records the reason", () => {
  const document = repairDocument();
  // Old persisted target: no capacity plan in its scene plan.
  const legacyTarget = document.volumes[0].chapters[1];
  const legacyTargetPlan = JSON.parse(legacyTarget.sceneCards);
  delete legacyTargetPlan.capacityPlan;
  legacyTarget.sceneCards = JSON.stringify(legacyTargetPlan);
  const sourcePlan = capacityPlan({
    mustDeliver: ["验货确认账目被改"],
    deferable: [DEFERRED_LEASE_RULE],
    seedOnly: [],
  });
  const p2Plan = capacityPlan({ coreEvent: "第2章唯一主事件", keyTurn: "第2章唯一转折", mustDeliver: ["完成第2章主事件"], deferable: [], seedOnly: [] });
  const p2Change = repairChange("p2", p2Plan);
  delete p2Change.capacityPlan;
  const repaired = runRepair(document, ["p1", "p2"], [repairChange("p1", sourcePlan), p2Change]);
  const debt = domain.getPlanningRepairCapacityDebt(repaired);
  assert.equal(debt.length, 1);
  assert.equal(debt[0].reason, "later_chapters_missing_capacity_plan");
  const target = JSON.parse(repaired.volumes[0].chapters.find((chapter) => chapter.id === "p2").sceneCards);
  assert.equal(target.requiredElements.includes(DEFERRED_LEASE_RULE), false);
});

test("repair still rejects an allowed chapter outside the target volume", () => {
  const document = repairDocument();
  document.volumes.push({
    id: "volume-2", novelId: "novel-1", title: "第二卷", sortOrder: 2, status: "draft",
    openPayoffs: [], createdAt: "", updatedAt: "",
    chapters: [repairChapter("outside", "volume-2", 4)],
  });
  const plan = capacityPlan({ mustDeliver: ["验货确认账目被改"], deferable: [], seedOnly: [] });
  assert.throws(
    () => runRepair(document, ["p1", "outside"], [repairChange("p1", plan), repairChange("outside", plan)]),
    /.+/,
  );
});

test("legacy repair responses without a capacity plan remain replayable", () => {
  const document = repairDocument();
  // This unit targets pre-capacity persisted contracts: strip the plan from the stored chapter.
  const legacyChapter = document.volumes[0].chapters[0];
  const legacyScenePlan = JSON.parse(legacyChapter.sceneCards);
  delete legacyScenePlan.capacityPlan;
  legacyChapter.sceneCards = JSON.stringify(legacyScenePlan);
  legacyChapter.requiredElements = undefined;
  const legacyEvaluation = capacityGateSource.evaluateCandidateCapacity({
    targetWordCount: legacyChapter.targetWordCount,
    exclusiveEvent: legacyChapter.exclusiveEvent,
    sceneCards: legacyChapter.sceneCards,
  });
  assert.equal(legacyEvaluation.capacityPlanPresent, false);
  const repairOutputPlan = capacityPlan({ mustDeliver: ["验货确认账目被改"], seedOnly: [], deferable: [] });
  const change = repairChange("p1", repairOutputPlan);
  delete change.capacityPlan;
  const repaired = domain.applyPlanningRepairCandidate(document, "volume-1", ["p1"], {
    requiresUserDecision: false, reason: "旧格式修复", changes: [change], obligationMoves: [],
  }, [], []);
  const chapter = repaired.volumes[0].chapters.find((item) => item.id === "p1");
  assert.equal(JSON.parse(chapter.sceneCards).capacityPlan, undefined);
});

test("contract and repair prompts require the capacity classification", () => {
  const prompts = require("../dist/prompting/prompts/novel/volume/chapterDetail.prompts.js");
  const repairPrompts = require("../dist/prompting/prompts/novel/volume/planningRepair.prompts.js");
  const contractText = prompts.volumeChapterExecutionContractPrompt.render({ detailMode: "task_sheet" }, { blocks: [] })
    .map((message) => message.content).join("\n");
  assert.match(contractText, /capacityPlan/);
  assert.match(contractText, /coreEvent/);
  assert.match(contractText, /keyTurn/);
  assert.match(contractText, /deferable/);
  assert.match(contractText, /requiredElements 只能由 mustDeliver 与 seedOnly 组成/);
  assert.equal(prompts.volumeChapterExecutionContractPrompt.version, "v15");
  assert.ok(prompts.volumeChapterExecutionContractPrompt.structuredOutputHint.example.capacityPlan);

  const repairText = repairPrompts.planningRepairPrompt.render({ contextJson: JSON.stringify({ candidateChapters: [], writtenEvidence: {} }) }, { blocks: [] })
    .map((message) => message.content).join("\n");
  assert.match(repairText, /capacityPlan/);
  assert.match(repairText, /requiresUserDecision/);
  assert.match(repairText, /规划质量债/);
  assert.equal(repairPrompts.planningRepairPrompt.version, "v16");
});

test("compound deferable matches the later chapter's concrete action", () => {
  assert.equal(capacity.isRelatedCapacityText(
    "巢穴据点、麦种袋与领主徽记木牌由第2章发现",
    "格鲁尔在巢穴深处发现原主藏的一小袋麦种和刻着领主徽记的木牌",
  ), true);
  assert.equal(capacity.isRelatedCapacityText(
    "巡逻队与骑士的正式追查由后续章节承接",
    "老莫德说出圣种是领主垄断的高产麦种、原主偷种是为流民",
  ), false);
});

test("capacity failure is recorded on the chapter audit trail", async () => {
  const audit = require("../dist/services/novel/volume/chapterDetail/chapterCapacityAudit.js");
  assert.equal(typeof audit.recordChapterCapacityAudit, "function");
  const decision = capacityGateSource.evaluateCandidateCapacity(candidate({
    capacityPlan: capacityPlan({
      mustDeliver: ["进入秘境入口", "被卷入秘境", "预判机关位置", "救下同行", "传功给主角"],
      estimatedCoreWordCount: 6000,
    }),
  }));
  assert.equal(decision.passed, false);
});
