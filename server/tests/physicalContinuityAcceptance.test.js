// Physical continuity / length acceptance tests. No model call, no manuscript edit,
// no database access: these validate the structured AI contract, deterministic
// post-processing and the existing repair/quality-debt routing.
const test = require("node:test");
const assert = require("node:assert/strict");

const prompts = require("../dist/prompting/prompts/novel/chapterAcceptance.prompts");
const contract = require("../dist/prompting/prompts/novel/acceptance/semantic/reviewContract");
const physicalContract = require("../dist/prompting/prompts/novel/acceptance/semantic/physicalContinuity");
const evidence = require("../dist/prompting/prompts/novel/acceptance/evidenceCatalog");
const { assertReviewCompleted } = require("../dist/services/novel/runtime/acceptance/reviewCompletion");
const { normalizeAssessment } = require("../dist/services/novel/runtime/ChapterAcceptanceAssessmentService");
const { projectPhysicalContinuityAssessment } = require("../dist/services/novel/runtime/acceptance");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");

const PHYSICAL_DIMENSIONS = physicalContract.PHYSICAL_CONTINUITY_DIMENSIONS;

function catalogFor(content, options = {}) {
  const input = {
    chapterId: options.chapterId ?? "c1",
    chapterOrder: options.chapterOrder ?? 1,
    content,
    expectedSceneKeys: ["scene"],
    establishedProse: options.establishedProse ?? [],
  };
  return { input, catalog: evidence.buildEvidenceCatalog(input) };
}

function ref(catalog, excerpt, source = "current_prose") {
  const matches = catalog.entries.filter(entry => entry.source === source && entry.quote.includes(excerpt));
  assert.ok(matches.length >= 1, `证据目录必须包含可引用的真实片段：${excerpt}`);
  return { evidenceId: matches[0].id };
}

const CAPACITY_CONTENT = "他把餐箱放在门口，从箱子里扶出一个瘦小的孩子。第二天，他一手拎着那只餐箱，另一只手拎着两份盒饭上楼。";
const PREREQUISITE_CONTENT = "他翻出空白符纸与朱砂笔，却没有落笔。他抽出那张镇宅符，往门框上一拍，符纸亮起。";
const EXEMPT_CONTENT = "他从空间折叠餐箱里接出孩子，又把餐箱折成手掌大小塞进口袋。";

/** The terminology dimension is not applicable when no key proper noun first enters the prose. */
const NOT_APPLICABLE_TERMINOLOGY_ROW = {
  dimension: "terminology_introduction",
  verdict: "not_applicable",
  evidence: [],
  explanation: "本章没有首次进入读者视野的关键能力、势力、物品或称号专名。",
};

