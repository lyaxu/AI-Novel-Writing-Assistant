const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');

test('recovery GET only inspects the chapter journal and never runs a workflow step', async () => {
  const routes = [];
  const inspected = [];
  const snapshot = { operationId: 'operation', status: 'paused', partialText: '半章', steps: [] };
  const { registerNovelChapterGenerationRoutes } = loadRuntimeSource('../../../modules/novel/production/http/novelChapterGeneration.ts', {
    zod: require('zod'),
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

for (const entry of ['stream', 'repair', 'pipeline']) {
  test(`explicit recovery preserves original ${entry} entry and options`, async () => {
    const routes = []; const calls = []; let streamed = false;
    const { registerNovelChapterGenerationRoutes } = loadRuntimeSource('../../../modules/novel/production/http/novelChapterGeneration.ts', {
      zod: require('zod'),
      '../../../../llm/streaming': { streamToSSE: async () => { streamed = true; } },
      '../../../../middleware/validate': { validate: () => () => {} },
      '../../../../services/novel/runtime/chapterRuntimeSchema': { chapterRuntimeRequestSchema: {} },
      '../../../../services/novel/director/workflowStepRuntime/StepModuleRunner': { stepModuleRunner: { runStep: async (...args) => { calls.push(args); return { stream: {}, onDone() {} }; } } },
      '../../../../services/novel/director/workflowStepRuntime/directorWorkflowStepIds': { DIRECTOR_EXECUTION_STEP_IDS: { chapter_execution: 'execute', chapter_repair: 'repair' } },
      '../../../../services/novel/production/reliability': { createDefaultChapterProductionJournal: () => ({ readResumeRequest: async input => {
        assert.equal(input.operationId, 'original'); return { entry, model: 'original-model', temperature: 0.4 };
      } }) },
    });
    registerNovelChapterGenerationRoutes({ router: { get() {}, post: (...args) => routes.push(args) }, chapterParamsSchema: {}, forwardBusinessError: () => false });
    let error;
    await routes.find(route => route[0].endsWith('/recovery/resume')).at(-1)({ params: { id: 'n', chapterId: 'c' }, body: { operationId: 'original', model: 'injected' } }, {}, value => { error = value; });
    if (entry === 'pipeline') { assert.ok(error); assert.equal(calls.length, 0); return; }
    assert.equal(error, undefined); assert.equal(streamed, true);
    assert.equal(calls[0][0], entry === 'repair' ? 'repair' : 'execute');
    const options = entry === 'repair' ? calls[0][1].stepInput : calls[0][1].stepInput.options;
    assert.equal(options.model, 'original-model'); assert.equal(options.productionOperationId, 'original');
  });
}
