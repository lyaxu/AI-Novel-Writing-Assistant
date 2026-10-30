const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planChapterTitleAutoRepair,
  readChapterTitleAutoRepairState,
  buildChapterTitleAutoRepairState,
  isChapterTitleAutoRepairEnabledByMode,
  CHAPTER_TITLE_AUTO_REPAIR_FALLBACK_MESSAGE,
} = require("../dist/services/novel/director/recovery/chapterTitleAutoRepairPolicy.js");
const { NovelWorkflowHealingService } = require("../dist/services/novel/workflow/NovelWorkflowHealingService.js");
const {
  registerChapterTitleAutoRecoveryPort,
} = require("../dist/services/novel/workflow/novelWorkflowChapterTitleRecoveryPort.js");
const { NovelDirectorChapterTitleRepairRuntime } = require("../dist/services/novel/director/phases/novelDirectorChapterTitleRepairRuntime.js");

const DIVERSITY_ISSUE = "章节标题结构过于集中：2/3 个标题使用了“X的Y / X中的Y”式结构。请降低这类标题占比。";

function buildSeed(overrides = {}) {
  return {
    novelId: "novel-1",
    runMode: "full_book_autopilot",
    provider: "deepseek",
    model: "deepseek-chat",
    temperature: 0.7,
    directorInput: {
      candidate: { workingTitle: "测试书" },
      runMode: "full_book_autopilot",
      provider: "deepseek",
      model: "deepseek-chat",
      temperature: 0.7,
      autoExecutionPlan: { mode: "chapter_range", startOrder: 1, endOrder: 3 },
    },
    autoExecution: { enabled: true },
    ...overrides,
  };
}

function buildTaskRow(overrides = {}) {
  return {
    id: "task-1",
    novelId: "novel-1",
    lane: "auto_director",
    status: "failed",
    lastError: DIVERSITY_ISSUE,
    currentItemKey: "chapter_list",
    progress: 0.99,
    permissionMode: null,
    seedPayloadJson: JSON.stringify(buildSeed()),
    resumeTargetJson: JSON.stringify({
      route: "/novels/:id/edit",
      novelId: "novel-1",
      taskId: "task-1",
      lane: null,
      stage: "structured",
      chapterId: null,
      volumeId: "volume-1",
    }),
    ...overrides,
  };
}

function createWorkspace(titles) {
  return {
    novelId: "novel-1",
    volumes: [{
      id: "volume-1",
      sortOrder: 1,
      title: "第一卷",
      chapters: titles.map((title, index) => ({ id: `chapter-${index + 1}`, chapterOrder: index + 1, title })),
    }],
  };
}

test("chapter title auto repair policy: full autopilot schedules one bounded attempt per volume", () => {
  assert.equal(isChapterTitleAutoRepairEnabledByMode({ runMode: "full_book_autopilot", autoExecutionEnabled: false }), true);
  assert.equal(isChapterTitleAutoRepairEnabledByMode({ runMode: "auto_to_execution", autoExecutionEnabled: true }), true);
  assert.equal(isChapterTitleAutoRepairEnabledByMode({ runMode: "auto_to_execution", autoExecutionEnabled: false }), false);
  assert.equal(isChapterTitleAutoRepairEnabledByMode({ runMode: "auto_to_ready", autoExecutionEnabled: true }), false);

  assert.deepEqual(planChapterTitleAutoRepair({
    issue: DIVERSITY_ISSUE,
    runMode: "full_book_autopilot",
    autoExecutionEnabled: true,
    volumeId: "volume-1",
    state: null,
  }), { action: "auto_repair" });

  const attempted = buildChapterTitleAutoRepairState({ issue: DIVERSITY_ISSUE, volumeId: "volume-1" });
  assert.deepEqual(planChapterTitleAutoRepair({
    issue: DIVERSITY_ISSUE,
    runMode: "full_book_autopilot",
    autoExecutionEnabled: true,
    volumeId: "volume-1",
    state: attempted,
  }).action, "already_attempted");
  // A different volume is a new episode and may be repaired once.
  assert.deepEqual(planChapterTitleAutoRepair({
    issue: DIVERSITY_ISSUE,
    runMode: "full_book_autopilot",
    autoExecutionEnabled: true,
    volumeId: "volume-2",
    state: attempted,
  }), { action: "auto_repair" });
  // Non-autopilot tasks stay on the manual path.
  assert.deepEqual(planChapterTitleAutoRepair({
    issue: DIVERSITY_ISSUE,
    runMode: "auto_to_ready",
    autoExecutionEnabled: true,
    volumeId: "volume-1",
    state: null,
  }), { action: "manual_only" });
  assert.equal(readChapterTitleAutoRepairState({ chapterTitleAutoRepair: attempted }).status, "scheduled");
  assert.equal(readChapterTitleAutoRepairState({ chapterTitleAutoRepair: { version: 2 } }), null);
});

