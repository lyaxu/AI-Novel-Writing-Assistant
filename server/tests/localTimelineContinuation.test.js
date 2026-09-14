const test = require("node:test");
const assert = require("node:assert/strict");
const { runPipelineChapterWithRuntime } = require("../dist/services/novel/runtime/chapterRuntimePipeline.js");

function createDeps(events, finalize) {
  return {
    validateRequest: (input) => input,
    ensureNovelCharacters: async () => {},
    assemble: async () => ({
      novel: { id: "novel", title: "Novel" },
      chapter: { id: "chapter", title: "Chapter", order: 1, content: "Existing content", expectation: null },
      contextPackage: {},
    }),
    syncFinalChapterArtifacts: async () => ({ status: "completed", completedArtifacts: [], contentHash: "hash" }),
    finalizeChapterTimeline: finalize,
    markChapterGenerationState: async () => events.push("approved"),
  };
}

test("unreviewed chapters cannot be approved before timeline finalization succeeds", async () => {
  const events = [];
  const deps = createDeps(events, async () => { throw new Error("timeline pending"); });
  await assert.rejects(
    runPipelineChapterWithRuntime(deps, "novel", "chapter", { autoReview: false }),
    /timeline pending/,
  );
  assert.deepEqual(events, []);
});

test("losing execution ownership during timeline finalization prevents chapter approval", async () => {
  const events = [];
  let ownsExecution = true;
  const deps = createDeps(events, async () => {
    events.push("timeline");
    ownsExecution = false;
  });
  await assert.rejects(
    runPipelineChapterWithRuntime(deps, "novel", "chapter", { autoReview: false }, {
      onCheckCancelled: async () => {
        if (!ownsExecution) throw new Error("execution ownership lost");
      },
    }),
    /execution ownership lost/,
  );
  assert.deepEqual(events, ["timeline"]);
});
