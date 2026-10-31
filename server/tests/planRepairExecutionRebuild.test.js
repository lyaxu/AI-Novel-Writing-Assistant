const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planStalePlanRepairExecutionRebuild,
} = require("../dist/services/novel/director/recovery/DirectorRecoveryConvergence.js");
const {
  PlanRepairExecutionRebuildService,
} = require("../dist/services/novel/director/recovery/PlanRepairExecutionRebuildService.js");

const TASK_ID = "task-1";
const NOVEL_ID = "novel-1";
const JOB_ID = "job-old";
const CHAPTER_ID = "chapter-3";

function evidence(overrides = {}) {
  return {
    taskId: TASK_ID,
    novelId: NOVEL_ID,
    taskPaused: true,
    cancelRequested: false,
    activeCommand: false,
    activeJobInNovel: false,
    repairTerminalOrAbsent: true,
    repairPhase: "abandoned",
    executionRange: { startOrder: 1, endOrder: 3 },
    pipelineJobId: JOB_ID,
    job: {
      id: JOB_ID,
      novelId: NOVEL_ID,
      status: "queued",
      pendingManualRecovery: true,
      currentItemKey: null,
      payloadWorkflowTaskId: TASK_ID,
      leaseActive: false,
      cancelRequestedAt: null,
      startOrder: 3,
      endOrder: 3,
    },
    nextChapter: { id: CHAPTER_ID, order: 3, hasProse: false, hasUsablePlan: true },
    journal: {
      status: "paused",
      hasUncertainStep: false,
      hasWorkBeyondPreparation: false,
      belongsToPreviousJob: true,
    },
    ...overrides,
  };
}

test("plan rebuild: unrecoverable planning-repair job with a planned empty chapter rebuilds execution", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence()), {
    action: "rebuild_execution",
    previousJobId: JOB_ID,
    targetChapterId: CHAPTER_ID,
    targetChapterOrder: 3,
  });
});

test("plan rebuild: no usable plan routes back to normal planning instead of writing blind", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    nextChapter: { id: CHAPTER_ID, order: 3, hasProse: false, hasUsablePlan: false },
  })), {
    action: "requires_planning",
    previousJobId: JOB_ID,
    targetChapterOrder: 3,
  });
});

test("plan rebuild: saved prose is never rewritten", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    nextChapter: { id: CHAPTER_ID, order: 3, hasProse: true, hasUsablePlan: true },
  })), { action: "none", reason: "target_chapter_has_prose" });
});

test("plan rebuild: active planning repair blocks convergence", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    repairTerminalOrAbsent: false,
    repairPhase: "waiting_confirmation",
  })), { action: "none", reason: "planning_repair_active" });
});

test("plan rebuild: unknown external call, live lease, active job or command all block", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    journal: { status: "paused", hasUncertainStep: true },
  })), { action: "none", reason: "journal_unknown_call" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    job: { ...evidence().job, leaseActive: true },
  })), { action: "none", reason: "job_lease_active" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    activeJobInNovel: true,
  })), { action: "none", reason: "active_job" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    activeCommand: true,
  })), { action: "none", reason: "active_command" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    job: { ...evidence().job, currentItemKey: CHAPTER_ID },
    nextChapter: { id: CHAPTER_ID, order: 3, hasProse: false, hasUsablePlan: true },
  })), { action: "none", reason: "job_still_recoverable" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    job: { ...evidence().job, payloadWorkflowTaskId: "another-task" },
  })), { action: "none", reason: "job_owned_by_other_task" });
});

test("plan rebuild: a failed job with no chapter anchor and no pending flag still rebuilds", () => {
  // Recorded real shape: status=failed, currentItemKey=null, pendingManualRecovery=false. The job
  // is terminal bookkeeping, not a live pause, so the missing anchor is the only recovery signal.
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    job: { ...evidence().job, status: "failed", pendingManualRecovery: false },
  })), {
    action: "rebuild_execution",
    previousJobId: JOB_ID,
    targetChapterId: CHAPTER_ID,
    targetChapterOrder: 3,
  });
});

test("plan rebuild: a failed job that still has an anchor keeps the ordinary recovery path", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    job: { ...evidence().job, status: "failed", pendingManualRecovery: false, currentItemKey: CHAPTER_ID },
  })), { action: "none", reason: "job_not_paused" });
});

test("plan rebuild: saved prose or a preparation-owned journal cannot be superseded", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    journal: { ...evidence().journal, hasWorkBeyondPreparation: true },
  })), { action: "none", reason: "journal_has_unfinished_work" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    journal: { ...evidence().journal, belongsToPreviousJob: false },
  })), { action: "none", reason: "journal_owned_by_other_execution" });
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    journal: { ...evidence().journal, hasUncertainStep: true },
  })), { action: "none", reason: "journal_unknown_call" });
});

test("plan rebuild: an active repair session never rebuilds around its pending state", () => {
  assert.deepEqual(planStalePlanRepairExecutionRebuild(evidence({
    repairTerminalOrAbsent: false,
    repairPhase: "technical_failed",
  })), { action: "none", reason: "planning_repair_active" });
});

