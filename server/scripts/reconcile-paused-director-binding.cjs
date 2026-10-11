// Explicit maintenance only. No scheduling, model calls, deletion, or manuscript writes.
// Back up the live SQLite database consistently before invoking this function.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chapterFingerprint } = require('../dist/services/novel/production/reliability/types');

function reconcilePausedDirectorBinding(db, expected, { apply = false, now = Date.now() } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { taskId, novelId, chapterId, originalJobId, displacedJobId, contentHash, taskUpdatedAt } = expected;
    assert(originalJobId && displacedJobId && originalJobId !== displacedJobId, 'Distinct explicit job identities required');
    const task = db.prepare('SELECT * FROM NovelWorkflowTask WHERE id=?').get(taskId);
    assert(task && task.novelId === novelId && task.lane === 'auto_director', 'Director ownership mismatch');
    assert(task.pendingManualRecovery && !task.cancelRequestedAt && ['queued', 'failed'].includes(task.status), 'Director must remain paused');
    assert.equal(task.updatedAt, taskUpdatedAt, 'Director changed since inspection');
    const seed = JSON.parse(task.seedPayloadJson);
    assert.equal(seed.autoExecution?.pipelineJobId, displacedJobId, 'Displaced binding changed');
    assert.equal(seed.autoExecution.pipelineStatus, 'failed', 'Displaced projection is not failed');
    assert.equal(db.prepare("SELECT count(*) AS n FROM DirectorRunCommand WHERE taskId=? AND status IN ('queued','running')").get(taskId).n, 0, 'Command is active');
    assert.equal(db.prepare("SELECT count(*) AS n FROM GenerationJob WHERE novelId=? AND status IN ('queued','running')").get(novelId).n, 0, 'Another chapter job is active');
    const original = db.prepare('SELECT * FROM GenerationJob WHERE id=?').get(originalJobId);
    const displaced = db.prepare('SELECT * FROM GenerationJob WHERE id=?').get(displacedJobId);
    const chapter = db.prepare('SELECT * FROM Chapter WHERE id=? AND novelId=?').get(chapterId, novelId);
    assert(chapter, 'Chapter missing');
    assert.equal(createHash('sha256').update(chapter.content || '').digest('hex'), contentHash, 'Manuscript changed');
    for (const job of [original, displaced]) {
      assert(job && job.novelId === novelId && job.currentItemKey === chapterId, 'Job ownership mismatch');
      assert.equal(JSON.parse(job.payload).workflowTaskId, taskId, 'Parent mismatch');
      assert(job.startOrder <= chapter.order && job.endOrder >= chapter.order, 'Chapter outside job range');
      assert(job.status === 'failed' && job.pendingManualRecovery && !job.cancelRequestedAt, 'Job is not paused');
      assert(!job.executionOwner || !job.executionLeaseExpiresAt || Date.parse(job.executionLeaseExpiresAt) <= now, 'Job lease active');
    }
    assert.equal(original.payload, displaced.payload, 'Displaced request differs');
    assert.equal(original.startOrder, displaced.startOrder, 'Job range differs');
    assert.equal(original.endOrder, displaced.endOrder, 'Job range differs');
    assert.equal(displaced.llmCallCount, 0, 'Displaced job has external effects');
    assert.equal(displaced.totalTokens, 0, 'Displaced job has model usage');
    assert.equal(displaced.completedCount, 0, 'Displaced job completed work');
    const rows = db.prepare("SELECT * FROM ChapterArtifactSyncCheckpoint WHERE novelId=? AND artifactType='production_execution' AND syncMode='journal'").all(novelId);
    assert(!rows.some(row => JSON.parse(row.metadataJson || '{}').operationId?.startsWith(`pipeline:${displacedJobId}:`)), 'Displaced job owns a journal');
    const active = rows.filter(row => row.chapterId === chapterId && row.contentHash === 'active');
    assert.equal(active.length, 1, 'Unique active journal required');
    const journal = JSON.parse(active[0].metadataJson);
    assert.equal(journal.operationId, `pipeline:${originalJobId}:${chapterId}`, 'Original job does not own journal');
    assert.equal(journal.request?.workflowTaskId, taskId, 'Journal parent differs');
    assert.equal(journal.request?.entry, 'pipeline', 'Journal entry differs');
    assert.equal(journal.status, 'paused', 'Journal must be paused');
    assert(journal.expiresAt <= now, 'Journal lease active');
    assert.equal(chapterFingerprint(chapter), journal.expectedFingerprint, 'Manuscript or execution contract changed');
    assert(Object.values(journal.steps).every(step => !['running', 'unknown'].includes(step.status)), 'Uncertain journal result');
    for (const key of ['prepare', 'pipeline.options', 'pipeline.draft', 'pipeline.save_draft']) {
      assert.equal(journal.steps[key]?.status, 'done', `Saved boundary missing: ${key}`);
    }
    assert.equal(journal.steps['pipeline.review:0']?.status, 'failed', 'Expected failed original review');
    const plan = seed.directorInput?.autoExecutionPlan;
    assert(plan && seed.autoExecution.mode === plan.mode, 'Scope missing or changed');
    if (plan.mode === 'chapter_range') {
      assert.equal(seed.autoExecution.startOrder, plan.startOrder, 'Requested start changed');
      assert.equal(seed.autoExecution.endOrder, plan.endOrder, 'Requested end changed');
      assert(original.startOrder >= plan.startOrder && original.endOrder <= plan.endOrder, 'Original batch outside approved range');
    } else if (plan.mode === 'volume') {
      assert.equal(seed.autoExecution.volumeOrder, plan.volumeOrder, 'Requested volume changed');
    }
    seed.autoExecution.pipelineJobId = originalJobId;
    seed.autoExecution.pipelineStatus = original.status;
    const result = { applied: apply, taskId, originalJobId, displacedJobId, chapterId, contentHash,
      unchanged: ['manuscripts', 'journals', 'bothJobs', 'budgets', 'manualPause', 'scope', 'commands'] };
    if (apply) {
      const changed = db.prepare('UPDATE NovelWorkflowTask SET seedPayloadJson=?,lastError=?,updatedAt=? WHERE id=? AND updatedAt=? AND seedPayloadJson=? AND pendingManualRecovery=1 AND cancelRequestedAt IS NULL')
        .run(JSON.stringify(seed), original.error, new Date(now).toISOString(), taskId, task.updatedAt, task.seedPayloadJson);
      assert.equal(changed.changes, 1, 'Binding compare-and-set failed');
      db.exec('COMMIT');
    } else db.exec('ROLLBACK');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

module.exports = { reconcilePausedDirectorBinding };
