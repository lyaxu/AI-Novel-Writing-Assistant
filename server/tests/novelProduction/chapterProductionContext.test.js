const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');

function load() {
  return loadRuntimeSource('../production/reliability/executionContext.ts', {
    'node:async_hooks': require('node:async_hooks'), '../../../../llm/invocation/executionPolicy': { withUnknownOutcomeProtection: fn => fn() },
  });
}

test('production context persists each emitted fragment before delivering it and keeps interrupted draft incomplete', async () => {
  const { withProductionSession, captureProductionStream } = load();
  const saved = [];
  const session = { assertCurrent: async () => {}, checkpoint: async text => saved.push(text) };
  async function* broken() { yield { content: '半' }; yield { content: '章' }; throw new Error('offline disconnect'); }
  const seen = [];
  await assert.rejects(withProductionSession(session, async () => {
    for await (const chunk of captureProductionStream(broken())) {
      seen.push(chunk.content);
      assert.equal(saved.at(-1), seen.join(''));
    }
  }), /offline disconnect/);
  assert.deepEqual(saved, ['半', '半章']);
});

test('production context isolates concurrent chapter ownership and reuses saved step output', async () => {
  const { withProductionSession, productionStep } = load();
  const outputs = new Map();
  let calls = 0;
  const session = { runStep: async (key, fn) => {
    if (!outputs.has(key)) outputs.set(key, await fn());
    return outputs.get(key);
  } };
  const execute = () => withProductionSession(session, () => productionStep('review:0', async () => ++calls));
  assert.equal(await execute(), 1);
  assert.equal(await execute(), 1);
  assert.equal(await productionStep('review:0', async () => 2), 2);
  assert.equal(calls, 1);
});

test('lifecycle refuses cross-chapter writes and uses the session for quality state updates', async () => {
  const context = load();
  const writes = [];
  const { ChapterLifecycleService } = loadRuntimeSource('lifecycle/ChapterLifecycleService.ts', {
    '../../../../db/prisma': { prisma: {} },
    '../../../../db/sqliteRetry': { withSqliteRetry: () => assert.fail('must use guarded transaction') },
    '../../chapterLifecycleState': { mergeChapterPatchForGenerationStateBump: (_old, state) => ({ generationState: state }) },
    '../chapterEmptyContentError': { assertChapterContentNotEmpty: value => value },
    '../../production/reliability': { ...context, ChapterProductionError: class extends Error {
      constructor(code, message) { super(message); this.code = code; }
    } },
  });
  const session = { novelId: 'n', chapterId: 'c', saveContent: async input => writes.push(input), updateState: async input => writes.push(input) };
  await context.withProductionSession(session, async () => {
    const service = new ChapterLifecycleService();
    await assert.rejects(service.saveWorkingContent({ novelId: 'n', chapterId: 'other', content: 'draft', generationState: 'drafted' }), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
    await assert.rejects(service.markChapterStatus('other', 'completed'), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
    await service.applyQualityAssessmentState({ chapterId: 'c', data: { chapterStatus: { set: 'needs_repair' }, repairHistory: 'receipt' } });
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].chapterStatus, 'needs_repair');
  assert.equal(writes[0].repairHistory, 'receipt');
});
