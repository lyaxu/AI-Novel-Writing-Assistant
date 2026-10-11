const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');

test('recovery GET only inspects the chapter journal and never runs a workflow step', async () => {
  const routes = [];
  const inspected = [];
  const snapshot = { operationId: 'operation', status: 'paused', partialText: '半章', steps: [] };
  const { registerNovelChapterGenerationRoutes } = loadRuntimeSource('../../../modules/novel/production/http/novelChapterGeneration.ts', {
    '../../../../llm/streaming': { streamToSSE: () => assert.fail('must not stream') },
    '../../../../middleware/validate': { validate: () => () => {} },
    '../../../../services/novel/runtime/chapterRuntimeSchema': { chapterRuntimeRequestSchema: {} },
    '../../../../services/novel/director/workflowStepRuntime/StepModuleRunner': { stepModuleRunner: { runStep: () => assert.fail('must not run') } },
    '../../../../services/novel/director/workflowStepRuntime/directorWorkflowStepIds': { DIRECTOR_EXECUTION_STEP_IDS: {} },
    '../../../../services/novel/production/reliability': { createDefaultChapterProductionJournal: () => ({ inspect: async input => { inspected.push(input); return snapshot; } }) },
  });
  registerNovelChapterGenerationRoutes({
    router: { get: (...args) => routes.push(args), post: () => {} }, chapterParamsSchema: {}, forwardBusinessError: () => false,
  });
  assert.equal(routes[0][0], '/:id/chapters/:chapterId/runtime/recovery');
  let response;
  await routes[0].at(-1)({ params: { id: 'n', chapterId: 'c' } }, { json: value => { response = value; } }, error => { throw error; });
  assert.deepEqual(inspected, [{ novelId: 'n', chapterId: 'c' }]);
  assert.equal(response.data, snapshot);
});
