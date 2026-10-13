const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/secondChapterReviewV13.json');
const input = structuredClone(require('./fixtures/secondChapterReview.json').input);
input.chapterId = fixture.provenance.chapterId;
input.establishedProse[0].chapterId = fixture.provenance.previousChapterId;
const {
  chapterAcceptanceAssessmentPrompt: asset,
  chapterAcceptanceAssessmentSchema,
  generatedChapterAcceptanceAssessmentSchema,
  resolvedAcceptanceValidation,
} = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { buildEvidenceCatalog, resolveEvidenceReference } = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const { validateActionStateEvidence } = require('../../dist/prompting/prompts/novel/acceptance/actionStateEvidence');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { preparePromptExecution, runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');

function resolveRecorded(value) {
  const catalog = buildEvidenceCatalog(input);
  const visit = item => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    if (typeof item.evidenceId === 'string') return resolveEvidenceReference(catalog, item);
    return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, visit(nested)]));
  };
  return visit(value);
}

// These timing findings are authored for offline contract verification. They do
// not claim the recorded model supplied them or certify the literary verdict.
function simulatedTimingResponse() {
  const output = structuredClone(fixture.outputs[2]);
  for (const check of output.actionStateChecks) {
    for (const state of check.states) {
      state.beforeEvidenceTiming = check.sceneKey === 'suppress_with_fist'
        ? { relation: 'retrospective_prior_state', reason: '练了十几年是在撞击之后补述长期拳术经历，随身材料也已在此前拿出；这些条件在动作前已具备，并非打完才得到。' }
        : { relation: 'before_or_at_action', reason: '所选前章或本章证据在本次行动之前或行动开始时交代已具备的条件，叙述未将后得条件当成前提。' };
    }
  }
  return output;
}

test('all three recorded v13 answers remain unchanged and IDs bind the exact two-chapter snapshot', () => {
  assert.equal(fixture.outputs.length, 3);
  assert.equal(buildEvidenceCatalog(input).snapshotId, '65723ef4510a5104a65518d6c008644f861f0b968b4f98410052ded036f911e3');
  assert.equal(buildEvidenceCatalog(input).snapshotId, fixture.provenance.evidenceCatalogSnapshotId);
  fixture.outputs.forEach((output, index) => {
    assert.equal(createHash('sha256').update(JSON.stringify(output)).digest('hex'), fixture.responses[index].responseObjectSha256);
    assert.equal(fixture.responses[index].promptVersion, 'v13');
    assert.equal(fixture.responses[index].finishReason, 'stop');
  });
  assert.deepEqual(fixture.responses.map(row => row.repairAttempts), [0, 1, 1]);
  assert.deepEqual(fixture.responses.map(row => row.semanticRetryAttempts), [0, 0, 1]);
  assert.equal(input.content.length, 3652);
  assert.equal(input.establishedProse[0].content.length, 3013);
});

test('recorded first answer mixes reference objects into scene explanation arrays and remains schema-invalid', () => {
  assert.deepEqual(fixture.outputs[0].sceneCausalityVerdicts[0].prerequisiteEvidence[0], { evidenceId: 'ev_65723ef4510a_293' });
  const result = asset.outputSchema.safeParse(fixture.outputs[0]);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path[0] === 'sceneCausalityVerdicts' && issue.path.includes('prerequisiteEvidence')));
  assert.ok(result.error.issues.some(issue => issue.path[0] === 'sceneCausalityVerdicts' && issue.path.includes('constraintEvidence')));
});

test('recorded format repair still lacks the arrival transition and the semantic retry fixes only that gap', () => {
  const second = resolveRecorded(fixture.outputs[1]);
  const last = resolveRecorded(fixture.outputs[2]);
  const secondAudit = validateActionStateEvidence(second.actionStateChecks, input);
  const lastAudit = validateActionStateEvidence(last.actionStateChecks, input);
  assert.ok(secondAudit.checks.find(row => row.sceneKey === 'arrive_and_meet').validationIssues.includes('earned_without_state_evidence'));
  assert.deepEqual(lastAudit.checks.find(row => row.sceneKey === 'arrive_and_meet').validationIssues, []);
  for (const audit of [secondAudit, lastAudit]) {
    assert.ok(audit.checks.find(row => row.sceneKey === 'suppress_with_fist').validationIssues.some(issue => issue.startsWith('before_state_after_action:')));
  }
  assert.throws(() => resolvedAcceptanceValidation.postValidate(last, input), /before_state_after_action/);
});

test('v14 rejects missing timing in contextual semantic validation while historical records remain readable', () => {
  assert.equal(asset.version, 'v14');
  const last = fixture.outputs[2];
  const result = asset.outputSchema.safeParse(last);
  assert.equal(result.success, true, 'absence must not trigger context-free JSON repair to invent story timing');
  assert.throws(() => asset.postValidate(result.data, input), /beforeEvidenceTiming/);
  assert.equal(chapterAcceptanceAssessmentSchema.safeParse(resolveRecorded(last)).success, true);
  assert.equal(generatedChapterAcceptanceAssessmentSchema.safeParse(resolveRecorded(last)).success, true);
  const incomplete = simulatedTimingResponse();
  delete incomplete.actionStateChecks[1].states[0].beforeEvidenceTiming;
  assert.equal(asset.outputSchema.safeParse(incomplete).success, true);
  assert.throws(() => asset.postValidate(asset.outputSchema.parse(incomplete), input), /beforeEvidenceTiming/);
  const unexplained = simulatedTimingResponse();
  unexplained.actionStateChecks[1].states[0].beforeEvidenceTiming.reason = '   ';
  assert.equal(asset.outputSchema.safeParse(unexplained).success, false);
});

