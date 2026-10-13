const test = require('node:test');
const assert = require('node:assert/strict');
require('./offlineBootstrap.cjs');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const auto = loadRuntimeSource('../director/automation/novelDirectorAutoExecution.ts', {
  '@ai-novel/shared/types/chapterLengthControl': require('@ai-novel/shared/types/chapterLengthControl'),
  '../../pipelineJobState': {}, '../../production/ChapterExecutionStageRunner': {}, './novelDirectorAutoExecutionFailure': {},
});
const detector = loadRuntimeSource('../director/recovery/rangeCompletion/index.ts', {
  '../../automation/novelDirectorAutoExecution': auto, './acceptCommand': {},
});
const workflow = loadRuntimeSource('../workflow/novelWorkflow.shared.ts', {
  '@ai-novel/shared/types/novelWorkflow': require('@ai-novel/shared/types/novelWorkflow'),
});
const { buildDirectorDisplayState } = loadRuntimeSource('../director/projections/DirectorDisplayStateBuilder.ts', {
  '@ai-novel/shared/types/directorWorkflowStepCatalog': require('@ai-novel/shared/types/directorWorkflowStepCatalog'),
});
const { buildDirectorDashboardView } = loadRuntimeSource('../director/projections/DirectorDashboardViewBuilder.ts', {});
function fixture() {
  const chapters = [1, 2].map(order => ({ id: `chapter-${order}`, order, content: `saved-${order}`, generationState: 'approved', chapterStatus: 'completed' }));
  const row = { id: 'original-task', novelId: 'novel', title: 'original range', lane: 'auto_director', status: 'succeeded',
    checkpointType: 'workflow_completed', progress: 1, pendingManualRecovery: false, currentItemKey: 'completed',
    checkpointSummary: 'finished', createdAt: new Date(1000), updatedAt: new Date(2000), finishedAt: new Date(2000),
    attemptCount: 1, maxAttempts: 3, seedPayloadJson: JSON.stringify({ preserved: { budget: 42 },
      autoExecution: { enabled: true, mode: 'chapter_range', startOrder: 1, endOrder: 3,
        pipelineJobId: 'successful-history', totalChapterCount: 3, completedChapterCount: 2, remainingChapterCount: 0 },
      directorSession: { phase: 'completed', isBackgroundRunning: false } }) };
  const reads = [];
  const db = { chapter: { findMany: async () => { reads.push('chapters'); return chapters; } },
    directorRunCommand: { findFirst: async () => { reads.push('commands'); return null; } },
    novelWorkflowTask: { findMany: async () => [row], findUnique: async () => row } };
  const projection = loadRuntimeSource('../director/projections/rangeCompletion/index.ts', {
    '../../../../../db/prisma': { prisma: db }, '../../../workflow/novelWorkflow.shared': workflow,
    '../../automation/novelDirectorAutoExecution': auto, '../../recovery/rangeCompletion': detector,
  });
  return { row, chapters, db, reads, projection };
}

test('original 1-3 task projects pending source recovery at 2/3 without changing stored history or manuscripts', async () => {
  const f = fixture(), before = JSON.stringify([f.row, f.chapters]);
  const view = await f.projection.readIncompleteCompletedRangeProjection(f.row);
  assert.equal(view.id, f.row.id); assert.equal(view.status, 'waiting_approval');
  assert.equal(view.pendingManualRecovery, true); assert.equal(view.progress, 2 / 3);
  assert.equal(view.checkpointType, 'chapter_batch_ready'); assert.equal(view.currentItemKey, 'chapter_range_incomplete');
  assert.match(view.checkpointSummary, /2\/3/); assert.match(view.checkpointSummary, /第 3 章/);
  const seed = JSON.parse(view.seedPayloadJson);
  assert.deepEqual(seed.preserved, { budget: 42 }); assert.deepEqual(seed.autoExecution.remainingChapterOrders, [3]);
  assert.equal(seed.autoExecution.nextChapterId, null); assert.equal(seed.autoExecution.pipelineJobId, 'successful-history');
  const route = workflow.resumeTargetToRoute(JSON.parse(view.resumeTargetJson));
  assert.match(route, /directorTaskId=original-task/); assert.match(route, /novels\/novel\/edit/);
  assert.equal(JSON.stringify([f.row, f.chapters]), before); assert.deepEqual(f.reads.sort(), ['chapters', 'commands']);
});

test('range overlay excludes active commands and preserves complete, cancelled and unapproved tasks', () => {
  const f = fixture();
  for (const status of ['queued', 'leased', 'running']) {
    assert.equal(f.projection.projectIncompleteCompletedRange(f.row, f.chapters, { status }), f.row);
  }
  const all = [...f.chapters, { ...f.chapters[0], id: 'chapter-3', order: 3 }];
  assert.equal(f.projection.projectIncompleteCompletedRange(f.row, all).rangeCompletionVerified, true);
  for (const patch of [{ status: 'cancelled' }, { cancelRequestedAt: new Date() }, { lane: 'manual_create' },
    { seedPayloadJson: '{}' }, { seedPayloadJson: '{broken' }]) {
    const task = { ...f.row, ...patch };
    assert.equal(f.projection.projectIncompleteCompletedRange(task, f.chapters), task);
  }
});

