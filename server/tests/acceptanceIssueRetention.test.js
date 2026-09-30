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
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  }, exports);
  return exports;
}

const causal = source("../src/services/novel/runtime/acceptance/causalAssessment.ts", {
  "./actionStateProjection": source("../src/services/novel/runtime/acceptance/actionStateProjection.ts"),
  "./progressionProjection": source("../src/services/novel/runtime/acceptance/progressionProjection.ts"),
});
const rows = [];
const service = source("../src/services/novel/runtime/ChapterAcceptanceAssessmentService.ts", {
  "../../../db/prisma": { prisma: {
    $transaction: async (work) => work({ auditReport: {
      deleteMany: async () => { rows.length = 0; },
      create: async ({ data }) => { rows.push(data); },
    } }),
    auditReport: { findMany: async () => rows },
  } },
  "../../../prompting/core/promptRunner": {},
  "../../../prompting/context/promptContextResolution": {},
  "../../../prompting/prompts/novel/chapterLayeredContext": {},
  "../../../prompting/prompts/novel/chapterLayeredContextShared": {
    resolveTargetWordRange: () => ({ minWordCount: null, maxWordCount: null }),
  },
  "../../../prompting/prompts/novel/chapterAcceptance.prompts": {},
  "../../state/OpenConflictService": { openConflictService: { syncFromAuditReports: async () => {} } },
  "../novelP0Utils": { normalizeScore: (value) => value },
  "./proseQuality/ProseQualityDetector": {},
  "./acceptance": causal,
});
const pipeline = source("../src/services/novel/runtime/chapterRuntimePipeline.ts", {
  "./acceptance": source("../src/services/novel/runtime/acceptance/actionableIssues.ts"),
  "./artifactSync/ChapterArtifactSyncResult": {},
  "../../styleEngine/styleGenerationSanitizer": {},
  "./chapterEmptyContentError": {},
  "./repair/chapterRepairRuntime": {},
  "../chapterPatchRepairService": {},
  "./selection/ChapterRepairCandidateSelection": {},
});
const actionable = source("../src/services/novel/runtime/acceptance/actionableIssues.ts");
let patchInput;
class PatchError extends Error {}
const repair = source("../src/services/novel/runtime/repair/chapterRepairRuntime.ts", {
  "../../../../prompting/core/promptRunner": {},
  "../../../../prompting/prompts/novel/chapterLayeredContext": {},
  "../../../../prompting/prompts/novel/review.prompts": {},
  "../acceptance": actionable,
  "../../chapterPatchRepairService": {
    ChapterPatchRepairFailedError: PatchError,
    ChapterPatchRepairService: class { async repair(input) { patchInput = input; return { content: "保留稿", plan: {} }; } },
  },
});
let selectedAuditIssues = [];
const manual = source("../src/services/novel/runtime/repair/ChapterRepairStreamRuntime.ts", {
  "../../../../db/prisma": { prisma: { auditIssue: { findMany: async () => selectedAuditIssues } } },
  "../../../../prompting/core/promptRunner": {},
  "../../../../prompting/prompts/novel/chapterLayeredContext": {},
  "../../../audit/AuditService": {},
  "../../chapterPatchRepairService": { ChapterPatchRepairFailedError: PatchError },
  "../../quality/ChapterQualityLoopService": {},
  "../acceptance": actionable,
  "../../novelCoreShared": {},
  "../artifactSync/ChapterArtifactSyncResult": {},
  "./chapterAuditContext": {},
  "./chapterRepairRuntime": {},
});

