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
const shared = source("../../shared/types/novel/progression/index.ts");
const evidence = source("../src/prompting/prompts/novel/acceptance/progressionEvidence.ts", {
  "@ai-novel/shared/types/novel/progression/index": shared,
});
const projection = source("../src/services/novel/runtime/acceptance/progressionProjection.ts");
const actionSchema = source("../../shared/types/novel/sceneCausality/actionState.ts");
const causalSchema = source("../../shared/types/novel/sceneCausality.ts", { "./sceneCausality/actionState.js": actionSchema });
const actionEvidence = source("../src/prompting/prompts/novel/acceptance/actionStateEvidence.ts");
const prompts = source("../src/prompting/prompts/novel/chapterAcceptance.prompts.ts", {
  "@ai-novel/shared/types/novel/sceneCausality": causalSchema,
  "@ai-novel/shared/types/novel/progression/index": shared,
  "@ai-novel/shared/types/chapterProseContract": { CHAPTER_PROSE_QUALITY_AUDIT_RULES: [] },
  "../../core/renderContextBlocks": { renderSelectedContextBlocks: () => "已写正文" },
  "./promptBudgetProfiles": { NOVEL_PROMPT_BUDGETS: { chapterAcceptance: 1200 } },
  "./context/capabilityAuthorization": source("../src/prompting/prompts/novel/context/capabilityAuthorization.ts"),
  "./context/emotionPresence": source("../src/prompting/prompts/novel/context/emotionPresence.ts"),
  "./context/typography": source("../src/prompting/prompts/novel/context/typography.ts"),
  "./acceptance/actionStateEvidence": actionEvidence,
  "./acceptance/progressionEvidence": evidence,
});
const causal = source("../src/services/novel/runtime/acceptance/causalAssessment.ts", {
  "./actionStateProjection": source("../src/services/novel/runtime/acceptance/actionStateProjection.ts"),
  "./progressionProjection": projection,
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
  "../novelP0Utils": { normalizeScore: (value) => value, ruleScore: () => scores() },
  "./proseQuality/ProseQualityDetector": { detectProseQuality: () => ({ findings: [] }) },
  "./acceptance": { ...causal, buildAcceptanceCacheIdentity: async () => "mock" },
});
const scores = () => ({ coherence: 96, pacing: 96, repetition: 96, engagement: 96, voice: 96, overall: 96 });
const oldText = "他买饼被骗，问清医馆方向，检查了箱底，决定去医馆。";
const newText = "他又买饼被骗，问清医馆方向，检查箱底后，决定去医馆。";
const quote = (text, source = "current_prose", sourceId = "c2") => ({ source, sourceId, quote: text });
const input = (overrides = {}) => ({ chapterId: "c2", chapterOrder: 2, content: newText,
  establishedProse: [{ chapterId: "c1", order: 1, content: oldText }], ...overrides });
function checks(status = "stalled") {
  return shared.CHAPTER_PROGRESSION_DIMENSIONS.map((dimension) => ({
    dimension, status, priorState: "已完成买饼问路检查并决定就医", actualChange: "", newConsequence: "",
    previousEvidence: [quote(oldText, "established_context", "c1")], currentEvidence: [quote(newText)],
    explanation: "本章重演前章已完成的职责，章末仍停在同一个决定。",
    repairSuggestion: "保留生活触感，压缩重复买饼问路检查，承接已决定就医后的实际尝试和后果。",
  }));
}
function assessment(rows) {
  return { status: "accepted", score: scores(), summary: "可继续", blockingIssues: [], repairDirectives: [],
    missingObligations: [], repairability: "none", decisionReason: "可继续", riskTags: [], continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "正常", requiresFullPayoffReconcile: false }, progressionChecks: rows };
}
function assess(rows, options = input()) {
  const verified = evidence.validateProgressionEvidence(rows, options);
  return service.normalizeAssessment({ ...assessment(verified.checks), progressionAuditIssues: verified.coverageIssues }, options.content);
}

test("three stalled semantic judgments survive high scores as local repair, not global replan", () => {
  const result = assess(checks());
  assert.equal(result.status, "repairable");
  assert.equal(result.continuePolicy, "repair_once");
  assert.equal(result.repairability, "none");
  assert.equal(result.blockingIssues.length, 3);
  // Proven repetition (stalled, two-sided verified quotes) is graded high so it can reach
  // blockingIssueIds and actually force a rewrite, instead of being recorded as medium
  // debt and passed over. It must still stay a LOCAL repair: no global replan is derived.
  assert.ok(result.blockingIssues.every((issue) => issue.category === "plot" && issue.severity === "high"));
  assert.equal(result.repairDirectives.length, 3);
  assert.notEqual(result.replanRecommendation?.recommended, true);
  assert.deepEqual(service.normalizeAssessment(result, newText), result);
});