/** Five audited dimensions; tests override only the row they exercise. */
function physicalRows(terminologyRow = NOT_APPLICABLE_TERMINOLOGY_ROW) {
  return [
    { dimension: "object_container", verdict: "not_applicable", evidence: [], explanation: "本章没有搬运或装载关键物品。" },
    { dimension: "action_prerequisite", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖工具或消耗品的动作。" },
    { dimension: "physical_environment", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖距离、体力或能源的动作。" },
    { dimension: "continuity_state", verdict: "not_applicable", evidence: [], explanation: "本章没有需要跨章核对的状态。" },
    terminologyRow,
  ];
}

/** Complete, structurally valid semantic review used as the base of each scenario. */
function validReview(input, catalog) {
  const raw = contract.semanticExample(input);
  const currentEntries = catalog.entries.filter((entry) => entry.source === "current_prose");
  const first = { evidenceId: currentEntries[0].id };
  const second = { evidenceId: currentEntries[Math.min(1, currentEntries.length - 1)].id };
  const action = raw.actionStateChecks[0];
  action.actionEvidence = [second];
  const state = action.states[0];
  state.before.evidence = state.prerequisite.basis.evidence = [first];
  state.after.evidence = state.resultChange.basis.evidence = [second];
  raw.sceneCausalityVerdicts[0].choiceAndResistance.evidence = [second];
  if (raw.sceneCausalityVerdicts[0].constraints.length) {
    raw.sceneCausalityVerdicts[0].constraints[0].evidence = [first];
  }
  raw.physicalContinuityChecks = physicalRows();
  return raw;
}

function validate(raw, input) {
  return prompts.chapterAcceptanceAssessmentPrompt.postValidate(raw, input);
}

function recover(raw, input) {
  let failure;
  try { validate(raw, input); } catch (error) { failure = error; }
  assert.ok(failure, "伪造或缺少依据的审查回答必须被拒绝");
  return prompts.chapterAcceptanceAssessmentPrompt.postValidateFailureRecovery({
    rawOutput: raw, promptInput: input, validationError: failure.message, semanticRetryAttempts: 1,
  });
}

test("structured physical and terminology audit schema exposes the five dimensions and verdicts", () => {
  assert.deepEqual([...PHYSICAL_DIMENSIONS],
    ["object_container", "action_prerequisite", "physical_environment", "continuity_state", "terminology_introduction"]);
  const schema = prompts.semanticChapterAcceptanceSchema;
  assert.equal(schema.parse(contract.semanticExample({ expectedSceneKeys: ["scene"] })).physicalContinuityChecks.length, 5);
});

test("a container that hides a person can not later be carried one-handed: capacity/weight defect is detected", () => {
  const { input, catalog } = catalogFor(CAPACITY_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "defect", severity: "high",
      evidence: [ref(catalog, "从箱子里扶出一个瘦小的孩子"), ref(catalog, "一手拎着那只餐箱")],
      explanation: "同一只餐箱能藏下一个孩子，第二天却能被单手拎着，容量与重量前后不一致。",
      fixSuggestion: "统一餐箱的容积与重量描述：或说明它是空间装备，或改成需要两人搬运/推车。" },
    ...physicalRows().slice(1),
  ];
  const output = validate(raw, input);
  assert.equal(output.physicalContinuityChecks.length, 5);
  assert.equal(output.physicalContinuityChecks[0].evidence.length, 2);
  assert.ok(output.physicalContinuityChecks[0].evidence.every(item => item.source === "current_prose" && item.quote));
  assert.doesNotThrow(() => assertReviewCompleted(output));
  const normalized = normalizeAssessment(output, input.content, 2800);
  const issue = normalized.blockingIssues.find(item => item.code === "physical_object_container");
  assert.ok(issue, "容量/重量缺陷应进入现有 blocking issue，交给修复/质量债链路");
  assert.equal(issue.severity, "high");
  assert.match(issue.evidence, /从箱子里扶出一个瘦小的孩子/);
  assert.match(issue.fixSuggestion, /餐箱/);
  assert.equal(normalized.status, "repairable");
  assert.equal(normalized.continuePolicy, "repair_once");
  assert.ok(normalized.riskTags.includes("physical_object_container"));
});

test("using a protective talisman without drawing it: missing action prerequisite is detected", () => {
  const { input, catalog } = catalogFor(PREREQUISITE_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "not_applicable", evidence: [], explanation: "本章没有搬运或装载关键物品。" },
    { dimension: "action_prerequisite", verdict: "defect", severity: "high",
      evidence: [ref(catalog, "空白符纸与朱砂笔"), ref(catalog, "抽出那张镇宅符")],
      explanation: "前文只有空白符纸和朱砂笔，没有画符过程，后文却直接使用已经画好的镇宅符。",
      fixSuggestion: "在使用前补一个画符动作：落笔、朱砂、时间与失败风险，或把道具改成已经画好的符。" },
    { dimension: "physical_environment", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖距离、体力或能源的动作。" },
    { dimension: "continuity_state", verdict: "not_applicable", evidence: [], explanation: "本章没有需要跨章核对的状态。" },
    NOT_APPLICABLE_TERMINOLOGY_ROW,
  ];
  const output = validate(raw, input);
  const normalized = normalizeAssessment(output, input.content, 2800);
  const issue = normalized.blockingIssues.find(item => item.code === "physical_action_prerequisite");
  assert.ok(issue);
  assert.match(issue.evidence, /空白符纸与朱砂笔/);
  assert.equal(normalized.status, "repairable");
});

test("an explicit world rule exemption is not misreported as a defect", () => {
  const { input, catalog } = catalogFor(EXEMPT_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "exempt",
      evidence: [ref(catalog, "空间折叠餐箱")],
      explanation: "本书设定餐箱采用空间折叠技术，容积与重量不按现实物理计算。",
      worldRuleBasis: "已建立设定：空间折叠餐箱是本书允许的空间装备。" },
    { dimension: "action_prerequisite", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖工具或消耗品的动作。" },
    { dimension: "physical_environment", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖距离、体力或能源的动作。" },
    { dimension: "continuity_state", verdict: "not_applicable", evidence: [], explanation: "本章没有需要跨章核对的状态。" },
    NOT_APPLICABLE_TERMINOLOGY_ROW,
  ];
  const output = validate(raw, input);
  // No target word count here: this test isolates the physical exemption from length control.
  const normalized = normalizeAssessment(output, input.content);
  assert.equal(normalized.blockingIssues.filter(item => item.code.startsWith("physical_")).length, 0);
  assert.equal(normalized.status, "accepted");
  assert.equal(normalized.continuePolicy, "continue");
  // The exemption rationale stays auditable instead of becoming silent approval.
  assert.equal(normalized.physicalContinuityChecks[0].verdict, "exempt");
  assert.match(normalized.physicalContinuityChecks[0].worldRuleBasis, /空间折叠/);
});

test("fabricated evidence in a physical finding is rejected, never silently dropped", () => {
  const { input, catalog } = catalogFor(CAPACITY_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = raw.physicalContinuityChecks.map(row => row.dimension === "object_container"
    ? {
      dimension: "object_container", verdict: "defect", severity: "high",
      evidence: [{ evidenceId: "ev_fabricated_capacity_claim" }],
      explanation: "凭空声称正文写过餐箱容量。",
      fixSuggestion: "按真实正文重新核对。",
    }
    : row);
  const recovered = recover(raw, input);
  assert.equal(recovered.status, "needs_manual_review");
  assert.equal(recovered.continuePolicy, "pause");
  assert.deepEqual(recovered.repairDirectives, []);
  assert.ok(recovered.reviewContractIssues.some(problem => problem.includes("physicalContinuityChecks")));
  assert.ok(recovered.reviewContractIssues.some(problem => problem.includes("不属于本次正文证据目录")));
});

test("physical audit requires all five dimensions and defect fix suggestions", () => {
  const { input, catalog } = catalogFor(CAPACITY_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "defect", evidence: [ref(catalog, "一手拎着那只餐箱")], explanation: "只声明缺陷。" },
  ];
  const problems = physicalContract.normalizeSemanticPhysicalChecks(raw.physicalContinuityChecks, catalog).problems;
  assert.ok(problems.some(problem => problem.includes("severity:required_for_defect")));
  assert.ok(problems.some(problem => problem.includes("fixSuggestion:required_for_defect")));
  for (const dimension of ["action_prerequisite", "physical_environment", "continuity_state", "terminology_introduction"]) {
    assert.ok(problems.some(problem => problem.includes(`physical_dimension_coverage_missing:${dimension}`)));
  }
});

test("an exemption without an in-world rule basis is rejected", () => {
  const { input, catalog } = catalogFor(EXEMPT_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = raw.physicalContinuityChecks.map(row => row.dimension === "object_container"
    ? { dimension: "object_container", verdict: "exempt", evidence: [ref(catalog, "空间折叠餐箱")], explanation: "题材如此。" }
    : row);
  assert.throws(() => validate(raw, input), /worldRuleBasis:required_for_world_rule_exemption/);
});

test("a measured length far outside the target band becomes a repair issue with the existing contract numbers", () => {
  const content = "字".repeat(4362);
  const assessment = {
    status: "accepted",
    score: { coherence: 90, pacing: 88, repetition: 90, engagement: 88, voice: 90, overall: 89 },
    summary: "正文完整但篇幅明显超出目标带。",
    blockingIssues: [], repairDirectives: [], missingObligations: [], repairability: "none",
    decisionReason: "可继续。", riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "常规同步。", requiresFullPayoffReconcile: false },
  };
  const normalized = normalizeAssessment(assessment, content, 2800);
  // 2800 target -> soft 2380-3220, hard max 3500 (existing chapterLengthControl contract).
  assert.equal(normalized.lengthCompliance.targetWordCount, 2800);
  assert.equal(normalized.lengthCompliance.actualWordCount, 4362);
  assert.equal(normalized.lengthCompliance.minWordCount, 2380);
  assert.equal(normalized.lengthCompliance.maxWordCount, 3220);
  assert.equal(normalized.lengthCompliance.hardMaxWordCount, 3500);
  assert.equal(normalized.lengthCompliance.status, "over_hard");
  const issue = normalized.blockingIssues.find(item => item.code === "length_over_hard");
  assert.ok(issue);
  assert.equal(issue.severity, "high");
  assert.match(issue.evidence, /4362/);
  assert.match(issue.evidence, /2800/);
  assert.equal(normalized.status, "repairable");
  assert.equal(normalized.continuePolicy, "repair_once");
  assert.ok(normalized.riskTags.includes("length_over_hard"));
});

test("length just over the soft band is medium severity, and content inside the band adds no issue", () => {
  const assessment = {
    status: "accepted",
    score: { coherence: 90, pacing: 88, repetition: 90, engagement: 88, voice: 90, overall: 89 },
    summary: "正文可继续。", blockingIssues: [], repairDirectives: [], missingObligations: [], repairability: "none",
    decisionReason: "可继续。", riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "常规同步。", requiresFullPayoffReconcile: false },
  };
  const overSoft = normalizeAssessment(assessment, "字".repeat(3400), 2800);
  assert.equal(overSoft.lengthCompliance.status, "over_soft");
  assert.equal(overSoft.blockingIssues.find(item => item.code === "length_over_soft")?.severity, "medium");
  const within = normalizeAssessment(assessment, "字".repeat(2800), 2800);
  assert.equal(within.lengthCompliance.status, "within_band");
  assert.deepEqual(within.blockingIssues, []);
  assert.equal(within.status, "accepted");
});

test("a model-reported length issue is dropped when the measured body is inside the band", () => {
  const normalized = normalizeAssessment({
    status: "repairable",
    score: { coherence: 90, pacing: 88, repetition: 90, engagement: 88, voice: 90, overall: 89 },
    summary: "模型报告长度超出。",
    blockingIssues: [{ severity: "high", category: "plot", code: "length_over", evidence: "超出目标长度。", fixSuggestion: "压缩。" }],
    repairDirectives: [{ mode: "patch", target: "plot", instruction: "压缩超出目标长度的正文。" }],
    missingObligations: [], repairability: "none", decisionReason: "需压缩。",
    riskTags: ["length_over"], continuePolicy: "repair_once",
    assetSyncRecommendation: { priority: "normal", reason: "常规同步", requiresFullPayoffReconcile: false },
  }, "字".repeat(2800), 2800);
  assert.equal(normalized.lengthCompliance.status, "within_band");
  assert.deepEqual(normalized.blockingIssues, []);
  assert.deepEqual(normalized.repairDirectives, []);
  assert.equal(normalized.status, "continue_with_risk");
});

test("legacy assessments without audit data keep their previous behavior", () => {
  const legacy = {
    status: "accepted",
    score: { coherence: 90, pacing: 90, repetition: 90, engagement: 90, voice: 90, overall: 90 },
    summary: "旧报告。", blockingIssues: [], repairDirectives: [], riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "常规同步", requiresFullPayoffReconcile: false },
  };
  const normalized = normalizeAssessment(legacy, "旧正文", undefined);
  assert.equal(normalized.lengthCompliance, undefined);
  assert.deepEqual(normalized.blockingIssues, []);
  assert.doesNotThrow(() => assertReviewCompleted(normalized));
  // Projection is a no-op for reports that never carried a physical audit.
  assert.deepEqual(projectPhysicalContinuityAssessment(legacy), legacy);
});

