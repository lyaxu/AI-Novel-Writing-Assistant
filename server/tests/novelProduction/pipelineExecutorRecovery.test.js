const test = require("node:test");
const assert = require("node:assert/strict");

// Do not initialize SQLite or allow an unstubbed model operation in this suite.
const blockedPrisma = new Proxy({}, { get(target, model) {
  if (!(model in target)) target[model] = new Proxy({}, { get(methods, method) {
    if (!(method in methods)) methods[method] = () => { throw new Error(`Unexpected database call: ${String(model)}.${String(method)}`); };
    return methods[method];
  } });
  return target[model];
} });
require.cache[require.resolve("../../dist/db/prisma.js")] = { exports: { prisma: blockedPrisma } };

const { prisma } = require("../../dist/db/prisma.js");
const { novelEventBus } = require("../../dist/events/index.js");
const {
  ChapterContentPersistenceError,
} = require("../../dist/services/novel/runtime/lifecycle/ChapterLifecycleService.js");
const {
  NovelPipelineExecutor,
} = require("../../dist/services/novel/production/NovelPipelineExecutor.js");
const { ChapterRouteWindowService } = require("../../dist/services/novel/planning/ChapterRouteWindowService.js");
const { ChapterExecutionPreparationService } = require("../../dist/services/novel/production/preparation/ChapterExecutionPreparationService.js");
const { PlanningRepairRecoveryService } = require("../../dist/services/novel/director/recovery/planningRepair/PlanningRepairRecoveryService.js");
const directorIssues = require("../../dist/services/novel/director/issues/DirectorIssueTaskContext.js");
const pipelineGovernance = require("../../dist/services/novel/production/issueGovernance/PipelineIssueGovernance.js");

