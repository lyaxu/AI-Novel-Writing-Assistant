const test = require('node:test');
const assert = require('node:assert/strict');
const { collectAcceptanceDiagnostics } = require('../../dist/prompting/prompts/novel/acceptance/reviewDiagnostics');
const { collectAcceptanceIssueSources, validateAcceptanceIssueSources } = require('../../dist/prompting/prompts/novel/acceptance/progressionEvidence');
const { resolvedAcceptanceValidation } = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');

const input = { chapterId: 'current', chapterOrder: 2, content: '她拿着钥匙。她用钥匙开门。', expectedSceneKeys: ['s'],
  establishedProse: [{ chapterId: 'prior', order: 1, content: '她决定去开门。' }] };
const evidence = (quote, source = 'current_prose', sourceId = 'current') => ({ source, sourceId, quote });
const progression = dimension => ({ dimension, status: 'not_applicable', repeatsEstablishedBeat: null, addsNewConsequence: null,
  priorState: '已知前文', actualChange: '', newConsequence: '', previousEvidence: [], currentEvidence: [],
  explanation: '这项没有比较职责。', repairSuggestion: '' });
function assessment() {
  return { status: 'accepted', score: { coherence: 80, pacing: 80, repetition: 80, engagement: 80, voice: 80, overall: 80 },
    summary: '离线审查', sceneCausalityVerdicts: [{ sceneKey: 's', verdict: 'earned', outcomeObserved: true,
      prerequisiteEvidence: ['持有钥匙'], constraintEvidence: [], choiceAndResistanceEvidence: '使用钥匙', outcomeMechanismEvidence: '钥匙开门', explanation: '条件已具备。' }],
    actionStateChecks: [{ sceneKey: 's', actor: '她', action: '开门', actionEvidence: [evidence('她用钥匙开门。')],
      states: [{ dimension: 'item', entity: '钥匙', before: '持有', requiredForAction: '持有', after: '仍持有',
        beforeEvidence: [evidence('她拿着钥匙。')], afterEvidence: [evidence('她用钥匙开门。')], transitionEvidence: [],
        beforeEvidenceTiming: { relation: 'before_or_at_action', reason: '拿钥匙在开门之前。' },
        stateChanged: false, enablingTransitionRequired: false, transitionStatus: 'not_needed' }], verdict: 'earned', explanation: '使用既有物品。' }],
    progressionChecks: ['event_repetition', 'knowledge_repetition', 'prior_goal_followthrough'].map(progression),
    blockingIssues: [], repairDirectives: [], missingObligations: [], repairability: 'none', decisionReason: '可继续',
    riskTags: [], assetSyncRecommendation: { priority: 'normal', reason: '常规', requiresFullPayoffReconcile: false }, continuePolicy: 'continue' };
}

test('collector reports scene, action, progression and every issue source together without mutating the answer', () => {
  const raw = assessment();
  raw.sceneCausalityVerdicts = [];
  raw.actionStateChecks[0].states[0].stateChanged = true;
  raw.progressionChecks[0] = { ...progression('event_repetition'), status: 'progressed', repeatsEstablishedBeat: true,
    addsNewConsequence: false, currentEvidence: [evidence('不存在的动作。')] };
  raw.blockingIssues = [
    { code: 'one', severity: 'medium', category: 'plot', evidence: '待核对', fixSuggestion: '待核对', sourceEvidence: [evidence('不存在前文。', 'established_context', 'prior')] },
    { code: 'two', severity: 'medium', category: 'plot', evidence: '待核对', fixSuggestion: '待核对', sourceEvidence: [evidence('也不存在。')] },
  ];
  const original = structuredClone(raw);
  const result = collectAcceptanceDiagnostics(raw, input, { citationMode: 'refs' });
  const combined = result.problems.join('\n');
  assert.match(combined, /scene_coverage_invalid/);
  assert.match(combined, /actionStateChecks\[0\].*earned_without_required_transition/);
  assert.match(combined, /progressionChecks\[0\].*current_quote_not_in_current_prose/);
  assert.match(combined, /progressed_conflicts_with_repeated_beat/);
  assert.match(combined, /blockingIssues\[0\].*current_issue_source_missing/);
  assert.match(combined, /blockingIssues\[0\].*issue_quote_source_mismatch/);
  assert.match(combined, /blockingIssues\[1\].*issue_quote_source_mismatch/);
  const feedback = result.correctionHints.join('\n');
  assert.match(feedback, /stateChanged=true/);
  assert.match(feedback, /not_needed/);
  assert.match(feedback, /progressionChecks\[0\].*当前值/);
  assert.match(feedback, /evidenceId/);
  assert.doesNotMatch(feedback, /逐字引用|逐字复制|copy a continuous exact quote/);
  assert.deepEqual(raw, original);
});

