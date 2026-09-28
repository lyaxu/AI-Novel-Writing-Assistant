const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function source(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
    if (name in mocks) return mocks[name];
    if (name === "zod" || name === "@langchain/core/messages") return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  }, exports);
  return exports;
}
const sharedAction = source("../../shared/types/novel/sceneCausality/actionState.ts");
const shared = source("../../shared/types/novel/sceneCausality.ts", { "./sceneCausality/actionState.js": sharedAction });
const evidence = source("../src/prompting/prompts/novel/acceptance/actionStateEvidence.ts");
const projection = source("../src/services/novel/runtime/acceptance/actionStateProjection.ts");
const causal = source("../src/services/novel/runtime/acceptance/causalAssessment.ts", { "./actionStateProjection": projection });
const prompts = source("../src/prompting/prompts/novel/chapterAcceptance.prompts.ts", {
  "@ai-novel/shared/types/novel/sceneCausality": shared,
  "@ai-novel/shared/types/chapterProseContract": { CHAPTER_PROSE_QUALITY_AUDIT_RULES: [] },
  "../../core/renderContextBlocks": { renderSelectedContextBlocks: () => "已写正文" },
  "./promptBudgetProfiles": { NOVEL_PROMPT_BUDGETS: { chapterAcceptance: 1200 } },
  "./acceptance/actionStateEvidence": evidence,
});
let modelOutput;
const service = source("../src/services/novel/runtime/ChapterAcceptanceAssessmentService.ts", {
  "../../../db/prisma": { prisma: {} },
  "../../../prompting/core/promptRunner": { runStructuredPrompt: async ({ asset, promptInput }) => ({ output: asset.postValidate(modelOutput, promptInput) }) },
  "../../../prompting/context/promptContextResolution": { resolvePromptContextBlocksForAsset: async () => ({ blocks: [] }) },
  "../../../prompting/prompts/novel/chapterLayeredContext": { buildChapterReviewContextBlocks: () => [] },
  "../../../prompting/prompts/novel/chapterLayeredContextShared": { resolveTargetWordRange: () => ({ minWordCount: null, maxWordCount: null }) },
  "../../../prompting/prompts/novel/chapterAcceptance.prompts": prompts,
  "../../state/OpenConflictService": { openConflictService: {} },
  "../novelP0Utils": { normalizeScore: (x) => x, ruleScore: () => scores() },
  "./proseQuality/ProseQualityDetector": { detectProseQuality: () => ({ findings: [] }) },
  "./acceptance": { ...causal, buildAcceptanceCacheIdentity: async () => "mock" },
});
const scores = () => ({ coherence: 95, pacing: 95, repetition: 95, engagement: 95, voice: 95, overall: 95 });
const quote = (text, source = "current_prose", sourceId = "c2") => ({ source, sourceId, quote: text });
function check(overrides = {}) {
  return {
    sceneKey: "s", actor: "主角", action: "吃下食物", actionEvidence: [quote("他把食物送进嘴里。")],
    states: [{ dimension: "body", entity: "双手", before: "双手反绑", requiredForAction: "手可到达嘴边", after: "已经进食",
      beforeEvidence: [quote("双手反绑在背后。")], afterEvidence: [quote("他把食物送进嘴里。")], transitionEvidence: [],
      enablingTransitionRequired: true, stateChanged: false, transitionStatus: "missing" }],
    verdict: "earned", explanation: "检验行动执行条件，而不是只看进食结果。", ...overrides,
  };
}
function assessment(checks = [check()]) {
  return { status: "accepted", score: scores(), summary: "结果已经发生", blockingIssues: [], repairDirectives: [],
    missingObligations: [], repairability: "none", decisionReason: "可继续", riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "正常", requiresFullPayoffReconcile: false }, actionStateChecks: checks,
    sceneCausalityVerdicts: [{ sceneKey: "s", outcomeObserved: true, verdict: "earned", prerequisiteEvidence: [],
      choiceAndResistanceEvidence: "人物行动", outcomeMechanismEvidence: "结果发生", constraintEvidence: [], explanation: "计划完成" }] };
}
function evaluate(row, content, extra = {}) {
  const parsed = prompts.generatedChapterAcceptanceAssessmentSchema.parse(assessment([row]));
  const output = prompts.chapterAcceptanceAssessmentPrompt.postValidate(parsed, {
    chapterId: "c2", chapterOrder: 2, content, expectedSceneKeys: ["s"], ...extra,
  });
  return service.normalizeAssessment(output, content);
}

test("bound hands cannot earn eating merely because the result appears, despite a 95 score", () => {
  const result = evaluate(check(), "双手反绑在背后。他把食物送进嘴里。");
  assert.equal(result.actionStateChecks[0].verdict, "unearned");
  assert.equal(result.sceneCausalityVerdicts[0].verdict, "unearned");
  assert.equal(result.status, "repairable");
  assert.equal(result.continuePolicy, "repair_once");
  assert.equal(result.repairability, "none");
  assert.match(result.blockingIssues[0].code, /^action_state_unearned/);
  assert.match(result.repairDirectives[0].instruction, /先前正文是事实边界/);
});