function createExecutorHarness({
  used = 0,
  usedError = null,
  executionOwner = null,
  currentExecutionOwner = executionOwner,
  cancelAfterChapter = false,
  executeOptions = options,
  estimatedChapterCount = 1,
  chapterCount = 1,
  chapterStartOrder = 1,
  savedControlPolicy = {
    kickoffMode: "director_start",
    advanceMode: "full_book_autopilot",
    reviewCheckpoints: ["chapter_batch"],
  },
  runChapter,
}) {
  const originals = {
    generationFindUnique: prisma.generationJob.findUnique,
    generationUpdate: prisma.generationJob.update,
    generationUpdateMany: prisma.generationJob.updateMany,
    novelFindUnique: prisma.novel.findUnique,
    chapterFindMany: prisma.chapter.findMany,
    emit: novelEventBus.emit,
    ensureRouteWindow: ChapterRouteWindowService.prototype.ensureRouteWindow,
  };
  const updates = [];
  const claims = [];
  const routeRequests = [];
  let chapterCalls = 0;
  let receivedMaxRetries = null;
  const jobState = {
    status: "running",
    pendingManualRecovery: false,
    cancelRequestedAt: null,
    executionOwner: currentExecutionOwner,
    executionLeaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };

  prisma.generationJob.findUnique = async (input) => {
    if (input.select?.startedAt) {
      return {
        startedAt: null,
        completedCount: 0,
        totalCount: 1,
        retryCount: used,
        payload: JSON.stringify({
          provider: "deepseek",
          model: "deepseek-chat",
          maxRetries: 1,
          runMode: "fast",
          autoReview: true,
          autoRepair: true,
          skipCompleted: true,
          qualityThreshold: 75,
          repairMode: "light_repair",
          controlPolicy: savedControlPolicy,
        }),
      };
    }
    if (input.select?.status) {
      return { ...jobState };
    }
    throw new Error(`Unexpected generationJob lookup: ${JSON.stringify(input)}`);
  };
  prisma.generationJob.update = async (input) => {
    updates.push(input);
    Object.assign(jobState, input.data);
    return input;
  };
  prisma.generationJob.updateMany = async (input) => {
    if (input.where.executionOwner) {
      assert.ok(input.where.executionLeaseExpiresAt?.gt instanceof Date);
    }
    if (input.where.executionOwner && input.where.executionOwner !== currentExecutionOwner) {
      return { count: 0 };
    }
    if (input.where.status?.in && !input.where.status.in.includes(jobState.status)) {
      return { count: 0 };
    }
    if (input.where.pendingManualRecovery !== undefined
      && input.where.pendingManualRecovery !== jobState.pendingManualRecovery) {
      return { count: 0 };
    }
    if (input.where.cancelRequestedAt === null && jobState.cancelRequestedAt !== null) {
      return { count: 0 };
    }
    if (input.where.OR) {
      const cancellationMatches = input.where.OR.some((condition) => (
        condition.status === jobState.status
        || (condition.cancelRequestedAt?.not === null && jobState.cancelRequestedAt !== null)
      ));
      if (!cancellationMatches) return { count: 0 };
    }
    updates.push(input);
    Object.assign(jobState, input.data);
    return { count: 1 };
  };
  prisma.novel.findUnique = async () => ({
    id: "novel-1",
    title: "测试小说",
    estimatedChapterCount,
  });
  prisma.chapter.findMany = async () => Array.from({ length: chapterCount }, (_, index) => ({
    id: `chapter-${index + 1}`,
    order: index + chapterStartOrder,
    title: `第${index + 1}章`,
    content: "已保存草稿",
  }));
  ChapterRouteWindowService.prototype.ensureRouteWindow = async (_novelId, order) => { routeRequests.push(order); };
  novelEventBus.emit = async () => undefined;

  const attempts = {
    async used() {
      if (usedError) throw usedError;
      return used;
    },
    async claim(_jobId, _chapterId, kind) {
      claims.push(kind);
      return claims.length === 1;
    },
  };
  const executor = new NovelPipelineExecutor({
    async runPipelineChapter(_novelId, _chapterId, options, hooks) {
      chapterCalls += 1;
      receivedMaxRetries = options.maxRetries;
      const result = await runChapter({ hooks, chapterCalls, runtimeOptions: options });
      if (cancelAfterChapter) {
        jobState.status = "cancelled";
        jobState.cancelRequestedAt = new Date();
      }
      return result;
    },
  }, attempts);

  return {
    execute: () => executor.execute("job-1", "novel-1", executeOptions, executionOwner || undefined),
    updates,
    claims,
    routeRequests,
    get chapterCalls() { return chapterCalls; },
    get receivedMaxRetries() { return receivedMaxRetries; },
    get jobState() { return jobState; },
    restore() {
      prisma.generationJob.findUnique = originals.generationFindUnique;
      prisma.generationJob.update = originals.generationUpdate;
      prisma.generationJob.updateMany = originals.generationUpdateMany;
      prisma.novel.findUnique = originals.novelFindUnique;
      prisma.chapter.findMany = originals.chapterFindMany;
      novelEventBus.emit = originals.emit;
      ChapterRouteWindowService.prototype.ensureRouteWindow = originals.ensureRouteWindow;
    },
  };
}

const options = {
  startOrder: 1,
  endOrder: 1,
  provider: "deepseek",
  model: "deepseek-chat",
  temperature: 0.7,
  maxRetries: 1,
  runMode: "fast",
  autoReview: true,
  autoRepair: true,
  skipCompleted: true,
  qualityThreshold: 75,
  repairMode: "light_repair",
  controlPolicy: { advanceMode: "full_book_autopilot" },
};

