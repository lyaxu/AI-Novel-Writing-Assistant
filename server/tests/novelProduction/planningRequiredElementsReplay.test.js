const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const fixture = require('../fixtures/planningRequiredElements-stop.json');
const lengthControl = require('@ai-novel/shared/types/chapterLengthControl');
const revisions = loadRuntimeSource('../volume/planningRepair/domain/requiredElementRevisions.ts', { zod: require('zod') });
const domain = loadRuntimeSource('../volume/planningRepair/planningRepairDomain.ts', {
  zod: require('zod'),
  '../../../../llm/generatedContentSchema': require('../../dist/llm/generatedContentSchema.js'),
  '@ai-novel/shared/types/chapterLengthControl': lengthControl,
  '../chapterDetail/chapterDetailSchemas': require('../../dist/services/novel/volume/chapterDetail/chapterDetailSchemas.js'),
  './domain/requiredElementRevisions': revisions,
});
const { PlanningRepairCoordinator } = loadRuntimeSource('../volume/planningRepair/PlanningRepairCoordinator.ts', {
  '@ai-novel/shared/types/chapterLengthControl': lengthControl,
  '../../../../prompting/core/promptRunner': { runStructuredPrompt: () => assert.fail('No live models') },
  '../../../../prompting/prompts/novel/volume/planningRepair.prompts': {
    planningRepairPrompt: { id: 'novel.volume.planning_repair' },
    planningRepairReviewPrompt: { id: 'novel.volume.planning_repair_review' },
  },
  '../ChapterTaskSheetQualityGateService': { ChapterTaskSheetQualityGateService: class { constructor() { assert.fail('No live gate'); } } },
  '../volumeWorkspaceDocument': { buildVolumeWorkspaceDocument: doc => doc },
  './PlanningRepairStore': { PlanningRepairStore: class { constructor() { assert.fail('No database'); } } },
  './planningRepairDomain': domain,
  '../planningPromises': { projectPlanningHorizon: () => ({}) },
  './domain/reviewIssueHistory': require('../../dist/services/novel/volume/planningRepair/domain/reviewIssueHistory.js'),
});
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const targetId = fixture.allowedChapterIds[0];
const target = doc => doc.volumes.flatMap(v => v.chapters).find(c => c.id === targetId);
const elements = doc => JSON.parse(target(doc).sceneCards).requiredElements;
function candidateDocument() {
  const doc = structuredClone(fixture.baselineDocument);
  for (const volume of doc.volumes) volume.chapters = volume.chapters.map(c => (
    fixture.initialCandidateChapters.find(initial => initial.id === c.id) ?? c
  ));
  return structuredClone(doc);
}
function apply(doc, output, prior = []) {
  return domain.applyPlanningRepairCandidate(doc, fixture.volumeId, fixture.allowedChapterIds, output, [], prior);
}
function syntheticRevision() {
  const output = structuredClone(fixture.repairs[1].output);
  const original = elements(candidateDocument());
  output.changes[0].requiredElementRevisions = [
    { original: original[4], replacement: '劳梓凡确认第2章已收的三百元仍在内兜，郑小满补充摊主位于城西二手市场最里面一排靠墙第三个摊位。',
      reason: '第2章正文已经支付，修正重复付款；保留报酬确认和具体摊位线索。', preservedFunction: '保留第一单报酬确认与追查方向，不重复支付。', sceneKeys: ['scene_4'] },
    { original: original[5], replacement: '劳梓凡查看第2章拍下的木匣照片，补拍本章新形成的符咒封匣状态，保留供后续追查的证据。',
      reason: '第2章已拍原有照片，只补充本章新增封匣状态。', preservedFunction: '保留追查证据并展示封匣后的新状态。', sceneKeys: ['scene_4'] },
  ];
  return output;
}
function assertProtected(before, after) {
  for (const volume of before.volumes) {
    const actual = after.volumes.find(v => v.id === volume.id);
    for (const chapter of volume.chapters) {
      const changed = actual.chapters.find(c => c.id === chapter.id);
      if (chapter.id !== targetId) assert.deepEqual(changed, chapter);
      else for (const field of ['id', 'volumeId', 'chapterId', 'chapterOrder', 'beatKey', 'targetWordCount', 'conflictLevel', 'revealLevel', 'styleContract', 'createdAt', 'updatedAt', 'content']) {
        assert.deepEqual(changed[field], chapter[field], field);
      }
    }
    for (const field of Object.keys(volume).filter(k => k !== 'chapters')) assert.deepEqual(actual[field], volume[field]);
  }
  assert.deepEqual(target(after).payoffRefs, target(before).payoffRefs);
  const scenePlan = JSON.parse(target(after).sceneCards);
  assert.equal(scenePlan.scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0), target(before).targetWordCount);
}

