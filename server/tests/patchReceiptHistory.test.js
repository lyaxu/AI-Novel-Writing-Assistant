const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(relative, imports) {
  const filename = path.resolve(__dirname, "../src/services/novel", relative);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require, exports) { ${code}\n})`, { filename })((id) => {
    if (!Object.hasOwn(imports, id)) throw new Error(`Unmocked dependency: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

const receipts = [{ issueId: "repair-issue-1", disposition: "deferred", patchIds: [],
  reason: "Cannot change the chapter plan locally", inputEvidence: "Already delivered\nAlready rewarded" }];
const history = load("quality/patchReceiptHistory.ts", { "node:crypto": require("node:crypto") });
const assessment = { evaluatedAt: "2026-09-30T20:00:00Z", recommendedAction: "continue", overallStatus: "valid", signals: [] };

function qualityHarness() {
  const chapter = { content: "Preserved prose", repairHistory: "legacy note", riskFlags: null,
    chapterStatus: "completed", generationState: "approved" };
  const writes = [];
  const service = load("quality/ChapterQualityLoopService.ts", {
    "@ai-novel/shared/types/chapterQualityLoop": { buildChapterQualityLoopAssessment: () => assessment },
    "../../../db/prisma": { prisma: { chapter: { findFirst: async () => ({ ...chapter }) } } },
    "../director/runtime/DirectorAutomationLedgerEventService": { directorAutomationLedgerEventService: {
      recordQualityLoopAssessment: async () => {},
    } },
    "../runtime/lifecycle/ChapterLifecycleService": { chapterLifecycleService: {
      applyQualityAssessmentState: async ({ data }) => { writes.push(data); Object.assign(chapter, data); },
    } },
    "./patchReceiptHistory": history,
  });
  return { ...service, chapter, writes };
}

test("receipt history survives later clean and failed assessments beyond the status trail limit", () => {
  const h = qualityHarness();
  const update = h.buildChapterQualityLoopChapterUpdate(h.chapter, assessment, "repair_recheck", null, null,
    { selected: "candidate", issueResolutions: receipts });
  Object.assign(h.chapter, update);
  const receiptLine = h.chapter.repairHistory.split("\n").find(line => line.startsWith("[patch_receipt]"));
  assert.ok(receiptLine);
  for (let n = 0; n < 20; n += 1) {
    Object.assign(h.chapter, h.buildChapterQualityLoopChapterUpdate(h.chapter, {
      ...assessment, evaluatedAt: `later-${n}`, recommendedAction: n % 2 ? "continue" : "repair", overallStatus: "warning",
    }, "manual_review"));
  }
  assert.ok(h.chapter.repairHistory.includes(receiptLine));
  const entry = JSON.parse(receiptLine.slice("[patch_receipt] ".length));
  assert.deepEqual(entry.issueResolutions, receipts);
  assert.equal(entry.outcome, "candidate_selected");
  assert.equal(h.chapter.content, "Preserved prose");
});

test("manual attempt persistence changes only repairHistory and deduplicates the same receipt", async () => {
  const h = qualityHarness();
  const service = new h.ChapterQualityLoopService();
  const input = { novelId: "n", chapterId: "c", entry: { attemptId: "attempt-1", recordedAt: assessment.evaluatedAt,
    source: "manual_repair", outcome: "application_failed", issueResolutions: receipts } };
  await service.recordPatchAttempt(input);
  await service.recordPatchAttempt(input);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(Object.keys(h.writes[0]), ["repairHistory"]);
  assert.equal(h.chapter.content, "Preserved prose");
  assert.equal(h.chapter.generationState, "approved");
});

for (const failure of [false, true]) {
  test(`manual repair records receipts before ${failure ? "propagating application failure" : "returning a stream"}`, async () => {
    class PatchError extends Error { constructor() { super("unsafe patch"); this.plan = { issueResolutions: receipts }; } }
    const originalError = new PatchError();
    const writes = [];
    const runtime = load("runtime/repair/ChapterRepairStreamRuntime.ts", {
      "node:crypto": require("node:crypto"),
      "../../../../db/prisma": { prisma: {
        novel: { findUnique: async () => ({ title: "Novel" }) },
        chapter: { findFirst: async () => ({ title: "Chapter", content: "Existing prose" }) },
        novelBible: { findUnique: async () => null },
      } },
      "../../../../prompting/core/promptRunner": { streamTextPrompt: async () => { throw new Error("No model"); } },
      "../../../../prompting/prompts/novel/chapterLayeredContext": { withChapterRepairContext: () => ({ chapterRepairContext: {} }) },
      "../../../audit/AuditService": { auditService: {} },
      "../acceptance": {},
      "../../chapterPatchRepairService": { ChapterPatchRepairFailedError: PatchError },
      "../../quality/ChapterQualityLoopService": { chapterQualityLoopService: { recordPatchAttempt: async () => { throw new Error("Use injected persistence"); } } },
      "../../novelCoreShared": { isPass: () => true, logPipelineError: () => {} },
      "../artifactSync/ChapterArtifactSyncResult": { ChapterArtifactSyncBoundaryError: class extends Error {} },
      "./chapterAuditContext": { assembleChapterAuditContextPackage: async () => ({}), ChapterContextAssemblyError: class extends Error {} },
      "./chapterRepairRuntime": { prepareChapterRepairExecution: async () => {
        if (failure) throw originalError;
        return { kind: "patched", content: "Candidate", issueResolutions: receipts };
      } },
    });
    const service = new runtime.ChapterRepairStreamRuntime({ qualityLoopService: {
      recordPatchAttempt: async input => { writes.push(input); },
    } });
    const operation = service.createRepairStream("n", "c", { reviewIssues: [] });
    if (failure) await assert.rejects(operation, error => error === originalError);
    else assert.ok((await operation).stream);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].entry.outcome, failure ? "application_failed" : "candidate_prepared");
    assert.deepEqual(writes[0].entry.issueResolutions, receipts);
  });
}