function assessment() {
  return {
    status: "repairable", continuePolicy: "repair_once", repairability: "patchable_obligation_gap",
    decisionReason: "前章已交付，当前章重复首单结算。", summary: "需保留全部审查问题",
    score: { coherence: 70, pacing: 70, repetition: 60, engagement: 80, voice: 80, overall: 72 },
    riskTags: [], assetSyncRecommendation: { priority: "normal", reason: "normal", requiresFullPayoffReconcile: false },
    blockingIssues: [
      { code: "order_knowledge_break", severity: "high", category: "continuity", evidence: "订单知识误读", fixSuggestion: "核对知识状态" },
      { code: "duplicate_first_order_settlement", severity: "high", category: "plot", evidence: "上一章已交药，本章再次交药结算。", fixSuggestion: "承接交付后的后果，去除重复首单结算。", sourceEvidence: [
        { source: "established_context", sourceId: "c2", quote: "他把药放在香案上。" },
        { source: "current_prose", sourceId: "c3", quote: "他将药亲手交给对方。" },
      ] },
    ],
    repairDirectives: [{ mode: "patch", target: "plot", instruction: "处理重复首单结算，保留新的后果。" }],
    missingObligations: Array.from({ length: 10 }, (_, index) => ({
      kind: "must_preserve", summary: `义务${index}`, evidence: `证据${index}`,
    })),
    // Reproduce the incident ordering: three state issues and one progression
    // issue are prepended, moving the original high repetition issue to sixth.
    actionStateChecks: Array.from({ length: 3 }, (_, index) => ({
      sceneKey: `scene_${index}`, actor: "主角", action: "行动", verdict: "unearned",
      explanation: "需核对状态", states: [], actionEvidence: [],
    })),
    progressionChecks: [{
      dimension: "knowledge_repetition", status: "stalled", priorState: "已知订单", actualChange: "再次得知订单",
      newConsequence: "", explanation: "认识无增量", previousEvidence: [], currentEvidence: [], repairSuggestion: "体现新后果",
    }],
  };
}

test("projected findings cannot erase the sixth high issue, fifth directive or later obligations", () => {
  const normalized = service.normalizeAssessment(assessment(), "正文");
  assert.equal(normalized.blockingIssues.length, 6);
  assert.equal(normalized.blockingIssues[5].code, "duplicate_first_order_settlement");
  assert.equal(normalized.blockingIssues[5].severity, "high");
  assert.equal(normalized.repairDirectives.length, 5);
  assert.equal(normalized.repairDirectives[4].instruction, "处理重复首单结算，保留新的后果。");
  assert.equal(normalized.missingObligations.length, 10);
  assert.deepEqual(service.normalizeAssessment(normalized, "正文"), normalized);
});

test("runtime reports and persisted reports retain all issues and assessment instructions", async () => {
  const normalized = service.normalizeAssessment(assessment(), "正文");
  const instance = new service.ChapterAcceptanceAssessmentService();
  const input = { novelId: "test", chapterId: "c3", chapterOrder: 3 };
  const reports = instance.buildAcceptanceReports(input, normalized, normalized.score);
  assert.equal(reports.flatMap((report) => report.issues).length, 6);
  assert.ok(reports.flatMap((report) => report.issues).some((issue) => issue.code === "duplicate_first_order_settlement"));
  await instance.persistAssessmentResult(input, { assessment: normalized, score: normalized.score, issues: [], auditReports: reports });
  assert.equal(rows.flatMap((row) => row.issues.create).length, 6);
  for (const report of [...reports, ...rows]) {
    const meta = JSON.parse(report.legacyScoreJson);
    assert.deepEqual(meta.repairDirectives, normalized.repairDirectives);
    assert.deepEqual(meta.blockingIssues, normalized.blockingIssues);
    assert.deepEqual(meta.missingObligations, normalized.missingObligations);
    assert.equal(meta.repairability, normalized.repairability);
    assert.equal(meta.decisionReason, normalized.decisionReason);
  }
});

test("unverified source remains recorded while only the verified issue reaches repair", async () => {
  const raw = assessment();
  raw.actionStateChecks = [];
  raw.progressionChecks = [];
  raw.missingObligations = [];
  raw.deferredMissingObligations = [{ kind: "must_preserve", summary: "待核实义务", evidence: "错误来源" }];
  raw.deferredRepairDirectives = raw.repairDirectives;
  raw.repairDirectives = [];
  raw.blockingIssues[0].sourceValidationIssues = ["current_prose quotation absent"];
  raw.blockingIssues[0].unverifiedFixSuggestion = raw.blockingIssues[0].fixSuggestion;
  raw.blockingIssues[0].fixSuggestion = "核对来源，不自动改稿";
  const normalized = service.normalizeAssessment(raw, "正文");
  const instance = new service.ChapterAcceptanceAssessmentService();
  const input = { novelId: "test", chapterId: "c3", chapterOrder: 3 };
  const reports = instance.buildAcceptanceReports(input, normalized, normalized.score);
  const openIssues = reports.flatMap((report) => report.issues);
  assert.equal(openIssues.length, 2);
  assert.equal(openIssues.find((issue) => issue.code === "order_knowledge_break").severity, "medium");
  const runtime = { audit: { reports, openIssues } };
  assert.deepEqual(pipeline.toReviewIssues(runtime).map((issue) => issue.evidence), [raw.blockingIssues[1].evidence]);
  runtime.audit.openIssues = [openIssues.find((issue) => issue.code === "order_knowledge_break")];
  assert.deepEqual(pipeline.toReviewIssues(runtime), []);
  assert.equal(pipeline.shouldDeferNonPatchableReviewRisk(runtime, []), true);
  runtime.audit.openIssues = [];
  assert.deepEqual(pipeline.toReviewIssues(runtime).map((issue) => issue.evidence), [raw.blockingIssues[1].evidence]);
  await instance.persistAssessmentResult(input, { assessment: normalized, score: normalized.score, issues: [], auditReports: reports });
  for (const row of rows) {
    const meta = JSON.parse(row.legacyScoreJson);
    assert.deepEqual(meta.blockingIssues, raw.blockingIssues);
    assert.deepEqual(meta.deferredRepairDirectives, raw.deferredRepairDirectives);
    assert.deepEqual(meta.deferredMissingObligations, raw.deferredMissingObligations);
    assert.deepEqual(meta.repairDirectives, []);
  }
});

