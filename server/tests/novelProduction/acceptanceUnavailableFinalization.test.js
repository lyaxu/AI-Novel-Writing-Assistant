// Offline tests for the saved-prose degraded completion boundary. No DB, no model call: the
// journal/seed/job evidence is simulated so only the acceptance-review failure class is accepted.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

const reliability = loadRuntimeSource("../production/reliability/types.ts", {
  "node:crypto": require("node:crypto"),
});
const { AcceptanceUnavailableFinalizationService, isAcceptanceReviewFormatFailure } = loadRuntimeSource(
  "../production/recovery/AcceptanceUnavailableFinalizationService.ts",
  { "../reliability": reliability },
);

const taskId = "task-1";
const novelId = "novel-1";
const chapterId = "chapter-10";
const jobId = "job-10";
const acceptanceError = "[STRUCTURED_OUTPUT:malformed_json] [novel.chapter.acceptance_assessment@v20] JSON 解析失败；本次未启用模型修复。错误：JSON 解析失败：未检测到完整 JSON 值。";

const epoch = new Date("2026-11-21T04:26:25.000Z");
const later = new Date("2026-11-21T04:31:36.000Z");

function chapter(overrides = {}) {
  return {
    id: chapterId, novelId, order: 10, title: "第10章", content: "第10章已保存正文。".repeat(80),
    taskSheet: "任务单", sceneCards: "[]", expectation: "预期", targetWordCount: 2800,
    mustAvoid: null, conflictLevel: 2, revealLevel: null, hook: null,
    generationState: "drafted", chapterStatus: "generating", repairHistory: null, riskFlags: null,
    ...overrides,
  };
}

function journalRecord(target = chapter(), overrides = {}) {
  return {
    version: 1,
    operationId: `pipeline:${jobId}:${chapterId}`,
    request: { entry: "pipeline", workflowTaskId: taskId, chapterId },
    status: "paused",
    expectedFingerprint: reliability.chapterFingerprint(target),
    steps: {
      "pipeline.start": { status: "done" },
      "pipeline.options": { status: "done" },
      "pipeline.draft": { status: "done" },
      "pipeline.save_draft": { status: "done" },
      "pipeline.review:0": { status: "done" },
      "evaluation:first": { status: "done" },
      "pipeline.repair_budget": { status: "done" },
      "pipeline.repair": { status: "done" },
      "pipeline.review:1": { status: "failed", error: acceptanceError },
      "evaluation:second": { status: "failed", error: acceptanceError },
    },
    values: {},
    ...overrides,
  };
}

function fixture({ chapterRow = chapter(), journal = null, job: jobOverrides = {}, task: taskOverrides = {}, persistResult = true } = {}) {
  const seed = {
    novelId,
    autoExecution: {
      enabled: true, mode: "chapter_range", scopeLabel: "第 10 章",
      startOrder: 10, endOrder: 10, totalChapterCount: 1, completedChapterCount: 0,
      remainingChapterCount: 1, remainingChapterIds: [chapterId], remainingChapterOrders: [10],
      nextChapterId: chapterId, nextChapterOrder: 10, pipelineJobId: jobId, pipelineStatus: "failed",
      qualityDebtChapterIds: [], qualityDebtChapterOrders: [], qualityDebtSummaries: [],
    },
  };
  const task = {
    id: taskId, novelId, lane: "auto_director", status: "failed", pendingManualRecovery: false,
    cancelRequestedAt: null, updatedAt: later, seedPayloadJson: JSON.stringify(seed), ...taskOverrides,
  };
  const job = {
    id: jobId, novelId, status: "failed", startOrder: 10, endOrder: 10, currentItemKey: null,
    pendingManualRecovery: false, cancelRequestedAt: null, executionOwner: null, executionLeaseExpiresAt: null,
    payload: JSON.stringify({ workflowTaskId: taskId, provider: "deepseek", model: "m" }),
    updatedAt: epoch, error: acceptanceError, ...jobOverrides,
  };
  const row = {
    id: "checkpoint-1", novelId, chapterId, contentHash: "active", artifactType: "production_execution",
    syncMode: "journal", metadataJson: JSON.stringify(journal ?? journalRecord(chapterRow)),
  };
  const calls = { persist: [] };
  const service = new AcceptanceUnavailableFinalizationService({
    loadTask: async () => structuredClone(task),
    findJob: async () => structuredClone(job),
    findChapter: async () => structuredClone(chapterRow),
    readJournal: async () => structuredClone(row),
    persist: async (plan) => { calls.persist.push(plan); return persistResult; },
    now: () => later.getTime(),
  });
  return { service, task, job, seed, chapter: chapterRow, journal: row, calls };
}