test('real raw replies and extracted planning source have verifiable hashes and remain unedited', () => {
  for (const repair of fixture.repairs) {
    assert.equal(sha(repair.responseContent), repair.responseContentSha256);
    assert.deepEqual(JSON.parse(repair.responseContent), repair.output);
    for (const change of repair.output.changes) {
      assert.equal(Object.hasOwn(change, 'requiredElements'), false);
      assert.equal(Object.hasOwn(change, 'requiredElementRevisions'), false);
    }
    assert.equal(fixture.provenance.responseManifest.find(r => r.line === repair.responseLine).contentSha256, repair.responseContentSha256);
  }
  assert.equal(sha(fixture.baselineDocument), fixture.provenance.baselineSha256);
  assert.equal(sha(fixture.initialCandidateChapters), fixture.provenance.initialCandidateSha256);
  assert.equal(sha(fixture.afterFirstRepairChapters), fixture.provenance.afterFirstRepairSha256);
  assert.equal(sha(fixture.writtenEvidence), fixture.provenance.writtenEvidenceSha256);
  assert.equal(sha(fixture.windowReview.responseContent), fixture.windowReview.responseContentSha256);
  assert.deepEqual(JSON.parse(fixture.windowReview.responseContent), fixture.windowReview.output);
  assert.equal(fixture.provenance.responseManifest.length, 9);
});

test('both real legacy repairs preserve the unchanged conflicting minimum events in both stored locations', () => {
  const baseline = candidateDocument();
  const untouched = sha(baseline);
  let candidate = baseline;
  for (const repair of fixture.repairs) {
    candidate = apply(candidate, repair.output);
    assert.deepEqual(elements(candidate), elements(baseline));
    assert.deepEqual(target(candidate).requiredElements, target(baseline).requiredElements);
    assert.match(target(candidate).mustAvoid, /再次支付/);
    assertProtected(baseline, candidate);
  }
  assert.equal(sha(baseline), untouched);
  assert.deepEqual(elements({ volumes: [{ chapters: fixture.afterFirstRepairChapters }] }), elements(baseline));
  assert.equal(fixture.assessments[1].chapters[targetId].issues.length, 0, 'The first chapter reviewer missed the inherited conflict');
  assert.equal(fixture.windowReview.output.safeToSync, false, 'The window reviewer caught it');
  const finalIssues = fixture.assessments[2].chapters[targetId].issues;
  assert.ok(finalIssues.some(i => i.id === 'required_elements_duplicate_payment_conflict'));
  assert.ok(finalIssues.some(i => i.id === 'required_elements_duplicate_photo_conflict'));
});

test('synthetic explicit revisions replace only the two cited events, synchronize both locations and preserve future plans', () => {
  const before = candidateDocument();
  // A synthetic future chapter makes preservation observable even though the real sample only planned 1-3.
  before.volumes[0].chapters.push({ ...structuredClone(target(before)), id: 'synthetic-future', chapterOrder: 203,
    exclusiveEvent: '未来章独立事件', content: '只读正文不得改写', requiredElements: ['后文职责'] });
  const untouched = sha(before);
  const output = syntheticRevision();
  const after = apply(before, output);
  const expected = elements(before).slice();
  for (const revision of output.changes[0].requiredElementRevisions) expected[expected.indexOf(revision.original)] = revision.replacement;
  assert.deepEqual(elements(after), expected);
  assert.deepEqual(target(after).requiredElements, expected);
  assert.equal(expected.length, elements(before).length);
  assertProtected(before, after);
  assert.equal(sha(before), untouched);
  assert.deepEqual(fixture.repairs[1].output.changes[0].requiredElementRevisions, undefined);
});

test('revision boundaries reject invented sources, deletion, duplicate mappings and nonexistent scene evidence', () => {
  for (const change of [
    revision => { revision.original = '不存在的原义务'; },
    revision => { revision.replacement = ''; },
    revision => { revision.replacement = revision.original; },
    revision => { revision.reason = ''; },
    revision => { revision.preservedFunction = ''; },
    revision => { revision.sceneKeys = ['missing-scene']; },
  ]) {
    const proposal = syntheticRevision(); change(proposal.changes[0].requiredElementRevisions[0]);
    assert.throws(() => apply(candidateDocument(), proposal));
  }
  const duplicate = syntheticRevision(); duplicate.changes[0].requiredElementRevisions.push(duplicate.changes[0].requiredElementRevisions[0]);
  assert.throws(() => apply(candidateDocument(), duplicate));
  const arbitraryList = structuredClone(fixture.repairs[0].output); arbitraryList.changes[0].requiredElements = [];
  assert.throws(() => apply(candidateDocument(), arbitraryList));
});

