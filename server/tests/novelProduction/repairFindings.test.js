const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const evidence = loadRuntimeSource('../../../prompting/prompts/novel/acceptance/evidenceCatalog.ts', { 'node:crypto': require('node:crypto') });
const { normalizeRepairFindings, reviewFindingSchema, reviewFindingRecordSchema, reviewQualityDebtSchema } = loadRuntimeSource(
  '../../../prompting/prompts/novel/acceptance/semantic/repairFindings.ts', { zod: require('zod'), '../evidenceCatalog': evidence });
const { assertReviewCompleted } = loadRuntimeSource('acceptance/reviewCompletion.ts', {});
const input = { chapterId: 'c', chapterOrder: 1, content: '她发现门锁坏了。她换好门锁。' };
const catalog = evidence.buildEvidenceCatalog(input);
const reference = index => ({ evidenceId: catalog.entries[index].id });
const quote = index => evidence.resolveEvidenceReference(catalog, reference(index));
function output() {
  return { status: 'repairable', score: { coherence: 80, pacing: 80, repetition: 80, engagement: 80, voice: 80, overall: 80 },
    summary: '离线模拟审查建议。', blockingIssues: [{ severity: 'low', category: 'continuity', code: 'lock',
      evidence: '门锁损坏', fixSuggestion: '换锁', sourceEvidence: [quote(0)] }],
    repairDirectives: [{ issueId: 'lock-check', mode: 'rewrite', target: 'continuity', instruction: '换锁' }],
    missingObligations: [], repairability: 'rewrite_needed', decisionReason: '测试', riskTags: ['lock'],
    assetSyncRecommendation: { priority: 'normal', reason: '常规', requiresFullPayoffReconcile: false }, continuePolicy: 'repair_once' };
}
function finding(status = 'unresolved', repairScope = 'local') {
  return { issueId: 'lock-check', issueIndex: 0, status, repairScope,
    nearbyEvidence: [reference(1)], reason: '这是人工模拟判断，必须与邻近已写过程一起核对。' };
}

test('explicit scope alone chooses patch, chapter rewrite or replan; severity does not choose', () => {
  for (const [scope, mode, repairability, status] of [['local', 'patch', 'patchable_obligation_gap', 'repairable'],
    ['chapter', 'rewrite', 'rewrite_needed', 'repairable'], ['replan', 'manual', 'plan_misalignment', 'needs_manual_review']]) {
    const original = output(); const saved = structuredClone(original);
    const result = normalizeRepairFindings([finding('unresolved', scope)], original, catalog);
    assert.deepEqual(result.problems, []); assert.equal(result.output.repairDirectives[0].mode, mode);
    assert.equal(result.output.repairability, repairability); assert.equal(result.output.status, status);
    if (scope === 'replan') assert.equal(result.output.continuePolicy, 'pause');
    assert.deepEqual(original, saved); assert.equal(reviewFindingRecordSchema.safeParse(result.output.reviewFindings[0]).success, true);
  }
  const high = output(); high.blockingIssues[0].severity = 'critical';
  assert.equal(normalizeRepairFindings([finding('unresolved', 'local')], high, catalog).output.repairability, 'patchable_obligation_gap');
});

test('already-addressed observation and its proposed edit remain inspectable but are not defects', () => {
  const result = normalizeRepairFindings([finding('already_addressed', 'none')], output(), catalog);
  assert.deepEqual(result.problems, []); assert.deepEqual(result.output.blockingIssues, []);
  assert.deepEqual(result.output.repairDirectives, []); assert.equal(result.output.reviewFindings[0].originalIssue.code, 'lock');
  assert.equal(result.output.deferredRepairDirectives.length, 1); assert.equal(result.output.status, 'accepted');
  assert.equal(result.output.continuePolicy, 'continue'); assert.equal(result.output.repairability, 'none');
  assert.deepEqual(result.output.riskTags, []);
});

test('uncertain findings are visible debt with no automatic edit, rewrite or global pause', () => {
  const original = output(); original.continuePolicy = 'pause';
  original.missingObligations = [{ issueId: 'lock-check', kind: 'must_hit_now', summary: '补写换锁过程', evidence: '不确定' }];
  const uncertain = finding('uncertain', 'none'); uncertain.nearbyEvidence = [];
  const result = normalizeRepairFindings([uncertain], original, catalog);
  assert.deepEqual(result.problems, []); assert.equal(result.output.status, 'continue_with_risk');
  assert.equal(result.output.continuePolicy, 'continue'); assert.equal(result.output.repairability, 'none');
  assert.deepEqual(result.output.blockingIssues, []); assert.deepEqual(result.output.repairDirectives, []);
  assert.deepEqual(result.output.missingObligations, []); assert.equal(result.output.deferredMissingObligations.length, 1);
  assert.ok(result.output.riskTags.includes('review_uncertain:lock-check'));
  assert.equal(reviewQualityDebtSchema.safeParse(result.output.reviewQualityDebt[0]).success, true);
  assert.doesNotThrow(() => assertReviewCompleted(result.output));
});

