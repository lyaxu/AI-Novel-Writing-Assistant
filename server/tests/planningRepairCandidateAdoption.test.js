const test = require("node:test");
const assert = require("node:assert/strict");

const base = "../dist/services/novel/director/recovery/";
const {
  planPlanningRepairCandidateAdoption,
} = require(base + "PlanningRepairCandidateAdoptionPlan.js");
const {
  PlanningRepairCandidateAdoptionService,
  createPlanningRepairCandidateAdoptionService,
} = require(base + "PlanningRepairCandidateAdoptionService.js");
const {
  planPreparationJournalRetirement,
  retirePreparationJournalIfSafe,
} = require(base + "PreparationJournalRetirement.js");

const TASK_ID = "task-1";
const NOVEL_ID = "novel-1";
const JOB_ID = "job-old";
const CHAPTER_ID = "chapter-1";
const VOLUME_ID = "volume-1";
const VOLUME_CHAPTER_ID = "volume-chapter-1";
const VERSION_ID = "version-candidate";

function evidence(overrides = {}) {
  return {
    taskId: TASK_ID,
    novelId: NOVEL_ID,
    taskPaused: true,
    cancelRequested: false,
    activeCommand: false,
    activeJobInNovel: false,
    repairPhase: "abandoned",
    repairPendingWork: false,
    candidateVersionId: VERSION_ID,
    executionRange: { startOrder: 1, endOrder: 3 },
    pipelineJobId: JOB_ID,
    job: {
      id: JOB_ID,
      novelId: NOVEL_ID,
      status: "failed",
      pendingManualRecovery: false,
      currentItemKey: null,
      payloadWorkflowTaskId: TASK_ID,
      leaseActive: false,
      cancelRequestedAt: null,
    },
    targetChapter: { id: CHAPTER_ID, order: 1, hasProse: false, hasPlan: false },
    candidate: {
      versionId: VERSION_ID,
      status: "draft",
      volumeMatches: true,
      volumeChapterId: VOLUME_CHAPTER_ID,
      chapterExists: true,
      chapterOrder: 1,
      contractUsable: true,
    },
    journal: {
      status: "paused",
      hasUncertainStep: false,
      hasWorkBeyondPreparation: false,
      belongsToPreviousJob: true,
    },
    writtenSourceUnchanged: true,
    ...overrides,
  };
}

test("a saved draft candidate of a terminal repair is adopted from the existing plan", () => {
  assert.deepEqual(planPlanningRepairCandidateAdoption(evidence()), {
    action: "adopt",
    versionId: VERSION_ID,
    volumeChapterId: VOLUME_CHAPTER_ID,
    chapterId: CHAPTER_ID,
    chapterOrder: 1,
  });
});