test('one semantic correction receives missing timing, missing transition and late before-evidence together', () => {
  const raw = asset.outputSchema.parse(structuredClone(fixture.outputs[1]));
  assert.throws(() => asset.postValidate(raw, input), error => {
    assert.match(error.message, /beforeEvidenceTiming/);
    assert.match(error.message, /arrive_and_meet[^\n]*earned_without_state_evidence/);
    assert.match(error.message, /suppress_with_fist[^\n]*before_state_after_action/);
    return true;
  });
});

test('two responses missing timing exhaust one contextual correction and retain incomplete review rather than inventing timing', async () => {
  const calls = [];
  const raw = structuredClone(fixture.outputs[2]);
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    return { data: asset.outputSchema.parse(structuredClone(raw)), repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await runStructuredPrompt({ asset, promptInput: input, options: {
      provider: 'deepseek', model: 'offline-timing-fixture', disableFallbackModel: true,
      transportRetryCount: 0, disableStrategyFallback: true,
    } });
    assert.equal(calls.length, 2);
    const correction = calls[1].messages.map(message => String(message.content)).join('\n');
    assert.match(correction, /beforeEvidenceTiming/);
    assert.match(correction, /八极拳的贴身靠/);
    assert.match(correction, /练了十几年/);
    assert.throws(() => assertReviewCompleted(result.output), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    assert.ok(result.output.actionStateAuditIssues.length);
    assert.ok(result.output.actionStateChecks.every(check => check.states.every(state => state.beforeEvidenceTiming === undefined)));
    assert.deepEqual(result.output.repairDirectives, []);
    assert.deepEqual(result.output.actionStateChecks.map(check => check.actionEvidence), resolveRecorded(raw).actionStateChecks.map(check => check.actionEvidence));
    assert.deepEqual(raw, fixture.outputs[2]);
    assert.equal(input.content.length, 3652);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test('hand-authored explicit timing simulation completes the exact recorded review without changing IDs, verdicts or prose', () => {
  const beforeInput = structuredClone(input);
  const simulated = simulatedTimingResponse();
  const output = asset.postValidate(asset.outputSchema.parse(simulated), input);
  assert.doesNotThrow(() => assertReviewCompleted(output));
  for (let index = 0; index < simulated.actionStateChecks.length; index++) {
    const stripped = structuredClone(simulated.actionStateChecks[index]);
    stripped.states.forEach(state => { delete state.beforeEvidenceTiming; });
    assert.deepEqual(stripped, fixture.outputs[2].actionStateChecks[index]);
  }
  assert.equal(output.actionStateChecks.find(row => row.sceneKey === 'suppress_with_fist').states[0].beforeEvidenceTiming.relation, 'retrospective_prior_state');
  assert.deepEqual(input, beforeInput);
});

test('before_or_at_action is not a bypass for evidence that is actually after the action', () => {
  const local = { chapterId: 'late-key', chapterOrder: 1, content: '她打开保险柜。随后她才拿到钥匙。', expectedSceneKeys: ['chapter'] };
  const evidence = quote => ({ source: 'current_prose', sourceId: local.chapterId, quote });
  const row = { sceneKey: 'chapter', actor: '她', action: '打开保险柜', actionEvidence: [evidence('她打开保险柜。')],
    verdict: 'earned', explanation: '需要核对钥匙是否先于使用取得。', states: [{ dimension: 'item', entity: '钥匙', before: '持有钥匙',
      requiredForAction: '持有钥匙', after: '打开保险柜', beforeEvidence: [evidence('随后她才拿到钥匙。')], afterEvidence: [evidence('她打开保险柜。')],
      transitionEvidence: [], enablingTransitionRequired: false, stateChanged: false, transitionStatus: 'not_needed',
      beforeEvidenceTiming: { relation: 'before_or_at_action', reason: '错误声明条件在动作之前成立。' } }] };
  const audit = validateActionStateEvidence([row], local).checks[0];
  assert.ok(audit.validationIssues.some(issue => issue.startsWith('before_state_after_action:')));
  assert.notEqual(audit.verdict, 'earned');
});

test('unknown story timing cannot remain earned even when all reference IDs are real', () => {
  const raw = simulatedTimingResponse();
  raw.actionStateChecks[2].states[0].beforeEvidenceTiming = { relation: 'unknown', reason: '当前证据不足以确定行动前是否已有条件。' };
  assert.throws(() => asset.postValidate(asset.outputSchema.parse(raw), input), /earned_without_state_evidence/);
});

test('v14 model-facing example shows complete timing shape and retains string scene explanations', () => {
  const prepared = preparePromptExecution({ asset, promptInput: input });
  const text = prepared.messages.map(message => String(message.content)).join('\n');
  assert.match(text, /beforeEvidenceTiming/);
  assert.match(text, /before_or_at_action/);
  assert.match(text, /retrospective_prior_state/);
  assert.match(text, /prerequisiteEvidence/);
  assert.match(text, /constraintEvidence/);
  assert.match(text, /字符串/);
  const hint = asset.structuredOutputHint.example;
  const example = typeof hint === 'function' ? hint(input, prepared.context) : hint;
  assert.equal(asset.outputSchema.safeParse(example).success, true);
  assert.ok(example.actionStateChecks.every(check => check.states.every(state => state.beforeEvidenceTiming?.reason?.trim())));
});
