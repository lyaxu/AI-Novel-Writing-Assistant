const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/secondChapterReviewV11.json');
const { input } = require('./fixtures/secondChapterReview.json');
const { asset, generatedChapterAcceptanceAssessmentSchema } = require('./resolvedAcceptanceHarness.cjs').createResolvedAcceptanceHarness();
const { validateActionStateEvidence } = require('../../dist/prompting/prompts/novel/acceptance/actionStateEvidence');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');

const badQuote = '“我上个月丢过手机，后来补了卡。”';
const exactQuote = '我上个月丢过手机，后来补了卡。';
function correctedSimulation() {
  const output = structuredClone(fixture.outputs[1]);
  output.actionStateChecks[1].states[0].afterEvidence[0].quote = exactQuote;
  return output;
}
function audit(output) { return validateActionStateEvidence(output.actionStateChecks, input); }

test('recorded v11 replies fail on a quote boundary; the original manuscripts contain the exact interior excerpt', () => {
  assert.equal(input.content.includes(badQuote), false);
  assert.equal(input.content.includes(exactQuote), true);
  assert.equal(input.content.length, 3652);
  assert.equal(input.establishedProse[0].content.length, 3013);
  for (const output of fixture.outputs) {
    assert.throws(() => asset.postValidate(generatedChapterAcceptanceAssessmentSchema.parse(output), input), /quote_not_found|unverified_source/);
    assert.equal(output.actionStateChecks[1].states[0].afterEvidence[0].quote, badQuote);
  }
});

test('quote feedback names the exact field and declared source, without claiming a nonexistent quote is too early', () => {
  const result = audit(fixture.outputs[1]);
  const issues = result.checks[1].validationIssues.join('\n');
  const feedback = result.correctionHints.join('\n');
  assert.match(issues + feedback, /quote_not_found/);
  assert.match(feedback, /actionStateChecks\[1\].*states\[0\]\.afterEvidence\[0\]/);
  assert.match(feedback, /chapter-2/);
  assert.ok(feedback.includes(badQuote));
  assert.match(feedback, /未找到连续准确原文/);
  assert.match(feedback, /不判断时序/);
  assert.match(feedback, /不能删除真实证据来认证通过/);
  assert.match(feedback, /不能修改正文/);
  assert.doesNotMatch(issues, /after_state_not_in_current_action/);
  assert.doesNotMatch(feedback, /未定位到关键行动发生时或之后/);
});

test('deleting a bad citation cannot retain earned or silently complete review', () => {
  const output = correctedSimulation();
  output.actionStateChecks[1].states[0].afterEvidence = [];
  assert.throws(() => asset.postValidate(output, input));
  const result = audit(output);
  assert.equal(result.checks[1].verdict, 'insufficient_evidence');
  assert.ok(result.checks[1].validationIssues.includes('earned_without_state_evidence'));
});

test('manually corrected citation passes the mechanical contract without automatic text or judgment changes', () => {
  const output = correctedSimulation();
  const result = asset.postValidate(generatedChapterAcceptanceAssessmentSchema.parse(output), input);
  assert.doesNotThrow(() => assertReviewCompleted(result));
  const expected = structuredClone(fixture.outputs[1]);
  expected.actionStateChecks[1].states[0].afterEvidence[0].quote = exactQuote;
  assert.deepEqual(output, expected);
  assert.equal(fixture.outputs[1].actionStateChecks[1].states[0].afterEvidence[0].quote, badQuote);
});