test("a later release cannot serve as the earlier enabling transition", () => {
  const row = check(); row.states[0].transitionStatus = "established"; row.states[0].transitionEvidence = [quote("爆发后绳索断了。")];
  const result = evaluate(row, "双手反绑在背后。他把食物送进嘴里。爆发后绳索断了。");
  assert.equal(result.actionStateChecks[0].verdict, "contradicted");
  assert.equal(result.blockingIssues[0].severity, "high");
  assert.notEqual(result.continuePolicy, "pause");
});

test("missing heat and cooking medium are consumed as item-state gaps, not checked by culinary regex", () => {
  const row = check({ action: "熬出汤", actionEvidence: [quote("凹槽里的骨汤沸腾了。")], states: [
    { ...check().states[0], dimension: "item", entity: "烹饪媒介与热源", before: "无水、石台微温", requiredForAction: "可成汤的媒介和足够热量", after: "无交代便沸腾",
      beforeEvidence: [quote("没有水，六步外的火盆只把石台烘温。")], afterEvidence: [quote("凹槽里的骨汤沸腾了。")], transitionStatus: "missing" },
  ] });
  const result = evaluate(row, "没有水，六步外的火盆只把石台烘温。凹槽里的骨汤沸腾了。");
  assert.equal(result.actionStateChecks[0].verdict, "unearned");
});

test("paralysed limb powering a later escape is a local contradiction", () => {
  const row = check({ action: "用左腿蹬地", actionEvidence: [quote("他用还能动的左腿蹬地。")], states: [
    { ...check().states[0], entity: "左腿", before: "失去知觉", requiredForAction: "左腿可发力", after: "左腿发力",
      beforeEvidence: [quote("左腿膝盖以下完全失去知觉。")], afterEvidence: [quote("他用还能动的左腿蹬地。")], transitionStatus: "contradicted" },
  ] });
  const result = evaluate(row, "左腿膝盖以下完全失去知觉。他用还能动的左腿蹬地。");
  assert.equal(result.actionStateChecks[0].verdict, "contradicted");
});

test("a mark's new location must match the actual earlier chapter, not its later plan", () => {
  const row = check({ action: "用掌印触碰藤蔓", actionEvidence: [quote("他把掌心烙印按向藤蔓。")], states: [
    { ...check().states[0], dimension: "location", entity: "烙印位置", before: "胸口", requiredForAction: "掌心有烙印", after: "烙印在掌心",
      beforeEvidence: [quote("烙印在胸口正中。", "established_context", "c1")], afterEvidence: [quote("他把掌心烙印按向藤蔓。")],
      stateChanged: true, transitionStatus: "contradicted" },
  ] });
  const result = evaluate(row, "他把掌心烙印按向藤蔓。", { establishedProse: [{ chapterId: "c1", order: 1, content: "烙印在胸口正中。" }] });
  assert.equal(result.actionStateChecks[0].verdict, "contradicted");
});

test("wuxia positive: witnessed acupuncture recovery before standing is allowed", () => {
  const row = check({ action: "起身", actionEvidence: [quote("她站了起来。")], states: [
    { ...check().states[0], entity: "双腿", before: "麻痹", requiredForAction: "双腿可以承重", after: "站立但虚弱",
      beforeEvidence: [quote("她的双腿麻痹。")], afterEvidence: [quote("她站了起来。")],
      transitionEvidence: [quote("师姐拔针解穴，她试着屈膝，双腿恢复知觉。")], stateChanged: true, transitionStatus: "established" },
  ] });
  const result = evaluate(row, "她的双腿麻痹。师姐拔针解穴，她试着屈膝，双腿恢复知觉。她站了起来。");
  assert.equal(result.status, "accepted"); assert.equal(result.actionStateChecks[0].verdict, "earned");
});

test("xianxia positive: established remote fire and water spells need no mundane stove", () => {
  const row = check({ action: "隔空炼液", actionEvidence: [quote("她以灵火令石槽中凝出的水沸腾。")], states: [
    { ...check().states[0], dimension: "ability", entity: "凝水与灵火", before: "已掌握隔空凝水驱火术", requiredForAction: "隔空供水供热", after: "法术供热煮沸",
      beforeEvidence: [quote("她练成凝水驱火术，可隔空凝水并升温。", "established_context", "c1")],
      afterEvidence: [quote("她以灵火令石槽中凝出的水沸腾。")], transitionEvidence: [], enablingTransitionRequired: false, stateChanged: false, transitionStatus: "not_needed" },
  ] });
  const result = evaluate(row, "她以灵火令石槽中凝出的水沸腾。", { establishedProse: [{ chapterId: "c1", order: 1, content: "她练成凝水驱火术，可隔空凝水并升温。" }] });
  assert.equal(result.actionStateChecks[0].verdict, "earned"); assert.equal(result.continuePolicy, "continue");
});