for (const [reason, patch] of Object.entries({
  "a cancelled task": { cancelRequested: true },
  "a live task": { taskPaused: false },
  "an active command": { activeCommand: true },
  "another active chapter job": { activeJobInNovel: true },
  "an active repair session": { repairPhase: "reviewing" },
  "pending repair work": { repairPhase: "abandoned", repairPendingWork: true },
  "a technical failure that is not exhausted": { repairPhase: "technical_failed", repairPendingWork: true },
  "no saved job": { pipelineJobId: null, job: null },
  "a job owned by another task": { job: { ...evidence().job, payloadWorkflowTaskId: "other-task" } },
  "a job that still has an anchor": { job: { ...evidence().job, currentItemKey: CHAPTER_ID } },
  "a job that is not failed": { job: { ...evidence().job, status: "queued" } },
  "an active job lease": { job: { ...evidence().job, leaseActive: true } },
  "a cancelled job": { job: { ...evidence().job, cancelRequestedAt: new Date(1) } },
  "changed written source": { writtenSourceUnchanged: false },
  "missing candidate version": { candidateVersionId: null, candidate: null },
  "an already active candidate": { candidate: { ...evidence().candidate, status: "active" } },
  "a candidate from another volume": { candidate: { ...evidence().candidate, volumeMatches: false } },
  "a candidate chapter outside the workspace": { candidate: { ...evidence().candidate, chapterExists: false } },
  "a candidate order mismatch": { candidate: { ...evidence().candidate, chapterOrder: 2 } },
  "an unusable candidate contract": { candidate: { ...evidence().candidate, contractUsable: false } },
  "no pending target chapter": { targetChapter: null },
  "target outside the execution range": { targetChapter: { id: CHAPTER_ID, order: 9, hasProse: false, hasPlan: false } },
  "saved target prose": { targetChapter: { id: CHAPTER_ID, order: 1, hasProse: true, hasPlan: false } },
  "an existing target plan": { targetChapter: { id: CHAPTER_ID, order: 1, hasProse: false, hasPlan: true } },
  "an unknown journal call": { journal: { ...evidence().journal, hasUncertainStep: true } },
  "unfinished journal work": { journal: { ...evidence().journal, hasWorkBeyondPreparation: true } },
  "a journal owned by another execution": { journal: { ...evidence().journal, belongsToPreviousJob: false } },
})) {
  test(`candidate adoption refuses ${reason}`, () => {
    assert.equal(planPlanningRepairCandidateAdoption(evidence(patch)).action, "none");
  });
}

function inspection(overrides = {}) {
  const seed = {
    planningRepair: { version: 1, key: "repair", phase: "abandoned", candidateVersionId: VERSION_ID, history: [] },
    autoExecution: { enabled: true, mode: "chapter_range", startOrder: 1, endOrder: 3, pipelineJobId: JOB_ID, nextChapterId: CHAPTER_ID, nextChapterOrder: 1 },
  };
  const { evidence: evidencePatch, ...rest } = overrides;
  return {
    evidence: evidence(evidencePatch),
    seed,
    candidateDocument: { novelId: NOVEL_ID, workspaceVersion: "v2", volumes: [] },
    candidateVersionId: VERSION_ID,
    volumeChapterId: VOLUME_CHAPTER_ID,
    targetChapter: { id: CHAPTER_ID, novelId: NOVEL_ID, order: 1, title: "第一章", content: null, updatedAt: new Date(1000) },
    expectedCandidateContentJson: "{}",
    journalMetadataJson: null,
    now: 5000,
    ...rest,
  };
}

function taskRow(overrides = {}) {
  return {
    id: TASK_ID,
    novelId: NOVEL_ID,
    lane: "auto_director",
    status: "running",
    pendingManualRecovery: true,
    cancelRequestedAt: null,
    updatedAt: new Date(1000),
    seedPayloadJson: "{}",
    ...overrides,
  };
}

test("adoption service applies the saved candidate through the writer and reports the receipt", async () => {
  const calls = { applied: 0, logged: [] };
  const service = createPlanningRepairCandidateAdoptionService({
    inspect: async () => inspection(),
    apply: async (input) => {
      calls.applied += 1;
      assert.equal(input.plan.versionId, VERSION_ID);
      assert.equal(input.plan.chapterId, CHAPTER_ID);
      return { changed: true };
    },
    logInfo: (message, meta) => calls.logged.push({ message, meta }),
    logWarn: () => {},
  });
  const result = await service.adopt({ task: taskRow(), trigger: "director_command:continue" });
  assert.equal(result.changed, true);
  assert.equal(result.adopted, true);
  assert.equal(result.versionId, VERSION_ID);
  assert.equal(result.chapterId, CHAPTER_ID);
  assert.equal(calls.applied, 1);
  assert.equal(calls.logged.length, 1);
  assert.equal(calls.logged[0].meta.action, "adopted_planning_repair_candidate");
});