async function replay(outputs, assertion) {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    return { data: structuredClone(outputs[Math.min(calls.length - 1, outputs.length - 1)]), repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await runStructuredPrompt({ asset, promptInput: input, options: {
      provider: 'deepseek', model: 'offline-fixture', disableFallbackModel: true,
      transportRetryCount: 0, disableStrategyFallback: true,
    } });
    await assertion(result, calls);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
}

test('two unchanged recorded replies still exhaust one correction and keep review incomplete without prose repairs', async () => {
  await replay(fixture.outputs, (result, calls) => {
    assert.equal(calls.length, 2);
    assert.throws(() => assertReviewCompleted(result.output), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    assert.deepEqual(result.output.repairDirectives, []);
    assert.ok(result.output.riskTags.includes('acceptance_source_evidence_unverified'));
    assert.equal(result.output.actionStateChecks[1].states[0].afterEvidence[0].quote, badQuote);
  });
});

test('the existing single correction receives actionable source feedback and can finish with a simulated exact quote', async () => {
  await replay([fixture.outputs[1], correctedSimulation()], (result, calls) => {
    assert.equal(calls.length, 2);
    const feedback = String(calls[1].messages.at(-1).content);
    assert.match(feedback, /未找到连续准确原文/);
    assert.match(feedback, /afterEvidence\[0\]/);
    assert.doesNotMatch(feedback, /after_state_not_in_current_action/);
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
  });
});

for (const [name, alter] of [
  ['unknown chapter ID', e => { e.sourceId = 'chapter-not-supplied'; }],
  ['planned contract posing as prose', e => { e.source = 'planned_contract'; }],
  ['previous chapter mislabeled as current', e => { e.sourceId = 'chapter-1'; e.quote = '“郑小满。”'; }],
  ['real previous chapter used as after-state proof', e => { e.source = 'established_context'; e.sourceId = 'chapter-1'; e.quote = '“郑小满。”'; }],
]) {
  test(`source validation still rejects ${name} before positional inference`, () => {
    const output = correctedSimulation();
    assert.ok(input.establishedProse[0].content.includes('“郑小满。”'));
    alter(output.actionStateChecks[1].states[0].afterEvidence[0]);
    assert.throws(() => asset.postValidate(output, input));
    const result = audit(output);
    assert.equal(result.checks[1].verdict, 'insufficient_evidence');
    assert.ok(result.checks[1].validationIssues.length > 0);
    assert.doesNotMatch(result.checks[1].validationIssues.join('\n'), /after_state_not_in_current_action/);
    if (name === 'real previous chapter used as after-state proof') {
      assert.ok(result.checks[1].validationIssues.some(issue => issue.startsWith('after_state_requires_current_prose')));
      assert.match(result.correctionHints.join('\n'), /afterEvidence/);
      assert.match(result.correctionHints.join('\n'), /current_prose/);
      assert.doesNotMatch(result.correctionHints.join('\n'), /未定位到关键行动发生时或之后/);
    }
  });
}

test('an accurately sourced after-state quote that actually precedes the action remains rejected', () => {
  const output = correctedSimulation();
  output.actionStateChecks[1].states[0].afterEvidence[0].quote = '他抬手敲门。两下，不轻不重。';
  const result = audit(output);
  assert.ok(result.checks[1].validationIssues.some(issue => issue.startsWith('after_state_not_in_current_action')));
  assert.match(result.correctionHints.join('\n'), /关键行动发生时或之后/);
  assert.throws(() => asset.postValidate(output, input), /after_state_not_in_current_action/);
});

test('an invalid action anchor produces source feedback without cascading position judgments', () => {
  const output = correctedSimulation();
  output.actionStateChecks[1].actionEvidence[0].quote = '她说了正文里不存在的回答。';
  const result = audit(output);
  const issues = result.checks[1].validationIssues.join('\n');
  assert.match(issues, /action_not_in_current_prose|quote_not_found/);
  assert.doesNotMatch(issues, /before_state_after_action|after_state_not_in_current_action/);
  assert.throws(() => asset.postValidate(output, input));
});

test('an accurately quoted prior chapter cannot become a current action anchor', () => {
  const output = correctedSimulation();
  assert.ok(input.establishedProse[0].content.includes('“郑小满。”'));
  output.actionStateChecks[1].actionEvidence[0] = {
    source: 'established_context', sourceId: 'chapter-1', quote: '“郑小满。”',
  };
  const result = audit(output);
  const issues = result.checks[1].validationIssues.join('\n');
  assert.match(issues, /action_not_in_current_prose/);
  assert.doesNotMatch(issues, /before_state_after_action|after_state_not_in_current_action/);
  assert.match(result.correctionHints.join('\n'), /actionEvidence\[0\]/);
  assert.match(result.correctionHints.join('\n'), /current_prose/);
  assert.throws(() => asset.postValidate(output, input));
});
