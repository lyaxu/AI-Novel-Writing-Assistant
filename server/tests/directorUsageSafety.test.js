const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");
const fixture = require("./fixtures/directorUsage/fiveChapterPause.json");
const circuit = loadRuntimeSource("../director/runtime/DirectorCircuitBreakerService.ts", {});

function harness({ rows = fixture.rows, stepStatus = "running", usageError } = {}) {
  const calls = [];
  const prisma = {
    directorLlmUsageRecord: { findMany: async (query) => {
      calls.push(["usage", query]);
      if (usageError) throw usageError;
      return rows.map((row) => ({ ...row, recordedAt: new Date(row.recordedAt) }));
    } },
    chapter: { findMany: async () => fixture.chapters },
    volumeChapterPlan: { findMany: async () => fixture.plans },
    directorStepRun: { findUnique: async () => {
      calls.push(["step"]);
      return stepStatus === null ? null : { taskId: "fixture-task", status: stepStatus };
    } },
  };
  const usageModule = loadRuntimeSource("../director/runtime/DirectorUsageTelemetryQueryService.ts", {
    "../../../../db/prisma": { prisma },
  });
  const runtime = loadRuntimeSource("../director/automation/novelDirectorAutoExecutionCircuitBreakerRuntime.ts", {
    "./novelDirectorAutoExecution": {},
    "./novelDirectorAutoExecutionCheckpointRuntime": {},
    "../runtime/DirectorCircuitBreakerService": circuit,
    "../runtime/DirectorAutomationLedgerEventService": {},
    "../runtime/DirectorUsageTelemetryQueryService": usageModule,
    "../issues": {}, "../issues/DirectorIssueTaskContext": {},
    "@ai-novel/shared/types/directorIssue": {},
    "../../../../db/prisma": { prisma },
  });
  return {
    calls, runtime,
    check: (autoExecution = {}) => runtime.resolveUsageCircuitBreaker({
      taskId: "fixture-task", novelId: "fixture-novel",
      autoExecution: { nextChapterOrder: 6, nextChapterId: null, ...autoExecution },
    }),
  };
}

test("real fifth-chapter pause replay does not block unmaterialized sixth chapter on completed historical maximum", async () => {
  const h = harness();
  assert.equal(await h.check(), null);
  assert.equal(await h.check({ usageBudget: { chapterTokenLimit: 100000 } }), null);
  assert.equal(h.calls.filter(([name]) => name === "usage").length, 2);
});

test("chapter budget checks the current chapter even when a completed chapter consumed more", async () => {
  const h = harness();
  assert.equal(await h.check({ nextChapterOrder: 5, usageBudget: { chapterTokenLimit: 450000 } }), null);
  const stop = await h.check({ nextChapterOrder: 5, usageBudget: { chapterTokenLimit: 400000 } });
  assert.equal(stop.status, "open");
  assert.equal(stop.chapterId, "chapter-5");
  assert.equal(stop.chapterOrder, 5);
  assert.equal(stop.lastUsageRecordId, "usage-26");
});

test("explicit task and chapter budgets keep all-time consumption across a recovery reset", async () => {
  const h = harness();
  const closed = { status: "closed", resetAt: "2026-10-17T12:00:00.000Z" };
  const task = await h.check({ circuitBreaker: closed, usageBudget: { taskTokenLimit: 1000000 } });
  assert.equal(task.status, "open");
  assert.match(task.message, /1008277/);
  const chapter = await h.check({ circuitBreaker: closed, nextChapterOrder: 5, usageBudget: { chapterTokenLimit: 400000 } });
  assert.equal(chapter.status, "open");
  assert.equal(chapter.chapterOrder, 5);
  assert.ok(h.calls.filter(([name]) => name === "usage").every(([, query]) => query.where.recordedAt === undefined));
});

