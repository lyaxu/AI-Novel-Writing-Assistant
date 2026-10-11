const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

// Real pipeline, session and selection code; the transaction store and external capabilities are offline doubles.
function fixture({ initialContent = "", repair = false, failure, viaAdapter = false } = {}) {
  const crypto = require("node:crypto");
  const contracts = loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": crypto });
  const { createChapterProductionJournal } = loadRuntimeSource("../production/reliability/session.ts", {
    "node:crypto": crypto, "./types": contracts,
  });
  const context = loadRuntimeSource("../production/reliability/executionContext.ts", {
    "node:async_hooks": require("node:async_hooks"),
  });
  const selection = loadRuntimeSource("selection/ChapterRepairCandidateSelection.ts", { "node:crypto": crypto });
  let chapter = { id: "c", novelId: "n", title: "Chapter", order: 1, content: initialContent, taskSheet: "contract", sceneCards: null, expectation: null, targetWordCount: 2800 };
  const initialChapter = structuredClone(chapter);
  let row = null;
  let tail = Promise.resolve();
  let session;
  let failurePending = failure;
  const calls = { writer: 0, review: 0, repair: 0, budget: 0, save: 0, commit: 0, sync: 0, timeline: 0, approved: 0 };
  const reviewed = [];
  const committed = [];
  const states = [];
  const repository = { transaction(fn) {
    const result = tail.then(async () => {
      const before = structuredClone({ chapter, row });
      try {
        return await fn({
          readChapter: async () => structuredClone(chapter),
          readJournal: async () => row && { ...row },
          writeJournal: async (_n, _c, expected, next) => {
            assert.equal(row?.metadataJson ?? null, expected);
            row = { metadataJson: next, status: JSON.parse(next).status };
          },
          archiveJournal: async () => assert.fail("same operation must not be archived"),
          writeContent: async (_n, _c, expected, data) => {
            assert.equal(contracts.chapterFingerprint(chapter), contracts.chapterFingerprint(expected));
            chapter = { ...chapter, ...data };
          },
        });
      } catch (error) { ({ chapter, row } = before); throw error; }
    });
    tail = result.catch(() => {});
    return result;
  } };
  function failOnce(point) {
    if (failurePending !== point) return;
    failurePending = null;
    const error = new Error(`offline ${point} failure`);
    if (point === "review" || point === "candidate_review") {
      error.name = "StructuredOutputError";
      error.category = "schema_mismatch";
    }
    throw error;
  }
  const { runPipelineChapterWithRuntime } = loadRuntimeSource("chapterRuntimePipeline.ts", {
    "../production/reliability": context,
    "./acceptance": { filterVerifiedRepairIssues: (issues) => issues },
    "../../styleEngine/styleGenerationSanitizer": { detectForbiddenStyleEntities: () => [] },
    "./chapterEmptyContentError": { assertChapterContentNotEmpty: value => value, isChapterEmptyContentError: () => false },
    "./repair/chapterRepairRuntime": { runChapterRepairText: async () => { calls.repair++; return { content: "repair candidate" }; } },
    "../chapterPatchRepairService": { ChapterPatchRepairFailedError: class extends Error {} },
    "./selection/ChapterRepairCandidateSelection": selection,
    "./artifactSync/ChapterArtifactSyncResult": { ChapterArtifactSyncBoundaryError: class extends Error {
      constructor(result) { super(result.reason); this.result = result; }
    } },
  });
  const deps = {
    validateRequest: value => value,
    ensureNovelCharacters: async () => {},
    assemble: async () => ({ novel: { id: "n", title: "Novel" }, chapter: initialChapter, contextPackage: {} }),
    generateDraftFromWriter: async () => { calls.writer++; return { content: "generated draft" }; },
    saveDraftAndArtifacts: async (_n, _c, content, generationState) => { calls.save++; await session.saveContent({ content, generationState }); },
    finalizeChapterContent: async ({ content }) => {
      calls.review++; reviewed.push(content);
      failOnce(content === "repair candidate" ? "candidate_review" : "review");
      if (failurePending === "human_edit") { failurePending = null; chapter.content = "human retained manuscript"; }
      const score = repair && content !== "repair candidate" ? 40 : 95;
      return { finalContent: content, needsRepair: score < 80, runtimePackage: {
        novelId: "n", chapterId: "c", context: {},
        meta: { acceptanceStatus: score < 80 ? "repairable" : "accepted" },
        audit: { score: { coherence: score, pacing: score, repetition: score, engagement: score, voice: score, overall: score }, openIssues: [], reports: [], hasBlockingIssues: false },
      } };
    },
    commitFinalizedChapterContent: async ({ evaluation }) => { calls.commit++; committed.push(evaluation.finalContent); },
    syncFinalChapterArtifacts: async (_n, _c, content) => {
      calls.sync++; failOnce("sync"); return { status: "completed", contentHash: content, completedArtifacts: ["facts"] };
    },
    finalizeChapterTimeline: async () => { calls.timeline++; failOnce("timeline"); },
    markChapterNeedsRepair: async () => {},
    markChapterGenerationState: async (_id, state) => { calls.approved++; states.push(state); },
  };
  const { ChapterPipelineRuntimeAdapter } = loadRuntimeSource("ChapterPipelineRuntimeAdapter.ts", {
    "../production/reliability": context,
    "./chapterRuntimePipeline": { runPipelineChapterWithRuntime },
    "./chapterEmptyContentError": { isChapterEmptyContentError: () => false },
  });
  const adapter = new ChapterPipelineRuntimeAdapter({
    streamOrchestrator: {
      prepareRuntimeChapter: async () => ({ request: {}, assembled: await deps.assemble() }),
      generateDraftFromWriter: deps.generateDraftFromWriter,
      markChapterStatus: async (_id, status) => { states.push(status); },
    },
    artifactSyncService: { saveDraftAndArtifacts: deps.saveDraftAndArtifacts, syncChapterArtifacts: deps.syncFinalChapterArtifacts },
    contentFinalizationService: deps,
    lifecycleService: { markGenerationState: deps.markChapterGenerationState },
    timelineFinalizer: { finalizeCurrentContent: async () => { await deps.finalizeChapterTimeline(); return { checkpointWritten: true }; } },
    ensureNovelCharacters: deps.ensureNovelCharacters,
  });
  return {
    calls, reviewed, committed, states,
    content: () => chapter.content,
    journal: () => JSON.parse(row.metadataJson),
    async run(options = {}) {
      // A fresh service instance simulates process restart over the retained journal and chapter rows.
      session = await createChapterProductionJournal({ repository }).open({ novelId: "n", chapterId: "c", request: { model: "offline" } });
      try {
        const hooks = {
          onCheckCancelled: () => session.assertCurrent(),
          onRetryConsumed: async () => { calls.budget++; return true; },
        };
        const result = await context.withProductionSession(session, () => viaAdapter
          ? adapter.runPipelineChapter("n", "c", options, hooks)
          : runPipelineChapterWithRuntime(deps, "n", "c", options, hooks));
        await session.close({ completed: true });
        return result;
      } catch (error) { await session.close({ error }); throw error; }
    },
  };
}

