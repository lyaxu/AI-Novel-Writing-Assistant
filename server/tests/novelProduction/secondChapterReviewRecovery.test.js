const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/secondChapterReview.json');
const { chapterAcceptanceAssessmentPrompt: asset, generatedChapterAcceptanceAssessmentSchema } = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { validateActionStateEvidence, ACTION_STATE_AUDIT_RULES } = require('../../dist/prompting/prompts/novel/acceptance/actionStateEvidence');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');
const { actionStateCheckSchema } = require('../../../shared/dist/types/novel/sceneCausality');

// Manually authored reviewer simulation. Do not treat this as a real model acceptance.
function simulatedCorrectTimingResponse() {
  const result = structuredClone(fixture.outputs[0]);
  const fist = result.actionStateChecks[2];
  fist.states[0].beforeEvidenceTiming = {
    relation: 'retrospective_prior_state',
    reason: '该句补叙行动之前的长期练拳经历，不是本次出拳之后才获得能力；本次使用的是既有能力。',
  };
  fist.states[1].transitionEvidence = [{ source: 'current_prose', sourceId: 'chapter-2', quote: '他连续三拳，每一拳都贴着符纸打进去。' }];
  result.actionStateChecks[3].states[0].transitionEvidence = structuredClone(result.actionStateChecks[3].actionEvidence);
  return result;
}

test('recorded chapter 2 responses remain invalid; new timing contract never silently approves old output', () => {
  for (const output of fixture.outputs) {
    assert.throws(() => asset.postValidate(structuredClone(output), fixture.input), /before_state_after_action|earned_without_state_evidence/);
  }
  assert.equal(fixture.input.content.length, 3652);
  assert.equal(fixture.input.establishedProse[0].content.length, 3013);
  assert.equal(createHash('sha256').update(fixture.input.establishedProse[0].content).digest('hex'),
    'd4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6');
});

test('explicit source-backed retrospective state passes without changing prose, action anchor or original state semantics', () => {
  const simulated = simulatedCorrectTimingResponse();
  const result = asset.postValidate(generatedChapterAcceptanceAssessmentSchema.parse(simulated), fixture.input);
  assert.doesNotThrow(() => assertReviewCompleted(result));
  assert.equal(result.actionStateChecks[2].verdict, 'earned');
  assert.deepEqual(result.actionStateChecks[2].states[0].beforeEvidenceTiming, simulated.actionStateChecks[2].states[0].beforeEvidenceTiming);
  assert.deepEqual(simulated.actionStateChecks[2].actionEvidence, fixture.outputs[0].actionStateChecks[2].actionEvidence);
  assert.deepEqual(simulated.actionStateChecks[2].states[0].beforeEvidence, fixture.outputs[0].actionStateChecks[2].states[0].beforeEvidence);
  assert.equal(simulated.actionStateChecks[2].states[0].stateChanged, false);
  assert.equal(simulated.actionStateChecks[2].states[0].transitionStatus, 'not_needed');
  const missingTransitions = structuredClone(fixture.outputs[0]);
  missingTransitions.actionStateChecks[2].states[0].beforeEvidenceTiming = simulated.actionStateChecks[2].states[0].beforeEvidenceTiming;
  assert.throws(() => asset.postValidate(missingTransitions, fixture.input), /earned_without_state_evidence/);
});

