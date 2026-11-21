const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planSupersededJournalOwnershipHandoff,
} = require("../dist/services/novel/director/recovery/DirectorRecoveryConvergence.js");
const {
  ChapterJournalOwnershipHandoffService,
  isChapterOwnershipConflictError,
  readPipelineOwnerJobId,
} = require("../dist/services/novel/director/recovery/ChapterJournalOwnershipHandoffService.js");
const {
  retirePreparationJournalIfSafe,
} = require("../dist/services/novel/director/recovery/PreparationJournalRetirement.js");

const NOVEL_ID = "novel-1";
const TASK_ID = "task-new";
const OLD_TASK_ID = "task-old";
const NEW_JOB_ID = "job-new";
const OLD_JOB_ID = "job-old";
const CHAPTER_ID = "chapter-9";
const OWNERSHIP_ERROR = "章节正文、执行约定或执行所有权已变化，已停止写入，请回到章节工作区核对。";
const NOW = Date.UTC(2026, 10, 21, 4, 0, 0);

function job(overrides = {}) {
  return {
    id: NEW_JOB_ID,
    novelId: NOVEL_ID,
    status: "failed",
    pendingManualRecovery: true,
    currentItemKey: CHAPTER_ID,
    payload: JSON.stringify({ workflowTaskId: TASK_ID }),
    payloadWorkflowTaskId: TASK_ID,
    leaseActive: false,
    cancelRequestedAt: null,
    error: OWNERSHIP_ERROR,
    llmCallCount: 0,
    completedCount: 0,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    taskId: TASK_ID,
    novelId: NOVEL_ID,
    taskPaused: true,
    cancelRequested: false,
    activeCommand: false,
    activeJobInNovel: false,
    targetChapter: { id: CHAPTER_ID, order: 9, hasProse: false },
    newJob: job(),
    newJobOwnershipConflict: true,
    newJobOwnsJournal: false,
    oldTask: {
      id: OLD_TASK_ID, status: "cancelled", cancelledOrSuperseded: true,
      hasActiveCommand: false, hasActiveJob: false,
    },
    oldJob: job({ id: OLD_JOB_ID, payloadWorkflowTaskId: OLD_TASK_ID, payload: JSON.stringify({ workflowTaskId: OLD_TASK_ID }), llmCallCount: 25 }),
    journal: {
      operationId: `pipeline:${OLD_JOB_ID}:${CHAPTER_ID}`,
      status: "paused",
      workflowTaskId: OLD_TASK_ID,
      leaseActive: false,
      partialTextLength: 0,
      expectedContentLength: 0,
      expectedContentMatchesChapter: true,
      hasUnknownOrRunningStep: false,
      belongsToOldJob: true,
    },
    ...overrides,
  };
}

test("ownership handoff: cancelled range task + paused preparation journal on an unwritten chapter is handed over", () => {
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence()), {
    action: "handoff",
    oldJournalOperationId: `pipeline:${OLD_JOB_ID}:${CHAPTER_ID}`,
    oldTaskId: OLD_TASK_ID,
    oldJobId: OLD_JOB_ID,
    newJobId: NEW_JOB_ID,
    targetChapterId: CHAPTER_ID,
    targetChapterOrder: 9,
  });
});

test("ownership handoff: saved prose, partial text and manuscript drift are never handed over", () => {
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    targetChapter: { id: CHAPTER_ID, order: 9, hasProse: true },
  })), { action: "none", reason: "target_chapter_has_prose" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    journal: { ...evidence().journal, partialTextLength: 120 },
  })), { action: "none", reason: "journal_partial_output" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    journal: { ...evidence().journal, expectedContentLength: 80 },
  })), { action: "none", reason: "journal_expected_prose" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    journal: { ...evidence().journal, expectedContentMatchesChapter: false },
  })), { action: "none", reason: "journal_manuscript_changed" });
});

test("ownership handoff: live lease, unknown call and active command/job keep the pause", () => {
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    newJob: job({ leaseActive: true }),
  })), { action: "none", reason: "job_lease_active" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    journal: { ...evidence().journal, leaseActive: true },
  })), { action: "none", reason: "journal_lease_active" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    journal: { ...evidence().journal, hasUnknownOrRunningStep: true },
  })), { action: "none", reason: "journal_unknown_call" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    activeCommand: true,
  })), { action: "none", reason: "active_command" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    activeJobInNovel: true,
  })), { action: "none", reason: "active_job" });
});

