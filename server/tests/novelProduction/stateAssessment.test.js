const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const shared = loadRuntimeSource('../../../../../shared/types/novel/sceneCausality/actionState.ts', { zod: require('zod') });
const evidence = loadRuntimeSource('../../../prompting/prompts/novel/acceptance/evidenceCatalog.ts', { 'node:crypto': require('node:crypto') });
const { referenceActionAssessmentSchema, normalizeReferenceActions } = loadRuntimeSource(
  '../../../prompting/prompts/novel/acceptance/stateAssessment.ts', {
    zod: require('zod'), '@ai-novel/shared/types/novel/sceneCausality': shared, './evidenceCatalog': evidence,
  },
);
const input = { chapterId: 'c1', chapterOrder: 1, content: '她持有符纸。她燃烧符纸。符纸化为灰烬。' };
const catalog = evidence.buildEvidenceCatalog(input);
const ref = index => ({ evidenceId: catalog.entries[index].id });
const finding = (status, refs = []) => ({ status, evidence: refs, reason: '根据所选正文逐项判断。' });
function response() {
  return {
    sceneKey: 's1', actor: '她', action: '烧符', actionEvidence: [ref(1)], explanation: '烧符消耗既有符纸。',
    states: [{ dimension: 'item', entity: '符纸', before: '持有符纸', requiredForAction: '持有可用符纸', after: '符纸耗尽',
      beforeEvidence: [ref(0)], beforeEvidenceTiming: { relation: 'before_or_at_action', reason: '持有发生在燃烧之前。' },
      afterEvidence: [ref(2)], prerequisite: finding('satisfied', [ref(0)]), resultChange: finding('changed', [ref(1), ref(2)]) }],
  };
}
function normalize(raw = response()) { return normalizeReferenceActions([referenceActionAssessmentSchema.parse(raw)], catalog); }

test('result consumption and pre-existing possession stay separate without model-authored redundant flags', () => {
  const raw = response();
  const original = structuredClone(raw);
  const { checks: [check], problems } = normalize(raw);
  assert.deepEqual(problems, []);
  assert.equal(check.verdict, 'earned');
  const state = check.states[0];
  assert.equal(state.enablingTransitionRequired, false);
  assert.equal(state.stateChanged, true);
  assert.equal(state.transitionStatus, 'established');
  assert.equal(state.assessment.prerequisite.status, 'satisfied');
  assert.equal(state.assessment.resultChange.status, 'changed');
  assert.equal(state.assessment.resultChange.evidence[0].quote, '她燃烧符纸。');
  assert.equal(state.assessment.resultChange.evidence[0].start, input.content.indexOf('她燃烧符纸。'));
  assert.deepEqual(raw, original);
  assert.equal(shared.actionStateCheckSchema.safeParse(check).success, true);
});

test('wire refuses old flags, action verdict, invented quote and server assessment metadata', () => {
  for (const fields of [{ stateChanged: true }, { enablingTransitionRequired: false }, { transitionStatus: 'not_needed' }, { transitionEvidence: [] }, { assessment: {} }]) {
    const raw = response(); Object.assign(raw.states[0], fields);
    assert.equal(referenceActionAssessmentSchema.safeParse(raw).success, false, JSON.stringify(fields));
  }
  const verdict = response(); verdict.verdict = 'earned';
  assert.equal(referenceActionAssessmentSchema.safeParse(verdict).success, false);
  const quote = response(); quote.states[0].resultChange.evidence[0].quote = 'invented';
  assert.equal(referenceActionAssessmentSchema.safeParse(quote).success, false);
});