function repeatedRows({ metadata = { chapterId: "chapter-5" }, count = 6 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    ...fixture.rows[25], id: `repeat-${index}`, totalTokens: 100,
    recordedAt: `2026-10-16T08:00:0${index}.000Z`,
    stepIdempotencyKey: "repeat-step", nodeKey: "writer_draft", promptAssetKey: "novel.chapter.writer",
    metadataJson: JSON.stringify(metadata),
  }));
}

test("six same-step attempts without successful completion stop only the attributed current chapter", async () => {
  const h = harness({ rows: repeatedRows() });
  const stop = await h.check({ nextChapterOrder: 5 });
  assert.equal(stop.status, "open");
  assert.equal(stop.chapterOrder, 5);
  assert.match(stop.message, /6/);
  assert.equal(await h.check({ nextChapterOrder: 6 }), null);
});

test("progress, completed steps, missing step evidence and unknown attribution do not guess a stalled loop", async () => {
  assert.equal(await harness({ rows: repeatedRows({ count: 5 }) }).check({ nextChapterOrder: 5 }), null);
  assert.equal(await harness({ rows: repeatedRows(), stepStatus: "succeeded" }).check({ nextChapterOrder: 5 }), null);
  assert.equal(await harness({ rows: repeatedRows(), stepStatus: null }).check({ nextChapterOrder: 5 }), null);
  assert.equal(await harness({ rows: repeatedRows({ metadata: {} }) }).check({ nextChapterOrder: 5 }), null);
  const progressRows = repeatedRows();
  progressRows[3] = { ...progressRows[3], nodeKey: "chapter_acceptance" };
  assert.equal(await harness({ rows: progressRows }).check({ nextChapterOrder: 5 }), null);
});

test("recovery boundary limits repeat attempts but does not erase their recorded usage", async () => {
  const h = harness({ rows: repeatedRows() });
  assert.equal(await h.check({ nextChapterOrder: 5,
    circuitBreaker: { status: "closed", resetAt: "2026-10-16T08:00:03.000Z" },
  }), null);
  const stop = await h.check({ nextChapterOrder: 5,
    circuitBreaker: { status: "closed", resetAt: "2026-10-16T08:00:03.000Z" },
    usageBudget: { taskTokenLimit: 500 },
  });
  assert.equal(stop.status, "open");
});

test("current chapter output limit remains a terminal signal and completed historical limit does not block the next", async () => {
  const h = harness({ rows: repeatedRows({ count: 1, metadata: { chapterId: "chapter-5", finishReason: "output_limit" } }) });
  const stop = await h.check({ nextChapterOrder: 5 });
  assert.equal(stop.status, "open");
  assert.match(stop.message, /输出额度/);
  assert.equal(await h.check({ nextChapterOrder: 6 }), null);
});

test("polling preserves an open safety pause without querying usage or clearing its timestamp", async () => {
  const h = harness();
  const previous = { status: "open", reason: "usage_anomaly", openedAt: "2026-10-16T07:35:16.733Z" };
  assert.equal(await h.check({ circuitBreaker: previous }), previous);
  assert.equal(h.calls.length, 0);
});

test("explicit budgets fail closed when usage cannot be read", async () => {
  const error = new Error("usage unavailable");
  const h = harness({ usageError: error });
  await assert.rejects(h.check({ usageBudget: { taskTokenLimit: 1000000 } }), error);
  assert.equal(await h.check(), null);
});

test("high input usage produces an idempotent warning instead of an automatic stop", () => {
  const first = circuit.recordUsageAnomalySignal({ totalTokens: 250000, usageRecordId: "large-1" });
  assert.equal(first.status, "closed");
  assert.equal(circuit.recordUsageAnomalySignal({ previous: first, totalTokens: 250000, usageRecordId: "large-1" }), first);
  assert.equal(circuit.recordUsageAnomalySignal({ previous: first, totalTokens: 250000, usageRecordId: "large-2" }).status, "closed");
});