test("an unverified issue alone cannot promote acceptance into automatic repair", () => {
  const raw = assessment();
  raw.status = "accepted";
  raw.repairability = "none";
  raw.continuePolicy = "continue";
  raw.actionStateChecks = [];
  raw.progressionChecks = [];
  raw.missingObligations = [];
  raw.repairDirectives = [];
  raw.blockingIssues = [{ ...raw.blockingIssues[0], sourceValidationIssues: ["wrong source"] }];
  const normalized = service.normalizeAssessment(raw, "正文");
  assert.notEqual(normalized.status, "repairable");
  assert.notEqual(normalized.continuePolicy, "repair_once");
  assert.equal(normalized.blockingIssues.length, 1);
});

test("repair entry filters both the issue catalog and payload and refuses an all-unverified fallback", async () => {
  const fake = { code: "bad", evidence: "假问题", fixSuggestion: "错误修改", severity: "high", category: "coherence", sourceValidationIssues: ["wrong chapter"] };
  const real = { code: "good", evidence: "真重复", fixSuggestion: "修复重复", severity: "high", category: "pacing" };
  const reports = [{ legacyScoreJson: JSON.stringify({ blockingIssues: [fake, real] }) }];
  const input = { content: "原稿", issues: [fake, real], options: {}, runtimePackage: {
    audit: { openIssues: [fake, real], reports }, context: {}, obligationCoverage: { missing: [] },
  } };
  await repair.prepareChapterRepairExecution(input);
  assert.deepEqual(patchInput.issues, [real]);
  const payload = JSON.parse(patchInput.issuesJson);
  assert.deepEqual(payload.blockingIssueCodes, ["good"]);
  assert.deepEqual(payload.issues, [real]);
  await assert.rejects(repair.prepareChapterRepairExecution({ ...input, issues: [fake] }), PatchError);
  await assert.rejects(repair.prepareChapterRepairExecution({ ...input, issues: [], runtimePackage: {
    ...input.runtimePackage, audit: { openIssues: [fake], reports },
  } }), PatchError);
});

test("manual audit selection cannot revive a finding whose source failed validation", async () => {
  const fake = { code: "bad", evidence: "假问题", fixSuggestion: "核实来源", severity: "medium", auditType: "continuity" };
  const real = { code: "good", evidence: "真重复", fixSuggestion: "修复重复", severity: "high", auditType: "plot" };
  const report = { legacyScoreJson: JSON.stringify({ blockingIssues: [{ ...fake, sourceValidationIssues: ["wrong chapter"] }, real] }) };
  const instance = new manual.ChapterRepairStreamRuntime({});
  selectedAuditIssues = [{ ...fake, report }, { ...real, report }];
  const result = await instance.resolveRepairIssues("n", "c", "正文", { auditIssueIds: ["bad", "good"] }, {});
  assert.deepEqual(result.map((issue) => issue.evidence), ["真重复"]);
  selectedAuditIssues = [{ ...fake, report }];
  await assert.rejects(instance.resolveRepairIssues("n", "c", "正文", { auditIssueIds: ["bad"] }, {}), PatchError);
  const explicit = [{ severity: "medium", category: "pacing", evidence: "用户要求", fixSuggestion: "调整节奏" }];
  assert.deepEqual(await instance.resolveRepairIssues("n", "c", "正文", { reviewIssues: explicit }, {}), explicit);
});
