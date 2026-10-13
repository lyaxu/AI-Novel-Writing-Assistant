const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/firstChapterReview.json');
const resumed = require('./fixtures/resumedFirstChapterReview.json');
const candidateReview = require('./fixtures/firstChapterCandidateReview.json');
const { asset } = require('./resolvedAcceptanceHarness.cjs').createResolvedAcceptanceHarness();
const { buildEvidenceCatalog } = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const { validateProgressionEvidence } = require('../../dist/prompting/prompts/novel/acceptance/progressionEvidence');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');

function assertCompleteCurrentProse(messages, input) {
  const entries = buildEvidenceCatalog(input).entries
    .filter(entry => entry.source === 'current_prose').sort((a, b) => a.start - b.start);
  assert.equal(entries.map(entry => entry.quote).join(''), input.content);
  for (const entry of entries) {
    assert.equal(entry.quote, input.content.slice(entry.start, entry.end));
    assert.ok(messages.some(message => String(message.content).includes(`[${entry.id}] ${entry.quote}`)),
      `Current prose evidence ${entry.id} must remain complete in the prompt`);
  }
}

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
async function runWithResponses(responses, work, promptInput = fixture.input) {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (response instanceof Error) throw response;
    return { data: structuredClone(response), repairUsed: false, repairAttempts: 0 };
  });
  try { await work(calls, () => runStructuredPrompt({ asset, promptInput,
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
    assertCompleteCurrentProse(calls[1].messages, fixture.input);
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

test('both real resumed reviewer responses reproduce the same five validation failures', () => {
  for (const output of resumed.outputs) {
    assert.throws(() => asset.postValidate(structuredClone(output), fixture.input), error => {
      const issues = error.message.split('\n').filter(line => /^actionStateChecks\[scene_/.test(line));
      assert.equal(issues.length, 5);
      assert.equal(issues.filter(line => line.includes('after_state_not_in_current_action')).length, 2);
      assert.equal(issues.filter(line => line.includes('earned_without_required_transition')).length, 3);
      assert.doesNotMatch(error.message, /unverified_source|quote_not_in_current_prose/);
      assert.match(error.message, /actionStateChecks\[0\].*states\[0\].*stateChanged=true.*not_needed/);
      assert.match(error.message, /actionStateChecks\[3\].*states\[0\]\.afterEvidence/);
      assert.match(error.message, /行动前的判断.*beforeEvidence/);
      return true;
    });
  }
});

// Hand-authored correction for exercising the contract only; never persisted to the book.
function correctedResumedResponse() {
  const output = structuredClone(resumed.outputs[1]);
  for (const check of output.actionStateChecks) {
    for (const state of check.states) {
      if (state.stateChanged) {
        state.transitionStatus = 'established';
        state.transitionEvidence = structuredClone(state.afterEvidence);
      }
    }
  }
  const paid = output.actionStateChecks[0];
  paid.states[1].afterEvidence = structuredClone(paid.actionEvidence);
  const departed = output.actionStateChecks[3];
  departed.states[0].enablingTransitionRequired = true;
  departed.states[0].afterEvidence = structuredClone(departed.actionEvidence);
  return output;
}

test('actual runner carries actionable state-specific feedback and accepts a consistent simulated correction', async () => {
  await runWithResponses([resumed.outputs[0], correctedResumedResponse()], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 2);
    const feedback = String(calls[1].messages.at(-1).content).split('上一次的 JSON 输出')[0];
    assert.match(feedback, /states\[0\].*stateChanged=true/);
    assert.match(feedback, /actionEvidence=.*afterEvidence=/);
    assert.match(feedback, /无需另造前置情节/);
    assert.match(feedback, /不要为了通过检查机械修改布尔值或降低结论/);
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
    assert.equal(result.output.status, 'accepted');
    assert.equal(result.output.repairDirectives.length, 0);
    assert.equal(fixture.input.content.length, 3013);
  });
});

test('replaying both real unchanged responses still pauses after exactly one correction, never fabricates acceptance', async () => {
  await runWithResponses(resumed.outputs, async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 2);
    assert.throws(() => assertReviewCompleted(result.output), error => error.code === 'CHAPTER_REVIEW_INCOMPLETE');
    assert.deepEqual(result.output.repairDirectives, []);
    assert.equal(result.output.actionStateChecks.length, 4);
  });
});

test('real v9 original passes; candidate comparison without a duty is valid but its two timing errors remain rejected', () => {
  assert.doesNotThrow(() => assertReviewCompleted(asset.postValidate(structuredClone(candidateReview.originalOutput), fixture.input)));
  assert.equal(candidateReview.input.content.length, 3265);
  for (const output of candidateReview.outputs) {
    assert.ok(validateProgressionEvidence(output.progressionChecks, candidateReview.input).checks.every(row => row.validationIssues.length === 0));
    assert.throws(() => asset.postValidate(structuredClone(output), candidateReview.input), error => {
      const errors = error.message.split('\n').filter(line => /^actionStateChecks\[scene_/.test(line));
      assert.equal(errors.length, 2);
      assert.ok(errors.every(line => line.includes('before_state_after_action')));
      assert.match(error.message, /states\[0\]\.beforeEvidence/);
      assert.match(error.message, /晚叙述不等于晚发生/);
      assert.match(error.message, /not_before_action/);
      assert.doesNotMatch(error.message, /current_evidence_missing/);
      return true;
    });
  }
});

test('candidate evidence correction receives precise before/action boundaries and never rewrites the saved input', async () => {
  // Simulated reviewer correction of quoted action boundaries; not a live model success.
  const corrected = structuredClone(candidateReview.outputs[1]);
  corrected.actionStateChecks[1].states[0].before = '电话响起，尚未知晓本次催租期限';
  corrected.actionStateChecks[1].states[0].beforeEvidence = structuredClone(corrected.actionStateChecks[1].actionEvidence);
  corrected.actionStateChecks[3].states[1].beforeEvidence[0].quote = '劳梓凡坐在床边，盯着那本册子。';
  await runWithResponses([candidateReview.outputs[0], corrected], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 2);
    const feedback = String(calls[1].messages.at(-1).content).split('上一次的 JSON 输出')[0];
    assert.match(feedback, /beforeEvidence=.*所选行动|beforeEvidence=/);
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
    assert.equal(result.output.status, 'repairable');
    assert.ok(result.output.blockingIssues.length > 0, 'valid local issues are retained');
    assertCompleteCurrentProse(calls[1].messages, candidateReview.input);
  }, candidateReview.input);
});
