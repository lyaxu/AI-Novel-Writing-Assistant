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

/** Complete, structurally valid semantic review used as the base of each scenario. */
function validReview(input, catalog) {
  const raw = contract.semanticExample(input);
  const first = { evidenceId: catalog.entries[0].id };
  const second = { evidenceId: catalog.entries[Math.min(1, catalog.entries.length - 1)].id };
  const action = raw.actionStateChecks[0];
  action.actionEvidence = [second];
  const state = action.states[0];
  state.before.evidence = state.prerequisite.basis.evidence = [first];
  state.after.evidence = state.resultChange.basis.evidence = [second];
  raw.sceneCausalityVerdicts[0].choiceAndResistance.evidence = [second];
  if (raw.sceneCausalityVerdicts[0].constraints.length) {
    raw.sceneCausalityVerdicts[0].constraints[0].evidence = [first];
  }
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "not_applicable", evidence: [], explanation: "本章没有搬运或装载关键物品。" },
    { dimension: "action_prerequisite", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖工具或消耗品的动作。" },
    { dimension: "physical_environment", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖距离、体力或能源的动作。" },
    { dimension: "continuity_state", verdict: "not_applicable", evidence: [], explanation: "本章没有需要跨章核对的状态。" },
  ];
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

test("structured physical audit schema exposes the four dimensions and verdicts", () => {
  assert.deepEqual([...PHYSICAL_DIMENSIONS],
    ["object_container", "action_prerequisite", "physical_environment", "continuity_state"]);
  const schema = prompts.semanticChapterAcceptanceSchema;
  assert.ok(schema.parse(contract.semanticExample({ expectedSceneKeys: ["scene"] })).physicalContinuityChecks.length === 4);
});

test("a container that hides a person can not later be carried one-handed: capacity/weight defect is detected", () => {
  const { input, catalog } = catalogFor(CAPACITY_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "defect", severity: "high",
      evidence: [ref(catalog, "从箱子里扶出一个瘦小的孩子"), ref(catalog, "一手拎着那只餐箱")],
      explanation: "同一只餐箱能藏下一个孩子，第二天却能被单手拎着，容量与重量前后不一致。",
      fixSuggestion: "统一餐箱的容积与重量描述：或说明它是空间装备，或改成需要两人搬运/推车。" },
    { dimension: "action_prerequisite", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖工具或消耗品的动作。" },
    { dimension: "physical_environment", verdict: "not_applicable", evidence: [], explanation: "本章没有依赖距离、体力或能源的动作。" },
    { dimension: "continuity_state", verdict: "not_applicable", evidence: [], explanation: "本章没有需要跨章核对的状态。" },
  ];
  const output = validate(raw, input);
  assert.equal(output.physicalContinuityChecks.length, 4);
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

test("physical audit requires all four dimensions and defect fix suggestions", () => {
  const { input, catalog } = catalogFor(CAPACITY_CONTENT);
  const raw = validReview(input, catalog);
  raw.physicalContinuityChecks = [
    { dimension: "object_container", verdict: "defect", evidence: [ref(catalog, "一手拎着那只餐箱")], explanation: "只声明缺陷。" },
  ];
  const problems = physicalContract.normalizeSemanticPhysicalChecks(raw.physicalContinuityChecks, catalog).problems;
  assert.ok(problems.some(problem => problem.includes("severity:required_for_defect")));
  assert.ok(problems.some(problem => problem.includes("fixSuggestion:required_for_defect")));
  for (const dimension of ["action_prerequisite", "physical_environment", "continuity_state"]) {
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

function pipelineRuntimePackage(failing) {
  const score = failing ? 70 : 92;
  const issue = {
    auditType: "continuity", severity: "high", code: "physical_object_container",
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
      ? { acceptanceStatus: "repairable", continuePolicy: "repair_once", repairDirectives: [], riskTags: ["physical_object_container"] }
      : { acceptanceStatus: "accepted", continuePolicy: "continue", repairDirectives: [], riskTags: [] },
  };
}

function pipelineDeps(results) {
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
        return { finalContent: content, runtimePackage: pipelineRuntimePackage(failing), needsRepair: failing };
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