test("slow repeated action with new knowledge and relationship consequences is preserved", () => {
  const content = "她又问了一遍地址，发现老人每次都避开桥名，终于承认自己害怕独自去。";
  const rows = checks("justified_repetition").map((row) => ({ ...row,
    currentEvidence: [quote(content)], actualChange: "注意到回避并承认恐惧", newConsequence: "对带路人的信任改变，愿意求助",
    explanation: "同一问题产生认识与关系增量，不必本章已经到达医馆。", repairSuggestion: "",
  }));
  const result = assess(rows, input({ content }));
  assert.equal(result.status, "accepted");
  assert.equal(result.repairDirectives.length, 0);
});

test("fabricated quotes, future prose, wrong source and missing comparison become uncertainty, never invented patch", () => {
  for (const mutate of [
    (row) => { row.previousEvidence[0].quote = "从未写过的前情"; },
    (row) => { row.previousEvidence[0].sourceId = "future"; },
    (row) => { row.currentEvidence[0].sourceId = "other"; },
    (row) => { row.previousEvidence = []; },
    (row) => { row.currentEvidence = []; },
  ]) {
    const rows = checks(); rows.forEach(mutate);
    const result = assess(rows, input({ establishedProse: [...input().establishedProse, { chapterId: "future", order: 3, content: oldText }] }));
    assert.equal(result.status, "continue_with_risk");
    assert.ok(result.progressionChecks.every((row) => row.status === "insufficient_evidence"));
    assert.equal(result.repairDirectives.length, 0);
    assert.ok(result.riskTags.length > 0);
  }
});

test("first chapter can have no inherited comparison; unavailable later prose cannot certify absence", () => {
  const rows = checks("not_applicable").map((row) => ({ ...row, previousEvidence: [], repairSuggestion: "", explanation: "没有继承职责。" }));
  assert.equal(assess(rows, input({ chapterOrder: 1, establishedProse: [] })).status, "accepted");
  const later = assess(rows, input({ establishedProse: [] }));
  assert.equal(later.status, "continue_with_risk");
  assert.equal(later.repairDirectives.length, 0);
});

test("missing or duplicate dimensions are visible, not assumed reviewed", () => {
  for (const rows of [checks().slice(0, 2), [checks()[0], checks()[0], checks()[2]]]) {
    const result = assess(rows);
    assert.ok(result.progressionAuditIssues.length > 0);
    assert.ok(result.riskTags.some((tag) => tag.startsWith("progression_coverage_")));
  }
});

test("legacy schema accepts absent progression, fresh schema requires three checks and excludes self-validation", () => {
  const old = assessment(undefined);
  assert.equal(prompts.chapterAcceptanceAssessmentSchema.safeParse(old).success, true);
  const example = prompts.chapterAcceptanceAssessmentPrompt.structuredOutputHint.example;
  assert.equal(prompts.generatedChapterAcceptanceAssessmentSchema.safeParse(example).success, true);
  const missing = { ...example }; delete missing.progressionChecks;
  assert.equal(prompts.generatedChapterAcceptanceAssessmentSchema.safeParse(missing).success, false);
  const parsed = prompts.generatedChapterAcceptanceAssessmentSchema.parse({ ...example, progressionAuditIssues: ["model_certified"],
    progressionChecks: example.progressionChecks.map((row) => ({ ...row, validationIssues: ["model_certified"] })) });
  assert.equal(parsed.progressionAuditIssues, undefined);
  assert.equal(parsed.progressionChecks[0].validationIssues, undefined);
});

test("projection preserves existing manual policy; unknown progression does not hide known causal failure", () => {
  const manual = projection.projectProgressionAssessment({ ...assessment(checks()), status: "needs_manual_review", continuePolicy: "pause", repairability: "plan_misalignment" });
  assert.equal(manual.status, "needs_manual_review");
  assert.equal(manual.continuePolicy, "pause");
  const output = { ...assessment(checks("insufficient_evidence")), sceneCausalityVerdicts: [{ sceneKey: "s", verdict: "unearned", outcomeObserved: true,
    prerequisiteEvidence: [], choiceAndResistanceEvidence: "选择", outcomeMechanismEvidence: "缺少机制", constraintEvidence: [], explanation: "机制未建立" }] };
  assert.equal(service.normalizeAssessment(output, newText).status, "repairable");
});

