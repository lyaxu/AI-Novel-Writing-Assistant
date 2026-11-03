const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STALE_RANGE_JOB_IDLE_MS,
  extractStructuredFailureCode,
  readDefinitiveNoOutputCode,
  hasEffectiveRangeJobActivity,
  isStaleRangeJobWithoutAnchor,
} = require("../dist/services/novel/director/recovery/StaleRangeJobActivity.js");

const NOW = Date.parse("2026-11-04T02:00:00.000+08:00");
const TASK_ID = "task-1";
const NOVEL_ID = "novel-1";
const OUTPUT_LIMIT = "[STRUCTURED_OUTPUT:output_limit] [novel.volume.planning_repair@v16] 模型输出达到额度上限（12000 tokens），结果被截断。";

function job(overrides = {}) {
  return {
    id: "job-1",
    novelId: NOVEL_ID,
    status: "queued",
    pendingManualRecovery: true,
    currentItemKey: null,
    executionOwner: null,
    executionLeaseExpiresAt: null,
    heartbeatAt: null,
    updatedAt: new Date(NOW - 2 * 24 * 60 * 60_000),
    startedAt: new Date(NOW - 2 * 24 * 60 * 60_000),
    payloadWorkflowTaskId: TASK_ID,
    completedCount: 0,
    error: OUTPUT_LIMIT,
    ...overrides,
  };
}

const CONTEXT = { novelId: NOVEL_ID, taskId: TASK_ID, now: NOW };

test("a queued range job with no owner/lease/heartbeat and a definite output-limit error is stale", () => {
  assert.equal(isStaleRangeJobWithoutAnchor(job(), CONTEXT), true);
  assert.equal(isStaleRangeJobWithoutAnchor(job({ status: "running" }), CONTEXT), true);
});

test("structured failure codes and the definitive no-output list are read strictly", () => {
  assert.equal(extractStructuredFailureCode(OUTPUT_LIMIT), "STRUCTURED_OUTPUT:output_limit");
  assert.equal(extractStructuredFailureCode("普通中文报错"), null);
  assert.equal(readDefinitiveNoOutputCode([OUTPUT_LIMIT, OUTPUT_LIMIT]), "STRUCTURED_OUTPUT:output_limit");
  assert.equal(readDefinitiveNoOutputCode([OUTPUT_LIMIT]), "STRUCTURED_OUTPUT:output_limit");
  assert.equal(readDefinitiveNoOutputCode(["[STRUCTURED_OUTPUT:schema_mismatch] x"]), null);
  assert.equal(readDefinitiveNoOutputCode([OUTPUT_LIMIT, "[STRUCTURED_OUTPUT:incomplete_json] x"]), null);
  assert.equal(readDefinitiveNoOutputCode(["普通报错"]), null);
});

for (const [reason, patch] of Object.entries({
  "another live owner": { executionOwner: "worker" },
  "a lease timestamp": { executionLeaseExpiresAt: new Date(NOW + 60_000) },
  "a fresh heartbeat": { heartbeatAt: new Date(NOW - 30_000) },
  "a fresh update": { updatedAt: new Date(NOW - 30_000) },
  "a fresh start": { startedAt: new Date(NOW - 30_000) },
  "a chapter anchor": { currentItemKey: "chapter-4" },
  "completed work": { completedCount: 1 },
  "another task parent": { payloadWorkflowTaskId: "other-task" },
  "another novel": { novelId: "other-novel" },
  "a definitive-failure-free error": { error: "普通报错" },
  "a schema mismatch error only": { error: "[STRUCTURED_OUTPUT:schema_mismatch] x" },
  "a non-range status": { status: "succeeded" },
  "a failed status": { status: "failed" },
})) {
  test(`stale range job classification refuses ${reason}`, () => {
    assert.equal(isStaleRangeJobWithoutAnchor(job(patch), CONTEXT), false);
    assert.equal(isStaleRangeJobWithoutAnchor(job(patch), { ...CONTEXT, staleAfterMs: STALE_RANGE_JOB_IDLE_MS }), false);
  });
}

test("effective activity is reported for owner/lease/fresh signals only", () => {
  assert.equal(hasEffectiveRangeJobActivity(job(), { now: NOW }), false);
  assert.equal(hasEffectiveRangeJobActivity(job({ executionOwner: "worker" }), { now: NOW }), true);
  assert.equal(hasEffectiveRangeJobActivity(job({ heartbeatAt: new Date(NOW - 30_000) }), { now: NOW }), true);
  assert.equal(hasEffectiveRangeJobActivity(job({ updatedAt: new Date(NOW - 30_000) }), { now: NOW }), true);
  assert.equal(hasEffectiveRangeJobActivity(job({ status: "failed" }), { now: NOW }), false);
});