test('unknown risk and negative action or progression findings survive scope-none normalization', () => {
  for (const fragment of [{ riskTags: ['other-warning'] }, { actionStateChecks: [{ verdict: 'insufficient_evidence' }] },
    { progressionChecks: [{ status: 'stalled' }] }]) {
    const original = { ...output(), blockingIssues: [], repairDirectives: [], riskTags: [], ...fragment };
    const result = normalizeRepairFindings([], original, catalog);
    assert.equal(result.output.status, 'continue_with_risk'); assert.equal(result.output.continuePolicy, 'continue');
  }
});

test('unbound instructions and obligations cannot bypass issue verification', () => {
  for (const issueId of [undefined, 'wrong-id']) {
    const original = output(); original.repairDirectives[0].issueId = issueId;
    original.missingObligations = [{ issueId, kind: 'must_hit_now', summary: '补正文', evidence: '尚未绑定' }];
    const result = normalizeRepairFindings([finding()], original, catalog);
    assert.ok(result.problems.some(problem => problem.includes('repairDirectives[0].issueId')));
    assert.ok(result.problems.some(problem => problem.includes('missingObligations[0].issueId')));
    assert.deepEqual(result.output.repairDirectives, []); assert.deepEqual(result.output.missingObligations, []);
  }
});

test('missing or duplicate issue coverage prevents associated edits from executing', () => {
  for (const findings of [undefined, [], [finding(), finding()], [{ ...finding(), issueIndex: 9 }]]) {
    const result = normalizeRepairFindings(findings, output(), catalog);
    assert.ok(result.problems.length); assert.deepEqual(result.output.repairDirectives, []);
  }
  const original = output(); original.blockingIssues.push({ ...original.blockingIssues[0], code: 'other' });
  const result = normalizeRepairFindings([finding(), { ...finding(), issueIndex: 1 }], original, catalog);
  assert.ok(result.problems.some(problem => problem.includes('duplicate_issue_id')));
  assert.deepEqual(result.output.repairDirectives, []);
});

test('invalid source and unknown neighbor ID preserve exact diagnostic context and cannot authorize repair', () => {
  const original = output(); original.blockingIssues[0].sourceEvidence[0].quote = '伪造原文';
  let result = normalizeRepairFindings([finding()], original, catalog);
  assert.ok(result.problems.some(problem => problem.includes('unverified_issue_source')));
  assert.deepEqual(result.output.repairDirectives, []);
  const bad = finding(); bad.nearbyEvidence = [{ evidenceId: 'unknown-nearby' }];
  result = normalizeRepairFindings([bad], output(), catalog);
  assert.ok(result.problems.some(problem => problem.includes('unknown-nearby') && problem.includes(catalog.snapshotId)));
  assert.deepEqual(result.output.repairDirectives, []);
});

test('claimed handled or unresolved diagnosis requires nearby current prose and nonactionable scope must be none', () => {
  for (const status of ['already_addressed', 'unresolved']) {
    const row = finding(status, status === 'already_addressed' ? 'none' : 'local'); row.nearbyEvidence = [];
    assert.ok(normalizeRepairFindings([row], output(), catalog).problems.some(problem => problem.includes('current_nearby_evidence_required')));
  }
  assert.ok(normalizeRepairFindings([finding('uncertain', 'chapter')], output(), catalog).problems.some(problem => problem.includes('non_actionable_finding_requires_none')));
  assert.ok(normalizeRepairFindings([finding('unresolved', 'none')], output(), catalog).problems.some(problem => problem.includes('repair_scope_none_cannot_authorize_edit')));
});