test("adoption service never writes when the inspection or the pure plan refuses", async () => {
  let applied = 0;
  const refused = createPlanningRepairCandidateAdoptionService({
    inspect: async () => ({ reason: "repair_chapter_mapping_missing" }),
    apply: async () => { applied += 1; return { changed: true }; },
    logInfo: () => {},
    logWarn: () => {},
  });
  const first = await refused.adopt({ task: taskRow(), trigger: "director_command:continue" });
  assert.equal(first.changed, false);
  assert.equal(first.reason, "repair_chapter_mapping_missing");

  const guarded = createPlanningRepairCandidateAdoptionService({
    inspect: async () => inspection({ evidence: { targetChapter: { id: CHAPTER_ID, order: 1, hasProse: true, hasPlan: false } } }),
    apply: async () => { applied += 1; return { changed: true }; },
    logInfo: () => {},
    logWarn: () => {},
  });
  const second = await guarded.adopt({ task: taskRow(), trigger: "director_command:continue" });
  assert.equal(second.changed, false);
  assert.equal(second.reason, "target_chapter_has_prose");
  assert.equal(applied, 0);
});

test("adoption service keeps the pause when the writer declines or throws", async () => {
  const declined = createPlanningRepairCandidateAdoptionService({
    inspect: async () => inspection(),
    apply: async () => ({ changed: false, reason: "task_changed" }),
    logInfo: () => {},
    logWarn: () => {},
  });
  const first = await declined.adopt({ task: taskRow(), trigger: "director_command:continue" });
  assert.equal(first.changed, false);
  assert.equal(first.reason, "task_changed");

  const warnings = [];
  const failed = createPlanningRepairCandidateAdoptionService({
    inspect: async () => inspection(),
    apply: async () => { throw new Error("serialization conflict"); },
    logInfo: () => {},
    logWarn: (message, meta) => warnings.push({ message, meta }),
  });
  const second = await failed.adopt({ task: taskRow(), trigger: "director_command:continue" });
  assert.equal(second.changed, false);
  assert.equal(second.reason, "adoption_write_failed");
  assert.equal(warnings.length, 1);
});

test("adoption service skips cancelled or foreign tasks without inspecting", async () => {
  let inspected = 0;
  const service = createPlanningRepairCandidateAdoptionService({
    inspect: async () => { inspected += 1; return inspection(); },
    apply: async () => ({ changed: true }),
    logInfo: () => {},
    logWarn: () => {},
  });
  const foreign = await service.adopt({ task: taskRow({ lane: "manual_create" }), trigger: "x" });
  assert.equal(foreign.changed, false);
  const cancelled = await service.adopt({ task: taskRow({ cancelRequestedAt: new Date(1) }), trigger: "x" });
  assert.equal(cancelled.changed, false);
  assert.equal(inspected, 0);
});

function journal(overrides = {}) {
  return {
    version: 1,
    operationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
    status: "paused",
    expiresAt: 0,
    request: { entry: "pipeline", workflowTaskId: TASK_ID },
    expectedChapter: { id: CHAPTER_ID, content: "" },
    expectedFingerprint: "chapter-fingerprint",
    steps: {
      prepare: { status: "failed" },
      "prepare.contract": { status: "failed" },
      "prepare.execution_contract": { status: "failed" },
    },
    values: {},
    ...overrides,
  };
}

test("a failed preparation-only journal owned by the superseded job is retired", () => {
  assert.deepEqual(planPreparationJournalRetirement({
    journal: journal(),
    expectedOperationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
    taskId: TASK_ID,
    now: 1000,
    expectedChapterFingerprint: "chapter-fingerprint",
  }), { retire: true });
});

