const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");

// ---------------------------------------------------------------------------
// Pure policy + runner
// ---------------------------------------------------------------------------
const reliabilityStub = {
  ChapterProductionError: class ChapterProductionError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
  isDefinitiveProductionFailure: () => false,
};
const emptyContentStub = {
  isChapterEmptyContentError: error => Boolean(error && error.code === "CHAPTER_EMPTY_CONTENT"),
};
const retryModule = loadRuntimeSource("writerTransportRetry.ts", {
  "../production/reliability": reliabilityStub,
  "./chapterEmptyContentError": emptyContentStub,
});
const {
  isTransientWriterTransportFailure,
  planWriterTransportRetry,
  runWriterAttemptWithTransportRetry,
} = retryModule;

test("transient transport classification accepts connection/terminated errors only", () => {
  assert.equal(isTransientWriterTransportFailure(new TypeError("terminated")), true);
  assert.equal(isTransientWriterTransportFailure(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), true);
  assert.equal(isTransientWriterTransportFailure(Object.assign(new Error("wrapped"), {
    name: "StructuredOutputError", category: "transport_error",
  })), true);
  assert.equal(isTransientWriterTransportFailure(Object.assign(new Error("aborted"), { name: "AbortError" })), false);
  assert.equal(isTransientWriterTransportFailure(Object.assign(new Error("bad json"), {
    name: "StructuredOutputError", category: "malformed_json",
  })), false);
  assert.equal(isTransientWriterTransportFailure(Object.assign(new Error("limits"), { code: "LLM_OUTPUT_LIMIT" })), false);
  assert.equal(isTransientWriterTransportFailure(new Error("review incomplete")), false);
});

test("automatic retry is only for transport failures with zero output unless the unknown was acknowledged", () => {
  const transport = new TypeError("terminated");
  assert.deepEqual(planWriterTransportRetry({ error: transport, producedText: "" }), {
    retry: true, reason: "transient_transport_without_output",
  });
  assert.deepEqual(planWriterTransportRetry({ error: transport, producedText: "部分正文" }), {
    retry: false, reason: "partial_output_retained",
  });
  assert.deepEqual(planWriterTransportRetry({
    error: transport, producedText: "部分正文", acknowledgedUnknownRecovery: true,
  }), { retry: true, reason: "transient_transport_after_acknowledged_unknown" });
  assert.deepEqual(planWriterTransportRetry({ error: transport, producedText: "x", completed: true }), {
    retry: false, reason: "writer_output_completed",
  });
  assert.deepEqual(planWriterTransportRetry({ error: transport, producedText: "", retried: true }), {
    retry: false, reason: "automatic_retry_already_used",
  });
  assert.deepEqual(planWriterTransportRetry({ error: new Error("schema mismatch"), producedText: "" }), {
    retry: false, reason: "not_transient_transport",
  });
});

test("runner retries exactly once and keeps second-failure evidence", async () => {
  const calls = [];
  const first = await runWriterAttemptWithTransportRetry({
    runAttempt: async attempt => {
      calls.push(attempt);
      if (attempt === 0) return { ok: false, error: new TypeError("terminated"), producedText: "" };
      return { ok: true, value: "完整正文" };
    },
    onRetry: info => { calls.push(["retry", info.decision.reason]); },
  });
  assert.equal(first.value, "完整正文");
  assert.equal(first.transportRetries, 1);
  assert.deepEqual(calls, [0, ["retry", "transient_transport_without_output"], 1]);

  const second = [];
  await assert.rejects(runWriterAttemptWithTransportRetry({
    runAttempt: async attempt => {
      second.push(attempt);
      return { ok: false, error: new TypeError(attempt === 0 ? "terminated" : "terminated again"), producedText: "" };
    },
    onRetry: () => { second.push("retry"); },
  }), /terminated again/);
  assert.deepEqual(second, [0, "retry", 1]);
});

test("runner never retries partial output without an acknowledged unknown recovery", async () => {
  let attempts = 0;
  await assert.rejects(runWriterAttemptWithTransportRetry({
    runAttempt: async () => {
      attempts += 1;
      return { ok: false, error: new TypeError("terminated"), producedText: "部分正文" };
    },
  }), /terminated/);
  assert.equal(attempts, 1);
});