test('all 25 structured role combinations produce deterministic compatible projections', () => {
  for (const prerequisite of ['satisfied', 'established', 'missing', 'contradicted', 'unknown']) {
    for (const result of ['unchanged', 'changed', 'unsupported', 'contradicted', 'unknown']) {
      const raw = response(); raw.states[0].prerequisite = finding(prerequisite); raw.states[0].resultChange = finding(result);
      const { checks: [check] } = normalize(raw);
      const state = check.states[0];
      const contradicted = prerequisite === 'contradicted' || result === 'contradicted';
      const missing = prerequisite === 'missing' || result === 'unsupported';
      const unknown = prerequisite === 'unknown' || result === 'unknown';
      assert.equal(check.verdict, contradicted ? 'contradicted' : missing ? 'unearned' : unknown ? 'insufficient_evidence' : 'earned', `${prerequisite}/${result}`);
      assert.equal(state.transitionStatus, contradicted ? 'contradicted' : missing ? 'missing' : unknown ? 'unknown' : prerequisite === 'established' || result === 'changed' ? 'established' : 'not_needed');
      assert.equal(state.enablingTransitionRequired, ['established', 'missing', 'contradicted'].includes(prerequisite));
      assert.equal(state.stateChanged, ['changed', 'unsupported', 'contradicted'].includes(result));
    }
  }
});

test('missing semantic roles parse but produce exact field problems without fabricated findings', () => {
  for (const field of ['prerequisite', 'resultChange', 'beforeEvidenceTiming']) {
    const raw = response(); delete raw.states[0][field];
    const { checks: [check], problems } = normalize(raw);
    assert.ok(problems.some(problem => problem.includes(`states[0].${field}:`)), field);
    assert.equal(check.verdict, 'insufficient_evidence');
    if (field !== 'beforeEvidenceTiming') assert.equal(check.states[0].assessment, undefined);
  }
});

test('every evidence role retains unknown ID and path as a failure instead of silently accepting', () => {
  for (const role of ['actionEvidence', 'beforeEvidence', 'afterEvidence', 'prerequisite', 'resultChange']) {
    const raw = response();
    const refs = [{ evidenceId: `missing-${role}` }];
    if (role === 'actionEvidence') raw.actionEvidence = refs;
    else if (['prerequisite', 'resultChange'].includes(role)) raw.states[0][role].evidence = refs;
    else raw.states[0][role] = refs;
    const { checks: [check], problems } = normalize(raw);
    assert.equal(check.verdict, 'insufficient_evidence');
    assert.ok(problems.some(problem => problem.includes(`missing-${role}`) && problem.includes(role) && problem.includes(catalog.snapshotId)));
  }
});

test('explicit late or unknown timing cannot produce an earned action', () => {
  for (const [relation, expected] of [['not_before_action', 'contradicted'], ['unknown', 'insufficient_evidence'], ['retrospective_prior_state', 'earned']]) {
    const raw = response(); raw.states[0].beforeEvidenceTiming.relation = relation;
    assert.equal(normalize(raw).checks[0].verdict, expected);
  }
});

test('role evidence keeps independent identities and four-item compatibility evidence without truncation', () => {
  const raw = response();
  raw.states[0].prerequisite = finding('established', [ref(0), ref(1)]);
  raw.states[0].resultChange = finding('changed', [ref(1), ref(2)]);
  const state = normalize(raw).checks[0].states[0];
  assert.equal(state.transitionEvidence.length, 4);
  assert.equal(state.assessment.prerequisite.evidence.length, 2);
  assert.equal(state.assessment.resultChange.evidence.length, 2);
  assert.equal(shared.actionStateDimensionCheckSchema.safeParse(state).success, true);
  assert.equal(state.assessment.prerequisite.evidence[1].evidenceId, state.assessment.resultChange.evidence[0].evidenceId);
});

test('historical canonical reviews remain readable without the new optional assessment', () => {
  const check = normalize().checks[0]; delete check.states[0].assessment;
  assert.equal(shared.actionStateCheckSchema.safeParse(check).success, true);
});

test('findings require actual reason strings and bounded reference arrays', () => {
  for (const role of ['prerequisite', 'resultChange']) {
    for (const reason of ['', ' ', '字'.repeat(181)]) {
      const raw = response(); raw.states[0][role].reason = reason;
      assert.equal(referenceActionAssessmentSchema.safeParse(raw).success, false);
    }
    const raw = response(); raw.states[0][role].evidence = [ref(0), ref(1), ref(2)];
    assert.equal(referenceActionAssessmentSchema.safeParse(raw).success, false);
  }
});