for (const code of ["PLANNING_REPAIR_CONFLICT", "PLANNING_REPAIR_CONFIRMATION_REQUIRED"]) {
  for (const pauseOutcome of ["paused", "rejected", "cas_conflict"]) {
    test(`typed ${code} closes the actual executor without retry when pause is ${pauseOutcome}`, async () => {
      const original = {
        findTask: prisma.novelWorkflowTask.findUnique,
        capture: PlanningRepairRecoveryService.prototype.capturePipelineFailureBoundary,
        pause: PlanningRepairRecoveryService.prototype.pauseAfterPipelineFailure,
        loadIssues: directorIssues.loadDirectorIssueTaskContext,
        report: pipelineGovernance.reportPipelineIssue,
      };
      const capture = { id: "task-1", attemptCount: 3, seedPayloadJson: "captured-state" };
      const error = Object.assign(new Error("planning ownership conflict"), { code });
      const pauses = []; const captures = []; let governanceCalls = 0;
      prisma.novelWorkflowTask.findUnique = async ({ where }) => {
        assert.equal(where.id, "task-1"); return { lane: "auto_director", directorRun: { id: "run-1" } };
      };
      directorIssues.loadDirectorIssueTaskContext = async () => null;
      pipelineGovernance.reportPipelineIssue = async () => { governanceCalls++; throw new Error("Planning errors cannot enter generic governance"); };
      PlanningRepairRecoveryService.prototype.capturePipelineFailureBoundary = async id => { captures.push(id); return capture; };
      PlanningRepairRecoveryService.prototype.pauseAfterPipelineFailure = async (...args) => {
        pauses.push(args);
        if (pauseOutcome === "cas_conflict") throw new Error("pause CAS changed");
        return pauseOutcome === "paused";
      };
      const harness = createExecutorHarness({
        executeOptions: { ...options, workflowTaskId: "task-1" },
        runChapter: async () => { throw error; },
      });
      try {
        await harness.execute();
        assert.deepEqual(captures, ["task-1"]);
        assert.equal(pauses.length, 1);
        assert.deepEqual(pauses[0].slice(0, 2), ["task-1", "job-1"]);
        assert.strictEqual(pauses[0][2], error); assert.strictEqual(pauses[0][3], capture);
        assert.equal(harness.chapterCalls, 1); assert.deepEqual(harness.claims, []);
        assert.equal(governanceCalls, 0);
        assert.equal(harness.jobState.status, "failed"); assert.equal(harness.jobState.error, error.message);
        assert.equal(harness.updates.at(-1).data.status, "failed");
      } finally {
        harness.restore(); prisma.novelWorkflowTask.findUnique = original.findTask;
        PlanningRepairRecoveryService.prototype.capturePipelineFailureBoundary = original.capture;
        PlanningRepairRecoveryService.prototype.pauseAfterPipelineFailure = original.pause;
        directorIssues.loadDirectorIssueTaskContext = original.loadIssues;
        pipelineGovernance.reportPipelineIssue = original.report;
      }
    });
  }
}

for (const endOrder of [1, 3]) {
  test(`autopilot honors requested 1-${endOrder} despite an 80-chapter novel estimate`, async () => {
    const harness = createExecutorHarness({
      estimatedChapterCount: 80, chapterCount: endOrder,
      executeOptions: { ...options, endOrder, autoReview: false },
      runChapter: async () => ({ reviewExecuted: false, pass: true, score: { overall: 100 },
        issues: [], runtimePackage: null, retryCountUsed: 0 }),
    });
    try {
      await harness.execute();
      assert.equal(harness.jobState.status, "succeeded");
      assert.equal(harness.chapterCalls, endOrder);
      assert.equal(harness.jobState.endOrder, endOrder);
      assert.equal(harness.jobState.totalCount, endOrder);
      assert.ok(harness.updates.every(update => update.data.endOrder === undefined || update.data.endOrder <= endOrder));
      assert.deepEqual(harness.routeRequests, Array.from({ length: endOrder - 1 }, (_, index) => index + 2));
    } finally { harness.restore(); }
  });
}

for (const savedRange of [undefined, { mode: "book", start: 1, end: 80 }]) {
  test(`single-chapter job bounds preparation when saved policy range is ${savedRange ? "broader" : "missing"}`, async () => {
    const originalCount = prisma.chapter.count;
    const originalEnsureRouteWindow = ChapterRouteWindowService.prototype.ensureRouteWindow;
    const routeQueries = [];
    prisma.chapter.count = async ({ where }) => {
      routeQueries.push(where);
      return [2, 3].filter(order => order >= where.order.gte && (where.order.lte == null || order <= where.order.lte)).length;
    };
    const routeService = new ChapterRouteWindowService({
      getVolumes: async () => { throw new Error("Existing chapter 2 must not cause route generation"); },
    });
    const preparation = new ChapterExecutionPreparationService({
      chapterPlanJITService: {
        ensureExecutionReady: async (novelId, _chapterId, routeOptions) => {
          assert.equal(routeOptions.endOrder, 2);
          assert.equal(routeOptions.completionProfile.targetChapterCount, 80);
          await originalEnsureRouteWindow.call(routeService, novelId, 2, routeOptions);
        },
      },
      planner: { ensureChapterPlan: async () => ({ id: "existing-chapter-2-plan" }) },
      loadEstimatedChapterCount: async () => 80,
    });
    const harness = createExecutorHarness({
      estimatedChapterCount: 80,
      chapterStartOrder: 2,
      executeOptions: { ...options, startOrder: 2, endOrder: 2, autoReview: false },
      savedControlPolicy: {
        kickoffMode: "director_start", advanceMode: "full_book_autopilot", reviewCheckpoints: ["chapter_batch"],
        ...(savedRange ? { autoExecutionRange: savedRange } : {}),
      },
      runChapter: async ({ runtimeOptions }) => {
        assert.deepEqual(runtimeOptions.controlPolicy.autoExecutionRange, { mode: "chapter_range", start: 2, end: 2 });
        assert.deepEqual(runtimeOptions.controlPolicy.reviewCheckpoints, ["chapter_batch"]);
        await preparation.prepare("novel-1", "chapter-2", runtimeOptions);
        return { reviewExecuted: false, pass: true, score: { overall: 100 }, issues: [], runtimePackage: null, retryCountUsed: 0 };
      },
    });
    try {
      await harness.execute();
      assert.equal(harness.jobState.status, "succeeded");
      assert.equal(harness.chapterCalls, 1);
      assert.deepEqual(routeQueries.map(query => query.order), [{ gte: 2, lte: 2 }]);
      assert.deepEqual(harness.routeRequests, []);
    } finally {
      harness.restore();
      prisma.chapter.count = originalCount;
    }
  });
}

