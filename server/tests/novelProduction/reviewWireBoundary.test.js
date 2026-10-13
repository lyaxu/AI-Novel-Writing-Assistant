const test = require('node:test');
const assert = require('node:assert/strict');
const { chapterAcceptanceAssessmentPrompt: asset, semanticChapterAcceptanceSchema } = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');
const fixture = require('./fixtures/secondChapterReviewV16.json');
const prior = require('./fixtures/secondChapterReview.json');
const input = { ...prior.input, chapterId: fixture.provenance.chapterId,
  establishedProse: prior.input.establishedProse.map(row => ({ ...row, chapterId: fixture.provenance.previousChapterId })) };

test('v17 transport retains every field of all four real JSON answers without schema rewriting', () => {
  assert.equal(asset.version, 'v17');
  assert.equal(asset.repairPolicy.maxAttempts, 0);
  assert.equal(asset.semanticRetryPolicy.maxAttempts, 1);
  for (const raw of fixture.outputs) assert.deepEqual(asset.outputSchema.parse(raw), raw);
  assert.equal(fixture.outputs[0].actionStateChecks.length, 4);
  assert.equal(semanticChapterAcceptanceSchema.safeParse(fixture.outputs[0]).success, false);
});

test('real object-array and enum errors reach complete-context diagnostics, not JSON-only repair', () => {
  assert.throws(() => asset.postValidate(fixture.outputs[0], input), error => {
    assert.match(error.message, /sceneCausalityVerdicts\.0\.constraints:review_shape_invalid/);
    assert.match(error.message, /expected array/);
    return true;
  });
  assert.throws(() => asset.postValidate(fixture.outputs[2], input), error => {
    assert.match(error.message, /resources/);
    assert.match(error.message, /body/);
    assert.match(error.message, /item/);
    return true;
  });
});

test('one bad shape cannot hide independent semantic mismatches or missing scene coverage', () => {
  const raw = structuredClone(fixture.outputs[3]);
  raw.sceneCausalityVerdicts[0].constraints = {};
  raw.actionStateChecks.pop();
  assert.throws(() => asset.postValidate(raw, input), error => {
    assert.match(error.message, /constraints:review_shape_invalid/);
    assert.match(error.message, /semantic_dimension_mismatch/);
    assert.match(error.message, /action_state_coverage_missing:pay_and_depart/);
    return true;
  });
});

test('exhausted field errors retain the untouched raw answer and never manufacture executable repairs', () => {
  for (const raw of fixture.outputs) {
    let failure; try { asset.postValidate(raw, input); } catch (error) { failure = error; }
    assert.ok(failure, 'all four real replies remain incomplete, not retrospectively approved');
    const recovered = asset.postValidateFailureRecovery({ rawOutput: raw, promptInput: input,
      validationError: failure.message, semanticRetryAttempts: 1 });
    assert.deepEqual(recovered.reviewRawResponse, raw);
    assert.deepEqual(recovered.repairDirectives, []);
    assert.deepEqual(recovered.missingObligations, []);
    assert.throws(() => assertReviewCompleted(recovered), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
  }
});

test('real failure replay has exactly two full-context invocations and zero JSON-repair allowance', async () => {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    const data = request.schema.parse(structuredClone(fixture.outputs[calls.length === 1 ? 0 : 3]));
    return { data, repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await runStructuredPrompt({ asset, promptInput: input, options: {
      provider: 'deepseek', model: 'offline-replay', disableFallbackModel: true,
      transportRetryCount: 0, disableStrategyFallback: true,
    } });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.maxRepairAttempts === 0));
    const feedback = String(calls[1].messages.at(-1).content);
    assert.match(feedback, /constraints/);
    assert.ok(feedback.includes(JSON.stringify(fixture.outputs[0], null, 2))
      || feedback.includes('收下三百元并承诺追查旧物来源'), 'the original payment action survives contextual correction');
    assert.deepEqual(result.output.reviewRawResponse, fixture.outputs[3]);
    assert.throws(() => assertReviewCompleted(result.output), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    assert.equal(result.meta.invocation.repairAttempts, 0);
    assert.equal(result.meta.invocation.semanticRetryAttempts, 1);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});