test("sync failure resumes only sync after saved draft, reviews, repair and commit", async () => {
  const f = fixture({ repair: true, failure: "sync" });
  await assert.rejects(f.run(), /offline sync failure/);
  assert.equal(f.content(), "repair candidate");
  assert.deepEqual(f.calls, { writer: 1, review: 2, repair: 1, budget: 1, save: 2, commit: 1, sync: 1, timeline: 0, approved: 0 });
  const result = await f.run();
  assert.equal(result.pass, true);
  assert.deepEqual(f.calls, { writer: 1, review: 2, repair: 1, budget: 1, save: 2, commit: 1, sync: 2, timeline: 0, approved: 1 });
});

test("explicit review failure keeps saved draft and resumes review without writer", async () => {
  const f = fixture({ failure: "review" });
  await assert.rejects(f.run(), /offline review failure/);
  assert.equal(f.content(), "generated draft");
  await f.run();
  assert.equal(f.calls.writer, 1); assert.equal(f.calls.save, 1);
  assert.equal(f.calls.review, 2); assert.equal(f.calls.commit, 1);
});

test("candidate review failure retains original and candidate, then reuses repair output without a second budget claim", async () => {
  const f = fixture({ initialContent: "original draft", repair: true, failure: "candidate_review" });
  await assert.rejects(f.run(), /offline candidate_review failure/);
  assert.equal(f.content(), "original draft");
  assert.equal(f.journal().steps["pipeline.repair"].output.content, "repair candidate");
  const result = await f.run();
  assert.equal(result.repairSelection.selected, "candidate");
  assert.equal(f.content(), "repair candidate");
  assert.equal(f.calls.repair, 1); assert.equal(f.calls.budget, 1);
  assert.deepEqual(f.reviewed, ["original draft", "repair candidate", "repair candidate"]);
});

test("manual content change during review blocks terminal writes and retains the human manuscript", async () => {
  const f = fixture({ initialContent: "original draft", failure: "human_edit" });
  await assert.rejects(f.run(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.content(), "human retained manuscript");
  assert.equal(f.calls.save, 0); assert.equal(f.calls.commit, 0); assert.equal(f.calls.sync, 0); assert.equal(f.calls.approved, 0);
});

test("restart with consumed automatic budget still reviews the previously generated repair candidate", async () => {
  const f = fixture({ initialContent: "original draft", repair: true, failure: "candidate_review" });
  await assert.rejects(f.run({ maxRetries: 1 }), /offline candidate_review failure/);
  const result = await f.run({ maxRetries: 0 });
  assert.equal(result.repairSelection?.selected, "candidate");
  assert.equal(f.content(), "repair candidate");
  assert.equal(f.calls.repair, 1); assert.equal(f.calls.budget, 1);
  assert.deepEqual(f.reviewed, ["original draft", "repair candidate", "repair candidate"]);
});

test("timeline failure with review disabled reuses completed artifact sync", async () => {
  const f = fixture({ failure: "timeline" });
  await assert.rejects(f.run({ autoReview: false }), /offline timeline failure/);
  await f.run({ autoReview: false });
  assert.equal(f.calls.writer, 1); assert.equal(f.calls.sync, 1); assert.equal(f.calls.timeline, 2);
});

test("duplicate successful adapter invocation preserves terminal state and reuses all completed work", async () => {
  const f = fixture({ viaAdapter: true });
  await f.run({ autoReview: false });
  const completedCalls = { ...f.calls };
  assert.deepEqual(f.states, ["generating", "approved"]);
  await f.run({ autoReview: false });
  assert.deepEqual(f.states, ["generating", "approved"]);
  assert.deepEqual(f.calls, completedCalls);
});