test('runtime and chapter matrix cannot keep historical 100 percent or count outside-range chapters', () => {
  const f = fixture(), task = f.projection.projectIncompleteCompletedRange(f.row, f.chapters);
  const progress = { totalChapters: 3, completedChapters: 3, draftedChapterCount: 3, approvedChapterCount: 3,
    needsRepairChapters: 0, ratio: 1, chapters: [1, 2, 8].map(chapterOrder => ({ chapterId: `chapter-${chapterOrder}`,
      chapterOrder, status: 'approved', completedStages: ['draft_saved'], missingStages: [], currentStage: 'reviewable_or_approved' })) };
  const historical = { status: 'completed', progressBreakdown: { totalPercent: 100 }, chapterExecutionProgress: progress };
  const projected = f.projection.overlayIncompleteRangeRuntime(historical, task);
  assert.equal(projected.status, 'waiting_approval'); assert.equal(projected.progressBreakdown.totalPercent, 67);
  assert.equal(projected.requiresUserAction, true); assert.equal(projected.isAutopilotRecoverable, false);
  assert.equal(projected.chapterExecutionProgress.totalChapters, 3); assert.equal(projected.chapterExecutionProgress.ratio, 2 / 3);
  assert.equal(projected.chapterExecutionProgress.approvedChapterCount, 2);
  assert.equal(projected.chapterExecutionProgress.currentChapterOrder, 3);
  assert.equal(projected.chapterExecutionProgress.currentChapterId, null);
  assert.deepEqual(projected.chapterExecutionProgress.chapters.map(c => c.chapterOrder), [1, 2]);
  assert.equal(historical.progressBreakdown.totalPercent, 100);
  const displayState = buildDirectorDisplayState({ task, projection: projected, factStep: null });
  assert.equal(displayState.progressPercent, 67); assert.equal(displayState.mode, 'needs_recovery');
  const dashboard = buildDirectorDashboardView({ task, projection: projected, displayState });
  assert.equal(dashboard.mode, 'recovering'); assert.equal(dashboard.progressPercent, 67);
  const withoutRuntime = buildDirectorDisplayState({ task, projection: null, factStep: null });
  assert.equal(withoutRuntime.progressPercent, 67);
});

test('genuinely completed task stays completed despite a stale running event projection', () => {
  const f = fixture();
  const task = f.projection.projectIncompleteCompletedRange(f.row, [...f.chapters, { ...f.chapters[0], id: 'chapter-3', order: 3 }]);
  const projection = { status: 'running', currentLabel: 'historical running', headline: '正在自动导演' };
  const displayState = buildDirectorDisplayState({ task, projection, factStep: null });
  assert.equal(displayState.mode, 'completed'); assert.equal(displayState.progressPercent, 100);
  const dashboard = buildDirectorDashboardView({ task, projection, displayState });
  assert.equal(dashboard.mode, 'completed'); assert.equal(dashboard.progressPercent, 100);
  assert.doesNotMatch(dashboard.headline, /正在/);
  const incompleteFacts = { allStepsCompleted: false };
  const withoutEvidence = buildDirectorDisplayState({ task: f.row, projection, factStep: null, factSummary: incompleteFacts });
  assert.notEqual(withoutEvidence.mode, 'completed');
  assert.notEqual(buildDirectorDashboardView({ task: f.row, projection, displayState: withoutEvidence, factSummary: incompleteFacts }).mode, 'completed');
});

function adapter(f) {
  const { NovelWorkflowTaskAdapter } = loadRuntimeSource('../../task/adapters/NovelWorkflowTaskAdapter.ts', {
    '../../../db/prisma': { prisma: f.db }, '../../../middleware/errorHandler': {},
    '../../novel/director/commands/DirectorCommandService': { DirectorCommandService: class {} },
    '../../novel/director/automation/novelDirectorAutoExecutionFailure': { isSkippableAutoExecutionReviewFailure: () => false },
    '../../novel/workflow/NovelWorkflowService': { NovelWorkflowService: class { healAutoDirectorTaskState() { throw new Error('GET must not heal completed history'); } } },
    '../../novel/director/runtime/novelDirectorHelpers': { getDirectorLlmOptionsFromSeedPayload: () => null },
    '../../novel/workflow/novelWorkflowRecoveryHeuristics': { isAutoDirectorRecoveryInProgress: () => false },
    '../../novel/workflow/novelWorkflow.shared': workflow,
    '../taskSupport': { buildTaskRecoveryHint: () => null, normalizeFailureSummary: () => null },
    '../taskTokenUsageSummary': { toTaskTokenUsageSummary: () => null },
    '../taskArchive': { getArchivedTaskIds: async () => [], isTaskArchived: async () => false },
    '../novelWorkflowDetailSteps': { buildNovelWorkflowDetailSteps: () => [] },
    '../novelWorkflowExplainability': { buildWorkflowExplainability: () => ({ displayStatus: 'waiting_recovery' }) },
    '../novelWorkflowTaskSummary': { buildNovelWorkflowNextActionLabel: () => '回到章节工作区继续原任务' },
    '../../novel/director/projections/rangeCompletion': f.projection,
  });
  return new NovelWorkflowTaskAdapter();
}

test('readonly task-center detail/list expose original source recovery without a GET heal or write', async () => {
  const f = fixture(), before = JSON.stringify(f.row), view = adapter(f);
  const detail = await view.detail(f.row.id);
  assert.equal(detail.status, 'waiting_approval'); assert.equal(detail.finishedAt, null);
  assert.equal(detail.progress, 2 / 3); assert.match(detail.sourceRoute, /directorTaskId=original-task/);
  assert.match(detail.recoveryHint, /第 3 章/); assert.equal(detail.meta.seedPayload.preserved.budget, 42);
  const pending = await view.list({ status: 'waiting_approval', take: 20 });
  assert.equal(pending.length, 1); assert.equal(pending[0].id, f.row.id);
  assert.deepEqual(await view.list({ status: 'succeeded', take: 20 }), []);
  assert.equal(JSON.stringify(f.row), before);
});