test('saved revision lineage makes paid output idempotent without authorizing a branch or restoring obsolete events', () => {
  const original = candidateDocument();
  const first = syntheticRevision();
  const afterFirst = apply(original, first);
  const ledger = domain.mergeAppliedPlanningRepairRequiredElements([], first.changes);
  assert.equal(ledger.length, 2);
  assert.deepEqual(domain.mergeAppliedPlanningRepairRequiredElements(ledger, first.changes), ledger);
  assert.deepEqual(apply(afterFirst, first, ledger), afterFirst, 'A paid reply can replay after its saved candidate');
  assert.throws(() => apply(afterFirst, first), /source|required element/i, 'An unrecorded historical reply is not authority');

  const second = structuredClone(first);
  const prior = second.changes[0].requiredElementRevisions[0];
  second.changes[0].requiredElementRevisions = [{ ...prior, original: prior.replacement,
    replacement: '劳梓凡核对内兜已收的三百元，记下郑小满补充的城西二手市场最里面一排靠墙第三个摊位。' }];
  const afterSecond = apply(afterFirst, second, ledger);
  const chain = domain.mergeAppliedPlanningRepairRequiredElements(ledger, second.changes);
  assert.equal(chain.length, 3);
  assert.deepEqual(apply(afterSecond, first, chain), afterSecond, 'Older paid reply must not undo a later saved correction');
  assertProtected(original, afterSecond);
  const restore = structuredClone(second);
  restore.changes[0].requiredElementRevisions[0] = { ...prior,
    original: second.changes[0].requiredElementRevisions[0].replacement, replacement: prior.original };
  assert.throws(() => apply(afterSecond, restore, chain), /cycle|obsolete|histor/i);
  const branch = structuredClone(first);
  branch.changes[0].requiredElementRevisions[0].replacement = '另一条未经保存的付款要求';
  assert.throws(() => apply(afterFirst, branch, ledger), /branch|source|required element/i);
});

test('saved lineage rejects a reverted or missing replacement and cannot merge two distinct original duties', () => {
  const first = syntheticRevision();
  const saved = apply(candidateDocument(), first);
  const ledger = domain.mergeAppliedPlanningRepairRequiredElements([], first.changes);
  const mapping = first.changes[0].requiredElementRevisions[0];
  for (const revert of [true, false]) {
    const damaged = structuredClone(saved);
    const plan = JSON.parse(target(damaged).sceneCards);
    plan.requiredElements = plan.requiredElements.flatMap(text => text !== mapping.replacement ? [text] : revert ? [mapping.original] : []);
    target(damaged).sceneCards = JSON.stringify(plan);
    target(damaged).requiredElements = plan.requiredElements;
    assert.throws(() => apply(damaged, fixture.repairs[0].output, ledger), undefined,
      'A legacy no-revision answer must not conceal corruption of the persisted revision lineage');
  }
  const chainedIndependentDuties = syntheticRevision();
  chainedIndependentDuties.changes[0].requiredElementRevisions[0].replacement =
    chainedIndependentDuties.changes[0].requiredElementRevisions[1].original;
  assert.throws(() => apply(candidateDocument(), chainedIndependentDuties));
});

function replayHarness({ explicit = false, windowPass = false } = {}) {
  const document = candidateDocument();
  const session = { inputFingerprint: 'readonly-fixture', baselineDocument: fixture.baselineDocument,
    candidate: document, eligibleChapterIds: [targetId], state: {
      version: 1, key: 'offline-replay', novelId: document.novelId, volumeId: fixture.volumeId,
      chapterId: targetId, chapterOrder: 3, rounds: 0, maxRounds: 2,
      phase: 'reviewing', history: [], affectedChapterIds: [targetId], quality: { chapters: {} },
    } };
  const calls = [], contexts = [];
  let commits = 0;
  const store = { begin: async () => session,
    save: async (s, state, candidate) => { s.state = structuredClone(state); if (candidate) s.candidate = structuredClone(candidate); return s; },
    commit: async (s, candidate) => { commits++; s.state.phase = 'committed'; return candidate; },
  };
  const gate = { evaluate: async (_chapter, options) => {
    calls.push(`chapter:${session.state.rounds}`); contexts.push(JSON.parse(options.reviewContextJson));
    if (explicit && session.state.rounds > 0) return { status: 'passed', verdict: 'usable', safeToSync: true, issues: [] };
    return structuredClone(fixture.assessments.find(a => a.round === session.state.rounds).chapters[targetId]);
  } };
  const invoke = async ({ asset, promptInput }) => {
    contexts.push(JSON.parse(promptInput.contextJson));
    if (asset.id.endsWith('planning_repair_review')) {
      calls.push('window');
      return { output: windowPass ? { usable: true, safeToSync: true, requiresUserDecision: false, summary: 'Synthetic reviewer acceptance; not a real literary judgment', issues: [] }
        : structuredClone(fixture.windowReview.output) };
    }
    calls.push(`repair:${session.state.rounds}`);
    return { output: explicit ? syntheticRevision() : structuredClone(fixture.repairs[session.state.rounds - 1].output) };
  };
  const input = { document, volumeId: fixture.volumeId, chapterId: targetId, options: { taskId: 'offline-fixture' },
    context: {}, writtenEvidence: fixture.writtenEvidence, generateInitial: async () => assert.fail('Persisted candidate already exists') };
  return { session, input, calls, contexts, coordinator: new PlanningRepairCoordinator(store, gate, invoke), get commits() { return commits; } };
}

