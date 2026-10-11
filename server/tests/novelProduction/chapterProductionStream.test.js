const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

function fixture({ disconnect = false, outputLimit = false, failReview = false, failSave = false, savedNormalize } = {}) {
  const context = loadRuntimeSource("../production/reliability/executionContext.ts", { "node:async_hooks": require("node:async_hooks") });
  const runner = loadRuntimeSource("../production/reliability/ChapterProductionExecution.ts", { "./executionContext": context });
  const { ChapterStreamGenerationOrchestrator } = loadRuntimeSource("ChapterStreamGenerationOrchestrator.ts", {
    "../production/reliability": context,
    "../novelP0Utils": { toText: value => typeof value === "string" ? value : "" },
    "./chapterEmptyContentError": { assertChapterContentNotEmpty: value => value, isChapterEmptyContentError: () => false },
  });
  const steps = new Map(savedNormalize ? [["stream.normalize", { status: "done", output: savedNormalize }]] : []);
  const values = new Map(savedNormalize ? [["stream.started", true]] : []);
  const partial = [];
  const closes = [];
  const states = [];
  const calls = { writer: 0, writerDone: 0, save: 0, review: 0, renew: 0 };
  let content = "original manuscript";
  let sessionClosed = false;
  let reviewFailure = failReview;
  let saveFailure = failSave;
  const newSession = () => {
    sessionClosed = false;
    return {
      operationId: "offline-operation",
      async assertCurrent() { assert.equal(sessionClosed, false, "closed session cannot write"); },
      async renew() { calls.renew++; },
      get: key => values.get(key),
      getStepOutput: key => steps.get(key)?.status === "done" ? steps.get(key).output : undefined,
      async put(key, value) { values.set(key, value); },
      async bindPrepared() {},
      async checkpoint(value) { partial.push(value); },
      async saveContent(input) {
        calls.save++;
        if (saveFailure) { saveFailure = false; throw new Error("offline transient save failure"); }
        assert.equal(input.generationState, "drafted");
        content = input.content;
      },
      async close(result = {}) { sessionClosed = true; closes.push(result); },
      async runStep(key, action, options = {}) {
        if (steps.get(key)?.status === "done") return steps.get(key).output;
        if (steps.get(key)?.status === "unknown") throw Object.assign(new Error("unknown output"), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
        steps.set(key, { status: "running" });
        try {
          const output = await action();
          steps.set(key, { status: "done", output });
          return output;
        } catch (error) {
          steps.set(key, { status: options.external ? "unknown" : "failed" });
          throw error;
        }
      },
    };
  };
  const orchestrator = new ChapterStreamGenerationOrchestrator({
    validateRequest: options => options,
    ensureNovelCharacters: async () => {},
    preparationService: { prepare: async () => ({ status: "ready" }) },
    assembler: { assemble: async () => ({ novel: { title: "Novel" }, chapter: { id: "c", title: "Chapter", order: 1, content }, contextPackage: {} }) },
    readinessService: { assertReady() {} },
    agentRuntime: { createChapterGenRun: async () => "offline-trace" },
    chapterWritingGraph: { createChapterStream: async () => {
      calls.writer++;
      return {
        stream: (async function* () {
          yield { content: "半" };
          yield { content: "章" };
          if (disconnect) throw new Error("offline stream disconnected");
        })(),
        onDone: async () => {
          calls.writerDone++;
          if (outputLimit) throw Object.assign(new Error("output exhausted"), { code: "LLM_OUTPUT_LIMIT" });
          return { finalContent: "complete manuscript", artifactsAlreadySynced: false };
        },
      };
    } },
    contentFinalizationService: {
      markChapterStatus: async (_id, state) => { states.push(state); },
      finalizeChapterContent: async input => {
        calls.review++;
        if (reviewFailure) { reviewFailure = false; throw new Error("offline downstream review failure"); }
        return { finalContent: input.content, runtimePackage: { audit: { hasBlockingIssues: false } } };
      },
    },
  });
  return {
    calls, partial, closes, steps, states,
    content: () => content,
    open: () => runner.executeProductionStream(newSession(), () => orchestrator.createChapterStream("n", "c")),
  };
}

async function consume(stream) {
  let text = "";
  for await (const chunk of stream) text += chunk.content;
  return text;
}
const helpers = { writeFrame() {} };

test("disconnected stream retains delivered partial text without saving or finalizing a complete draft", async () => {
  const f = fixture({ disconnect: true });
  const result = await f.open();
  await assert.rejects(consume(result.stream), /offline stream disconnected/);
  assert.deepEqual(f.partial, ["半", "半章"]);
  assert.equal(f.content(), "original manuscript");
  assert.equal(f.calls.save, 0); assert.equal(f.calls.writerDone, 0); assert.equal(f.calls.review, 0);
  await assert.rejects(result.onDone("半章", helpers), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  assert.equal(f.closes.some(close => close.completed), false);
});

test("early iterator return refuses onDone and leaves the retained partial incomplete", async () => {
  const f = fixture(); const result = await f.open();
  const iterator = result.stream[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.content, "半");
  await iterator.return();
  await assert.rejects(result.onDone("半", helpers), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  assert.deepEqual(f.partial, ["半"]); assert.equal(f.calls.save, 0); assert.equal(f.calls.review, 0);
  assert.equal(f.closes.some(close => close.completed), false);
});

test("normalized output persisted before interruption resumes from its step result without another writer", async () => {
  const f = fixture({ savedNormalize: { finalContent: "previously normalized complete manuscript" } });
  const result = await f.open();
  const text = await consume(result.stream);
  assert.equal(text, "previously normalized complete manuscript");
  assert.equal((await result.onDone(text, helpers)).fullContent, text);
  assert.equal(f.calls.writer, 0); assert.equal(f.calls.writerDone, 0); assert.equal(f.calls.save, 1); assert.equal(f.calls.review, 1);
  assert.equal(f.content(), text);
  assert.equal(f.closes.at(-1).completed, true);
});

test("onDone review failure resumes the saved normalize output and never regenerates or resaves", async () => {
  const f = fixture({ failReview: true });
  let result = await f.open();
  let text = await consume(result.stream);
  await assert.rejects(result.onDone(text, helpers), /offline downstream review failure/);
  assert.equal(f.content(), "complete manuscript");
  assert.equal(f.steps.get("stream.normalize").status, "done");
  result = await f.open(); text = await consume(result.stream);
  assert.equal((await result.onDone(text, helpers)).fullContent, "complete manuscript");
  assert.equal(f.calls.writer, 1); assert.equal(f.calls.writerDone, 1); assert.equal(f.calls.save, 1); assert.equal(f.calls.review, 2);
  assert.deepEqual(f.states, ["generating"]);
});

test("provider output exhaustion cannot turn streamed partial text into a completed draft", async () => {
  const f = fixture({ outputLimit: true }); const result = await f.open();
  const text = await consume(result.stream);
  await assert.rejects(result.onDone(text, helpers), { code: "LLM_OUTPUT_LIMIT" });
  assert.equal(f.content(), "original manuscript");
  assert.equal(f.calls.save, 0); assert.equal(f.calls.review, 0);
  assert.notEqual(f.steps.get("stream.normalize").status, "done");
  assert.equal(f.closes.some(close => close.completed), false);
});

test("transient draft persistence failure resumes only save without repeating writer or normalization", async () => {
  const f = fixture({ failSave: true });
  let result = await f.open();
  let text = await consume(result.stream);
  await assert.rejects(result.onDone(text, helpers), /offline transient save failure/);
  assert.equal(f.content(), "original manuscript");
  assert.equal(f.steps.get("stream.normalize").status, "done");
  assert.equal(f.steps.get("stream.save").status, "failed");
  assert.equal(f.calls.review, 0);
  result = await f.open(); text = await consume(result.stream);
  assert.equal((await result.onDone(text, helpers)).fullContent, "complete manuscript");
  assert.equal(f.content(), "complete manuscript");
  assert.equal(f.calls.writer, 1); assert.equal(f.calls.writerDone, 1); assert.equal(f.calls.save, 2); assert.equal(f.calls.review, 1);
  assert.equal(f.steps.get("stream.save").status, "done");
});

test("created but unconsumed stream releases ownership and stops renewing", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const f = fixture(); const result = await f.open();
  t.mock.timers.tick(30 * 60 * 1000);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(f.closes.length > 0, "abandoned stream must have a bounded idle lifetime");
  assert.equal(f.closes.at(-1).completed, false);
  const renewals = f.calls.renew;
  t.mock.timers.tick(30 * 60 * 1000);
  await Promise.resolve();
  assert.equal(f.calls.renew, renewals);
  await assert.rejects(result.onDone("", helpers), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
});