test("production acceptance service consumes and returns progression evidence with persist false and no DB calls", async () => {
  modelOutput = assessment(checks());
  const result = await new service.ChapterAcceptanceAssessmentService().assess({ novelId: "n", chapterId: "c2", chapterOrder: 2,
    chapterTitle: "重复职责", novelTitle: "测试", content: newText, persist: false,
    contextPackage: { chapterReviewContext: { writtenEvidence: { chapters: input().establishedProse } } },
  });
  assert.equal(result.assessment.status, "repairable");
  const report = result.auditReports.find((row) => row.auditType === "plot");
  const metadata = JSON.parse(report.legacyScoreJson);
  assert.equal(metadata.progressionChecks.length, 3);
  assert.equal(metadata.progressionChecks[2].dimension, "prior_goal_followthrough");
  assert.ok(report.issues.some((issue) => issue.code === "chapter_progression_prior_goal_followthrough_stalled"));
});

test("same prompt keeps slow-burn and genre freedoms without chapter-count or keyword routing", () => {
  const rendered = prompts.chapterAcceptanceAssessmentPrompt.render({ ...input(), novelTitle: "多题材", chapterTitle: "细腻", expectedSceneKeys: [] }, {});
  const text = String(rendered[0].content);
  assert.match(text, /关系中的信任变化、认知修正、证据排除/);
  assert.match(text, /不要求赶路到达、战斗、升级、成功、反转/);
  assert.match(text, /悬疑暂不揭底、修仙闭关、民俗仪式、科幻等待、日常对白/);
  assert.match(text, /读者已知而角色首次获知/);
});

test("an AI-declared repeated beat cannot be certified as progressed even with a high score", () => {
  const rows = checks("progressed").map((row) => ({ ...row, actualChange: "重复先前交付",
    repeatsEstablishedBeat: true, addsNewConsequence: false }));
  const result = assess(rows);
  assert.equal(result.status, "continue_with_risk");
  assert.ok(result.progressionChecks.every((row) => row.status === "insufficient_evidence"
    && row.validationIssues.includes("progressed_conflicts_with_repeated_beat")));
  assert.equal(result.repairDirectives.length, 0, "conflicting evidence must not invent a prose patch");
  assert.ok(result.blockingIssues.length > 0, "inconsistent conclusions remain visible");
});

test("declared new consequences and repeated-beat states must agree without parsing narrative keywords", () => {
  const row = checks("justified_repetition")[0];
  const bad = evidence.validateProgressionEvidence([{ ...row, repeatsEstablishedBeat: true,
    addsNewConsequence: false, newConsequence: "任意非空描述" }, ...checks().slice(1)], input());
  assert.equal(bad.checks[0].status, "insufficient_evidence");
  const good = evidence.validateProgressionEvidence([{ ...row, repeatsEstablishedBeat: true,
    addsNewConsequence: true, newConsequence: "关系改变" }, ...checks().slice(1)], input());
  assert.equal(good.checks[0].status, "justified_repetition");
});

test("issue evidence cannot substitute prior-chapter events for current-chapter facts", () => {
  const issue = { code: "handover_conflict", sourceEvidence: [quote(oldText)] };
  assert.throws(() => evidence.validateAcceptanceIssueSources([issue], input()), /does not belong to declared/);
  assert.throws(() => evidence.validateAcceptanceIssueSources([{ ...issue,
    sourceEvidence: [quote(oldText, "established_context", "c1")] }], input()), /must include current_prose/);
  assert.doesNotThrow(() => evidence.validateAcceptanceIssueSources([{ ...issue, sourceEvidence: [
    quote(oldText, "established_context", "c1"), quote(newText),
  ] }], input()));
  assert.doesNotThrow(() => evidence.validateAcceptanceIssueSources([{ code: "legacy" }], input()));
});

