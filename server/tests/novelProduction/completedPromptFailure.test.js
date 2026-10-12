const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const contracts = loadRuntimeSource('../production/reliability/types.ts', { 'node:crypto': require('node:crypto') });
const { createChapterProductionJournal } = loadRuntimeSource('../production/reliability/session.ts', {
  'node:crypto': require('node:crypto'), './types': contracts,
});
const execution = loadRuntimeSource('../production/reliability/executionContext.ts', {
  'node:async_hooks': require('node:async_hooks'),
  '../../../../llm/invocation/executionPolicy': { withUnknownOutcomeProtection: fn => fn() },
});

function realPromptRunner() {
  const noCall = () => assert.fail('unmocked external call');
  return loadRuntimeSource(path.resolve(__dirname, '../../src/prompting/core/promptRunner.ts'), {
    '@langchain/core/messages': { HumanMessage: class { constructor(content) { this.content = content; } } },
    '../../llm/factory': { getLLM: noCall },
    '../../llm/structuredInvoke': { invokeStructuredLlmDetailed: noCall },
    '../../llm/structuredOutput': {}, '../../llm/usageTracking': {},
    '../../runtime/memoryTelemetry': { logMemoryUsage() {} },
    '../../services/novel/novelP0Utils': { toText: value => String(value ?? '') },
    '../../platform/llm/live/llmLiveSession': {}, '../../llm/reasoning': {},
    '../registry': { hasRegisteredPromptAsset: () => true },
    '../slots/slotResolution': { CUSTOM_SLOT_CONTEXT_GROUP: 'custom' },
    '../slots/PromptSlotOverrideService': {},
    '../templates/templateRuntime': { resolveAdvancedPromptMessages: async input => input.officialMessages },
    './contextSelection': { selectContextBlocks: blocks => ({ selectedBlocks: blocks, droppedBlockIds: [], summarizedBlockIds: [], estimatedTokens: 0 }) },
    './promptQualityTelemetry': { recordPromptQualityEvent() {} },
    './structuredOutputHint': { appendStructuredOutputHintMessages: input => input.messages },
    './streaming/promptStreamCapture': {}, '../../platform/llm/streaming/responseDiagnostics': {},
    './streaming/promptOutputLimit': {},
  });
}

function harness({ failureAt, failure, reject = true, journalFailure = false } = {}) {
  const runner = realPromptRunner();
  const calls = [];
  let record = null;
  let failRecord = journalFailure;
  const chapter = { id: 'chapter-2', novelId: 'novel', title: '第二章', content: '', taskSheet: 'approved contract',
    sceneCards: null, expectation: null, targetWordCount: 3000 };
  const journal = createChapterProductionJournal({ repository: { transaction: async action => {
    const before = record;
    try { return await action({
      readChapter: async () => structuredClone(chapter), readJournal: async () => record && { metadataJson: record },
      writeJournal: async (_n, _c, expected, next) => {
        assert.equal(record, expected);
        if (failRecord && JSON.parse(next).steps['prepare.chapter_plan']?.rejectedResponses?.length) {
          failRecord = false; throw new Error('disk rejected saved response');
        }
        record = next;
      },
      archiveJournal: async () => assert.fail('must keep original chapter operation'),
    }); } catch (error) { record = before; throw error; }
  } } });
  runner.setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    if (calls.length === failureAt) throw failure;
    return { data: { plan: 'complete response', attempt: calls.length }, repairUsed: false, repairAttempts: 0 };
  });
  const asset = { id: 'offline.chapter.plan', version: 'v1', mode: 'structured', taskType: 'planner',
    outputSchema: {}, contextPolicy: {}, semanticRetryPolicy: { maxAttempts: 1 }, render: () => [],
    postValidate: output => { if (reject) throw new Error('contract quote not present'); return output; } };
  const { ChapterStreamGenerationOrchestrator } = loadRuntimeSource('ChapterStreamGenerationOrchestrator.ts', {
    '../chapterWritingGraph': {}, '../novelP0Utils': {}, './GenerationContextAssembler': {},
    './ChapterRuntimeReadinessService': {}, '../production/reliability': execution,
    '../../planner/plannerPersistence': { buildChapterExecutionContractHash: () => 'contract' },
    './chapterEmptyContentError': {}, './ChapterContentFinalizationService': {},
  });
  const orchestrator = new ChapterStreamGenerationOrchestrator({
    validateRequest: input => input, ensureNovelCharacters: async () => {},
    preparationService: { prepare: () => execution.productionStep('prepare.chapter_plan', async () => {
      const result = await runner.runStructuredPrompt({ asset, promptInput: {}, options: { taskId: 'job', chapterId: chapter.id } });
      // Stand-in for the planner's local persistence, never confuse raw output with saved StoryPlan.
      return { planId: 'saved-plan', output: result.output };
    }, true) },
    assembler: { assemble: async () => ({ novel: {}, chapter, contextPackage: { chapter } }) },
    readinessService: { assertReady() {} },
  });
  return {
    calls, journal, record: () => JSON.parse(record), acceptNext: () => { reject = false; },
    open: () => journal.open({ novelId: chapter.novelId, chapterId: chapter.id, operationId: 'pipeline:job:chapter-2', request: { entry: 'pipeline' } }),
    run: session => execution.withProductionSession(session, () => orchestrator.prepareRuntimeChapter(chapter.novelId, chapter.id)),
  };
}