// Real sample-book failure: the first chapter ends with “破妄眼每用一次…” while the
// proper noun was never established inside the story. These cases exercise the AI-first
// contract with simulated structured judgements, not keyword detection.
const TERMINOLOGY_FIRST_USE_CONTENT = "他闭上眼，再睁开时，破妄眼已经亮起。从这一刻起，破妄眼每用一次，眼底就会多一道血丝。";
const TERMINOLOGY_ESTABLISHED_CONTENT = "半年后，破妄眼每用一次，眼底就会多一道血丝。";
const TERMINOLOGY_ALIAS_CONTENT = "他闭上眼，再睁开时，那双眼睛已经亮起。从这一刻起，这双眼睛每用一次，眼底就会多一道血丝。";
const TERMINOLOGY_ORDINARY_CONTENT = "雨点打在青石板上，他缩在屋檐下，看巷口那盏忽明忽灭的纸灯笼。";

test("using a key proper noun before any in-story naming source is a terminology defect", () => {
  const { input, catalog } = catalogFor(TERMINOLOGY_FIRST_USE_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = physicalRows({
    dimension: "terminology_introduction", verdict: "defect", severity: "medium",
    evidence: [ref(catalog, "破妄眼已经亮起"), ref(catalog, "破妄眼每用一次")],
    explanation: "正文第一次直接使用“破妄眼”这个能力名，前文与本章首次使用前都没有人物命名、他人告知或记录来源，读者不知道这双眼睛叫什么。",
    fixSuggestion: "在首次使用前补一个正文内命名场景（人物命名、他人告知或师门记录带出），或把首次使用改成只写功能与代称“这双眼睛”。",
  });
  const output = validate(raw, input);
  assert.equal(output.physicalContinuityChecks.length, 5);
  assert.equal(output.physicalContinuityChecks[4].verdict, "defect");
  assert.doesNotThrow(() => assertReviewCompleted(output));
  const normalized = normalizeAssessment(output, input.content);
  const issue = normalized.blockingIssues.find(item => item.code === "physical_terminology_introduction");
  assert.ok(issue, "名称未建立就首次使用应进入现有 blocking issue");
  assert.equal(normalized.status, "repairable");
  assert.equal(normalized.continuePolicy, "repair_once");
  assert.match(issue.evidence, /破妄眼/);
  assert.match(issue.evidence, /专有名词命名来源/);
  assert.match(issue.fixSuggestion, /命名|代称/);
  assert.ok(normalized.riskTags.includes("physical_terminology_introduction"));
});

test("a proper noun already named in earlier prose is not misreported", () => {
  const establishedProse = [{
    chapterId: "c1", order: 1,
    content: "老人盯着他的眼睛看了很久，说：“这叫破妄眼。”",
  }];
  const { input, catalog } = catalogFor(TERMINOLOGY_ESTABLISHED_CONTENT, {
    chapterId: "c2", chapterOrder: 2, establishedProse,
  });
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = physicalRows({
    dimension: "terminology_introduction", verdict: "consistent",
    evidence: [ref(catalog, "这叫破妄眼", "established_context"), ref(catalog, "破妄眼每用一次")],
    explanation: "名称已在第 1 章由人物当面命名，本章首次使用有前文名称来源，读者已经知道这双眼睛叫破妄眼。",
  });
  const normalized = normalizeAssessment(validate(raw, input), input.content);
  assert.equal(normalized.blockingIssues.filter(item => item.code.startsWith("physical_")).length, 0);
  assert.equal(normalized.status, "accepted");
  assert.equal(normalized.continuePolicy, "continue");
});

test("ordinary narrative and alias-only prose are not misreported as naming-source defects", () => {
  const ordinary = catalogFor(TERMINOLOGY_ORDINARY_CONTENT);
  const ordinaryRaw = validReview(ordinary.input, ordinary.catalog);
  ordinaryRaw.physicalContinuityChecks = physicalRows({
    dimension: "terminology_introduction", verdict: "not_applicable", evidence: [],
    explanation: "本章只有普通叙述与日常名词，没有首次进入读者视野的关键能力、势力或物品专名。",
  });
  const ordinaryNormalized = normalizeAssessment(validate(ordinaryRaw, ordinary.input), ordinary.input.content);
  assert.equal(ordinaryNormalized.blockingIssues.length, 0);
  assert.equal(ordinaryNormalized.status, "accepted");

  // 名称未建立时只写功能、现象或代称（这双眼睛/那股寒意）不属于缺陷。
  const alias = catalogFor(TERMINOLOGY_ALIAS_CONTENT);
  const aliasRaw = validReview(alias.input, alias.catalog);
  aliasRaw.physicalContinuityChecks = physicalRows({
    dimension: "terminology_introduction", verdict: "not_applicable", evidence: [],
    explanation: "本章只写这双眼睛的功能与代称，没有直接使用作者设定名，不构成名称来源缺陷。",
  });
  const aliasNormalized = normalizeAssessment(validate(aliasRaw, alias.input), alias.input.content);
  assert.equal(aliasNormalized.blockingIssues.length, 0);
});

test("legacy v19 four-row audit reports stay readable and are not re-judged", () => {
  const legacyRows = physicalRows().slice(0, 4).map(row => ({ ...row, evidence: [] }));
  const legacyV19 = {
    status: "continue_with_risk",
    score: { coherence: 80, pacing: 80, repetition: 80, engagement: 80, voice: 80, overall: 80 },
    summary: "旧版四维审计报告。", physicalContinuityChecks: legacyRows,
    blockingIssues: [], repairDirectives: [], missingObligations: [], repairability: "none",
    decisionReason: "旧报告继续使用。", riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "常规同步", requiresFullPayoffReconcile: false },
  };
  assert.doesNotThrow(() => prompts.chapterAcceptanceAssessmentSchema.parse(legacyV19));
  const normalized = normalizeAssessment(legacyV19, "旧正文");
  assert.equal(normalized.physicalContinuityChecks.length, 4);
  assert.equal(normalized.blockingIssues.length, 0);
  assert.equal(normalized.riskTags.includes("physical_terminology_introduction"), false);
});

