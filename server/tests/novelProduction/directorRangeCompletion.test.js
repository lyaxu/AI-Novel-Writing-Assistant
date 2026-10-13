const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const prefix = '../director/automation/';
const sharedDirector = require('@ai-novel/shared/types/novelDirector');
const failures = { isSkippableAutoExecutionReviewFailure: () => false };
const core = loadRuntimeSource(`${prefix}novelDirectorAutoExecution.ts`, {
  '@ai-novel/shared/types/chapterLengthControl': require('@ai-novel/shared/types/chapterLengthControl'),
  '../../pipelineJobState': {}, '../../production/ChapterExecutionStageRunner': { buildPipelineExecutionControlPolicy: () => ({ advanceMode: 'full_book_autopilot' }) },
  './novelDirectorAutoExecutionFailure': failures,
});
const scope = loadRuntimeSource(`${prefix}novelDirectorAutoExecutionScopeRuntime.ts`, {
  '@ai-novel/shared/types/directorCompletion': require('@ai-novel/shared/types/directorCompletion'),
  './novelDirectorAutoExecution': core, './novelDirectorAutoExecutionFailure': failures,
  '../recovery/novelDirectorStructuredOutlineRecovery': {},
});
class ChapterProductionError extends Error { constructor(code, message) { super(message); this.code = code; } }
const preparation = loadRuntimeSource(`${prefix}novelDirectorAutoExecutionRuntimePreparation.ts`, {
  '@ai-novel/shared/types/novelDirector': sharedDirector,
  './novelDirectorAutoExecutionScopeRuntime': scope, './novelDirectorAutoExecutionFailure': failures,
  '../../production/reliability': { ChapterProductionError },
});
const checkpoints = loadRuntimeSource(`${prefix}novelDirectorAutoExecutionCheckpointRuntime.ts`, {
  '@ai-novel/shared/types/novelDirector': sharedDirector,
  '../../workflow/novelWorkflow.shared': { buildNovelEditResumeTarget: value => value },
  './novelDirectorAutoExecution': core, '../runtime/novelDirectorHelpers': { buildDirectorSessionState: value => value },
  '../../pipelineJobState': {}, '../phases/novelDirectorQualityRepairRisk': {},
});
const utils = loadRuntimeSource(`${prefix}novelDirectorAutoExecutionRuntimeUtils.ts`, {});
const runtime = loadRuntimeSource(`${prefix}novelDirectorAutoExecutionRuntime.ts`, {
  '@ai-novel/shared/types/novelDirector': sharedDirector,
  './novelDirectorAutoExecution': core, './novelDirectorAutoExecutionCheckpointRuntime': checkpoints,
  './novelDirectorAutoExecutionFailure': failures, './novelDirectorAutoExecutionRuntimePreparation': preparation,
  './novelDirectorAutoExecutionRuntimeUtils': utils,
  './novelDirectorAutoExecutionCircuitBreakerRuntime': { isDirectorCircuitBreakerOpen: () => false, resolveUsageCircuitBreaker: async () => null },
  '../../../../db/prisma': { prisma: { novelWorkflowTask: { findUnique: async () => null } } },
  '../../production/reliability': { ChapterProductionError },
});
const chapter = (order, complete = true) => ({ id: `c${order}`, order, content: complete ? `saved-${order}` : '',
  expectation: '已有路线', generationState: complete ? 'approved' : 'planned' });
const range = (startOrder = 1, endOrder = 3) => ({ startOrder, endOrder, totalChapterCount: endOrder - startOrder + 1, firstChapterId: `c${startOrder}` });
const plan = (startOrder = 1, endOrder = 3) => ({ enabled: true, mode: 'chapter_range', startOrder, endOrder });
const build = (rows, limits = range(), extra = {}) => core.buildDirectorAutoExecutionState({ range: limits, chapters: rows, plan: { ...plan(limits.startOrder, limits.endOrder), ...extra } });

