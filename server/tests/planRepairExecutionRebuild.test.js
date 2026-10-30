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
    journal: { status: "paused", hasUncertainStep: false },
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

function createHarness(overrides = {}) {
  const calls = { updateTaskSeed: [], retireJob: [] };
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
    findActiveJournalMetadata: async () => JSON.stringify({
      status: "paused",
      steps: { prepare: { status: "failed" } },
      values: {},
    }),
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