// The pipeline is the real consumer of acceptance issues: a physical finding must use the
// existing repair attempt and, when repair is exhausted, the existing quality-debt path.
const selectionModule = loadRuntimeSource("selection/ChapterRepairCandidateSelection.ts", {
  "node:crypto": { createHash: require("node:crypto").createHash },
});
const { runPipelineChapterWithRuntime } = loadRuntimeSource("chapterRuntimePipeline.ts", {
  "../production/reliability": { productionStep: (_key, fn) => fn() },
  "./acceptance": { filterVerifiedRepairIssues: (issues) => issues },
  "../../styleEngine/styleGenerationSanitizer": { detectForbiddenStyleEntities: () => [] },
  "./chapterEmptyContentError": { assertChapterContentNotEmpty: (value) => value, isChapterEmptyContentError: () => false },
  "./repair/chapterRepairRuntime": { runChapterRepairText: async () => ({ content: "修复后的正文" }) },
  "../chapterPatchRepairService": { ChapterPatchRepairFailedError: class extends Error {} },
  "./selection/ChapterRepairCandidateSelection": selectionModule,
  "./artifactSync/ChapterArtifactSyncResult": {
    ChapterArtifactSyncBoundaryError: class extends Error { constructor(result) { super(result.reason); this.result = result; } },
  },
});

