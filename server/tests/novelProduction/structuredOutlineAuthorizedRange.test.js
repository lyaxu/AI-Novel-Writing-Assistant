const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const core = require('../../dist/services/novel/director/automation/novelDirectorAutoExecution.js');
const recovery = require('../../dist/services/novel/director/recovery/novelDirectorStructuredOutlineRecovery.js');
const scope = require('../../dist/services/novel/director/automation/novelDirectorAutoExecutionScopeRuntime.js');
const preparation = require('../../dist/services/novel/director/automation/novelDirectorAutoExecutionRuntimePreparation.js');
const { buildProductionExperienceSeed } = require('../../dist/services/novel/director/commands/DirectorProductionExperienceService.js');

// Real incident: task cmv8d55el0033z8w0hneoiiru authorized 4-10, but the
// completed first route window contained only 4-5. Prose is replaced by sentinels.
function createHarness(startOrder = 4, endOrder = 10) {
  const rows = Array.from({ length: startOrder + 1 }, (_, i) => ({
    id: `chapter-${i + 1}`, order: i + 1,
    content: i + 1 < startOrder ? `protected-original-${i + 1}` : '',
    generationState: i + 1 < startOrder ? 'approved' : 'planned',
    chapterStatus: i + 1 < startOrder ? 'completed' : 'unplanned',
    expectation: 'offline route context',
  }));
  const workspace = {
    volumes: [{ id: 'volume-1', sortOrder: 1, title: 'Volume 1',
      chapters: rows.map(row => ({ id: row.id, chapterOrder: row.order, title: `Title ${row.order}`,
        volumeId: 'volume-1', payoffRefs: [], beatKey: 'prepared', taskSheet: null, sceneCards: null })) }],
    beatSheets: [{ volumeId: 'volume-1', beats: [
      { key: 'prepared', chapterSpanHint: `1-${startOrder + 1}章` },
      { key: 'future', chapterSpanHint: `${startOrder + 2}-${endOrder}章` },
    ] }],
  };
  const plan = { mode: 'chapter_range', startOrder, endOrder, autoReview: true, autoRepair: true };
  const request = { runMode: 'full_book_autopilot', autoExecutionPlan: plan,
    candidate: { workingTitle: 'Offline preserved sample', targetChapterCount: 100 }, estimatedChapterCount: 100 };
  const resets = []; const syncs = []; const checkpoints = [];
  const { runDirectorStructuredOutlinePhase } = loadRuntimeSource('../director/phases/novelDirectorStructuredOutlinePhase.ts', {
    '@ai-novel/shared/types/novelDirector': require('@ai-novel/shared/types/novelDirector'),
    '../../volume/chapterTitleDiversity': { getChapterTitleDiversityIssue: () => null },
    '../../workflow/novelWorkflow.shared': { buildNovelEditResumeTarget: value => value },
    '../../../../runtime/memoryTelemetry': { logMemoryUsage: () => {} },
    '../runtime/novelDirectorHelpers': { buildDirectorSessionState: value => value, normalizeDirectorRunMode: value => value },
    '../projections/novelDirectorProgress': require('../../dist/services/novel/director/projections/novelDirectorProgress.js'),
    '../automation/novelDirectorAutoExecution': core,
    '../recovery/novelDirectorStructuredOutlineRecovery': recovery,
    '../projections/directorProgressTracker': { runDirectorTrackedStep: () => assert.fail('Prepared route must not be regenerated') },
    '../recovery/novelDirectorDownstreamReset': { resetDirectorDownstreamChapterState: async (_novel, range) => resets.push(range) },
  });
  const dependencies = {
    volumeService: {
      updateVolumesWithOptions: async (_novel, value) => value,
      syncVolumeChaptersWithOptions: async (_novel, input) => { syncs.push(structuredClone(input)); },
      generateVolumes: async () => assert.fail('No live generation'),
    },
    workflowService: { bootstrapTask: async () => {}, recordCheckpoint: async (_task, checkpoint) => checkpoints.push(checkpoint) },
    novelContextService: { listChapters: async () => rows, updateNovel: async () => {} },
  };
  return { rows, workspace, plan, request, resets, syncs, checkpoints,
    run: () => runDirectorStructuredOutlinePhase({ taskId: 'same-scoped-task', novelId: 'same-book', request,
      baseWorkspace: workspace, dependencies, callbacks: { markDirectorTaskRunning: async () => {},
        buildDirectorSeedPayload: (directorInput, novelId, extra) => ({ directorInput, novelId,
          takeover: { strategy: 'continue_existing' }, ...extra }) } }) };
}