test('recorded manuscript already supports both late return and a behavioral response without adding prose', () => {
  const realInput = structuredClone(require('./fixtures/secondChapterReview.json').input);
  const before = structuredClone(realInput); const realCatalog = evidence.buildEvidenceCatalog(realInput);
  const select = text => {
    const rows = realCatalog.entries.filter(row => row.quote.trim() === text);
    assert.equal(rows.length, 1, `manually selected manuscript evidence: ${text}`);
    return { evidenceId: rows[0].id };
  };
  const resolve = text => evidence.resolveEvidenceReference(realCatalog, select(text));
  // Explicit offline reviewer simulation of the observed two false-positive patterns, not an automatic literary judgment.
  const original = { ...output(), blockingIssues: [
    { severity: 'low', category: 'continuity', code: 'timeline_transport_inconsistency', evidence: '来时末班车，回时没车', fixSuggestion: '补公交说明',
      sourceEvidence: [resolve('公交车在柳巷街口刹住，劳梓凡最后一个下车。'), resolve('末班车早没了，这个点只能打车回去。')] },
    { severity: 'low', category: 'voice', code: 'emotion_label_without_behavior', evidence: '鸡皮疙瘩后缺动作', fixSuggestion: '补看郑小满的动作',
      sourceEvidence: [resolve('劳梓凡盯着那六个字，后背的汗还没干，又起了一层鸡皮疙瘩。')] },
  ], repairDirectives: [
    { issueId: 'bus', mode: 'rewrite', target: 'continuity', instruction: '补公交说明' },
    { issueId: 'emotion', mode: 'patch', target: 'voice', instruction: '补看郑小满的动作' },
  ], riskTags: ['timeline_transport_inconsistency', 'emotion_label_without_behavior'] };
  const findings = [
    { issueId: 'bus', issueIndex: 0, status: 'already_addressed', repairScope: 'none',
      nearbyEvidence: [select('公交车在柳巷街口刹住，劳梓凡最后一个下车。'), select('末班车早没了，这个点只能打车回去。')],
      reason: '来时赶上末班、经历驱邪后回程公交收班可以同时成立，未发现矛盾，不据此补文。' },
    { issueId: 'emotion', issueIndex: 1, status: 'already_addressed', repairScope: 'none',
      nearbyEvidence: [select('那根在哪？'), select('他回头看了一眼郑小满。')],
      reason: '正文已有因提示产生的追问和回看，不能重复要求补同一个行为。' },
  ];
  const result = normalizeRepairFindings(findings.map(row => reviewFindingSchema.parse(row)), original, realCatalog);
  assert.deepEqual(result.problems, []); assert.deepEqual(result.output.blockingIssues, []);
  assert.deepEqual(result.output.repairDirectives, []); assert.equal(result.output.reviewFindings.length, 2);
  assert.equal(result.output.deferredRepairDirectives.length, 2); assert.equal(result.output.repairability, 'none');
  assert.deepEqual(realInput, before);
});

test('verified scope-none defect remains debt without legacy projections recreating an unbound patch', () => {
  const original = output(); original.repairDirectives = []; original.continuePolicy = 'pause';
  original.reviewSemanticResponse = { fixture: 'v16 explicitly chooses visible debt' };
  original.actionStateChecks = [{ sceneKey: 'chapter', verdict: 'unearned' }];
  original.sceneCausalityVerdicts = [{ sceneKey: 'chapter', verdict: 'contradicted' }];
  original.progressionChecks = [{ dimension: 'event_repetition', status: 'stalled' }];
  const normalized = normalizeRepairFindings([finding('unresolved', 'none')], original, catalog);
  assert.deepEqual(normalized.problems, []); assert.deepEqual(normalized.output.blockingIssues, []);
  assert.equal(normalized.output.reviewQualityDebt.length, 1);
  assert.equal(normalized.output.reviewQualityDebt[0].status, 'unresolved');
  assert.equal(reviewQualityDebtSchema.safeParse(normalized.output.reviewQualityDebt[0]).success, true);
  const unexpectedLegacyProjection = () => { throw Error('v16 must not regenerate legacy repairs'); };
  const { projectCausalAssessment } = loadRuntimeSource('acceptance/causalAssessment.ts', {
    './actionStateProjection': { projectActionStateAssessment: unexpectedLegacyProjection },
    './progressionProjection': { projectProgressionAssessment: unexpectedLegacyProjection },
  });
  const projected = projectCausalAssessment(normalized.output);
  assert.equal(projected.status, 'continue_with_risk'); assert.equal(projected.continuePolicy, 'continue');
  assert.equal(projected.repairability, 'none'); assert.deepEqual(projected.blockingIssues, []);
  assert.deepEqual(projected.repairDirectives, []); assert.deepEqual(projected.missingObligations, []);
  assert.deepEqual(projected.reviewQualityDebt, normalized.output.reviewQualityDebt);
  assert.ok(projected.riskTags.includes('review_quality_debt:lock-check'));
});