function pipelineRuntimePackage(failing, issueCode = "physical_object_container") {
  const score = failing ? 70 : 92;
  const issue = {
    auditType: "continuity", severity: "high", code: issueCode,
    evidence: "物品与容器：同一只餐箱前后容量与重量不一致。", fixSuggestion: "统一餐箱容量与重量描述。",
  };
  return {
    novelId: "novel-1", chapterId: "chapter-1",
    audit: {
      score: { coherence: score, pacing: score, repetition: score, engagement: score, voice: score, overall: score },
      openIssues: failing ? [issue] : [],
      reports: failing ? [{ auditType: "continuity", issues: [issue] }] : [],
      hasBlockingIssues: failing,
    },
    context: { chapterRepairContext: null, bookContract: null, macroConstraints: null, volumeWindow: null, styleContext: null },
    meta: failing
      ? { acceptanceStatus: "repairable", continuePolicy: "repair_once", repairDirectives: [], riskTags: [issueCode] }
      : { acceptanceStatus: "accepted", continuePolicy: "continue", repairDirectives: [], riskTags: [] },
  };
}

function pipelineDeps(results, issueCode = "physical_object_container") {
  let index = 0;
  const committed = [];
  return {
    committed,
    deps: {
      validateRequest: (input) => input,
      ensureNovelCharacters: async () => {},
      assemble: async () => ({
        novel: { id: "novel-1", title: "测试小说" },
        chapter: { id: "chapter-1", title: "第一章", order: 1, content: null, expectation: null },
        contextPackage: {},
      }),
      generateDraftFromWriter: async () => ({ content: "生成后的正文" }),
      saveDraftAndArtifacts: async () => {},
      syncFinalChapterArtifacts: async (_n, _c, content) => ({ status: "completed", contentHash: content, completedArtifacts: ["artifact_delta"] }),
      finalizeChapterContent: async ({ content }) => {
        const failing = results[Math.min(index++, results.length - 1)];
        return { finalContent: content, runtimePackage: pipelineRuntimePackage(failing, issueCode), needsRepair: failing };
      },
      finalizeChapterTimeline: async () => {},
      commitFinalizedChapterContent: async ({ evaluation }) => { committed.push(evaluation.finalContent); },
      markChapterGenerationState: async () => {},
      markChapterNeedsRepair: async () => {},
    },
  };
}