// ---------------------------------------------------------------------------
// Session acknowledgement marker + evidence archive
// ---------------------------------------------------------------------------
function sessionFixture() {
  const contracts = loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": crypto, "./types": {} });
  const reliability = loadRuntimeSource("../production/reliability/session.ts", {
    "node:crypto": crypto,
    "./types": loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": crypto }),
  });
  void contracts;
  let chapter = {
    id: "chapter-1", novelId: "novel-1", title: "第一章", order: 1, content: "",
    taskSheet: "章节目标", sceneCards: null, expectation: null, targetWordCount: 2800,
  };
  let row = null;
  const archives = [];
  let tail = Promise.resolve();
  const repository = {
    transaction(fn) {
      const result = tail.then(async () => fn({
        readChapter: async () => ({ ...chapter }),
        readJournal: async () => (row ? { ...row } : null),
        writeJournal: async (_n, _c, expected, next) => {
          assert.equal(row?.metadataJson ?? null, expected);
          row = { metadataJson: next, status: JSON.parse(next).status };
        },
        archiveJournal: async (_n, _c, record) => { archives.push(structuredClone(record)); },
        writeContent: async (_n, _c, _expected, data) => { chapter = { ...chapter, ...data }; },
        writeState: async (_n, _c, _expected, data) => { chapter = { ...chapter, ...data }; },
      }));
      tail = result.catch(() => undefined);
      return result;
    },
  };
  const { createChapterProductionJournal } = reliability;
  return { journal: () => JSON.parse(row.metadataJson), archives, createChapterProductionJournal: createChapterProductionJournal, repository };
}

test("acknowledgeUnknown leaves a durable recovery marker and archived evidence", async () => {
  const f = sessionFixture();
  const journal = f.createChapterProductionJournal({ repository: f.repository, now: () => 1000 });
  const session = await journal.open({
    novelId: "novel-1", chapterId: "chapter-1", request: { entry: "pipeline", workflowTaskId: "task-1" },
  });
  await session.checkpoint("保留的部分正文");
  await assert.rejects(session.runStep("pipeline.draft", async () => {
    throw new TypeError("terminated");
  }, { external: true }), /不能自动重新发送/);
  await session.close({ error: new Error("terminated") });
  assert.equal(f.journal().steps["pipeline.draft"].status, "unknown");

  const before = f.archives.length;
  await journal.acknowledgeUnknown({
    novelId: "novel-1", chapterId: "chapter-1", operationId: f.journal().operationId,
  });
  assert.equal(f.archives.length, before + 1);
  assert.equal(f.archives.at(-1).recoveryDecision.kind, "acknowledge_unknown");
  assert.equal(f.journal().recoveryDecision.kind, "acknowledge_unknown");
  assert.equal(f.journal().partialText, "保留的部分正文");

  const resumed = await journal.open({
    novelId: "novel-1", chapterId: "chapter-1", request: { entry: "pipeline", workflowTaskId: "task-1" },
  });
  assert.equal(resumed.getRecoveryDecision().kind, "acknowledge_unknown");
  const archived = await resumed.archiveEvidence("transport-retry");
  assert.match(archived.archiveId, /transport-retry/);
  assert.equal(f.archives.at(-1).partialText, "保留的部分正文");
  assert.equal(f.archives.at(-1).recoveryDecision.kind, "acknowledge_unknown");
});

// ---------------------------------------------------------------------------
// Orchestrator C path
// ---------------------------------------------------------------------------
function orchestratorFixture({ acknowledged = false } = {}) {
  const puts = [];
  const archives = [];
  const fakeSession = {
    getRecoveryDecision: () => acknowledged
      ? { kind: "acknowledge_unknown", originalOperationId: "op", acknowledgedAt: 5000, affectedSteps: ["pipeline.draft"] }
      : undefined,
    get: () => undefined,
    put: async (key, value) => { puts.push([key, value]); },
    archiveEvidence: async label => { archives.push(label); return { archiveId: `archive:${label}` }; },
  };
  const context = {
    currentProductionSession: () => fakeSession,
    productionStep: async (_key, fn) => fn(),
    captureProductionStream: async function* (stream) {
      for await (const chunk of stream) yield chunk;
    },
  };
  const emptyContent = {
    assertChapterContentNotEmpty: (value) => {
      if (!value || !value.trim()) throw Object.assign(new Error("empty chapter"), { code: "CHAPTER_EMPTY_CONTENT" });
      return value;
    },
    isChapterEmptyContentError: error => Boolean(error && error.code === "CHAPTER_EMPTY_CONTENT"),
  };
  const retry = loadRuntimeSource("writerTransportRetry.ts", {
    "../production/reliability": reliabilityStub,
    "./chapterEmptyContentError": emptyContent,
  });
  const { ChapterStreamGenerationOrchestrator } = loadRuntimeSource("ChapterStreamGenerationOrchestrator.ts", {
    "../novelP0Utils": { toText: content => (typeof content === "string" ? content : "") },
    "../production/reliability": context,
    "../../planner/plannerPersistence": { buildChapterExecutionContractHash: () => "hash" },
    "./chapterEmptyContentError": emptyContent,
    "./writerTransportRetry": retry,
  });
  const behaviors = [];
  const graphCalls = [];
  const graph = {
    createChapterStream: async () => {
      const behavior = behaviors[graphCalls.length];
      graphCalls.push(graphCalls.length);
      return behavior();
    },
  };
  const orchestrator = new ChapterStreamGenerationOrchestrator({
    assembler: {},
    preparationService: {},
    chapterWritingGraph: graph,
    readinessService: {},
    contentFinalizationService: {},
    agentRuntime: {},
    validateRequest: value => value,
    ensureNovelCharacters: async () => {},
  });
  const input = {
    novelId: "novel-1",
    chapterId: "chapter-1",
    request: {},
    assembled: { novel: { title: "书" }, chapter: { id: "chapter-1", order: 1, title: "第一章" }, contextPackage: {} },
  };
  return { behaviors, graphCalls, puts, archives, orchestrator, input };
}