async function replay(responses, assertion) {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    return { data: structuredClone(responses[Math.min(calls.length - 1, responses.length - 1)]), repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await runStructuredPrompt({ asset, promptInput: fixture.input, options: {
      provider: 'deepseek', model: 'offline-fixture', disableFallbackModel: true, transportRetryCount: 0, disableStrategyFallback: true,
    } });
    await assertion(result, calls);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
}

test('bounded correction explains narrative time and a simulated correct answer can complete without another call', async () => {
  await replay([fixture.outputs[0], simulatedCorrectTimingResponse()], (result, calls) => {
    assert.equal(calls.length, 2);
    const feedback = String(calls[1].messages.at(-1).content);
    assert.match(feedback, /晚叙述不等于晚发生/);
    assert.match(feedback, /beforeEvidenceTiming/);
    assert.match(feedback, /insufficient_evidence/);
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
  });
});

test('both real answers still exhaust review correction and preserve incomplete review rather than fiction edits', async () => {
  await replay(fixture.outputs, (result, calls) => {
    assert.equal(calls.length, 2);
    assert.throws(() => assertReviewCompleted(result.output), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    assert.deepEqual(result.output.repairDirectives, []);
    assert.ok(result.output.actionStateChecks[2].validationIssues.includes('earned_without_state_evidence'));
  });
});

function evidence(quote) { return { source: 'current_prose', sourceId: 'c', quote }; }
function timingRow({ first = '她用钥匙打开保险柜。', prior = '那把钥匙是父亲前一天交给她的。', dimension = 'item' } = {}) {
  return {
    input: { chapterId: 'c', chapterOrder: 1, content: first + prior, expectedSceneKeys: ['s'] },
    row: { sceneKey: 's', actor: '她', action: '打开保险柜', actionEvidence: [evidence(first)], verdict: 'earned', explanation: '核对持有状态及其在行动中的使用。',
      states: [{ dimension, entity: '行动条件', before: '行动前已具备条件', requiredForAction: '使用既有条件', after: '行动完成且仍具备条件',
        beforeEvidence: [evidence(prior)], afterEvidence: [evidence(first)], transitionEvidence: [],
        beforeEvidenceTiming: { relation: 'retrospective_prior_state', reason: '叙述补充的是行动之前已经发生的交付，不是行动后取得条件。' },
        enablingTransitionRequired: false, stateChanged: false, transitionStatus: 'not_needed' }] },
  };
}
function validated(row, input) { return validateActionStateEvidence([row], input).checks[0]; }

test('retrospective handling is generic across existing ability, knowledge, body, location and item states', () => {
  for (const [dimension, first, prior] of [
    ['ability', '她演奏完这首曲子。', '她入学前便会弹这首曲子。'],
    ['knowledge', '她按暗号回应。', '这套暗号她出发前已背熟。'],
    ['body', '她用右手推开门。', '她的右手在出门前已恢复活动。'],
    ['location', '她站在台上讲话。', '她早在开场前就登上台。'],
    ['item', '她用钥匙打开保险柜。', '那把钥匙是父亲前一天交给她的。'],
  ]) {
    const { row, input } = timingRow({ dimension, first, prior });
    row.action = first;
    row.states[0].beforeEvidenceTiming.reason = '后一句补叙的是行动开始前已有的状态，本次行动使用该状态，并未临时取得前提。';
    const result = validated(actionStateCheckSchema.parse(row), input);
    assert.equal(result.verdict, 'earned', dimension); assert.deepEqual(result.validationIssues, []);
  }
});

test('no narrative-timing declaration keeps conservative legacy position checking', () => {
  const { row, input } = timingRow(); delete row.states[0].beforeEvidenceTiming;
  assert.ok(validated(row, input).validationIssues.some(issue => issue.startsWith('before_state_after_action:')));
});

for (const variant of ['wrong_quote', 'wrong_source', 'planned_source', 'empty_reason', 'empty_before', 'required_transition']) {
  test(`retrospective declaration cannot excuse ${variant}`, () => {
    const { row, input } = timingRow(); const state = row.states[0];
    if (variant === 'wrong_quote') state.beforeEvidence[0].quote = '没有出现的回叙。';
    if (variant === 'wrong_source') state.beforeEvidence[0].sourceId = 'other';
    if (variant === 'planned_source') state.beforeEvidence[0].source = 'planned_contract';
    if (variant === 'empty_reason') state.beforeEvidenceTiming.reason = ' ';
    if (variant === 'empty_before') state.beforeEvidence = [];
    if (variant === 'required_transition') state.enablingTransitionRequired = true;
    assert.notEqual(validated(row, input).verdict, 'earned');
    assert.ok(validated(row, input).validationIssues.length > 0);
    if (variant === 'empty_reason') assert.equal(actionStateCheckSchema.safeParse(row).success, false);
  });
}

test('an actual later acquisition remains a contradiction even when reverse narration places its quote first', () => {
  for (const [action, condition] of [['他用钥匙开了门。', '他事后才拿到钥匙。'], ['她站起身来。', '她事后才恢复双腿知觉。']]) {
    const { row, input } = timingRow({ first: action, prior: condition });
    input.content = condition + '回想更早的一幕：' + action;
    row.states[0].beforeEvidenceTiming = { relation: 'not_before_action', reason: '正文采用逆序叙述，条件实际在所选行动之后才成立，不能作为行动前提。' };
    assert.equal(validated(row, input).verdict, 'contradicted');
    assert.ok(validated(row, input).validationIssues.includes('earned_conflicts_with_state_or_transition_order'));
    row.verdict = 'contradicted';
    assert.deepEqual(validated(row, input).validationIssues, [], 'honest negative finding is a completed review');
  }
});

test('honest unknown timing remains uncertainty and cannot keep an earned verdict', () => {
  const { row, input } = timingRow();
  row.states[0].beforeEvidenceTiming = { relation: 'unknown', reason: '原文不足以确认条件建立与行动的先后。' };
  row.states[0].transitionStatus = 'unknown';
  assert.ok(validated(row, input).validationIssues.includes('earned_without_state_evidence'));
  row.verdict = 'insufficient_evidence';
  assert.equal(validated(row, input).verdict, 'insufficient_evidence');
  assert.deepEqual(validated(row, input).validationIssues, []);
  row.states[0].beforeEvidence[0].quote = '不存在的原文';
  assert.ok(validated(row, input).validationIssues.some(issue => issue.startsWith('unverified_source:')));
});

test('before-state timing cannot exempt a later enabling transition or invalid after evidence', () => {
  const { row, input } = timingRow(); const state = row.states[0];
  state.enablingTransitionRequired = true; state.stateChanged = true; state.transitionStatus = 'established';
  state.transitionEvidence = structuredClone(state.beforeEvidence);
  const result = validated(row, input);
  assert.ok(result.validationIssues.some(issue => issue.startsWith('retrospective_conflicts_with_required_transition:')));
  assert.ok(result.validationIssues.includes('earned_conflicts_with_state_or_transition_order'));
  const other = timingRow(); other.row.states[0].afterEvidence = [evidence('未出现的行动后状态')];
  assert.ok(validated(other.row, other.input).validationIssues.some(issue => issue.startsWith('unverified_source:')));
});

test('acceptance registry and cache identity use v12 while old schema records remain readable', async () => {
  const { promptAssetLoaderEntries } = require('../../dist/prompting/registry/promptAssetLoaderEntries');
  const { getRegisteredPromptAsset } = require('../../dist/prompting/registry');
  assert.equal(asset.version, 'v12');
  assert.ok(promptAssetLoaderEntries.some(entry => entry.key === `${asset.id}@v12`));
  assert.equal(getRegisteredPromptAsset(asset.id, 'v12'), asset);
  assert.equal(generatedChapterAcceptanceAssessmentSchema.safeParse(fixture.outputs[0]).success, true);
  assert.match(ACTION_STATE_AUDIT_RULES.join('\n'), /不替代afterEvidence或必需的transitionEvidence/);
  const { loadRuntimeSource } = require('./sourceHarness.cjs');
  let version = 'v10';
  const { buildAcceptanceCacheIdentity } = loadRuntimeSource('acceptance/cacheIdentity.ts', {
    'node:crypto': require('node:crypto'),
    './causalAssessment': { buildAcceptancePromptInput: () => fixture.input, acceptanceOutputBudget: () => 12000 },
    '../../../../llm/factory': { resolveLLMClientOptions: async () => ({ provider: 'offline', model: 'offline' }) },
    '../../../../prompting/core/promptRunner': { preparePromptExecution: () => ({ context: {}, messages: [] }) },
    '../../../../prompting/context/promptContextResolution': { resolvePromptContextBlocksForAsset: async () => ({ blocks: [] }) },
    '../../../../prompting/prompts/novel/chapterLayeredContext': { buildChapterReviewContextBlocks: () => [] },
    '../../../../prompting/prompts/novel/chapterAcceptance.prompts': { chapterAcceptanceAssessmentPrompt: { ...asset, get version() { return version; } } },
    '../../../../prompting/slots/PromptSlotOverrideService': { promptSlotOverrideService: {} },
    '../../../../prompting/templates/templateRuntime': { resolveAdvancedPromptMessages: async () => [] },
  });
  const previous = await buildAcceptanceCacheIdentity({ contextPackage: {} }); version = asset.version;
  assert.notEqual(await buildAcceptanceCacheIdentity({ contextPackage: {} }), previous);
});