test("pipeline recovery gives an already-reserved chapter no second automatic attempt", async () => {
  const harness = createExecutorHarness({
    used: 1,
    runChapter: async () => { throw new Error("repair interrupted"); },
  });
  try {
    await harness.execute();

    assert.equal(harness.chapterCalls, 1);
    assert.equal(harness.receivedMaxRetries, 0);
    assert.deepEqual(harness.claims, []);
    assert.equal(harness.updates.at(-1).data.status, "failed");
  } finally {
    harness.restore();
  }
});

const pipelineIssueGovernance = require("../../dist/services/novel/production/issueGovernance/PipelineIssueGovernance.js");

test("output exhaustion fails once without AI classification or another writer attempt", async () => {
  const original = pipelineIssueGovernance.reportPipelineIssue;
  let reports = 0;
  pipelineIssueGovernance.reportPipelineIssue = async () => { reports += 1; throw new Error("must not classify output exhaustion"); };
  const harness = createExecutorHarness({ runChapter: async () => {
    throw Object.assign(new Error("模型输出额度耗尽，已停止自动重试"), { code: "LLM_OUTPUT_LIMIT" });
  } });
  try {
    await harness.execute();
    assert.equal(reports, 0);
    assert.equal(harness.chapterCalls, 1);
    assert.deepEqual(harness.claims, []);
    assert.equal(harness.jobState.status, "failed");
    assert.match(harness.jobState.error, /额度耗尽/);
  } finally { harness.restore(); pipelineIssueGovernance.reportPipelineIssue = original; }
});

for (const code of ["PLANNING_REPAIR_CONFLICT", "PLANNING_REPAIR_CONFIRMATION_REQUIRED"]) {
  test(`${code} stops without purchasing an AI diagnosis or retry`, async () => {
    const original = pipelineIssueGovernance.reportPipelineIssue;
    let reports = 0;
    pipelineIssueGovernance.reportPipelineIssue = async () => { reports += 1; return null; };
    const harness = createExecutorHarness({ runChapter: async () => { throw Object.assign(new Error("规划需确认"), { code }); } });
    try {
      await harness.execute();
      assert.equal(reports, 0);
      assert.equal(harness.chapterCalls, 1);
      assert.deepEqual(harness.claims, []);
      assert.equal(harness.jobState.status, "failed");
    } finally { harness.restore(); pipelineIssueGovernance.reportPipelineIssue = original; }
  });
}