test("healing schedules automatic title repair in autopilot instead of waiting for a click", async () => {
  const calls = [];
  registerChapterTitleAutoRecoveryPort({
    scheduleAutoRepair: async (input) => {
      calls.push(input);
      return "scheduled";
    },
  });
  try {
    const updates = [];
    const workflow = {
      getTaskByIdWithoutHealing: async () => buildTaskRow(),
      updateTaskWithRetry: async ({ data }) => {
        updates.push(data);
        return buildTaskRow();
      },
      buildResumeTarget: (input) => ({
        route: "/novels/:id/edit",
        novelId: input.novelId,
        taskId: input.taskId,
        stage: "structured",
        volumeId: null,
      }),
    };
    const healing = new NovelWorkflowHealingService(workflow, {
      hasActiveAutoDirectorCommand: async () => false,
    });
    const healed = await healing.healChapterTitleDiversitySoftFailure("task-1");
    assert.equal(healed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].taskId, "task-1");
    assert.equal(calls[0].volumeId, "volume-1");
    assert.match(calls[0].issue, /章节标题结构过于集中/);
    assert.equal(updates.length, 0);
  } finally {
    registerChapterTitleAutoRecoveryPort(null);
  }
});

test("healing keeps a bounded recoverable pause when the single auto attempt already ran", async () => {
  const calls = [];
  registerChapterTitleAutoRecoveryPort({
    scheduleAutoRepair: async (input) => {
      calls.push(input);
      return "already_attempted";
    },
  });
  try {
    const updates = [];
    const workflow = {
      getTaskByIdWithoutHealing: async () => buildTaskRow(),
      updateTaskWithRetry: async ({ data }) => {
        updates.push(data);
        return buildTaskRow();
      },
      buildResumeTarget: (input) => ({ route: "/novels/:id/edit", novelId: input.novelId, taskId: input.taskId, stage: "structured" }),
    };
    const healing = new NovelWorkflowHealingService(workflow, {
      hasActiveAutoDirectorCommand: async () => false,
    });
    const healed = await healing.healChapterTitleDiversitySoftFailure("task-1");
    assert.equal(healed, true);
    assert.equal(calls.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, "waiting_approval");
    assert.equal(updates[0].checkpointSummary, CHAPTER_TITLE_AUTO_REPAIR_FALLBACK_MESSAGE);
    const seed = JSON.parse(updates[0].seedPayloadJson);
    assert.equal(seed.taskNotice.code, "CHAPTER_TITLE_DIVERSITY");
    assert.match(updates[0].currentItemLabel, /可继续任务或手动快速修复/);
  } finally {
    registerChapterTitleAutoRecoveryPort(null);
  }
});

test("healing leaves the manual quick-repair pause for non-autopilot tasks", async () => {
  const calls = [];
  registerChapterTitleAutoRecoveryPort({
    scheduleAutoRepair: async (input) => {
      calls.push(input);
      return "scheduled";
    },
  });
  try {
    const row = buildTaskRow({
      seedPayloadJson: JSON.stringify(buildSeed({
        runMode: "auto_to_ready",
        directorInput: {
          candidate: { workingTitle: "测试书" },
          runMode: "auto_to_ready",
          provider: "deepseek",
          model: "deepseek-chat",
          temperature: 0.7,
        },
        autoExecution: undefined,
      })),
    });
    const updates = [];
    const workflow = {
      getTaskByIdWithoutHealing: async () => row,
      updateTaskWithRetry: async ({ data }) => {
        updates.push(data);
        return row;
      },
      buildResumeTarget: (input) => ({ route: "/novels/:id/edit", novelId: input.novelId, taskId: input.taskId, stage: "structured" }),
    };
    const healing = new NovelWorkflowHealingService(workflow, {
      hasActiveAutoDirectorCommand: async () => false,
    });
    assert.equal(await healing.healChapterTitleDiversitySoftFailure("task-1"), true);
    assert.equal(calls.length, 0);
    assert.equal(updates[0].status, "waiting_approval");
    assert.equal(updates[0].checkpointSummary, null);
  } finally {
    registerChapterTitleAutoRecoveryPort(null);
  }
});

test("healing does not race an active director command", async () => {
  const calls = [];
  registerChapterTitleAutoRecoveryPort({
    scheduleAutoRepair: async (input) => {
      calls.push(input);
      return "scheduled";
    },
  });
  try {
    const workflow = {
      getTaskByIdWithoutHealing: async () => buildTaskRow(),
      updateTaskWithRetry: async () => buildTaskRow(),
      buildResumeTarget: () => null,
    };
    const healing = new NovelWorkflowHealingService(workflow, {
      hasActiveAutoDirectorCommand: async () => true,
    });
    assert.equal(await healing.healChapterTitleDiversitySoftFailure("task-1"), false);
    assert.equal(calls.length, 0);
  } finally {
    registerChapterTitleAutoRecoveryPort(null);
  }
});