for (const [reason, plan] of Object.entries({
  "an operation owned by another job": { expectedOperationId: "pipeline:other-job:chapter-1" },
  "a completed journal": { journal: journal({ status: "completed" }) },
  "an active journal lease": { journal: journal({ expiresAt: 5000 }) },
  "a non-pipeline entry": { journal: journal({ request: { entry: "stream", workflowTaskId: TASK_ID } }) },
  "another task parent": { journal: journal({ request: { entry: "pipeline", workflowTaskId: "other-task" } }) },
  "saved expected prose": { journal: journal({ expectedChapter: { id: CHAPTER_ID, content: "已有正文" } }) },
  "partial stream prose": { journal: journal({ partialText: "半截正文" }) },
  "a changed chapter contract": { expectedChapterFingerprint: "other-fingerprint" },
  "an unknown step": { journal: journal({ steps: { prepare: { status: "unknown" } } }) },
  "a running step": { journal: journal({ steps: { prepare: { status: "running" } } }) },
  "an uncertain planning pause": { journal: journal({ steps: { prepare: { status: "failed", planningPause: { outcome: "unknown" } } } }) },
  "work beyond preparation": { journal: journal({ steps: { prepare: { status: "failed" }, "pipeline.draft": { status: "done" } } }) },
  "an unfinished stream": { journal: journal({ values: { "stream.started": true } }) },
  "no preparation steps": { journal: journal({ steps: {} }) },
})) {
  test(`preparation journal retirement refuses ${reason}`, () => {
    const result = planPreparationJournalRetirement({
      journal: journal(),
      expectedOperationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
      taskId: TASK_ID,
      now: 1000,
      expectedChapterFingerprint: "chapter-fingerprint",
      ...plan,
    });
    assert.equal(result.retire, false);
  });
}

function fakeTransaction(row) {
  const calls = { upserts: [], deletes: [] };
  const tx = {
    chapterArtifactSyncCheckpoint: {
      findUnique: async () => row,
      upsert: async (query) => { calls.upserts.push(query); return {}; },
      deleteMany: async (query) => { calls.deletes.push(query); return { count: row ? 1 : 0 }; },
    },
  };
  return { tx, calls };
}

test("retiring a safe journal archives the exact record and clears only the active ownership slot", async () => {
  const metadataJson = JSON.stringify(journal());
  const { tx, calls } = fakeTransaction({ metadataJson, status: "paused" });
  const result = await retirePreparationJournalIfSafe(tx, {
    novelId: NOVEL_ID,
    chapterId: CHAPTER_ID,
    expectedOperationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
    taskId: TASK_ID,
    now: 1000,
    expectedChapterFingerprint: "chapter-fingerprint",
  });
  assert.equal(result.status, "retired");
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].create.metadataJson, metadataJson);
  assert.match(calls.upserts[0].where.novelId_chapterId_contentHash_artifactType_syncMode.contentHash, /superseded/);
  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.deletes[0].where.contentHash, "active");
});

test("retiring an unsafe journal leaves the active record untouched", async () => {
  const metadataJson = JSON.stringify(journal({ steps: { "pipeline.draft": { status: "done" } } }));
  const { tx, calls } = fakeTransaction({ metadataJson, status: "paused" });
  const result = await retirePreparationJournalIfSafe(tx, {
    novelId: NOVEL_ID,
    chapterId: CHAPTER_ID,
    expectedOperationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
    taskId: TASK_ID,
    now: 1000,
    expectedChapterFingerprint: "chapter-fingerprint",
  });
  assert.equal(result.status, "blocked");
  assert.equal(calls.upserts.length, 0);
  assert.equal(calls.deletes.length, 0);
});

test("retiring a missing journal is a no-op", async () => {
  const { tx, calls } = fakeTransaction(null);
  const result = await retirePreparationJournalIfSafe(tx, {
    novelId: NOVEL_ID,
    chapterId: CHAPTER_ID,
    expectedOperationId: `pipeline:${JOB_ID}:${CHAPTER_ID}`,
    taskId: TASK_ID,
    now: 1000,
  });
  assert.equal(result.status, "none");
  assert.equal(calls.upserts.length + calls.deletes.length, 0);
});

// The exported class must be constructible directly for callers that wire deps without the factory.
test("adoption service class is exported alongside the factory", () => {
  assert.equal(typeof PlanningRepairCandidateAdoptionService, "function");
});
