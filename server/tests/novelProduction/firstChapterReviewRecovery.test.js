const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/firstChapterReview.json');
const { chapterAcceptanceAssessmentPrompt: asset } = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { validateProgressionEvidence } = require('../../dist/prompting/prompts/novel/acceptance/progressionEvidence');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');

// A simulated corrected reviewer response, not a real second model run. No prose edits.
function correctedResponse() {
  const output = structuredClone(fixture.output);
  const paid = output.actionStateChecks[0];
  paid.states[0].afterEvidence[0].quote = '大妈接过钱，对着光看了看，塞进围裙口袋';
  paid.states[0].transitionEvidence = structuredClone(paid.actionEvidence);
  const rent = output.actionStateChecks[1];
  rent.states[0].transitionEvidence = structuredClone(rent.states[0].afterEvidence);
  // The book turning a page is an outcome, not a prerequisite for picking it up.
  output.actionStateChecks[2].states[0].enablingTransitionRequired = false;
  const quote = '把册子塞进外卖箱最底层，压在一件旧雨衣下面。';
  output.actionStateChecks[3].actionEvidence[0].quote = quote;
  output.progressionChecks[0].currentEvidence[0].quote = quote;
  return output;
}
async function runWithResponses(responses, work) {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (response instanceof Error) throw response;
    return { data: structuredClone(response), repairUsed: false, repairAttempts: 0 };
  });
  try { await work(calls, () => runStructuredPrompt({ asset, promptInput: fixture.input,
    options: { provider: 'deepseek', model: 'offline-fixture', disableFallbackModel: true, transportRetryCount: 0, disableStrategyFallback: true } })); }
  finally { setPromptRunnerStructuredInvokerForTests(); }
}

test('first chapter not-applicable comparisons permit null semantic findings but preserve provenance checks', () => {
  const rows = correctedResponse().progressionChecks;
  const result = validateProgressionEvidence(rows, fixture.input);
  assert.ok(result.checks.every(row => row.status === 'not_applicable' && row.validationIssues.length === 0));
  const later = validateProgressionEvidence(rows, { ...fixture.input, chapterOrder: 2 });
  assert.ok(later.checks.every(row => row.validationIssues.includes('previous_prose_unavailable')));
  const original = validateProgressionEvidence(fixture.output.progressionChecks, fixture.input);
  assert.ok(original.checks[0].validationIssues.includes('current_quote_not_in_current_prose'));
});

test('recorded accepted response requests correction of the review without accepting invented quotations', () => {
  assert.equal(fixture.output.status, 'accepted');
  assert.throws(() => asset.postValidate(structuredClone(fixture.output), fixture.input), /scene_1|scene_4/);
});

test('real prompt runner gives saved invalid review exactly one bounded correction opportunity', async () => {
  await runWithResponses([fixture.output, correctedResponse()], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].promptMeta.semanticRetryAttempts, 1);
    assert.match(String(calls[1].messages.at(-1).content), /连续.*原文|连续.*引文/);
    assert.equal(calls[1].disableFallbackModel, true);
    assert.equal(calls[1].transportRetryCount, 0);
    assert.equal(calls[1].disableStrategyFallback, true);
    assert.ok(calls[1].messages.some(message => String(message.content).includes(fixture.input.content)));
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
    assert.equal(result.output.status, 'accepted');
    assert.equal(fixture.input.content.length, 3013);
  });
});

test('exhausted review correction remains incomplete with original findings retained and no rewrite directives', async () => {
  await runWithResponses([fixture.output], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 2);
    assert.throws(() => assertReviewCompleted(result.output), error => error.code === 'CHAPTER_REVIEW_INCOMPLETE');
    assert.equal(result.output.actionStateChecks.length, 4);
    assert.deepEqual(result.output.repairDirectives, []);
    assert.deepEqual(result.output.deferredRepairDirectives, fixture.output.repairDirectives);
  });
});

test('transport interruption during review correction is not converted into a completed review', async () => {
  await runWithResponses([fixture.output, new Error('offline simulated connection reset')], async (calls, invoke) => {
    await assert.rejects(invoke(), /connection reset/);
    assert.equal(calls.length, 2);
  });
});

test('output limit during correction preserves its terminal code without a third call', async () => {
  const failure = Object.assign(new Error('offline output limit'), { code: 'LLM_OUTPUT_LIMIT' });
  await runWithResponses([fixture.output, failure], async (calls, invoke) => {
    await assert.rejects(invoke(), error => error === failure && error.code === 'LLM_OUTPUT_LIMIT');
    assert.equal(calls.length, 2);
  });
});

test('valid negative findings remain local review work rather than triggering another reviewer', async () => {
  const output = correctedResponse();
  output.actionStateChecks[2].verdict = 'unearned';
  output.actionStateChecks[2].states[0].transitionStatus = 'missing';
  await runWithResponses([output], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 1);
    assert.equal(result.output.actionStateChecks[2].verdict, 'unearned');
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
  });
});