test('range 1-3 counts nonexistent third chapter and never requeues approved chapters', () => {
  const state = build([chapter(1), chapter(2)]);
  assert.equal(state.completedChapterCount, 2); assert.equal(state.totalChapterCount, 3);
  assert.equal(state.remainingChapterCount, 1); assert.deepEqual(state.remainingChapterOrders, [3]);
  assert.deepEqual(state.remainingChapterIds, []); assert.equal(state.nextChapterOrder, 3); assert.equal(state.nextChapterId, null);
  assert.equal(core.isDirectorAutoExecutionRangeComplete(range(), state), false);
});

test('middle holes precede existing pending rows and out-of-range rows do not affect progress', () => {
  const state = build([chapter(1), chapter(3), chapter(4, false), chapter(5)], range(1, 4));
  assert.deepEqual(state.remainingChapterOrders, [2, 4]); assert.deepEqual(state.remainingChapterIds, ['c4']);
  assert.equal(state.nextChapterOrder, 2); assert.equal(state.nextChapterId, null); assert.equal(state.completedChapterCount, 2);
});

test('high-order 201-203 range counts missing chapter 202 using the same policy', () => {
  const state = build([chapter(200), chapter(201), chapter(203), chapter(204)], range(201, 203));
  assert.deepEqual(state.remainingChapterOrders, [202]); assert.equal(state.completedChapterCount, 2);
  assert.equal(state.nextChapterOrder, 202); assert.equal(state.nextChapterId, null);
  assert.equal(core.isDirectorAutoExecutionRangeComplete(range(201, 203), state), false);
});

test('normal complete range, empty chapter rows and invalid range have distinct outcomes', () => {
  assert.equal(core.isDirectorAutoExecutionRangeComplete(range(), build([chapter(1), chapter(2), chapter(3), chapter(4, false)])), true);
  assert.deepEqual(build([]).remainingChapterOrders, [1, 2, 3]);
  for (const limits of [range(2, 1), range(0, 3), range(1, Infinity)]) assert.throws(() => build([], limits), /范围无效/);
  const stale = { ...build([chapter(1), chapter(2)]), remainingChapterCount: 0, remainingChapterOrders: [], nextChapterOrder: null };
  assert.equal(core.isDirectorAutoExecutionRangeComplete(range(), stale), false);
});

test('a skipped missing or blank chapter cannot count as a preserved quality-debt chapter', () => {
  const state = build([chapter(1), chapter(2, false)], range(), { skippedChapterOrders: [2, 3], qualityDebtChapterOrders: [2, 3] });
  assert.deepEqual(state.remainingChapterOrders, [2, 3]); assert.deepEqual(state.skippedChapterOrders, []);
});

test('scope read counts lazy holes but rejects them without lazy authorization and performs no planning', async () => {
  const input = { novelId: 'n', existingState: { ...plan(), totalChapterCount: 2 }, deps: { listChapters: async () => [chapter(1), chapter(2)] } };
  const result = await scope.resolveAutoExecutionRangeAndState({ ...input, allowLazyChapterPlanning: true });
  assert.equal(result.range.totalChapterCount, 3); assert.equal(result.autoExecution.nextChapterOrder, 3);
  await assert.rejects(scope.resolveAutoExecutionRangeAndState(input), /缺少第 3 章/);
  await assert.rejects(scope.resolveAutoExecutionRangeAndState({ ...input, existingState: null, deps: { listChapters: async () => [] } }), /还没有可自动执行/);
});