function createRepairRuntime(overrides = {}) {
  const state = {
    markTaskRunningCalls: [],
    waitingApprovalCalls: [],
    bootstrapCalls: [],
    continueCalls: 0,
    background: null,
    claimedSeed: null,
  };
  const row = buildTaskRow();
  const workflowService = {
    getTaskById: async () => row,
    getTaskByIdWithoutHealing: async () => row,
    bootstrapTask: async (input) => {
      state.bootstrapCalls.push(input);
      return row;
    },
    markTaskRunning: async (_taskId, input) => {
      state.markTaskRunningCalls.push(input);
      return row;
    },
    markTaskWaitingApproval: async (_taskId, input) => {
      state.waitingApprovalCalls.push(input);
      return row;
    },
  };
  let workspace = createWorkspace(["一杯奶茶的价码", "处分报告上的笔迹", "第三处异常"]);
  const volumeService = {
    getVolumes: async () => workspace,
  };
  const runtime = new NovelDirectorChapterTitleRepairRuntime({
    workflowService,
    volumeService,
    buildDirectorSeedPayload: (_input, novelId, extra) => ({ novelId, ...extra }),
    scheduleBackgroundRun: (_taskId, runner) => {
      state.background = runner();
    },
    continueTaskAfterRepair: async () => {
      state.continueCalls += 1;
    },
    repairChapterTitles: overrides.repairChapterTitles ?? (async () => {
      workspace = createWorkspace(["一杯奶茶的台阶", "槐荫街十七号", "第三处异常"]);
    }),
    claimAutoRepairAttempt: async (input) => {
      state.claimedSeed = input.nextSeedPayloadJson;
      return overrides.claimResult ?? true;
    },
  });
  return {
    runtime,
    state,
    setWorkspace: (titles) => {
      workspace = createWorkspace(titles);
    },
  };
}

test("automatic title repair continues the original task and clears the notice on success", async () => {
  const { runtime, state } = createRepairRuntime();
  assert.equal(await runtime.autoRepairAndContinue("task-1", { volumeId: "volume-1" }), "scheduled");
  assert.ok(state.claimedSeed, "bounded marker must be persisted before the repair");
  await state.background;
  assert.equal(state.continueCalls, 1);
  const finalRunning = state.markTaskRunningCalls.at(-1);
  assert.equal(finalRunning.seedPayload.taskNotice, null);
  assert.equal(finalRunning.seedPayload.chapterTitleAutoRepair.status, "completed");
  assert.equal(state.waitingApprovalCalls.length, 0);
});

test("automatic title repair keeps the warning but still continues when titles remain concentrated", async () => {
  const { runtime, state } = createRepairRuntime({
    repairChapterTitles: async () => {
      // The repair pass ran but produced no improvement.
    },
  });
  assert.equal(await runtime.autoRepairAndContinue("task-1", { volumeId: "volume-1" }), "scheduled");
  await state.background;
  assert.equal(state.continueCalls, 1);
  const finalRunning = state.markTaskRunningCalls.at(-1);
  assert.match(finalRunning.seedPayload.taskNotice.summary, /章节标题结构过于集中/);
  assert.equal(finalRunning.seedPayload.chapterTitleAutoRepair.status, "completed_with_warning");
});

test("automatic title repair failure falls back to a bounded manual recovery pause", async () => {
  const { runtime, state } = createRepairRuntime({
    repairChapterTitles: async () => {
      throw new Error("模型输出不可用");
    },
  });
  assert.equal(await runtime.autoRepairAndContinue("task-1", { volumeId: "volume-1" }), "scheduled");
  await state.background;
  assert.equal(state.continueCalls, 0);
  assert.equal(state.waitingApprovalCalls.length, 1);
  const waiting = state.waitingApprovalCalls[0];
  assert.equal(waiting.checkpointType, "step_review_required");
  assert.match(waiting.checkpointSummary, /模型输出不可用/);
  assert.equal(waiting.seedPayload.taskNotice.code, "CHAPTER_TITLE_DIVERSITY");
  assert.equal(waiting.seedPayload.chapterTitleAutoRepair.status, "failed");
});

test("automatic title repair is bounded to one attempt per volume", async () => {
  const seededAttempted = buildSeed({
    chapterTitleAutoRepair: buildChapterTitleAutoRepairState({ issue: DIVERSITY_ISSUE, volumeId: "volume-1" }),
  });
  const { runtime, state } = createRepairRuntime();
  // Re-point the fake task row at the already-attempted seed.
  const row = buildTaskRow({ seedPayloadJson: JSON.stringify(seededAttempted) });
  runtime.deps.workflowService.getTaskById = async () => row;
  runtime.deps.workflowService.getTaskByIdWithoutHealing = async () => row;
  assert.equal(await runtime.autoRepairAndContinue("task-1", { volumeId: "volume-1" }), "already_attempted");
  assert.equal(state.background, null);
  assert.equal(state.claimedSeed, null);
  assert.equal(state.continueCalls, 0);
});