function createHarness(overrides = {}) {
  const calls = { updateTaskSeed: [], retireJob: [], retirePreparationJournal: [] };
  const task = {
    id: TASK_ID,
    novelId: NOVEL_ID,
    status: "queued",
    pendingManualRecovery: true,
    cancelRequestedAt: null,
    updatedAt: new Date("2026-10-30T10:00:00.000Z"),
    seedPayloadJson: JSON.stringify({
      autoExecution: {
        enabled: true,
        mode: "chapter_range",
        startOrder: 1,
        endOrder: 3,
        pipelineJobId: JOB_ID,
        pipelineStatus: "running",
        nextChapterId: CHAPTER_ID,
        nextChapterOrder: 3,
      },
      planningRepair: { version: 1, phase: "abandoned", key: "repair-1", history: [] },
    }),
  };
  const job = {
    id: JOB_ID,
    novelId: NOVEL_ID,
    status: "queued",
    pendingManualRecovery: true,
    currentItemKey: null,
    payload: JSON.stringify({ workflowTaskId: TASK_ID }),
    startOrder: 3,
    endOrder: 3,
    cancelRequestedAt: null,
    executionOwner: null,
    executionLeaseExpiresAt: null,
    updatedAt: new Date("2026-10-30T09:00:00.000Z"),
    error: "[STRUCTURED_OUTPUT:schema_mismatch] 规划修复候选未通过复核",
  };
  const defaultChapter = {
    id: CHAPTER_ID,
    order: 3,
    content: "",
    taskSheet: "章节目标：让主角完成签约。",
    sceneCards: "{\"scenes\":[{\"title\":\"签约\"}]}",
  };
  const chapter = overrides.chapter === undefined ? defaultChapter : overrides.chapter;
  const deps = {
    findJob: async () => (overrides.job === undefined ? job : overrides.job),
    findChapter: async (id) => (id === CHAPTER_ID ? chapter : null),
    findFirstPendingChapter: async () => chapter,
    hasChapterLevelPlan: async () => overrides.hasChapterLevelPlan ?? false,
    findActiveJournalMetadata: async () => (overrides.journalMetadata === undefined
      ? JSON.stringify({
        operationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
        status: "paused",
        expiresAt: 0,
        request: { entry: "pipeline", workflowTaskId: TASK_ID },
        expectedChapter: { id: CHAPTER_ID, content: "" },
        expectedFingerprint: "fingerprint",
        steps: { prepare: { status: "failed" } },
        values: {},
      })
      : overrides.journalMetadata),
    retirePreparationJournal: async (input) => {
      calls.retirePreparationJournal.push(input);
      return overrides.retirePreparationJournal ?? { status: "retired", archiveContentHash: "archive" };
    },
    countActiveJobs: async () => overrides.activeJobCount ?? 0,
    updateTaskSeed: async (input) => {
      calls.updateTaskSeed.push(input);
      return overrides.updateTaskSeed ?? true;
    },
    retireJob: async (input) => {
      calls.retireJob.push(input);
      return overrides.retireJob ?? true;
    },
    now: () => Date.parse("2026-10-30T10:00:10.000Z"),
  };
  return { service: new PlanRepairExecutionRebuildService(deps), task, job, chapter, calls };
}

test("rebuild service clears the dead binding and retires the old job while keeping its evidence", async () => {
  const { service, task, calls } = createHarness();
  const result = await service.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(result.changed, true);
  assert.equal(result.action.action, "rebuild_execution");
  assert.equal(result.action.oldJobId, JOB_ID);
  assert.equal(result.action.targetChapterId, CHAPTER_ID);
  assert.equal(calls.updateTaskSeed.length, 1);
  assert.equal(calls.retireJob.length, 1);
  const nextSeed = JSON.parse(calls.updateTaskSeed[0].nextSeedPayloadJson);
  assert.equal(nextSeed.autoExecution.pipelineJobId, null);
  assert.equal(nextSeed.autoExecution.pipelineStatus, null);
  assert.equal(nextSeed.autoExecution.nextChapterId, CHAPTER_ID);
  assert.equal(nextSeed.autoExecution.nextChapterOrder, 3);
  assert.equal(nextSeed.planningRepairExecutionRebuild.action, "rebuild_execution");
  assert.equal(nextSeed.planningRepairExecutionRebuild.previousJobId, JOB_ID);
  assert.match(calls.retireJob[0].supersedeMessage, /新的章节执行任务/);
  assert.match(calls.retireJob[0].supersedeMessage, /schema_mismatch/);
});

