const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Refuse every unmocked import: this test never reaches a database or a model.
function load(relative, imports) {
  const filename = path.resolve(__dirname, "../src/services/novel", relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require, exports) { ${compiled}\n})`, { filename })((id) => {
    if (!Object.hasOwn(imports, id)) throw new Error(`Unmocked dependency: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

const receipts = [{ issueId: "repair-issue-1", disposition: "deferred", patchIds: [],
  reason: "The saved plan conflicts with the preceding delivery", inputEvidence: "Delivery already completed" }];

function runtime(score) {
  return { novelId: "n", chapterId: "c", context: {}, audit: {
    score: Object.fromEntries(["coherence", "pacing", "repetition", "engagement", "voice", "overall"].map(k => [k, score])),
    openIssues: score < 80 ? [{ id: "i", code: "duplicate_delivery", auditType: "continuity", severity: "medium",
      evidence: "Delivery already completed", fixSuggestion: "Retain the completed event" }] : [],
    reports: [], hasBlockingIssues: false,
  } };
}

for (const outcome of ["candidate_passed", "original_retained", "patch_failed"]) {
  test(`patch receipts reach quality persistence when ${outcome}`, async () => {
    class PatchFailed extends Error {
      constructor() { super("Patch could not be safely applied"); this.plan = { issueResolutions: receipts }; }
    }
    const selection = load("runtime/selection/ChapterRepairCandidateSelection.ts", { "node:crypto": require("node:crypto") });
    const pipeline = load("runtime/chapterRuntimePipeline.ts", {
      "./acceptance": load("runtime/acceptance/actionableIssues.ts", {}),
      "./artifactSync/ChapterArtifactSyncResult": { ChapterArtifactSyncBoundaryError: class extends Error {} },
      "../../styleEngine/styleGenerationSanitizer": { detectForbiddenStyleEntities: () => [] },
      "./chapterEmptyContentError": { assertChapterContentNotEmpty: () => {}, isChapterEmptyContentError: () => false },
      "./repair/chapterRepairRuntime": { runChapterRepairText: async () => {
        if (outcome === "patch_failed") throw new PatchFailed();
        return { content: "Candidate body with a local patch", issueResolutions: receipts };
      } },
      "../chapterPatchRepairService": { ChapterPatchRepairFailedError: PatchFailed },
      "./selection/ChapterRepairCandidateSelection": selection,
    });
    const retained = [];
    let evaluations = 0;
    const result = await pipeline.runPipelineChapterWithRuntime({
      validateRequest: input => input,
      ensureNovelCharacters: async () => {},
      assemble: async () => ({ novel: { id: "n", title: "Novel" }, chapter: {
        id: "c", title: "Chapter", order: 3, content: "Original body", expectation: null,
      }, contextPackage: {} }),
      generateDraftFromWriter: async () => { throw new Error("Existing prose must be retained"); },
      saveDraftAndArtifacts: async () => {},
      finalizeChapterContent: async ({ content }) => {
        const score = evaluations++ === 0 || outcome !== "candidate_passed" ? 60 : 90;
        return { finalContent: content, runtimePackage: runtime(score), needsRepair: score < 80 };
      },
      commitFinalizedChapterContent: async ({ evaluation }) => { retained.push(evaluation.finalContent); },
      syncFinalChapterArtifacts: async () => ({ status: "completed" }),
      markChapterGenerationState: async () => {}, markChapterNeedsRepair: async () => {},
    }, "n", "c", { autoReview: true, autoRepair: true, maxRetries: 1 });
    assert.equal(result.retryCountUsed, 1);
    if (outcome === "candidate_passed") {
      assert.equal(result.pass, true);
      assert.equal(result.qualityDebtAttribution, null);
      assert.deepEqual(result.repairSelection.issueResolutions, receipts);
    } else {
      assert.equal(result.pass, false);
      assert.deepEqual(result.qualityDebtAttribution.patchIssueResolutions, receipts);
      assert.deepEqual(retained, ["Original body"]);
      if (outcome === "original_retained") assert.deepEqual(result.repairSelection.issueResolutions, receipts);
      else assert.equal(result.repairSelection, null);
    }
    let persisted;
    const closure = load("production/qualityClosure/ChapterQualityClosure.ts", {
      "../../novelCoreShared": { logPipelineError: () => {}, logPipelineWarn: () => {} },
      "../../novelCoreReviewService": { createQualityReport: async () => {} },
      "../../quality/ChapterQualityLoopService": { chapterQualityLoopService: {
        recordAssessment: async input => { persisted = JSON.parse(JSON.stringify(input)); },
      } },
      "../issueGovernance/PipelineIssueGovernance": { reportPipelineIssue: async () => {} },
    });
    await closure.applyChapterQualityClosure({
      governance: null, workflowTaskId: "task", novelId: "n", jobId: "job", chapter: { id: "c", order: 3 },
      chapterResult: result, qualityThreshold: 75, runtimePayload: { autoReview: true },
      qualityAlertDetails: [], replanAlertDetails: [], recoverableRepairDetails: [],
      runLocalReplan: async () => { throw new Error("No replan was requested"); },
    });
    const saved = outcome === "candidate_passed" ? persisted.repairSelection.issueResolutions
      : persisted.qualityDebtAttribution.patchIssueResolutions;
    assert.deepEqual(saved, receipts);
  });
}