test('source collector retains every source field error and legacy throw facade reports all issues', () => {
  const issues = [
    { code: 'a', sourceEvidence: [evidence('错引1。'), evidence('错引2。')] },
    { code: 'b', sourceEvidence: [evidence('不存在前章。', 'established_context', 'missing')] },
    { code: 'legacy' },
  ];
  const diagnostics = collectAcceptanceIssueSources(issues, input);
  assert.equal(diagnostics.length, 4);
  assert.ok(diagnostics.some(row => row.path.endsWith('sourceEvidence[1]')));
  assert.ok(diagnostics.some(row => row.path.includes('blockingIssues[1]') && row.code === 'current_issue_source_missing'));
  assert.throws(() => validateAcceptanceIssueSources(issues, input), error => {
    assert.match(error.message, /Issue a/);
    assert.match(error.message, /Issue b/);
    assert.match(error.message, /sourceEvidence\[1\]/);
    return true;
  });
});

test('known review errors aggregate while unexpected runtime errors propagate instead of masquerading as ordinary review findings', () => {
  const raw = assessment();
  Object.defineProperty(raw, 'blockingIssues', { get() { throw new Error('unexpected storage adapter failure'); } });
  assert.throws(() => collectAcceptanceDiagnostics(raw, input, { citationMode: 'refs' }), /unexpected storage adapter failure/);
});

test('all progression inconsistency codes receive field-specific Chinese correction instructions', () => {
  const variants = [
    { status: 'stalled', previousEvidence: [evidence('错前文', 'established_context', 'prior')], currentEvidence: [evidence('错本章')] },
    { status: 'stalled', repeatsEstablishedBeat: true, addsNewConsequence: true },
    { dimension: 'prior_goal_followthrough', status: 'progressed', repeatsEstablishedBeat: false, addsNewConsequence: false },
    { status: 'justified_repetition', repeatsEstablishedBeat: false, addsNewConsequence: false },
    { status: 'progressed', repeatsEstablishedBeat: true, addsNewConsequence: true },
    { status: 'progressed', repeatsEstablishedBeat: null, addsNewConsequence: null },
  ];
  const expected = new Set([
    'previous_quote_not_in_established_prose', 'current_quote_not_in_current_prose', 'current_evidence_missing',
    'comparison_evidence_missing', 'prior_goal_evidence_missing', 'actual_change_missing', 'new_consequence_missing',
    'repair_suggestion_missing', 'semantic_findings_unknown', 'repetition_evidence_missing',
    'progressed_conflicts_with_repeated_beat', 'justified_repetition_conflicts_with_semantic_findings',
    'stalled_conflicts_with_new_consequence', 'declared_consequence_missing', 'progressed_but_consequence_denied',
    'previous_prose_unavailable', 'dimension_coverage_invalid',
  ]);
  const seen = new Set();
  for (const variant of variants) {
    const raw = assessment();
    raw.progressionChecks = [{ ...progression('event_repetition'), ...variant }];
    if (variant.status === 'justified_repetition') raw.progressionChecks.push(structuredClone(raw.progressionChecks[0]));
    const result = collectAcceptanceDiagnostics(raw, input, { citationMode: 'refs' });
    result.progression.checks.flatMap(row => row.validationIssues).forEach(code => seen.add(code));
    for (const code of result.progression.checks.flatMap(row => row.validationIssues)) {
      const hint = result.correctionHints.find(value => value.includes(`${code}；`));
      assert.ok(hint && /progressionChecks\[\d\].*当前值=/.test(hint), code);
      assert.match(hint, /[\u4e00-\u9fff]/);
    }
  }
  const absentPrior = collectAcceptanceDiagnostics(assessment(), { ...input, establishedProse: [] }, { citationMode: 'refs' });
  absentPrior.progression.checks.flatMap(row => row.validationIssues).forEach(code => seen.add(code));
  assert.deepEqual([...seen].sort(), [...expected].sort());
});

test('citation guidance is selected explicitly for refs and historical legacy callers', () => {
  const raw = assessment();
  assert.match(collectAcceptanceDiagnostics(raw, input, { citationMode: 'refs' }).correctionHints[0], /evidenceId/);
  assert.match(collectAcceptanceDiagnostics(raw, input, { citationMode: 'legacy' }).correctionHints[0], /复制连续准确原文/);
});

test('exhausted review correction retains all invalid evidence gates and cannot authorize a prose patch', () => {
  const raw = assessment();
  raw.actionStateChecks[0].states[0].stateChanged = true;
  raw.progressionChecks[0] = { ...progression('event_repetition'), status: 'progressed', repeatsEstablishedBeat: true, addsNewConsequence: false };
  raw.repairDirectives = [{ mode: 'patch', target: 'plot', instruction: '未核实，不可执行。' }];
  const result = resolvedAcceptanceValidation.postValidateFailureRecovery({
    rawOutput: raw, promptInput: input, context: {}, validationError: 'offline simultaneous failures', semanticRetryAttempts: 1,
  });
  assert.throws(() => assertReviewCompleted(result), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
  assert.ok(result.actionStateChecks[0].validationIssues.length);
  assert.ok(result.progressionChecks[0].validationIssues.length);
  assert.deepEqual(result.repairDirectives, []);
  assert.deepEqual(result.deferredRepairDirectives, raw.repairDirectives);
});