function resumeHarness({ explicit = true, reason = "usage_anomaly", usageBudget } = {}) {
  const events = [];
  let stopChecks = 0;
  let pending = true;
  const autoExecution = { pipelineJobId: "original-job", pipelineStatus: "running", nextChapterOrder: 6,
    circuitBreaker: { status: "open", reason, lastUsageRecordId: "usage-19" }, usageBudget };
  const h = harness();
  const deps = { novelService: {
    getPipelineJobById: async (id) => { events.push(["read-job", id]); return { id, pendingManualRecovery: pending, status: "running" }; },
    resumePipelineJob: async (id, scope) => { events.push(["resume-job", id, scope]); pending = false; },
  } };
  const { NovelDirectorAutoExecutionRuntime } = loadRuntimeSource("../director/automation/novelDirectorAutoExecutionRuntime.ts", {
    "@ai-novel/shared/types/novelDirector": { isFullBookAutopilotRunMode: () => false },
    "./novelDirectorAutoExecution": {},
    "./novelDirectorAutoExecutionCheckpointRuntime": { syncAutoExecutionTaskState: async (_deps, input) => events.push(["sync", input]) },
    "./novelDirectorAutoExecutionFailure": {},
    "./novelDirectorAutoExecutionCircuitBreakerRuntime": { ...h.runtime,
      stopAutoExecutionForCircuitBreaker: async (_deps, input) => events.push(["stop", input]),
    },
    "./novelDirectorAutoExecutionRuntimeUtils": {},
    "./novelDirectorAutoExecutionRuntimePreparation": {
      readAutoExecutionIdentity: async () => ({ seedPayloadJson: JSON.stringify({ autoExecution }) }),
      shouldStopAutoExecution: async () => ++stopChecks >= 3,
      restoreAutoExecutionBookRequest: (request) => request,
      prepareRequestedAutoExecution: async () => ({ range: { startOrder: 4, endOrder: 10 }, autoExecution, pipelineJobId: "original-job" }),
    },
    "../../../../db/prisma": {},
    "../../production/reliability": { ChapterProductionError: class extends Error {} },
  });
  return { events, run: () => new NovelDirectorAutoExecutionRuntime(deps).runFromReady({
    taskId: "fixture-task", novelId: "fixture-novel", request: {},
    existingPipelineJobId: "original-job", resumePendingManualRecovery: explicit,
  }) };
}

test("explicit usage resume clears the old signal and resumes only the original task and job", async () => {
  const h = resumeHarness();
  await h.run();
  assert.deepEqual(h.events.find(([name]) => name === "resume-job"), ["resume-job", "original-job", { novelId: "fixture-novel", directorTaskId: "fixture-task" }]);
  const sync = h.events.find(([name]) => name === "sync")[1];
  assert.equal(sync.autoExecution.circuitBreaker.status, "closed");
  assert.ok(sync.autoExecution.circuitBreaker.resetAt);
  assert.equal(sync.autoExecution.pipelineJobId, "original-job");
  assert.equal(h.events.some(([name]) => name === "stop"), false);
});

test("ordinary read and explicit resume of another safety reason preserve the pause", async () => {
  for (const options of [{ explicit: false }, { reason: "protected_user_content" }, { reason: "unrecoverable_data_risk" }]) {
    const h = resumeHarness(options);
    await h.run();
    assert.equal(h.events.some(([name]) => name === "resume-job"), false);
    assert.equal(h.events.find(([name]) => name === "stop")[1].autoExecution.circuitBreaker.status, "open");
  }
});

test("explicit resume cannot clear a still-exceeded task budget", async () => {
  const h = resumeHarness({ usageBudget: { taskTokenLimit: 1000000 } });
  await h.run();
  assert.equal(h.events.some(([name]) => name === "resume-job"), false);
  assert.match(h.events.find(([name]) => name === "stop")[1].circuitBreaker.message, /1008277/);
});