test("fresh output requires source evidence and semantic findings while persisted historical records remain readable", () => {
  const example = prompts.chapterAcceptanceAssessmentPrompt.structuredOutputHint.example;
  const missingSource = structuredClone(example);
  delete missingSource.blockingIssues[0].sourceEvidence;
  assert.equal(prompts.chapterAcceptanceAssessmentSchema.safeParse(missingSource).success, true);
  assert.equal(prompts.generatedChapterAcceptanceAssessmentSchema.safeParse(missingSource).success, false);
  const missingFinding = structuredClone(example);
  delete missingFinding.progressionChecks[0].repeatsEstablishedBeat;
  assert.equal(prompts.generatedChapterAcceptanceAssessmentSchema.safeParse(missingFinding).success, false);
  const text = String(prompts.chapterAcceptanceAssessmentPrompt.render({ ...input(), novelTitle: "测试", chapterTitle: "测试" }, {})[0].content);
  assert.match(text, /知道任务存在、知道任务内容、知道目标位置、知道执行方法是不同命题/);
  assert.equal(prompts.chapterAcceptanceAssessmentPrompt.semanticRetryPolicy.maxAttempts, 1);
});

test("exhausted source correction preserves both valid and invalid issues but defers unlinked prose edits", () => {
  const raw = assessment(checks("insufficient_evidence"));
  const valid = { severity: "high", category: "plot", code: "valid_repetition", evidence: "比较两章确认重复",
    fixSuggestion: "承接新事件", sourceEvidence: [quote(newText), quote(oldText, "established_context", "c1")] };
  const invalid = { ...valid, code: "misattributed_handover", sourceEvidence: [quote(oldText)], fixSuggestion: "删除本章交付" };
  raw.blockingIssues = [valid, invalid];
  raw.repairDirectives = [{ mode: "patch", target: "plot", instruction: "删除本章交付" }];
  raw.missingObligations = [{ kind: "must_hit_now", summary: "重写交付" }];
  assert.throws(() => prompts.chapterAcceptanceAssessmentPrompt.postValidate(raw, input()), /does not belong/);
  const recovered = prompts.chapterAcceptanceAssessmentPrompt.postValidateFailureRecovery({ rawOutput: raw,
    promptInput: input(), validationError: "source mismatch", semanticRetryAttempts: 1, context: {} });
  assert.equal(recovered.blockingIssues.length, 2);
  assert.deepEqual(recovered.blockingIssues[0], valid);
  assert.ok(recovered.blockingIssues[1].sourceValidationIssues.length > 0);
  assert.equal(recovered.blockingIssues[1].unverifiedFixSuggestion, invalid.fixSuggestion);
  assert.match(recovered.blockingIssues[1].fixSuggestion, /未核实前保留正文/);
  assert.deepEqual(recovered.deferredRepairDirectives, raw.repairDirectives);
  assert.deepEqual(recovered.deferredMissingObligations, raw.missingObligations);
  assert.deepEqual(recovered.repairDirectives, []);
  assert.deepEqual(recovered.missingObligations, []);
  assert.equal(recovered.status, "continue_with_risk");
  const persisted = prompts.chapterAcceptanceAssessmentSchema.parse(recovered);
  assert.deepEqual(persisted.blockingIssues[1].sourceValidationIssues, recovered.blockingIssues[1].sourceValidationIssues);
  assert.deepEqual(persisted.deferredRepairDirectives, raw.repairDirectives);
});

test("source recovery cannot bypass missing, duplicate or unexpected scene coverage", () => {
  const raw = assessment(checks("insufficient_evidence"));
  raw.blockingIssues = [{ severity: "high", category: "plot", code: "wrong_source", evidence: "错引",
    fixSuggestion: "不可执行", sourceEvidence: [quote(oldText)] }];
  const scene = { sceneKey: "s", outcomeObserved: true, verdict: "earned", prerequisiteEvidence: [],
    choiceAndResistanceEvidence: "行动", outcomeMechanismEvidence: "机制", constraintEvidence: [], explanation: "成立" };
  for (const scenes of [[], [scene, scene], [{ ...scene, sceneKey: "other" }]]) {
    assert.throws(() => prompts.chapterAcceptanceAssessmentPrompt.postValidateFailureRecovery({
      rawOutput: { ...raw, sceneCausalityVerdicts: scenes }, promptInput: input({ expectedSceneKeys: ["s"] }),
      validationError: "source mismatch", semanticRetryAttempts: 1, context: {},
    }), /逐一覆盖/);
  }
  const recovered = prompts.chapterAcceptanceAssessmentPrompt.postValidateFailureRecovery({
    rawOutput: { ...raw, sceneCausalityVerdicts: [scene] }, promptInput: input({ expectedSceneKeys: ["s"] }),
    validationError: "source mismatch", semanticRetryAttempts: 1, context: {},
  });
  assert.equal(recovered.sceneCausalityVerdicts[0].verdict, "insufficient_evidence", "missing key action coverage must not earn a scene");
});