for (const [start, end] of [[4, 10], [201, 210]]) {
  test(`structured phase keeps authorized ${start}-${end} after preparing only the first two chapters`, async () => {
    const h = createHarness(start, end);
    const originals = structuredClone(h.rows);
    const cursor = recovery.resolveStructuredOutlineRecoveryCursor({ workspace: h.workspace, plan: h.plan, allowPartialChapterListReady: true });
    assert.deepEqual(cursor.selectedChapters.map(chapter => chapter.chapterOrder), [start, start + 1]);
    assert.equal(cursor.volumeChapterListComplete, false);
    await h.run();
    const checkpoint = h.checkpoints.at(-1);
    assert.equal(checkpoint.checkpointType, 'production_experience_required');
    const state = checkpoint.seedPayload.autoExecution;
    assert.equal(state.startOrder, start); assert.equal(state.endOrder, end);
    assert.equal(state.totalChapterCount, end - start + 1);
    assert.equal(state.completedChapterCount, 0);
    assert.deepEqual(state.remainingChapterOrders, Array.from({ length: end - start + 1 }, (_, i) => start + i));
    assert.equal(state.remainingChapterIds.length, 2);
    assert.deepEqual(h.resets, [{ startOrder: start, endOrder: start + 1 }]);
    assert.equal(h.syncs[0].preserveContent, true); assert.equal(h.syncs[0].applyDeletes, false);
    assert.deepEqual(h.syncs[0].executionContractChapterRange, { startOrder: start, endOrder: end });
    assert.deepEqual(h.rows, originals);

    // Continue from the actual phase checkpoint, not a hand-built correct seed.
    for (const experience of ['professional', 'simple']) {
      const seed = buildProductionExperienceSeed(checkpoint.seedPayload, experience);
      assert.deepEqual(seed.directorInput.autoExecutionPlan, h.plan);
      assert.equal(seed.autoExecution.endOrder, end);
    }
    const seed = buildProductionExperienceSeed(checkpoint.seedPayload, 'professional');
    let current = await scope.resolveAutoExecutionRangeAndState({ novelId: 'same-book',
      existingState: seed.autoExecution, allowLazyChapterPlanning: true,
      deps: { listChapters: async () => h.rows } });
    const generatedRoutes = [];
    const deps = { novelContextService: { listChapters: async () => h.rows },
      ensureRouteWindow: async (_novel, order, options) => {
        assert.equal(options.endOrder, order); assert.equal(options.target, 1);
        assert(order >= start + 2 && order <= end); generatedRoutes.push(order);
        h.rows.push({ id: `chapter-${order}`, order, content: '', expectation: 'offline route', generationState: 'planned' });
      } };
    for (let order = start; order <= end; order++) {
      current = await preparation.prepareNextAutoExecutionChapter(deps, { taskId: 'same-scoped-task', novelId: 'same-book',
        request: seed.directorInput, ...current });
      assert.equal(current.autoExecution.nextChapterOrder, order);
      const row = h.rows.find(chapter => chapter.order === order);
      row.content = `offline draft ${order}`; row.generationState = 'approved'; row.chapterStatus = 'completed';
      current = await scope.resolveAutoExecutionRangeAndState({ novelId: 'same-book', existingState: current.autoExecution,
        allowLazyChapterPlanning: true, deps: { listChapters: async () => h.rows } });
      assert.equal(current.range.startOrder, start); assert.equal(current.range.endOrder, end);
      assert.equal(core.isDirectorAutoExecutionRangeComplete(current.range, current.autoExecution), order === end);
    }
    assert.deepEqual(generatedRoutes, Array.from({ length: end - start - 1 }, (_, i) => start + 2 + i));
    assert.deepEqual(h.rows.filter(row => row.order < start), originals.filter(row => row.order < start));
    assert.equal(current.autoExecution.totalChapterCount, end - start + 1);
    assert.equal(current.autoExecution.remainingChapterCount, 0);
  });
}