function executionHarness(initialRows, endOrder = 3, ensureImpl) {
  const rows = structuredClone(initialRows); const prepared = []; const starts = []; const savedCheckpoints = [];
  const task = { id: 'task', novelId: 'n', status: 'running', seedPayloadJson: '{}', startedAt: new Date(1000) };
  const request = { candidate: { workingTitle: 'offline', targetChapterCount: 10 }, runMode: 'full_book_autopilot', autoExecutionPlan: plan(1, endOrder) };
  const deps = {
    novelContextService: { listChapters: async () => rows },
    ensureRouteWindow: async (novelId, order, options) => {
      prepared.push({ novelId, order, options });
      if (ensureImpl) return ensureImpl(rows, order, options);
      rows.push(chapter(order, false)); return { availableRouteCount: 1, extended: true };
    },
    novelService: {
      findActivePipelineJobForRange: async () => null,
      startPipelineJob: async (_novelId, options) => {
        starts.push(options); const row = rows.find(row => row.order === options.startOrder);
        assert.ok(row); assert.notEqual(row.generationState, 'approved', 'completed manuscript cannot be rewritten');
        row.generationState = 'approved'; row.content = `new-${row.order}`;
        return { id: `job-${row.order}`, status: 'succeeded' };
      },
      getPipelineJobById: async id => ({ id, status: 'succeeded', progress: 1 }),
    },
    workflowService: { getTaskByIdWithoutHealing: async () => ({ ...task }),
      bootstrapTask: async input => { task.seedPayloadJson = JSON.stringify(input.seedPayload); },
      markTaskRunning: async () => {}, recordCheckpoint: async (_id, checkpoint) => savedCheckpoints.push(checkpoint) },
    buildDirectorSeedPayload: (_request, _novelId, extra) => extra,
  };
  return { rows, deps, request, task, prepared, starts, savedCheckpoints,
    run: () => new runtime.NovelDirectorAutoExecutionRuntime(deps).runFromReady({ taskId: 'task', novelId: 'n', request, existingState: plan(1, endOrder) }) };
}

test('runtime materializes chapter 3 in its original task then executes it once before completing 1-3', async () => {
  const h = executionHarness([chapter(1), chapter(2), chapter(4, false)]);
  await h.run();
  assert.deepEqual(h.prepared.map(item => [item.order, item.options.endOrder, item.options.min, item.options.target, item.options.taskId]), [[3, 3, 1, 1, 'task']]);
  assert.deepEqual(h.starts.map(item => [item.startOrder, item.endOrder, item.skipCompleted]), [[3, 3, true]]);
  assert.equal(h.rows.find(row => row.order === 1).content, 'saved-1'); assert.equal(h.rows.find(row => row.order === 2).content, 'saved-2');
  assert.equal(h.rows.find(row => row.order === 4).content, '');
  assert.equal(h.savedCheckpoints.length, 1); assert.equal(h.savedCheckpoints[0].checkpointType, 'workflow_completed');
  assert.equal(h.savedCheckpoints[0].seedPayload.autoExecution.completedChapterCount, 3);
});

test('succeeded prior job advances to the missing route without resuming its saved chapter', async () => {
  const h = executionHarness([chapter(1), chapter(2)]);
  h.deps.novelService.resumePipelineJob = async () => assert.fail('the succeeded chapter job must never be resumed');
  await new runtime.NovelDirectorAutoExecutionRuntime(h.deps).runFromReady({
    taskId: 'task', novelId: 'n', request: h.request, existingPipelineJobId: 'old-chapter-2-job',
    existingState: { ...plan(), pipelineJobId: 'old-chapter-2-job', pipelineStatus: 'succeeded' },
  });
  assert.deepEqual(h.starts.map(item => item.startOrder), [3]);
  assert.equal(h.rows.find(row => row.order === 2).content, 'saved-2');
  assert.equal(h.savedCheckpoints[0].seedPayload.autoExecution.completedChapterCount, 3);
});

test('next-route planning clears the succeeded chapter job before the real planning write guard captures ownership', async () => {
  const h = executionHarness([chapter(1), chapter(2)], 4);
  const oldState = { ...plan(1, 4), pipelineJobId: 'old-chapter-2-job', pipelineStatus: 'succeeded' };
  h.task.seedPayloadJson = JSON.stringify({ autoExecution: oldState });
  const fakeDb = { novelWorkflowTask: { findUnique: async () => ({ ...h.task }) },
    generationJob: { findUnique: async ({ where }) => ({ id: where.id, novelId: 'n', status: 'succeeded', startedAt: new Date(1000) }) } };
  const { createVolumeGenerationWriteGuard } = loadRuntimeSource('../volume/infrastructure/VolumeGenerationWriteGuard.ts', { '../../../../db/prisma': { prisma: fakeDb } });
  await assert.rejects(createVolumeGenerationWriteGuard('n', 'task'), error => error.code === 'PIPELINE_CANCELLED');
  const ensure = h.deps.ensureRouteWindow;
  const guardedOrders = [];
  h.deps.ensureRouteWindow = async (...args) => {
    assert.equal(JSON.parse(h.task.seedPayloadJson).autoExecution.pipelineJobId, null);
    const guard = await createVolumeGenerationWriteGuard('n', 'task');
    await guard(fakeDb);
    guardedOrders.push(args[1]); return ensure(...args);
  };
  await new runtime.NovelDirectorAutoExecutionRuntime(h.deps).runFromReady({
    taskId: 'task', novelId: 'n', request: h.request, existingPipelineJobId: 'old-chapter-2-job', existingState: oldState,
  });
  assert.deepEqual(guardedOrders, [3, 4]);
  assert.deepEqual(h.starts.map(item => item.startOrder), [3, 4]);
  assert.equal(h.rows.find(row => row.order === 2).content, 'saved-2');
});