function partialThenTerminated(text = "部分正文") {
  return () => ({
    stream: (async function* () {
      yield { content: text };
      throw new TypeError("terminated");
    })(),
    onDone: async () => undefined,
  });
}

function zeroThenTerminated() {
  return () => ({
    stream: (async function* () {
      throw new TypeError("terminated");
    })(),
    onDone: async () => undefined,
  });
}

function complete(text = "完整正文") {
  return () => ({
    stream: (async function* () {
      yield { content: text };
    })(),
    onDone: async () => ({ finalContent: text }),
  });
}

test("zero-output transport interruption retries once and succeeds without acknowledgement", async () => {
  const f = orchestratorFixture();
  f.behaviors.push(zeroThenTerminated(), complete());
  const result = await f.orchestrator.generateDraftFromWriter(f.input);
  assert.equal(result.content, "完整正文");
  assert.equal(f.graphCalls.length, 2);
  assert.equal(f.archives.length, 0);
  const retry = f.puts.filter(([key]) => key === "writer.transportRetry").at(-1)[1];
  assert.equal(retry.reason, "transient_transport_without_output");
  assert.equal(retry.outcome, "completed");
});

test("partial transport interruption does not retry without an acknowledged unknown", async () => {
  const f = orchestratorFixture();
  f.behaviors.push(partialThenTerminated(), complete());
  await assert.rejects(f.orchestrator.generateDraftFromWriter(f.input), /terminated/);
  assert.equal(f.graphCalls.length, 1);
  assert.equal(f.archives.length, 0);
});

test("an acknowledged unknown allows one retry-from-scratch and archives the retained partial", async () => {
  const f = orchestratorFixture({ acknowledged: true });
  f.behaviors.push(partialThenTerminated("旧的部分正文"), complete("重试后的完整正文"));
  const result = await f.orchestrator.generateDraftFromWriter(f.input);
  assert.equal(result.content, "重试后的完整正文");
  assert.equal(f.graphCalls.length, 2);
  assert.deepEqual(f.archives, ["transport-retry"]);
  const retry = f.puts.filter(([key]) => key === "writer.transportRetry").at(-1)[1];
  assert.equal(retry.reason, "transient_transport_after_acknowledged_unknown");
  assert.equal(retry.archiveId, "archive:transport-retry");
  assert.equal(retry.outcome, "completed");
  const used = f.puts.find(([key]) => key === "writer.transportRetryAcknowledged");
  assert.equal(used[1].acknowledgedAt, 5000);
});

test("a second transport failure stops after the single retry and preserves both evidence records", async () => {
  const f = orchestratorFixture({ acknowledged: true });
  f.behaviors.push(partialThenTerminated("第一次部分正文"), partialThenTerminated("第二次部分正文"));
  await assert.rejects(f.orchestrator.generateDraftFromWriter(f.input), /terminated/);
  assert.equal(f.graphCalls.length, 2);
  assert.deepEqual(f.archives, ["transport-retry"]);
  const retry = f.puts.filter(([key]) => key === "writer.transportRetry").at(-1)[1];
  assert.equal(retry.outcome, "failed");
  assert.equal(retry.archiveId, "archive:transport-retry");
});