test("saved prose whose acceptance review only failed at parse time is completed with visible debt", async () => {
  const f = fixture();
  const result = await f.service.finalize({ taskId, trigger: "director_continue_runtime" });
  assert.equal(result.changed, true);
  assert.equal(result.action, "completed_saved_prose_with_acceptance_unavailable_debt");
  assert.equal(result.chapterId, chapterId);
  assert.equal(result.chapterOrder, 10);
  assert.equal(f.calls.persist.length, 1);
  const plan = f.calls.persist[0];
  assert.equal(plan.chapter.nextGenerationState, "approved");
  assert.equal(plan.chapter.nextChapterStatus, "completed");
  assert.match(plan.chapter.nextRepairHistory, /event=degraded_completion/);
  assert.match(plan.chapter.nextRepairHistory, /novel\.chapter\.acceptance_assessment@v20/);
  assert.match(plan.chapter.nextRiskFlags, /acceptance:acceptance_unavailable/);
  const nextSeed = JSON.parse(plan.task.nextSeedPayloadJson);
  assert.equal(nextSeed.autoExecution.pipelineStatus, "succeeded");
  assert.equal(nextSeed.autoExecution.completedChapterCount, 1);
  assert.equal(nextSeed.autoExecution.remainingChapterCount, 0);
  assert.deepEqual(nextSeed.autoExecution.remainingChapterIds, []);
  assert.equal(nextSeed.autoExecution.qualityDebtChapterIds[0], chapterId);
  assert.equal(nextSeed.autoExecution.qualityDebtSummaries[0].source, "acceptance_unavailable");
  assert.equal(plan.job.expectedStatus, "failed");
  const nextJobPayload = JSON.parse(plan.job.nextPayload);
  assert.equal(nextJobPayload.acceptanceUnavailableEvidence.chapterId, chapterId);
  assert.equal(nextJobPayload.acceptanceUnavailableEvidence.failedSteps[0], "pipeline.review:1");
  const nextJournal = JSON.parse(plan.journal.nextMetadataJson);
  assert.equal(nextJournal.status, "completed");
  assert.equal(nextJournal.steps["pipeline.acceptance_unavailable"].status, "done");
  assert.equal(nextJournal.steps["pipeline.review:1"].status, "failed", "the review failure evidence is retained");
  assert.equal(plan.evidence.promptId, "novel.chapter.acceptance_assessment@v20");
});

test("a chapter without saved prose is never completed by this path", async () => {
  const f = fixture({ chapterRow: chapter({ content: "   " }) });
  const result = await f.service.finalize({ taskId, trigger: "continue" });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "no_saved_prose");
  assert.equal(f.calls.persist.length, 0);
});

test("an active lease keeps the pause", async () => {
  const f = fixture({ job: { executionOwner: "worker-1", executionLeaseExpiresAt: new Date(later.getTime() + 60_000) } });
  const result = await f.service.finalize({ taskId, trigger: "continue" });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "active_lease");
  assert.equal(f.calls.persist.length, 0);
});