test("ownership handoff: a still-active old task or job is never archived", () => {
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    oldTask: { ...evidence().oldTask, cancelledOrSuperseded: false, status: "queued" },
  })), { action: "none", reason: "old_task_active" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    oldTask: { ...evidence().oldTask, hasActiveCommand: true },
  })), { action: "none", reason: "old_task_active_command" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    oldTask: { ...evidence().oldTask, hasActiveJob: true },
  })), { action: "none", reason: "old_task_active_job" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    oldJob: job({ id: OLD_JOB_ID, payloadWorkflowTaskId: OLD_TASK_ID, status: "running" }),
  })), { action: "none", reason: "old_job_active" });
});

test("ownership handoff: the new job must be a zero-work failure with exactly the ownership conflict", () => {
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    newJobOwnershipConflict: false,
  })), { action: "none", reason: "not_ownership_conflict" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    newJob: job({ status: "cancelled" }),
  })), { action: "none", reason: "new_job_not_failed" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    newJob: job({ llmCallCount: 2 }),
  })), { action: "none", reason: "new_job_has_work" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    newJobOwnsJournal: true,
  })), { action: "none", reason: "new_job_owns_journal" });
  assert.deepEqual(planSupersededJournalOwnershipHandoff(evidence({
    newJob: job({ payloadWorkflowTaskId: "other-task" }),
  })), { action: "none", reason: "job_owned_by_other_task" });
});

test("ownership error parsing keeps only the chapter-production ownership conflict", () => {
  assert.equal(isChapterOwnershipConflictError(OWNERSHIP_ERROR), true);
  assert.equal(isChapterOwnershipConflictError("章节执行所有权已变化，已停止旧执行写入。"), true);
  assert.equal(isChapterOwnershipConflictError("模型输出达到额度上限"), false);
  assert.equal(isChapterOwnershipConflictError(null), false);
  assert.equal(readPipelineOwnerJobId(`pipeline:${OLD_JOB_ID}:${CHAPTER_ID}`), OLD_JOB_ID);
  assert.equal(readPipelineOwnerJobId(`pipeline:${OLD_JOB_ID}:${CHAPTER_ID}:decision:x`), OLD_JOB_ID);
  assert.equal(readPipelineOwnerJobId("not-a-pipeline-operation"), null);
});

// ---------------------------------------------------------------------------
// Service: inspect -> plan -> CAS apply
// ---------------------------------------------------------------------------
function taskRow(overrides = {}) {
  return {
    id: TASK_ID,
    novelId: NOVEL_ID,
    lane: "auto_director",
    status: "queued",
    pendingManualRecovery: true,
    cancelRequestedAt: null,
    updatedAt: new Date(NOW - 60_000),
    seedPayloadJson: JSON.stringify({
      autoExecution: {
        enabled: true, mode: "chapter_range", startOrder: 9, endOrder: 9,
        totalChapterCount: 1, remainingChapterCount: 1, remainingChapterIds: [CHAPTER_ID],
        nextChapterId: CHAPTER_ID, nextChapterOrder: 9,
        pipelineJobId: NEW_JOB_ID, pipelineStatus: "failed",
      },
    }),
    ...overrides,
  };
}

function journalRecord(overrides = {}) {
  return {
    version: 1,
    operationId: `pipeline:${OLD_JOB_ID}:${CHAPTER_ID}`,
    status: "paused",
    expiresAt: 0,
    request: { entry: "pipeline", workflowTaskId: OLD_TASK_ID },
    expectedChapter: { id: CHAPTER_ID, content: "" },
    expectedFingerprint: "old-contract-fingerprint",
    partialText: "",
    steps: {
      prepare: { status: "failed", error: "规划响应未通过格式或合同校验" },
      "prepare.contract": { status: "failed", error: "规划响应未通过格式或合同校验" },
      "prepare.execution_contract": { status: "failed", external: true, error: "规划响应未通过格式或合同校验" },
    },
    values: {},
    ...overrides,
  };
}

