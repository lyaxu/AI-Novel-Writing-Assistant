// Synthetic diagnostics only; no model calls, manuscript edits or database imports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const contract = require('../../dist/prompting/prompts/novel/acceptance/semantic/reviewContract');
const actions = require('../../dist/prompting/prompts/novel/acceptance/semantic/actionFacts');
const evidence = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const wire = loadRuntimeSource('../../../prompting/prompts/novel/acceptance/semantic/wireReview.ts', {
  zod: require('zod'), '../../chapterAcceptance.prompts': prompts, './reviewContract': contract,
  './actionFacts': actions, '../evidenceCatalog': evidence,
});
const input = { chapterId: 'partial-offline', chapterOrder: 1, expectedSceneKeys: ['scene'],
  content: '她读完条款。她拒绝签字。对方收回合同。' };
const catalog = evidence.buildEvidenceCatalog(input);
const ref = index => ({ evidenceId: catalog.entries[index].id });
function valid() {
  const raw = contract.semanticExample(input);
  const action = raw.actionStateChecks[0];
  action.actionEvidence = [ref(1)];
  const state = action.states[0];
  state.before.evidence = state.prerequisite.basis.evidence = [ref(0)];
  state.after.evidence = state.resultChange.basis.evidence = [ref(1)];
  raw.sceneCausalityVerdicts[0].choiceAndResistance.evidence = [ref(1)];
  raw.sceneCausalityVerdicts[0].constraints[0].evidence = [ref(2)];
  return raw;
}
function failure(raw) {
  let error;
  try { wire.validateReviewEnvelope(raw, input); } catch (caught) { error = caught; }
  assert.ok(error, 'the original malformed response must never pass via a projection');
  const recovered = wire.recoverReviewEnvelope(raw, input, error.message);
  assert.deepEqual(recovered.reviewRawResponse, raw);
  assert.deepEqual(recovered.reviewSemanticResponse, raw);
  assert.equal(recovered.status, 'needs_manual_review');
  assert.deepEqual(recovered.repairDirectives, []);
  assert.deepEqual(recovered.missingObligations, []);
  assert.ok(recovered.reviewContractIssues.some(problem => problem.includes('review_shape_invalid')));
  return error.message;
}

test('complete valid source remains the sole positive path', () => {
  const raw = valid();
  const output = wire.validateReviewEnvelope(raw, input);
  assert.equal(output.status, 'accepted');
  assert.deepEqual(output.reviewSemanticResponse, raw);
});

test('bad action enum does not hide other states or independent fact-role findings', () => {
  const raw = valid();
  const first = raw.actionStateChecks[0].states[0];
  const second = structuredClone(first);
  first.dimension = 'resources';
  first.before.reason = '';
  first.before.evidence = [{ evidenceId: 'missing-before-id' }];
  second.after.entity = '另一位人物';
  second.prerequisite.basis.storyTime = 'during_or_after_action';
  raw.actionStateChecks[0].states.push(second);
  const message = failure(raw);
  assert.match(message, /actionStateChecks\[0\]\.states\[0\]\.before\.evidence\[0\]:unknown_evidence_id="missing-before-id"/);
  assert.match(message, /actionStateChecks\[0\]\.states\[1\]\.after\.entity:semantic_entity_mismatch/);
  assert.match(message, /actionStateChecks\[0\]\.states\[1\]\.prerequisite\.basis\.storyTime:finding_story_time_conflict/);
});

test('bad scene constraints shape does not hide an unknown choice evidence ID', () => {
  const raw = valid();
  raw.sceneCausalityVerdicts[0].constraints = raw.sceneCausalityVerdicts[0].constraints[0];
  raw.sceneCausalityVerdicts[0].choiceAndResistance.evidence = [{ evidenceId: 'missing-choice-id' }];
  assert.match(failure(raw), /sceneCausalityVerdicts\[0\]\.choiceAndResistance\.evidence\[0\]:unknown_evidence_id="missing-choice-id"/);
});

test('valid issue and progression rows retain original indexes after malformed neighbors', () => {
  const raw = valid();
  const issue = { severity: 'low', category: 'plot', code: 'synthetic', evidence: '仅用于离线核验',
    fixSuggestion: '仅用于离线核验', sourceEvidence: [ref(1)] };
  raw.blockingIssues = [{ ...issue, severity: 'invalid' }, issue];
  const finding = { issueId: 'valid-finding', issueIndex: 1, status: 'unresolved', repairScope: 'local', nearbyEvidence: [], reason: '模拟缺少周边证据' };
  raw.issueChecks = [{ ...finding, issueId: 'invalid-finding', issueIndex: 0, status: 'invalid' }, finding];
  raw.progressionChecks[0].dimension = 'invalid';
  Object.assign(raw.progressionChecks[1], { status: 'progressed', repeatsEstablishedBeat: true,
    addsNewConsequence: false, currentEvidence: [ref(1)] });
  const message = failure(raw);
  assert.match(message, /issueChecks\[1\].*current_nearby_evidence_required/);
  assert.match(message, /progressionChecks\[1\].*progressed_conflicts_with_repeated_beat/);
});

test('all JSON root shapes reach contextual diagnostics without singleton-array unwrapping', () => {
  for (const raw of [[valid()], null, 'completed JSON string', 7, true]) {
    assert.deepEqual(wire.reviewEnvelopeSchema.parse(raw), raw);
    assert.match(failure(raw), /review:review_shape_invalid/);
  }
});