test("an unknown or still-running external call keeps the pause", async () => {
  const runningJournal = journalRecord(chapter(), { status: "running" });
  const lease = fixture({ journal: runningJournal });
  assert.equal((await lease.service.finalize({ taskId, trigger: "continue" })).reason, "journal_lease_active");

  const unknownJournal = journalRecord(chapter(), { steps: {
    ...journalRecord().steps, "pipeline.draft": { status: "unknown", external: true },
  } });
  const unknown = fixture({ journal: unknownJournal });
  assert.equal((await unknown.service.finalize({ taskId, trigger: "continue" })).reason, "unknown_external_call");
});

test("changed prose fingerprint keeps the pause", async () => {
  const changed = fixture({ chapterRow: chapter({ content: "正文被人工修改过了。".repeat(80) }), journal: journalRecord(chapter()) });
  const result = await changed.service.finalize({ taskId, trigger: "continue" });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "prose_fingerprint_changed");
});

test("non-acceptance failures are never converted into a degraded completion", async () => {
  const transport = journalRecord(chapter(), { steps: {
    ...journalRecord().steps,
    "pipeline.review:1": { status: "failed", error: "外部调用中断：socket hang up" },
    "evaluation:second": { status: "failed", error: "外部调用中断：socket hang up" },
  } });
  const transportFixture = fixture({ journal: transport });
  assert.equal((await transportFixture.service.finalize({ taskId, trigger: "continue" })).reason, "review_failure_not_acceptance_format");

  const unrelated = journalRecord(chapter(), { steps: {
    ...journalRecord().steps, "pipeline.sync": { status: "failed", error: acceptanceError },
  } });
  const unrelatedFixture = fixture({ journal: unrelated });
  assert.equal((await unrelatedFixture.service.finalize({ taskId, trigger: "continue" })).reason, "unrelated_pipeline_failure");

  const writer = journalRecord(chapter(), { steps: {
    ...journalRecord().steps, "pipeline.draft": { status: "failed", error: "[STRUCTURED_OUTPUT:malformed_json] [novel.chapter.writer@v1] 解析失败" },
  } });
  const writerFixture = fixture({ journal: writer });
  assert.equal((await writerFixture.service.finalize({ taskId, trigger: "continue" })).reason, "unrelated_pipeline_failure");
});

test("the journal must still belong to the same task and job", async () => {
  const otherJob = journalRecord(chapter(), { operationId: `pipeline:job-other:${chapterId}` });
  const jobMismatch = fixture({ journal: otherJob });
  assert.equal((await jobMismatch.service.finalize({ taskId, trigger: "continue" })).reason, "journal_belongs_to_another_job");

  const otherTask = journalRecord(chapter(), { request: { entry: "pipeline", workflowTaskId: "other-task" } });
  const taskMismatch = fixture({ journal: otherTask });
  assert.equal((await taskMismatch.service.finalize({ taskId, trigger: "continue" })).reason, "journal_owner_mismatch");

  const wrongJobTarget = fixture({ job: { currentItemKey: "chapter-9" } });
  assert.equal((await wrongJobTarget.service.finalize({ taskId, trigger: "continue" })).reason, "job_target_chapter_mismatch");
});

test("a concurrent state change rolls back instead of silently completing", async () => {
  const f = fixture({ persistResult: false });
  await assert.rejects(f.service.finalize({ taskId, trigger: "continue" }), /未执行降级完成/);
});

test("an already completed chapter is left alone", async () => {
  const f = fixture({ chapterRow: chapter({ generationState: "approved", chapterStatus: "completed" }) });
  assert.equal((await f.service.finalize({ taskId, trigger: "continue" })).reason, "chapter_already_completed");
});

test("acceptance-format classifier stays narrow", () => {
  assert.equal(isAcceptanceReviewFormatFailure(acceptanceError), true);
  assert.equal(isAcceptanceReviewFormatFailure("审查尚未完成：部分引文或检查范围未通过核验。"), true);
  assert.equal(isAcceptanceReviewFormatFailure("[STRUCTURED_OUTPUT:malformed_json] [novel.chapter.writer@v1] 解析失败"), false);
  assert.equal(isAcceptanceReviewFormatFailure("外部调用中断：socket hang up"), false);
  assert.equal(isAcceptanceReviewFormatFailure(null), false);
});