function createHarness({ chapterContent = "", journal = journalRecord(), oldTaskStatus = "cancelled" } = {}) {
  const calls = { apply: 0 };
  const deps = {
    findTask: async id => {
      if (id === TASK_ID) return taskRow();
      if (id === OLD_TASK_ID) return taskRow({
        id: OLD_TASK_ID, status: oldTaskStatus, cancelRequestedAt: new Date(NOW - 120_000),
      });
      return null;
    },
    findJob: async id => {
      if (id === NEW_JOB_ID) return job();
      if (id === OLD_JOB_ID) return job({ id: OLD_JOB_ID, payloadWorkflowTaskId: OLD_TASK_ID, payload: JSON.stringify({ workflowTaskId: OLD_TASK_ID }), llmCallCount: 25 });
      return null;
    },
    findChapter: async id => id !== CHAPTER_ID ? null : {
      id: CHAPTER_ID, order: 9, content: chapterContent, title: "账本背面发烫",
      taskSheet: "章节目标", sceneCards: "{}", expectation: null, targetWordCount: 2800,
      mustAvoid: null, conflictLevel: null, revealLevel: null, hook: null,
    },
    findActiveJournal: async () => ({ metadataJson: JSON.stringify(journal), status: journal.status }),
    countActiveCommands: async () => 0,
    countActiveJobs: async () => 0,
    apply: async input => {
      calls.apply += 1;
      calls.plan = input.plan;
      calls.journalMetadataJson = input.journalMetadataJson;
      return { changed: true };
    },
    now: () => NOW,
  };
  const task = taskRow();
  const service = new ChapterJournalOwnershipHandoffService(deps);
  const run = () => service.handoff({
    task,
    seed: JSON.parse(task.seedPayloadJson),
    activeCommand: false,
    trigger: "director_command:continue",
  });
  return { calls, run, task };
}

test("handoff service applies once for the recorded cancelled-task ownership shape", async () => {
  const { calls, run } = createHarness();
  const result = await run();
  assert.deepEqual(result, { changed: true, action: "handoff", reason: null });
  assert.equal(calls.apply, 1);
  assert.equal(calls.plan.oldTaskId, OLD_TASK_ID);
  assert.equal(calls.plan.oldJobId, OLD_JOB_ID);
  assert.equal(calls.plan.newJobId, NEW_JOB_ID);
  assert.equal(calls.plan.targetChapterId, CHAPTER_ID);
  assert.equal(calls.plan.targetChapterOrder, 9);
  assert.equal(calls.journalMetadataJson, JSON.stringify(journalRecord()));
});

test("handoff service keeps the pause without applying when the chapter already has prose", async () => {
  const { calls, run } = createHarness({ chapterContent: "已有正文" });
  const result = await run();
  assert.equal(result.changed, false);
  assert.equal(result.reason, "target_chapter_has_prose");
  assert.equal(calls.apply, 0);
});

test("handoff service keeps the pause when the journal has partial text or an unknown step", async () => {
  const partial = createHarness({ journal: journalRecord({ partialText: "截断正文" }) });
  assert.equal((await partial.run()).reason, "journal_partial_output");
  assert.equal(partial.calls.apply, 0);
  const unknown = createHarness({
    journal: journalRecord({
      steps: { ...journalRecord().steps, "prepare.execution_contract": { status: "unknown", external: true } },
    }),
  });
  assert.equal((await unknown.run()).reason, "journal_unknown_call");
  assert.equal(unknown.calls.apply, 0);
});

test("handoff service keeps the pause when the old task is still active", async () => {
  const { calls, run } = createHarness({ oldTaskStatus: "queued" });
  const result = await run();
  assert.equal(result.changed, false);
  assert.equal(result.reason, "old_task_active");
  assert.equal(calls.apply, 0);
});

// The archive helper must accept this exact paused preparation journal even though the saved
// expected fingerprint belongs to an older contract revision; the handoff planner already proved
// the manuscript itself did not change.
test("preparation journal retirement archives the exact cancelled-task journal", async () => {
  const record = journalRecord();
  const metadataJson = JSON.stringify(record);
  const archived = [];
  let removed = 0;
  const tx = {
    chapterArtifactSyncCheckpoint: {
      findUnique: async () => ({ metadataJson, status: "paused" }),
      upsert: async input => { archived.push(input.create); return input.create; },
      deleteMany: async () => { removed += 1; return { count: 1 }; },
    },
  };
  const result = await retirePreparationJournalIfSafe(tx, {
    novelId: NOVEL_ID,
    chapterId: CHAPTER_ID,
    expectedOperationId: record.operationId,
    taskId: OLD_TASK_ID,
    now: NOW,
  });
  assert.deepEqual(result, {
    status: "retired",
    archiveContentHash: `${record.operationId}:superseded`,
  });
  assert.equal(archived.length, 1);
  assert.equal(archived[0].metadataJson, metadataJson);
  assert.equal(archived[0].contentHash, `${record.operationId}:superseded`);
  assert.equal(removed, 1);
});