for (const timing of ["before classification", "during classification"]) {
  test(`cancellation ${timing} prevents AI classification or its retry action`, async () => {
    const original = pipelineIssueGovernance.reportPipelineIssue;
    let reports = 0;
    let harness;
    const cancel = () => {
      harness.jobState.status = "cancelled";
      harness.jobState.cancelRequestedAt = new Date();
    };
    pipelineIssueGovernance.reportPipelineIssue = async input => {
      reports += 1;
      cancel();
      await input.applyAction({ action: "auto_retry" });
      return { decision: { action: "auto_retry" } };
    };
    harness = createExecutorHarness({
      runChapter: async () => {
        if (timing === "before classification") cancel();
        throw new Error("late planning response cannot be saved on a cancelled task");
      },
    });
    try {
      await harness.execute();
      assert.equal(reports, timing === "before classification" ? 0 : 1);
      assert.equal(harness.chapterCalls, 1);
      assert.deepEqual(harness.claims, []);
      assert.equal(harness.jobState.status, "cancelled");
      assert.equal(harness.updates.some(update => ["failed", "succeeded"].includes(update.data.status)), false);
    } finally { harness.restore(); pipelineIssueGovernance.reportPipelineIssue = original; }
  });
}

test("an active failing job still reaches issue governance", async () => {
  const original = pipelineIssueGovernance.reportPipelineIssue;
  let reports = 0;
  pipelineIssueGovernance.reportPipelineIssue = async () => { reports += 1; return null; };
  const harness = createExecutorHarness({ used: 1, runChapter: async () => { throw new Error("ordinary provider failure"); } });
  try {
    await harness.execute();
    assert.ok(reports > 0);
    assert.equal(harness.jobState.status, "failed");
  } finally { harness.restore(); pipelineIssueGovernance.reportPipelineIssue = original; }
});

test("pipeline does not add an outer retry after repair reserved its attempt and failed", async () => {
  const harness = createExecutorHarness({
    used: 0,
    runChapter: async ({ hooks }) => {
      assert.equal(await hooks.onRetryConsumed(), true);
      throw new Error("repair provider disconnected");
    },
  });
  try {
    await harness.execute();

    assert.equal(harness.chapterCalls, 1);
    assert.deepEqual(harness.claims, ["quality_repair"]);
    assert.equal(harness.updates.at(-1).data.status, "failed");
  } finally {
    harness.restore();
  }
});

test("pipeline stops before chapter model work when attempt persistence cannot be read", async () => {
  const harness = createExecutorHarness({
    usedError: new ChapterContentPersistenceError("chapter-1", "无法读取章节自动处理额度，请检查数据库迁移和连接。"),
    runChapter: async () => { throw new Error("must not run"); },
  });
  try {
    await harness.execute();

    assert.equal(harness.chapterCalls, 0);
    assert.deepEqual(harness.claims, []);
    assert.equal(harness.updates.at(-1).data.status, "failed");
    assert.match(harness.updates.at(-1).data.error, /数据库迁移和连接/);
  } finally {
    harness.restore();
  }
});

test("pipeline lease: an old execution owner stops before chapter model work and cannot fail the job", async () => {
  const harness = createExecutorHarness({
    executionOwner: "owner-old",
    currentExecutionOwner: "owner-new",
    runChapter: async () => { throw new Error("must not run"); },
  });
  try {
    await harness.execute();

    assert.equal(harness.chapterCalls, 0);
    assert.deepEqual(harness.updates, []);
  } finally {
    harness.restore();
  }
});

test("pipeline lease: the active owner can still publish a successful terminal state", async () => {
  const harness = createExecutorHarness({
    executionOwner: "owner-a",
    executeOptions: { ...options, autoReview: false },
    runChapter: async () => ({
      reviewExecuted: false,
      pass: true,
      score: { overall: 100 },
      issues: [],
      runtimePackage: null,
      retryCountUsed: 0,
    }),
  });
  try {
    await harness.execute();

    assert.equal(harness.jobState.status, "succeeded");
    assert.equal(harness.updates.at(-1).data.status, "succeeded");
  } finally {
    harness.restore();
  }
});

test("pipeline lease: cancellation after chapter work cannot be overwritten by success", async () => {
  const harness = createExecutorHarness({
    executionOwner: "owner-a",
    cancelAfterChapter: true,
    executeOptions: { ...options, autoReview: false },
    runChapter: async () => ({
      reviewExecuted: false,
      pass: true,
      score: { overall: 100 },
      issues: [],
      runtimePackage: null,
      retryCountUsed: 0,
    }),
  });
  try {
    await harness.execute();

    assert.equal(harness.chapterCalls, 1);
    assert.equal(harness.jobState.status, "cancelled");
    assert.equal(harness.updates.some((update) => update.data.status === "succeeded"), false);
  } finally {
    harness.restore();
  }
});