test("planned assertions, wrong source IDs and invented quotes become visible uncertainty without a corrective invention", () => {
  for (const beforeEvidence of [
    [quote("双手反绑在背后。", "planned_contract", "s")],
    [quote("双手反绑在背后。", "current_prose", "other")],
    [quote("根本不存在的原文")],
    [quote("双手反绑在背后。", "established_context", "future")],
  ]) {
    const row = check(); row.states[0].beforeEvidence = beforeEvidence;
    const result = evaluate(row, "双手反绑在背后。他把食物送进嘴里。", { establishedProse: [{ chapterId: "future", order: 3, content: "双手反绑在背后。" }] });
    assert.equal(result.actionStateChecks[0].verdict, "insufficient_evidence");
    assert.equal(result.status, "continue_with_risk");
    assert.equal(result.repairDirectives.length, 0);
  }
});

test("state changes and unmet preconditions cannot be excused with not_needed", () => {
  const row = check(); row.states[0].transitionStatus = "not_needed";
  const result = evaluate(row, "双手反绑在背后。他把食物送进嘴里。");
  assert.equal(result.actionStateChecks[0].verdict, "unearned");
  const repeated = service.normalizeAssessment(result, "双手反绑在背后。他把食物送进嘴里。");
  assert.deepEqual(repeated, result);
});

test("legacy persisted assessments remain readable; fresh structured output requires action rows", () => {
  const legacy = assessment(); delete legacy.actionStateChecks;
  assert.equal(prompts.chapterAcceptanceAssessmentSchema.safeParse(legacy).success, true);
  assert.equal(prompts.generatedChapterAcceptanceAssessmentSchema.safeParse(legacy).success, false);
  assert.equal(service.normalizeAssessment(legacy, "旧正文").status, "accepted");
});

test("missing action coverage is uncertainty rather than another model request", () => {
  const output = prompts.chapterAcceptanceAssessmentPrompt.postValidate(assessment([]), { chapterId: "c2", chapterOrder: 2, content: "正文", expectedSceneKeys: ["s"] });
  const result = service.normalizeAssessment(output, "正文");
  assert.ok(result.riskTags.includes("action_state_coverage_missing:s"));
  assert.equal(result.status, "continue_with_risk");
  assert.equal(result.repairDirectives.length, 0);
});

test("fresh prompt has a full compact state example, relevant dimensions only, and bounded output allowance", () => {
  const prompt = prompts.chapterAcceptanceAssessmentPrompt;
  assert.equal(prompts.generatedChapterAcceptanceAssessmentSchema.safeParse(prompt.structuredOutputHint.example).success, true);
  const rendered = prompt.render({ chapterId: "c2", chapterOrder: 2, novelTitle: "武侠", chapterTitle: "解穴", content: "正文", expectedSceneKeys: ["s"] }, {});
  assert.match(String(rendered[0].content), /通常1-2项，不要求每次列齐五类/);
  assert.match(String(rendered[0].content), /planned_contract只能说明计划/);
  assert.equal(causal.acceptanceOutputBudget(3), 8832);
  assert.equal(causal.acceptanceOutputBudget(100), 16512);
});

test("uniform prompt input carries only actual prior prose with exact chapter IDs", () => {
  const result = causal.buildAcceptancePromptInput({ chapterId: "c2", chapterOrder: 2, content: "正文", contextPackage: {
    chapterReviewContext: { scenePlan: { scenes: [{ key: "s", causality: {} }] }, writtenEvidence: { chapters: [
      { chapterId: "c1", order: 1, content: "前章正文", title: "前章", contentHash: "hash" },
      { chapterId: "c2", order: 2, content: "本章旧稿" }, { chapterId: "c3", order: 3, content: "未来正文" },
    ] } },
  } });
  assert.equal(result.chapterId, "c2");
  assert.deepEqual(result.establishedProse, [{ chapterId: "c1", order: 1, content: "前章正文" }]);
});

test("service consumes action failures and includes checks in returned audit metadata without DB writes", async () => {
  modelOutput = assessment();
  const result = await new service.ChapterAcceptanceAssessmentService().assess({
    novelId: "n", chapterId: "c2", chapterOrder: 2, chapterTitle: "反绑", novelTitle: "测试", content: "双手反绑在背后。他把食物送进嘴里。", persist: false,
    contextPackage: { chapterReviewContext: { scenePlan: { scenes: [{ key: "s", causality: {} }] } } },
  });
  assert.equal(result.assessment.status, "repairable");
  const report = result.auditReports.find((item) => item.auditType === "continuity");
  assert.equal(JSON.parse(report.legacyScoreJson).actionStateChecks[0].verdict, "unearned");
  assert.ok(report.issues.some((item) => item.code.startsWith("action_state_")));
});
