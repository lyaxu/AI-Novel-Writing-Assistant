const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const contracts = loadRuntimeSource('../production/reliability/types.ts', { 'node:crypto': require('node:crypto') });
const { createChapterProductionJournal } = loadRuntimeSource('../production/reliability/session.ts', {
  'node:crypto': require('node:crypto'), './types': contracts,
});

function harness({ failReceipt = false } = {}) {
  let persisted = null;
  const chapter = { id: 'c', novelId: 'n', title: 'saved chapter', content: '完整已保存正文', taskSheet: 'approved',
    sceneCards: null, expectation: null, targetWordCount: 3000 };
  const journal = createChapterProductionJournal({ repository: { transaction: async action => {
    const before = persisted;
    try { return await action({
      readChapter: async () => structuredClone(chapter),
      readJournal: async () => persisted && { metadataJson: persisted },
      writeJournal: async (_n, _c, expected, next) => {
        assert.equal(persisted, expected);
        if (failReceipt && JSON.parse(next).steps['pipeline.review:0']?.rejectedReviews?.length) {
          failReceipt = false; throw new Error('receipt write interrupted');
        }
        persisted = next;
      },
      archiveJournal: async () => assert.fail('The same chapter operation must resume'),
      writeContent: async () => assert.fail('Review failure must not rewrite saved prose'),
      writeState: async () => assert.fail('Review failure must not approve the chapter'),
    }); } catch (error) { persisted = before; throw error; }
  } } });
  return { chapter, journal, record: () => JSON.parse(persisted),
    open: () => journal.open({ novelId: 'n', chapterId: 'c', operationId: 'original-job:c',
      request: { entry: 'pipeline', workflowTaskId: 'original-job', maxRetries: 2 } }) };
}
function incomplete(attempt = 1) {
  return Object.assign(new Error('review evidence incomplete'), { code: 'CHAPTER_REVIEW_INCOMPLETE', reviewOutput: {
    status: 'needs_manual_review', reviewRawResponse: { attempt, fullAnswer: '保留完整模型回答'.repeat(2000) },
    reviewSemanticResponse: { attempt, originalScenes: ['arrival', 'payment'] },
    reviewContractIssues: ['action_state_coverage_missing:payment'],
    reviewCorrectionHints: ['补齐审查，不改正文'],
    deferredRepairDirectives: [{ mode: 'patch', target: 'voice', instruction: '尚未核实的建议' }],
    deferredMissingObligations: [{ kind: 'must_hit_now', summary: '尚未核实', evidence: '记录' }],
    repairDirectives: [], missingObligations: [], riskTags: ['acceptance_source_evidence_unverified'],
  } });
}

test('incomplete review persists full private evidence while failed nested steps remain non-reusable', async () => {
  const f = harness(); const session = await f.open(); const error = incomplete(); let reviews = 0;
  await session.runStep('pipeline.draft', async () => ({ content: f.chapter.content }), { external: true });
  await session.put('pipeline.retryCount', 1);
  const run = () => session.runStep('pipeline.review:0', () => session.runStep('evaluation:hash', async () => {
    reviews++; throw error;
  }, { external: true }));
  await assert.rejects(run(), value => value === error);
  for (const key of ['pipeline.review:0', 'evaluation:hash']) {
    const step = f.record().steps[key];
    assert.equal(step.status, 'failed');
    assert.equal(step.output, undefined);
    assert.deepEqual(step.rejectedReviews, [{ code: 'CHAPTER_REVIEW_INCOMPLETE', output: error.reviewOutput,
      validationError: error.message }]);
    assert.equal(session.getStepOutput(key), undefined);
  }
  await assert.rejects(run(), value => value === error);
  assert.equal(reviews, 1, 'The same execution cannot silently reset correction attempts');
  assert.equal(f.record().steps['pipeline.draft'].status, 'done');
  assert.equal(f.record().values['pipeline.retryCount'], 1);
  await session.close({ error });
  const projected = await f.journal.inspect({ novelId: 'n', chapterId: 'c' });
  assert.equal(projected.status, 'paused');
  assert.equal(projected.canAcknowledge, false);
  assert.equal(projected.workflowTaskId, 'original-job');
  assert.equal(JSON.stringify(projected).includes('fullAnswer'), false, 'Private review raw is not a UI inspection field');
});