test("rebuild service rebuilds a failed job that lost its anchor even without a pending flag", async () => {
  const failedJob = {
    id: JOB_ID, novelId: NOVEL_ID, status: "failed", pendingManualRecovery: false,
    currentItemKey: null, payload: JSON.stringify({ workflowTaskId: TASK_ID }),
    startOrder: 3, endOrder: 3, cancelRequestedAt: null, executionOwner: null,
    executionLeaseExpiresAt: null, updatedAt: new Date("2026-10-30T09:00:00.000Z"),
    error: "[STRUCTURED_OUTPUT:schema_mismatch] 旧的执行任务失败",
  };
  const { service, task, calls } = createHarness({ job: failedJob });
  assert.equal(failedJob.pendingManualRecovery, false);
  const result = await service.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(result.changed, true);
  assert.equal(result.action.action, "rebuild_execution");
  assert.equal(calls.updateTaskSeed.length, 1);
  assert.equal(calls.retirePreparationJournal.length, 1);
  assert.deepEqual(calls.retirePreparationJournal[0], {
    novelId: NOVEL_ID, chapterId: CHAPTER_ID, jobId: JOB_ID, taskId: TASK_ID,
    now: Date.parse("2026-10-30T10:00:10.000Z"),
  });
  assert.equal(calls.retireJob.length, 1);
  const nextSeed = JSON.parse(calls.updateTaskSeed[0].nextSeedPayloadJson);
  assert.equal(nextSeed.planningRepairExecutionRebuild.journalSuperseded, true);
  assert.equal(calls.retireJob[0].job.pendingManualRecovery, false);
});

test("rebuild service aborts before any task/job write when the paused journal cannot be superseded", async () => {
  const { service, task, calls } = createHarness({
    retirePreparationJournal: { status: "blocked", reason: "uncertain_step" },
  });
  const result = await service.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(result.changed, false);
  assert.match(result.reason, /journal_cannot_be_retired/);
  assert.equal(calls.updateTaskSeed.length, 0);
  assert.equal(calls.retireJob.length, 0);
});

test("rebuild service is idempotent after the binding is cleared", async () => {
  const { service, task, calls } = createHarness();
  const first = await service.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(first.changed, true);
  const nextSeed = JSON.parse(calls.updateTaskSeed[0].nextSeedPayloadJson);
  const second = await service.converge({
    task: { ...task, seedPayloadJson: JSON.stringify(nextSeed), updatedAt: new Date(Date.parse("2026-10-30T10:00:10.000Z")) },
    seed: nextSeed,
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_runtime_continue",
  });
  assert.equal(second.changed, false);
  assert.equal(second.reason, "no_saved_pipeline_job");
  assert.equal(calls.updateTaskSeed.length, 1);
  assert.equal(calls.retireJob.length, 1);
});

test("rebuild service routes an unplanned pending chapter to normal planning", async () => {
  const { service, task, calls } = createHarness({
    chapter: { id: CHAPTER_ID, order: 3, content: "", taskSheet: null, sceneCards: null },
  });
  const result = await service.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:retry",
  });
  assert.equal(result.changed, true);
  assert.equal(result.action.action, "requires_planning");
  const nextSeed = JSON.parse(calls.updateTaskSeed[0].nextSeedPayloadJson);
  assert.equal(nextSeed.autoExecution.pipelineJobId, null);
  assert.equal(nextSeed.autoExecution.nextChapterId, null);
  assert.equal(nextSeed.autoExecution.nextChapterOrder, 3);
  assert.equal(calls.retirePreparationJournal.length, 1, "the paused preparation journal is superseded so a new job can start");
});

test("rebuild service refuses to rebuild over saved prose or an active job", async () => {
  const { service, task, calls } = createHarness();
  const proseService = new PlanRepairExecutionRebuildService({
    findJob: async () => ({
      id: JOB_ID,
      novelId: NOVEL_ID,
      status: "queued",
      pendingManualRecovery: true,
      currentItemKey: null,
      payload: JSON.stringify({ workflowTaskId: TASK_ID }),
      startOrder: 3,
      endOrder: 3,
      cancelRequestedAt: null,
      executionOwner: null,
      executionLeaseExpiresAt: null,
      updatedAt: new Date("2026-10-30T09:00:00.000Z"),
      error: "failed",
    }),
    findChapter: async () => ({
      id: CHAPTER_ID,
      order: 3,
      content: "已有正文，不能被重写。",
      taskSheet: "章节目标",
      sceneCards: null,
    }),
    findFirstPendingChapter: async () => null,
    hasChapterLevelPlan: async () => true,
    findActiveJournalMetadata: async () => null,
    countActiveJobs: async () => 0,
    updateTaskSeed: async () => {
      throw new Error("must not write");
    },
    retireJob: async () => {
      throw new Error("must not retire");
    },
  });
  const proseResult = await proseService.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(proseResult.changed, false);
  assert.equal(proseResult.reason, "target_chapter_has_prose");

  const { service: activeService, task: activeTask } = createHarness({ activeJobCount: 1 });
  const activeResult = await activeService.converge({
    task: activeTask,
    seed: JSON.parse(activeTask.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(activeResult.changed, false);
  assert.equal(activeResult.reason, "active_job");
  assert.equal(calls.updateTaskSeed.length, 0);
});

test("rebuild service does not clear the binding when the task seed changed concurrently", async () => {
  const { service, task, calls } = createHarness({ updateTaskSeed: false });
  const result = await service.converge({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    repairPhase: "abandoned",
    activeCommand: false,
    trigger: "director_command:continue",
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "task_seed_changed");
  assert.equal(calls.retireJob.length, 0);
});