test('complete semantic rejection crosses real runner and nested preparation as a retained definitive failure', async () => {
  const f = harness(); const session = await f.open();
  let caught;
  await assert.rejects(f.run(session), error => {
    caught = error;
    assert.equal(error.code, 'PROMPT_POST_VALIDATION_FAILED');
    assert.equal(Object.keys(error).includes('completedPromptResponse'), false);
    return true;
  });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].promptMeta.semanticRetryAttempts, 1);
  const state = f.record();
  assert.equal(state.steps['prepare.chapter_plan'].status, 'failed');
  assert.equal(state.steps['prepare.contract'].status, 'failed');
  assert.equal(state.steps['prepare.contract'].external, false);
  assert.equal(state.steps.prepare.status, 'failed');
  assert.deepEqual(state.steps['prepare.chapter_plan'].rejectedResponses, [{
    promptId: 'offline.chapter.plan', promptVersion: 'v1', output: { plan: 'complete response', attempt: 2 },
    validationError: 'contract quote not present', semanticRetryAttempts: 1, maxSemanticRetryAttempts: 1, repairAttempts: 0,
  }]);
  await assert.rejects(f.run(session), error => error === caught);
  assert.equal(f.calls.length, 2, 'automatic retry in the same execution must not reset the semantic budget');
  await session.close();
  const projection = await f.journal.inspect({ novelId: 'novel', chapterId: 'chapter-2' });
  assert.equal(projection.canAcknowledge, false);
  assert.equal(JSON.stringify(projection).includes('complete response'), false, 'raw response is private');
});

test('a new explicit recovery session can make a new attempt while retaining the prior rejected response and count', async () => {
  const f = harness(); let session = await f.open();
  await assert.rejects(f.run(session), { code: 'PROMPT_POST_VALIDATION_FAILED' });
  await session.close(); f.acceptNext(); session = await f.open();
  await f.run(session);
  assert.equal(f.calls.length, 3);
  assert.equal(f.record().steps['prepare.chapter_plan'].status, 'done');
  assert.equal(f.record().steps['prepare.chapter_plan'].rejectedResponses[0].semanticRetryAttempts, 1);
  assert.equal(f.record().steps['prepare.chapter_plan'].output.planId, 'saved-plan');
  await session.close({ completed: true });
});

for (const [name, error, expectedCode] of [
  ['network interruption', Object.assign(new Error('disconnected'), { code: 'ECONNRESET' }), 'CHAPTER_PRODUCTION_UNCERTAIN'],
  ['timeout', Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), 'CHAPTER_PRODUCTION_UNCERTAIN'],
  ['output limit', Object.assign(new Error('tokens exhausted'), { code: 'LLM_OUTPUT_LIMIT' }), 'LLM_OUTPUT_LIMIT'],
  ['structured output limit', Object.assign(new Error('tokens exhausted'), { name: 'StructuredOutputError', category: 'output_limit' }), undefined],
  ['cancelled request', Object.assign(new Error('aborted'), { name: 'AbortError' }), 'CHAPTER_PRODUCTION_UNCERTAIN'],
]) for (const attempt of [1, 2]) test(`${name} on invocation ${attempt} stays unknown and is never resent`, async () => {
  const f = harness({ failureAt: attempt, failure: error }); let session = await f.open();
  await assert.rejects(f.run(session), value => expectedCode ? value.code === expectedCode : value === error);
  assert.equal(f.record().steps['prepare.chapter_plan'].status, 'unknown');
  assert.equal(f.record().steps['prepare.chapter_plan'].rejectedResponses, undefined);
  assert.equal(f.record().steps['prepare.contract'].external, false);
  await session.close(); session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_UNCERTAIN' });
  assert.equal(f.calls.length, attempt);
  await session.close();
});

test('failure to durably save a completed response leaves an unresolved external step that cannot be resent', async () => {
  const f = harness({ journalFailure: true }); let session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  assert.equal(f.record().steps['prepare.chapter_plan'].status, 'running');
  await session.close(); session = await f.open();
  assert.equal(f.record().steps['prepare.chapter_plan'].status, 'unknown');
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_UNCERTAIN' });
  assert.equal(f.calls.length, 2);
  await session.close();
});

test('a bare code or incomplete diagnostic is not evidence that an external response completed', () => {
  for (const completedPromptResponse of [undefined, {}, { promptId: 'x', output: {}, semanticRetryAttempts: 0 }]) {
    assert.equal(contracts.isDefinitiveProductionFailure(Object.assign(new Error('opaque'), {
      code: 'PROMPT_POST_VALIDATION_FAILED', completedPromptResponse,
    })), false);
  }
});

test('an older retained response cannot clear an unknown outcome from a later explicit attempt', async () => {
  const f = harness({ failureAt: 3, failure: Object.assign(new Error('later attempt lost'), { code: 'ECONNRESET' }) });
  let session = await f.open();
  await assert.rejects(f.run(session), { code: 'PROMPT_POST_VALIDATION_FAILED' });
  await session.close(); session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_UNCERTAIN' });
  assert.equal(f.record().steps['prepare.chapter_plan'].status, 'unknown');
  assert.equal(f.record().steps['prepare.chapter_plan'].rejectedResponses.length, 1);
  assert.equal(f.record().steps['prepare.chapter_plan'].rejectedResponses[0].output.attempt, 2);
  await session.close(); session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_UNCERTAIN' });
  assert.equal(f.calls.length, 3);
  await session.close();
});