test('explicit original-step recovery preserves prior failures and budgets without caching an invalid review', async () => {
  const f = harness(); let session = await f.open();
  await session.put('pipeline.retryCount', 1);
  for (const attempt of [1, 2]) {
    await assert.rejects(session.runStep('pipeline.review:0', async () => { throw incomplete(attempt); }, { external: true }),
      { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    await session.close(); session = await f.open();
    assert.equal(session.operationId, 'original-job:c');
    assert.equal(session.get('pipeline.retryCount'), 1);
  }
  let calls = 0;
  const accepted = await session.runStep('pipeline.review:0', async () => { calls++; return { review: 'valid explicit recovery' }; }, { external: true });
  assert.equal(calls, 1);
  assert.deepEqual(accepted, { review: 'valid explicit recovery' });
  const step = f.record().steps['pipeline.review:0'];
  assert.equal(step.status, 'done');
  assert.deepEqual(step.rejectedReviews.map(row => row.output.reviewRawResponse.attempt), [1, 2]);
  assert.equal(step.output.review, 'valid explicit recovery');
  assert.equal(f.chapter.content, '完整已保存正文');
  await session.close();
});

test('receipt storage failure leaves unresolved work and cannot certify or resend the review', async () => {
  const f = harness({ failReceipt: true }); let session = await f.open(); let calls = 0;
  const run = () => session.runStep('pipeline.review:0', async () => { calls++; throw incomplete(); }, { external: true });
  await assert.rejects(run(), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  assert.equal(f.record().steps['pipeline.review:0'].status, 'running');
  await session.close(); session = await f.open();
  assert.equal(f.record().steps['pipeline.review:0'].status, 'unknown');
  await assert.rejects(run(), { code: 'CHAPTER_PRODUCTION_UNCERTAIN' });
  assert.equal(calls, 1);
  await session.close();
});

test('review receipts require the explicit incomplete-review code and a full object', () => {
  for (const value of [null, undefined, 'diagnostic only', []]) {
    assert.equal(contracts.incompleteReviewResponseFromError(Object.assign(new Error('bad'), {
      code: 'CHAPTER_REVIEW_INCOMPLETE', reviewOutput: value,
    })), undefined);
  }
  assert.equal(contracts.incompleteReviewResponseFromError(Object.assign(new Error('network'), {
    code: 'ECONNRESET', reviewOutput: incomplete().reviewOutput,
  })), undefined);
});

test('recorded v16 first failed review reaches the journal through the actual completion assertion', async () => {
  const { asset } = require('./legacySemanticHarness.cjs');
  const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
  const fixture = require('./fixtures/secondChapterReviewV16.json');
  const input = structuredClone(require('./fixtures/secondChapterReview.json').input);
  input.chapterId = fixture.provenance.chapterId;
  input.establishedProse[0].chapterId = fixture.provenance.previousChapterId;
  const raw = asset.outputSchema.parse(structuredClone(fixture.outputs[1]));
  let validationError;
  try { asset.postValidate(raw, input); } catch (error) { validationError = error; }
  assert.ok(validationError, 'The archived answer omitted the payment scene');
  const review = asset.postValidateFailureRecovery({ rawOutput: raw, promptInput: input,
    validationError: validationError.message, semanticRetryAttempts: 1 });
  assert.deepEqual(review.reviewRawResponse, raw);
  const f = harness(); const session = await f.open();
  await assert.rejects(session.runStep('pipeline.review:0', async () => {
    assertReviewCompleted(review);
    assert.fail('An incomplete review cannot reach successful persistence');
  }, { external: true }), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
  const step = f.record().steps['pipeline.review:0'];
  assert.equal(step.status, 'failed');
  assert.equal(step.output, undefined);
  assert.deepEqual(step.rejectedReviews[0].output, review);
  assert.deepEqual(step.rejectedReviews[0].output.reviewRawResponse, raw);
  await session.close();
});
