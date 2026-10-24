// Offline contract simulations for the chapter-review completion boundary. No model call,
// no manuscript edit and no database access: these reproduce the v18 semantic wire rules only.
const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const contract = require('../../dist/prompting/prompts/novel/acceptance/semantic/reviewContract');
const evidence = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const wire = require('../../dist/prompting/prompts/novel/acceptance/semantic/wireReview');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');

const input = { chapterId: 'tolerance-offline', chapterOrder: 1, expectedSceneKeys: ['scene'],
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

function validate(raw) {
  return wire.validateReviewEnvelope(raw, input);
}

function rejection(raw) {
  try { validate(raw); } catch (error) { return error; }
  return assert.fail('the simulated review answer must not pass the completion gate');
}

test('a few extra valid citations are real material, not a review failure', () => {
  const raw = valid();
  raw.sceneCausalityVerdicts[0].choiceAndResistance.evidence = [ref(1), ref(2), ref(0)];
  raw.sceneCausalityVerdicts[0].constraints[0].evidence = [ref(2), ref(0)];
  Object.assign(raw.progressionChecks[0], {
    status: 'progressed', repeatsEstablishedBeat: false, addsNewConsequence: true,
    actualChange: '她读完后拒签', newConsequence: '合作未成立',
    currentEvidence: [ref(1), ref(2), ref(0)],
  });
  const output = validate(raw);
  assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.equal(output.continuePolicy, 'continue');
  // The canonical projection keeps the model's first two citations per list.
  assert.equal(output.progressionChecks[0].currentEvidence.length, 2);
  assert.equal(output.progressionChecks[0].currentEvidence[0].evidenceId, raw.progressionChecks[0].currentEvidence[0].evidenceId);
});

test('an evidenced negative story fact is a completed review even without a bound issue', () => {
  const raw = valid();
  const state = raw.actionStateChecks[0].states[0];
  state.prerequisite = { status: 'contradicted', basis: structuredClone(state.before),
    reason: '正文显示所需条件并不成立，这是故事内的真实限制。' };
  const output = validate(raw);
  assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.equal(output.actionStateChecks[0].verdict, 'contradicted');
  assert.equal(output.continuePolicy, 'continue');
});

test('a claimed defect still needs a verified unresolved issue binding', () => {
  const raw = valid();
  const state = raw.actionStateChecks[0].states[0];
  state.prerequisite = { status: 'contradicted', basis: structuredClone(state.before),
    reason: '正文显示所需条件并不成立。' };
  raw.actionStateChecks[0].findingIssueId = 'missing-issue';
  const error = rejection(raw);
  assert.ok(error.reviewContractIssues.includes('actionStateChecks[0].findingIssueId:negative_finding_requires_verified_issue'));
});

test('a scene row dropped for its own shape error does not report coverage as missing', () => {
  const raw = valid();
  raw.sceneCausalityVerdicts[0].choiceAndResistance = '应为一个finding对象';
  const error = rejection(raw);
  const message = String(error.message);
  assert.match(message, /sceneCausalityVerdicts\.0\.choiceAndResistance:review_shape_invalid/);
  assert.doesNotMatch(message, /sceneCausalityVerdicts:scene_coverage_invalid/);
  assert.match(message, /因自身格式错误被整行剔除/);
});
