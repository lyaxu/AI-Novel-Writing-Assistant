const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { validateAutoDirectorTakeoverRequest } = require('../../dist/services/novel/director/runtime/autoDirectorValidationService.js');
const { applyDirectorRunModeContract } = require('../../dist/services/novel/director/runtime/novelDirectorHelpers.js');
const { resolveTakeoverExecutionDirectorInput } = require('../../dist/services/novel/director/runtime/novelDirectorTakeoverExecution.js');
const { buildProductionExperienceSeed } = require('../../dist/services/novel/director/commands/DirectorProductionExperienceService.js');
const { buildRequestedAutoExecutionState, resolveAutoExecutionRangeAndState } = require('../../dist/services/novel/director/automation/novelDirectorAutoExecutionScopeRuntime.js');
const { prepareNextAutoExecutionChapter } = require('../../dist/services/novel/director/automation/novelDirectorAutoExecutionRuntimePreparation.js');
const { isDirectorAutoExecutionRangeComplete } = require('../../dist/services/novel/director/automation/novelDirectorAutoExecution.js');

// Structural facts from the 2026-10-14 completed real sample: only 1-3 exist,
// all approved; the book estimate is 100. No manuscript or live database needed.
const snapshot = { chapterCount: 3, firstVolumeChapterCount: 3, plannedChapterCount: 100,
  generatedChapterCount: 3, approvedChapterCount: 3, volumeCount: 3,
  volumeChapterRanges: [{ volumeOrder: 1, startOrder: 1, endOrder: 3 }] };

test('actual completed sample UI selection survives validation, interface choice, lazy preparation and exact 4-10 completion', async () => {
  const ui = await import(pathToFileURL(path.resolve(__dirname,
    '../../../client/src/pages/novels/components/novelExistingProjectTakeoverViewModel.ts')).href);
  const readiness = { snapshot, executableRange: { startOrder: 1, endOrder: 3,
    totalChapterCount: 3, nextChapterOrder: null }, entrySteps: [] };
  const selection = ui.resolveTakeoverQuickExecution(ui.buildTakeoverChapterTarget(readiness, null, 10),
    ui.buildTakeoverContinuousTarget(readiness, null, 10));
  assert.equal(selection.useFullBookPlan, false);
  const plan = selection.plan;
  assert.deepEqual(plan, { mode: 'chapter_range', startOrder: 4, endOrder: 10, autoReview: true, autoRepair: true });
  const request = { novelId: 'same-book', entryStep: 'chapter', strategy: 'continue_existing',
    runMode: selection.runMode, autoExecutionPlan: plan };
  const assets = { ...snapshot, totalChapterCount: 3, hasProjectSetup: true, hasStoryMacroPlan: true,
    hasBookContract: true, characterCount: 4, hasVolumeStrategyPlan: true, hasStructuredOutline: true,
    structuredOutlineChapterOrders: [1, 2, 3] };
  assert.equal(validateAutoDirectorTakeoverRequest({ request, assets }).allowed, true);
  assert.equal(validateAutoDirectorTakeoverRequest({ request: { ...request, runMode: 'auto_to_execution' }, assets }).allowed, false);
  const directorInput = resolveTakeoverExecutionDirectorInput({ request,
    directorInput: applyDirectorRunModeContract({ ...request, candidate: { targetChapterCount: 100 }, estimatedChapterCount: 100 }),
    autoExecutionPlan: plan });
  let seed = { takeover: { strategy: 'continue_existing' }, directorInput,
    autoExecution: { enabled: true, mode: 'chapter_range', startOrder: 1, endOrder: 3, completedChapterCount: 3 } };
  for (const experience of ['professional', 'simple']) {
    seed = buildProductionExperienceSeed(seed, experience);
    assert.deepEqual(seed.directorInput.autoExecutionPlan, plan);
    assert.deepEqual(seed.autoExecutionPlan, plan);
    assert.throws(() => buildProductionExperienceSeed(seed, experience, 'book'), /接管范围已确认/);
  }
  const rows = [1, 2, 3].map(order => ({ id: `saved-${order}`, order, content: `protected-original-${order}`,
    generationState: 'approved', chapterStatus: 'completed' }));
  const originals = structuredClone(rows);
  const state = buildRequestedAutoExecutionState({ request: seed.directorInput, existingState: seed.autoExecution });
  let current = await resolveAutoExecutionRangeAndState({ novelId: 'same-book', deps: { listChapters: async () => rows },
    existingState: state, allowLazyChapterPlanning: true });
  assert.equal(current.autoExecution.remainingChapterCount, 7);
  assert.deepEqual(current.autoExecution.remainingChapterOrders, [4, 5, 6, 7, 8, 9, 10]);
  const prepared = [];
  const deps = { novelContextService: { listChapters: async () => rows },
    ensureRouteWindow: async (_novel, order, options) => {
      assert.equal(options.endOrder, order); assert.equal(options.target, 1);
      assert(order >= 4 && order <= 10); prepared.push(order);
      rows.push({ id: `new-${order}`, order, content: '', expectation: 'offline approved route', generationState: 'planned' });
    } };
  for (let order = 4; order <= 10; order++) {
    current = await prepareNextAutoExecutionChapter(deps, { taskId: 'new-scoped-task', novelId: 'same-book',
      request: seed.directorInput, ...current });
    assert.equal(current.autoExecution.nextChapterOrder, order);
    assert.equal(current.range.startOrder, 4); assert.equal(current.range.endOrder, 10);
    const row = rows.find(chapter => chapter.order === order);
    row.content = `offline-produced-${order}`; row.generationState = 'approved'; row.chapterStatus = 'completed';
    current = await resolveAutoExecutionRangeAndState({ novelId: 'same-book', deps: { listChapters: async () => rows },
      existingState: current.autoExecution, allowLazyChapterPlanning: true });
  }
  assert.deepEqual(prepared, [4, 5, 6, 7, 8, 9, 10]);
  assert.equal(isDirectorAutoExecutionRangeComplete(current.range, current.autoExecution), true);
  assert.equal(current.autoExecution.totalChapterCount, 7);
  assert.equal(current.autoExecution.remainingChapterCount, 0);
  assert.deepEqual(rows.slice(0, 3), originals);
  await assert.rejects(prepareNextAutoExecutionChapter(deps, { taskId: 'new-scoped-task', novelId: 'same-book',
    request: seed.directorInput, ...current, autoExecution: { ...current.autoExecution, nextChapterOrder: 11 } }), /已授权/);
  assert.equal(prepared.length, 7);
});