test("a physical continuity issue uses the existing repair attempt and passes after re-review", async () => {
  const { deps, committed } = pipelineDeps([true, false]);
  const result = await runPipelineChapterWithRuntime(deps, "novel-1", "chapter-1",
    { maxRetries: 1, repairMode: "light_repair" }, {});
  assert.equal(result.pass, true);
  assert.equal(result.retryCountUsed, 1);
  assert.equal(result.qualityDebtAttribution, null);
  assert.deepEqual(committed, ["修复后的正文"]);
});

test("an unrepairable physical issue degrades to quality debt instead of failing the whole run", async () => {
  const { deps } = pipelineDeps([true, true]);
  const result = await runPipelineChapterWithRuntime(deps, "novel-1", "chapter-1",
    { maxRetries: 1, repairMode: "light_repair" }, {});
  assert.equal(result.pass, false);
  assert.equal(result.retryCountUsed, 1);
  assert.ok(result.qualityDebtAttribution, "仍有可用正文时记录质量债归因");
  assert.ok(result.qualityDebtAttribution.firstFailureIssueCodes.includes("physical_object_container"));
  assert.equal(result.recoverableRepairFailure, null);
});

test("a terminology naming-source issue uses the existing repair attempt and quality debt path", async () => {
  const issueCode = "physical_terminology_introduction";
  const repaired = pipelineDeps([true, false], issueCode);
  const pass = await runPipelineChapterWithRuntime(repaired.deps, "novel-1", "chapter-1",
    { maxRetries: 1, repairMode: "light_repair" }, {});
  assert.equal(pass.pass, true);
  assert.equal(pass.retryCountUsed, 1);
  assert.equal(pass.qualityDebtAttribution, null);
  assert.deepEqual(repaired.committed, ["修复后的正文"]);

  const { deps } = pipelineDeps([true, true], issueCode);
  const debt = await runPipelineChapterWithRuntime(deps, "novel-1", "chapter-1",
    { maxRetries: 1, repairMode: "light_repair" }, {});
  assert.equal(debt.pass, false);
  assert.ok(debt.qualityDebtAttribution, "同类问题在修复耗尽后走既有质量债通道");
  assert.ok(debt.qualityDebtAttribution.firstFailureIssueCodes.includes(issueCode));
  assert.equal(debt.recoverableRepairFailure, null);
});