test('real two-round replay exhausts its saved budget and never syncs an unresolved candidate', async () => {
  const originalEvidence = sha(fixture.writtenEvidence);
  const h = replayHarness();
  await assert.rejects(h.coordinator.run(h.input), error => {
    assert.equal(error.code, 'PLANNING_REPAIR_CONFIRMATION_REQUIRED');
    assert.deepEqual(error.planningPause, { version: 1, repairKey: 'offline-replay', round: 2,
      candidateVersionId: undefined, outcome: 'settled' });
    return true;
  });
  assert.deepEqual(h.calls, ['chapter:0', 'repair:1', 'chapter:1', 'window', 'repair:2', 'chapter:2']);
  assert.equal(h.session.state.rounds, fixture.savedBoundary.rounds);
  assert.equal(h.session.state.maxRounds, fixture.savedBoundary.maxRounds);
  assert.equal(h.session.state.phase, 'waiting_confirmation'); assert.equal(h.commits, 0);
  assertProtected(h.input.document, h.session.candidate);
  assert.deepEqual(elements(h.session.candidate), elements(h.input.document));
  for (const repair of fixture.repairs) assert.deepEqual(h.session.state.history.find(h => h.kind === 'repair' && h.round === repair.round).output, repair.output);
  const callsBeforeRetry = h.calls.slice();
  await assert.rejects(h.coordinator.run(h.input), { code: 'PLANNING_REPAIR_CONFIRMATION_REQUIRED' });
  assert.deepEqual(h.calls, callsBeforeRetry, 'Passive retry cannot grant another budget');
  assert.equal(sha(fixture.writtenEvidence), originalEvidence);
});

test('planning owner never certifies an unsettled or unapplied paid call as a settled gate', async () => {
  for (const patch of [{ phase: 'uncertain' }, { pendingOperation: { kind: 'repair', startedAt: 'saved-call' } },
    { repairOutputPending: { inputFingerprint: 'readonly-fixture', round: 2 } }]) {
    const h = replayHarness();
    Object.assign(h.session.state, { phase: 'waiting_confirmation', rounds: 2, maxRounds: 3 }, patch);
    await assert.rejects(h.coordinator.run(h.input), error => {
      assert.equal(error.planningPause.outcome, 'unknown');
      assert.equal(error.planningPause.round, 2);
      return true;
    });
    assert.deepEqual(h.calls, []);
    assert.equal(h.commits, 0);
    assert.equal(h.session.state.maxRounds, 3);
  }
});

for (const windowPass of [true, false]) test(`synthetic explicit repair still requires chapter and window acceptance (${windowPass})`, async () => {
  const h = replayHarness({ explicit: true, windowPass });
  if (windowPass) await h.coordinator.run(h.input);
  else await assert.rejects(h.coordinator.run(h.input), { code: 'PLANNING_REPAIR_CONFIRMATION_REQUIRED' });
  assert.equal(h.commits, windowPass ? 1 : 0);
  assert.equal(h.session.state.maxRounds, 2);
  assert.equal(h.session.state.rounds, windowPass ? 1 : 2);
  assert.equal(h.session.state.requiredElementRevisions.length, 2, 'Replaying the same repair cannot duplicate the saved lineage');
  assert.deepEqual(target(h.session.candidate).requiredElements, elements(h.session.candidate));
  assertProtected(h.input.document, h.session.candidate);
  const reviewContext = h.contexts.find(c => c.appliedRequiredElementRevisions?.length);
  assert.ok(reviewContext, 'Saved revision audit must reach the next semantic reviewer');
  assert.deepEqual(reviewContext.currentRequiredElements[0].requiredElements, elements(h.session.candidate));
});
