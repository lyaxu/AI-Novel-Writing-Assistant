const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const crypto = require('node:crypto');
const types = loadRuntimeSource('../production/reliability/types.ts', { 'node:crypto': crypto });
const hash = content => crypto.createHash('sha256').update(content.trim()).digest('hex');
const boundary = loadRuntimeSource('./artifactSync/ChapterArtifactSyncBoundary.ts', {
  './ChapterArtifactContentVersion': { buildChapterArtifactContentHash: hash },
});
for (const outcome of [null, 'degraded', 'completed', 'stale']) {
  test(`previous chapter ${outcome} boundary gates new chapter without invoking work`, async () => {
    const { assertPreviousChapterStateReady } = loadRuntimeSource('../production/preparation/PreviousChapterStateGuard.ts', {
      '../../../../db/prisma': { prisma: { chapter: { findFirst: async () => ({ order: 2 }), findMany: async () => [{ id: 'one', order: 1, content: 'actual retained', artifactSyncCheckpoints: outcome ? [{ artifactType: boundary.CHAPTER_ARTIFACT_BOUNDARY_TYPE, contentHash: hash(outcome === 'stale' ? 'old draft' : 'actual retained'), metadataJson: JSON.stringify({ outcome: outcome === 'stale' ? 'completed' : outcome }) }] : [] }] } } },
      '../reliability': types,
      '../../runtime/artifactSync': boundary,
    });
    if (outcome === 'completed') await assertPreviousChapterStateReady('n', 'two');
    else await assert.rejects(assertPreviousChapterStateReady('n', 'two'), error => error.code === 'CHAPTER_PRODUCTION_STORAGE' && error.message.includes('第1章'));
  });
}
for (const boundaryOperation of ['old-operation', 'active-operation']) {
  test(`same-text boundary from ${boundaryOperation} cannot complete a different operation`, async () => {
    const { assertPreviousChapterStateReady } = loadRuntimeSource('../production/preparation/PreviousChapterStateGuard.ts', {
      '../../../../db/prisma': { prisma: { chapter: { findFirst: async () => ({ order: 2 }), findMany: async () => [{ id: 'one', order: 1, content: 'actual retained', artifactSyncCheckpoints: [
        { artifactType: 'production_execution', contentHash: 'active', metadataJson: JSON.stringify({ operationId: 'active-operation' }) },
        { artifactType: boundary.CHAPTER_ARTIFACT_BOUNDARY_TYPE, contentHash: hash('actual retained'), metadataJson: JSON.stringify({ outcome: 'completed', operationId: boundaryOperation }) },
      ] }] } } },
      '../reliability': types,
      '../../runtime/artifactSync': boundary,
    });
    if (boundaryOperation === 'active-operation') await assertPreviousChapterStateReady('n', 'two');
    else await assert.rejects(assertPreviousChapterStateReady('n', 'two'), error => error.code === 'CHAPTER_PRODUCTION_STORAGE');
  });
}
for (const action of ['stop_for_replan', 'local_patch_plan']) {
  test(`local window ${action} follows explicit structured action before scope`, async () => {
    let replanned = 0;
    const { applyChapterQualityClosure } = loadRuntimeSource('../production/qualityClosure/ChapterQualityClosure.ts', {
      '../../novelCoreShared': { logPipelineError() {}, logPipelineWarn() {} },
      '../../novelCoreReviewService': { createQualityReport: async () => {} },
      '../../quality/ChapterQualityLoopService': { chapterQualityLoopService: { recordAssessment: async () => {} } },
      '../issueGovernance/PipelineIssueGovernance': { reportPipelineIssue: async input => { await input.applyAction({ action: 'continue_with_warning' }); } },
    });
    const result = await applyChapterQualityClosure({ governance: null, novelId: 'n', jobId: 'job', chapter: { id: 'c', order: 1 },
      chapterResult: { pass: false, reviewExecuted: true, retryCountUsed: 0, score: { overall: 70 }, issues: [], runtimePackage: {
        replanRecommendation: { recommended: true, scope: 'local_window', action, affectedChapterOrders: [2], blockingIssueIds: [], reason: 'structured decision' },
      } }, qualityThreshold: 80, runtimePayload: { autoReview: true }, qualityAlertDetails: [], replanAlertDetails: [], recoverableRepairDetails: [],
      runLocalReplan: async () => { replanned++; return { affectedChapterOrders: [2] }; },
    });
    assert.equal(result.shouldStopAfterCurrentChapter, action === 'stop_for_replan');
    assert.equal(replanned, action === 'stop_for_replan' ? 0 : 1);
  });
}