test('a completed fixed chapter range is finished even when its volume has more chapters to plan', async () => {
  for (const mode of ['chapter_range', 'volume']) {
    const h = executionHarness([chapter(1), chapter(2), chapter(3)]);
    const state = build(h.rows, range(), { mode, volumeChapterListComplete: false });
    await checkpoints.recordCompletedCheckpoint(h.deps, { taskId: 'task', novelId: 'n', request: h.request, range: range(), autoExecution: state });
    assert.equal(h.savedCheckpoints[0].checkpointType, mode === 'volume' ? 'chapter_batch_ready' : 'workflow_completed');
    assert.equal(h.savedCheckpoints[0].seedPayload.autoExecution.endOrder, 3);
  }
});

test('runtime fills a middle gap before a later pending chapter and stops at the fixed boundary', async () => {
  const h = executionHarness([chapter(1), chapter(3, false), chapter(4, false)]);
  await h.run();
  assert.deepEqual(h.prepared.map(item => item.order), [2]); assert.deepEqual(h.starts.map(item => item.startOrder), [2, 3]);
});

test('runtime prepares several missing chapters in order while preserving the saved first chapter', async () => {
  const h = executionHarness([chapter(1), chapter(5, false)], 4);
  await h.run();
  assert.deepEqual(h.prepared.map(item => item.order), [2, 3, 4]);
  assert.deepEqual(h.starts.map(item => item.startOrder), [2, 3, 4]);
  assert.equal(h.rows.find(row => row.order === 1).content, 'saved-1');
  assert.equal(h.rows.find(row => row.order === 5).content, '');
});

test('no generated route never becomes successful or starts a nonexistent chapter', async () => {
  const h = executionHarness([chapter(1), chapter(2)], 3, async () => ({ availableRouteCount: 0, extended: false }));
  await assert.rejects(h.run(), /第 3 章规划尚未同步/);
  assert.equal(h.starts.length, 0); assert.equal(h.savedCheckpoints.length, 0);
});

test('completion checkpoint rejects a stale remaining=0 snapshot before any workflow write', async () => {
  const h = executionHarness([chapter(1), chapter(2)]);
  await assert.rejects(checkpoints.recordCompletedCheckpoint(h.deps, { taskId: 'task', novelId: 'n', request: h.request,
    range: range(), autoExecution: { ...build(h.rows), remainingChapterCount: 0 } }), /不能标记为全部完成/);
  assert.equal(h.savedCheckpoints.length, 0);
});

test('planning is forbidden for nonlazy or out-of-range next chapter', async () => {
  const h = executionHarness([chapter(1), chapter(2)]);
  for (const input of [{ request: { ...h.request, runMode: 'auto_to_execution' }, autoExecution: build(h.rows) },
    { request: h.request, autoExecution: { ...build(h.rows), nextChapterOrder: 4 } },
    { request: h.request, autoExecution: { ...build(h.rows), nextChapterOrder: 4, nextChapterId: 'c4' } }]) {
    await assert.rejects(preparation.prepareNextAutoExecutionChapter(h.deps, { taskId: 'task', novelId: 'n', range: range(), ...input }), /不在已授权/);
  }
  assert.equal(h.prepared.length, 0);
});
