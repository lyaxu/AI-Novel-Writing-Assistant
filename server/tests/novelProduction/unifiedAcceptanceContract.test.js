const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { asset, productionAsset, unifiedChapterAcceptanceAssessmentSchema } = require('./legacyUnifiedHarness.cjs');
const { buildEvidenceCatalog } = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { projectActionStateAssessment } = require('../../dist/services/novel/runtime/acceptance/actionStateProjection');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests, preparePromptExecution } = require('../../dist/prompting/core/promptRunner');
const { loadRuntimeSource } = require('./sourceHarness.cjs');

const input = { chapterId: 'key-transfer', chapterOrder: 1, novelTitle: '交付', chapterTitle: '钥匙',
  content: '她拿着钥匙。她将钥匙交给门卫。门卫收下钥匙。', expectedSceneKeys: [], establishedProse: [] };
function reference(catalog, quote) {
  const candidates = catalog.entries.filter(entry => entry.quote.trim() === quote);
  assert.equal(candidates.length, 1, `manual reviewer selected unique quote: ${quote}`);
  return { evidenceId: candidates[0].id };
}
const finding = (status, evidence, reason) => ({ status, evidence, reason });
function response() {
  const c = buildEvidenceCatalog(input); const select = quote => reference(c, quote);
  return {
    status: 'accepted', score: { coherence: 80, pacing: 80, repetition: 80, engagement: 80, voice: 80, overall: 80 },
    summary: '持有钥匙后交给门卫。', sceneCausalityVerdicts: [],
    actionStateChecks: [{ sceneKey: 'chapter', actor: '她', action: '交付钥匙', actionEvidence: [select('她将钥匙交给门卫。')],
      states: [{ dimension: 'item', entity: '钥匙', before: '她持有钥匙', requiredForAction: '她持有可交付的钥匙', after: '门卫持有钥匙',
        beforeEvidence: [select('她拿着钥匙。')], afterEvidence: [select('门卫收下钥匙。')],
        beforeEvidenceTiming: { relation: 'before_or_at_action', reason: '交付前已写她拿着钥匙。' },
        prerequisite: finding('satisfied', [select('她拿着钥匙。')], '交付人原先持有钥匙。'),
        resultChange: finding('changed', [select('她将钥匙交给门卫。'), select('门卫收下钥匙。')], '交付及接收共同建立持有人变化。') }],
      explanation: '既有钥匙在交付中转移。' }],
    progressionChecks: ['event_repetition', 'knowledge_repetition', 'prior_goal_followthrough'].map(dimension => ({
      dimension, status: 'not_applicable', repeatsEstablishedBeat: null, addsNewConsequence: null,
      priorState: '首章无前章对照', actualChange: '本章交钥匙', newConsequence: '', previousEvidence: [], currentEvidence: [],
      explanation: '不认证不存在的前章比较。', repairSuggestion: '',
    })), blockingIssues: [], repairDirectives: [], missingObligations: [], repairability: 'none', decisionReason: '可继续。',
    riskTags: [], assetSyncRecommendation: { priority: 'normal', reason: '常规同步。', requiresFullPayoffReconcile: false }, continuePolicy: 'continue',
  };
}
function validate(raw, promptInput = input) { return asset.postValidate(asset.outputSchema.parse(raw), promptInput); }

test('v15 completes hand-authored key transfer through separate prerequisite and result findings', () => {
  assert.equal(asset.version, productionAsset.version, 'Runner identity remains registered; the test binds historical v15 hooks');
  assert.equal(asset.outputSchema, unifiedChapterAcceptanceAssessmentSchema);
  assert.notEqual(asset, productionAsset);
  const output = validate(response()); assert.doesNotThrow(() => assertReviewCompleted(output));
  const check = output.actionStateChecks[0], state = check.states[0];
  assert.equal(check.verdict, 'earned'); assert.equal(state.enablingTransitionRequired, false);
  assert.equal(state.stateChanged, true); assert.equal(state.transitionStatus, 'established');
  assert.equal(state.assessment.prerequisite.status, 'satisfied'); assert.equal(state.assessment.resultChange.status, 'changed');
  assert.equal(state.assessment.resultChange.evidence[1].quote, '门卫收下钥匙。');
});

test('completed negative and unknown findings remain visible quality findings, never forced earned', () => {
  for (const [status, verdict] of [['missing', 'unearned'], ['contradicted', 'contradicted'], ['unknown', 'insufficient_evidence']]) {
    const raw = response(); raw.actionStateChecks[0].states[0].prerequisite = finding(status, [], '此离线分支模拟人工明确给出的负面或未知前提判断。');
    const output = validate(raw); assert.doesNotThrow(() => assertReviewCompleted(output));
    assert.equal(output.actionStateChecks[0].verdict, verdict);
    const projected = projectActionStateAssessment(output);
    assert.notEqual(projected.status, 'accepted');
    assert.ok(projected.blockingIssues.some(issue => issue.code.includes(`action_state_${verdict}`)));
    assert.equal(projected.repairDirectives.length > 0, status !== 'unknown', 'unknown facts never invent a plot patch');
  }
});

function simultaneousFailure() {
  const promptInput = { ...input, chapterOrder: 2, expectedSceneKeys: ['required-scene'],
    establishedProse: [{ chapterId: 'previous', order: 1, content: '她昨天交过钥匙。' }] };
  const catalog = buildEvidenceCatalog(promptInput);
  const raw = response();
  // Deterministic ID translation for this synthetic input preserves the same explicitly chosen snippets.
  const old = buildEvidenceCatalog(input);
  const translate = value => {
    if (Array.isArray(value)) return value.map(translate);
    if (!value || typeof value !== 'object') return value;
    if (value.evidenceId) return reference(catalog, old.byId.get(value.evidenceId).quote.trim());
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translate(item)]));
  };
  const bad = translate(raw);
  bad.actionStateChecks[0].actionEvidence = [{ evidenceId: 'unknown-catalog-id' }];
  for (const field of ['prerequisite', 'resultChange', 'beforeEvidenceTiming']) delete bad.actionStateChecks[0].states[0][field];
  bad.blockingIssues = [{ severity: 'medium', category: 'continuity', code: 'unverified', evidence: '错误来源模拟',
    fixSuggestion: '此建议必须被延后。', sourceEvidence: [reference(catalog, '她昨天交过钥匙。')] }];
  bad.repairDirectives = [{ mode: 'patch', target: 'continuity', instruction: '不应执行的未核实补写。' }];
  Object.assign(bad.progressionChecks[0], { status: 'progressed', repeatsEstablishedBeat: true, addsNewConsequence: false,
    previousEvidence: [reference(catalog, '她昨天交过钥匙。')], currentEvidence: [reference(catalog, '她将钥匙交给门卫。')] });
  return { raw: bad, promptInput };
}
const requiredProblems = ['scene_coverage_invalid', 'current_issue_source_missing', 'progressed_conflicts_with_repeated_beat',
  'unknown-catalog-id', 'required_prerequisite_assessment_missing', 'required_result_change_assessment_missing', 'required_story_time_finding_missing'];

test('one full-context correction reports independent coverage, sources, progression, ID and semantic-field failures together', () => {
  const { raw, promptInput } = simultaneousFailure();
  assert.throws(() => validate(raw, promptInput), error => {
    for (const problem of requiredProblems) assert.ok(error.message.includes(problem), problem);
    assert.ok(error.reviewCorrectionHints.some(hint => hint.includes('progressionChecks[0]')));
    assert.ok(error.reviewCorrectionHints.some(hint => hint.includes('resultChange')));
    return true;
  });
});

test('two failed replies preserve every contract problem, defer repair and cannot become a successful cache entry', async () => {
  const { raw, promptInput } = simultaneousFailure(); const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request); return { data: asset.outputSchema.parse(structuredClone(raw)), repairUsed: false, repairAttempts: 0 };
  });
  let output;
  try {
    ({ output } = await runStructuredPrompt({ asset, promptInput, options: { provider: 'deepseek', model: 'offline-unified-fixture',
      disableFallbackModel: true, transportRetryCount: 0, disableStrategyFallback: true } }));
  } finally { setPromptRunnerStructuredInvokerForTests(); }
  assert.equal(calls.length, 2);
  const correction = JSON.stringify(calls[1]);
  for (const problem of requiredProblems) {
    assert.ok(correction.includes(problem), `one correction retains ${problem}`);
    assert.ok(output.reviewContractIssues.some(item => item.includes(problem)), `saved failure retains ${problem}`);
  }
  assert.throws(() => assertReviewCompleted(output), error => error.code === 'CHAPTER_REVIEW_INCOMPLETE');
  assert.deepEqual(output.repairDirectives, []); assert.deepEqual(output.deferredRepairDirectives, raw.repairDirectives);
  let callsToAssess = 0, writes = 0;
  const { ChapterQualityGateService } = loadRuntimeSource('ChapterQualityGateService.ts', {
    '../../../db/prisma': { prisma: { chapterArtifactSyncCheckpoint: { findUnique: async () => null, upsert: async () => { writes++; } } } },
    './ChapterAcceptanceAssessmentService': {}, './acceptance': { assertReviewCompleted },
    './chapterRuntimePackageBuilders': { hashContent: value => crypto.createHash('sha256').update(value).digest('hex'), rememberCacheValue: (map, key, value) => map.set(key, value) },
  });
  const gate = new ChapterQualityGateService({ acceptanceAssessmentService: { getCacheIdentity: async () => 'v15-test',
    assess: async () => { callsToAssess++; return { assessment: output }; } } });
  const gateInput = { novelId: 'n', chapterId: promptInput.chapterId, content: promptInput.content, request: {},
    contextPackage: { chapter: { title: '钥匙', order: 2 } } };
  for (let i = 0; i < 2; i++) await assert.rejects(gate.runAcceptanceGate(gateInput), error => error.code === 'CHAPTER_REVIEW_INCOMPLETE');
  assert.equal(writes, 0); assert.equal(callsToAssess, 2);
  assert.equal(input.content, '她拿着钥匙。她将钥匙交给门卫。门卫收下钥匙。');
});

test('hand-authored v15 reviewer simulation on actual v14 manuscripts separates unchanged skills from consumed paper and acquired cash', () => {
  const fixture = require('./fixtures/secondChapterReviewV14.json'); const originalReply = JSON.stringify(fixture.outputs[1]);
  const promptInput = structuredClone(require('./fixtures/secondChapterReview.json').input);
  promptInput.chapterId = fixture.provenance.chapterId; promptInput.establishedProse[0].chapterId = fixture.provenance.previousChapterId;
  const beforeInput = JSON.stringify(promptInput); const c = buildEvidenceCatalog(promptInput);
  assert.equal(c.snapshotId, fixture.provenance.evidenceCatalogSnapshotId);
  const raw = structuredClone(fixture.outputs[1]);
  const select = quote => reference(c, quote);
  const [arrival, source, fist, payment] = raw.actionStateChecks;
  // Explicit manual reviewer findings. This is not automatic migration of old answers or real model acceptance.
  arrival.states[0].prerequisite = finding('satisfied', arrival.states[0].beforeEvidence, '前章已写账本显名和地址，本次报出的是既有信息。');
  arrival.states[0].resultChange = finding('changed', [select('她犹豫了几秒，把链子摘了，侧身让开。')], '本次相见及获准入内使地址和联系对象获得实际确认。');
  source.states[0].after = '郑小满继续知道自己的购买和丢手机经历，并向来访者说明';
  source.states[0].prerequisite = finding('satisfied', [select('“上个月在城西二手市场淘的。”')], '购买者陈述自己的既往经历，在交代前已知来源。');
  source.states[0].resultChange = finding('unchanged', [], '说出经历改变听者的信息，不代表郑小满本人新获得这份知识。');
  source.explanation = '先在询问下说明旧物来源，临别时再补充丢手机；木匣随后震动，不能倒置为先震动才说来源。';
  fist.states[0].after = '仍用既有八极拳完成连续短打，未写能力升级';
  fist.states[0].afterEvidence = [select('他连续三拳，每一拳都贴着符纸打进去。')];
  fist.states[0].prerequisite = finding('satisfied', [select('八极拳的贴身靠，他练了十几年，这一下撞得结结实实。')], '后叙十几年训练说明此前已有技能。');
  fist.states[0].resultChange = finding('unchanged', [], '使用既有拳术不等于提升拳术；胳膊酸麻属于身体状态，不混入能力增长。');
  fist.states[1].prerequisite = finding('satisfied', [select('他蹲下，从外卖箱侧兜里摸出一个小布袋。'), select('里面是他出门前从床底纸箱里翻出来的东西，几张黄纸符，一小瓶朱砂，还有半截用剩的墨条。')], '行动前已从侧兜取出，正文明确补述出门前拿取来源，无需重复补文。');
  fist.states[1].resultChange = finding('changed', [select('劳梓凡把拳面当符板用，每打一拳就消耗一张符纸，阴气团被打散一次就重聚一次，但每次重聚都比之前小一圈。'), select('打到第五拳，符纸用完了。')], '拳面贴符逐次消耗，打到第五拳耗尽。');
  fist.explanation = '既有拳术配合明确取出的符纸，逐拳消耗产生暂时压制；正文已经给出符纸来源。';
  payment.states[0].requiredForAction = '对方实际交付现金，劳梓凡接过并收好';
  payment.states[0].prerequisite = finding('satisfied', [select('郑小满从信封里数出三张一百的，递过来的时候手还在抖。')], '付款人先递出三张百元现金，收款并非凭空获得。');
  payment.states[0].resultChange = finding('changed', [select('劳梓凡接过钱，折好塞进内兜。')], '明确接过现金建立持有金额增加。');
  raw.sceneCausalityVerdicts[1].choiceAndResistanceEvidence = source.explanation;
  raw.sceneCausalityVerdicts[1].outcomeMechanismEvidence = '询问近期旧物后，购买者说出来源；没有正文依据认证匣子对符咒气息反应。';
  raw.sceneCausalityVerdicts[1].explanation = source.explanation;
  raw.sceneCausalityVerdicts[2].prerequisiteEvidence = ['本章后叙十几年八极拳训练', '本章明确补述出门前拿取符纸，行动前从侧兜取出'];
  raw.sceneCausalityVerdicts[3].outcomeMechanismEvidence = '暂时压制后郑小满先递钱，劳梓凡收下才承诺追查并拍照；照片不能反作先前付款原因。';
  raw.blockingIssues = raw.blockingIssues.filter(issue => issue.code !== 'item_setup_gap');
  raw.repairDirectives = raw.repairDirectives.filter(item => item.target !== 'continuity');
  for (const check of raw.actionStateChecks) {
    delete check.verdict;
    for (const state of check.states) for (const field of ['stateChanged', 'enablingTransitionRequired', 'transitionStatus', 'transitionEvidence']) delete state[field];
  }
  const output = validate(raw, promptInput); assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.ok(output.actionStateChecks.every(check => check.verdict === 'earned'));
  assert.equal(output.actionStateChecks[2].states[0].stateChanged, false);
  assert.equal(output.actionStateChecks[2].states[1].stateChanged, true);
  assert.equal(output.actionStateChecks[3].states[0].stateChanged, true);
  assert.ok(output.blockingIssues.some(issue => issue.code === 'emotion_label_without_behavior'), 'remaining quality observation was not silently erased');
  assert.equal(JSON.stringify(fixture.outputs[1]), originalReply); assert.equal(JSON.stringify(promptInput), beforeInput);
  assert.equal(crypto.createHash('sha256').update(promptInput.content).digest('hex'), fixture.provenance.currentContentSha256);
});

test('model example has legal explanation fields and no redundant model-authored action flags or verdict', () => {
  const exampleInput = { ...input, expectedSceneKeys: ['s1'] };
  const prepared = preparePromptExecution({ asset, promptInput: exampleInput });
  const example = typeof asset.structuredOutputHint.example === 'function'
    ? asset.structuredOutputHint.example(exampleInput, prepared.context) : asset.structuredOutputHint.example;
  assert.equal(asset.outputSchema.safeParse(example).success, true);
  for (const check of example.actionStateChecks) {
    assert.equal(Object.hasOwn(check, 'verdict'), false);
    for (const state of check.states) {
      for (const key of ['stateChanged', 'enablingTransitionRequired', 'transitionStatus', 'transitionEvidence']) assert.equal(Object.hasOwn(state, key), false);
      assert.ok(state.prerequisite.reason && state.resultChange.reason);
    }
  }
  const bad = structuredClone(example);
  bad.sceneCausalityVerdicts = [{ sceneKey: 's1', outcomeObserved: true, verdict: 'earned',
    prerequisiteEvidence: ['持有钥匙'], choiceAndResistanceEvidence: '主动交付', outcomeMechanismEvidence: '对方接收',
    constraintEvidence: ['她不再持有'], explanation: '交付导致持有人变化。' }];
  assert.equal(asset.outputSchema.safeParse(bad).success, true);
  bad.sceneCausalityVerdicts[0].prerequisiteEvidence = [{ evidenceId: 'invalid-description-type' }];
  assert.equal(asset.outputSchema.safeParse(bad).success, false);
});

test('honest missing or contradicted prerequisite can coexist with unknown result and empty state evidence', () => {
  for (const [status, verdict] of [['missing', 'unearned'], ['contradicted', 'contradicted']]) {
    const raw = response(); const state = raw.actionStateChecks[0].states[0];
    state.beforeEvidence = []; state.afterEvidence = [];
    state.beforeEvidenceTiming = { relation: 'unknown', reason: '本离线分支无法核实前状态的故事时间。' };
    state.prerequisite = finding(status, [], '模拟已明确判定的前提缺失或冲突，不能反填为满足。');
    state.resultChange = finding('unknown', [], '没有足够状态证据判断行动结果变化。');
    const output = validate(raw);
    assert.doesNotThrow(() => assertReviewCompleted(output));
    assert.equal(output.actionStateChecks[0].verdict, verdict);
    assert.equal(output.actionStateChecks[0].states[0].assessment.resultChange.status, 'unknown');
  }
});

test('exhausted correction retains the whole raw response when either semantic role is absent', async () => {
  for (const absent of ['prerequisite', 'resultChange']) {
    const raw = response(); delete raw.actionStateChecks[0].states[0][absent];
    const original = structuredClone(raw); let calls = 0;
    setPromptRunnerStructuredInvokerForTests(async () => {
      calls++;
      return { data: asset.outputSchema.parse(structuredClone(raw)), repairUsed: false, repairAttempts: 0 };
    });
    let output;
    try {
      ({ output } = await runStructuredPrompt({ asset, promptInput: input, options: { provider: 'deepseek',
        model: 'offline-partial-findings', disableFallbackModel: true, transportRetryCount: 0, disableStrategyFallback: true } }));
    } finally { setPromptRunnerStructuredInvokerForTests(); }
    assert.equal(calls, 2);
    assert.deepEqual(output.reviewRawResponse, original, 'a missing role must not discard the other authored finding');
    assert.deepEqual(raw, original);
    const retained = absent === 'prerequisite' ? 'resultChange' : 'prerequisite';
    assert.deepEqual(output.reviewRawResponse.actionStateChecks[0].states[0][retained], original.actionStateChecks[0].states[0][retained]);
    assert.throws(() => assertReviewCompleted(output), error => error.code === 'CHAPTER_REVIEW_INCOMPLETE');
  }
});

test('retrospective earlier empty hands does not invalidate separately established pre-action possession', () => {
  const promptInput = { ...input, content: '她拿到钥匙。她将钥匙交给门卫。门卫收下钥匙。此前她两手空空。' };
  const catalog = buildEvidenceCatalog(promptInput); const select = quote => reference(catalog, quote);
  const raw = response(); const check = raw.actionStateChecks[0];
  check.actionEvidence = [select('她将钥匙交给门卫。')];
  check.states[0] = { dimension: 'item', entity: '钥匙', before: '更早时她两手空空', requiredForAction: '交付时持有钥匙',
    after: '门卫持有钥匙', beforeEvidence: [select('此前她两手空空。')], afterEvidence: [select('门卫收下钥匙。')],
    beforeEvidenceTiming: { relation: 'retrospective_prior_state', reason: '末句回述拿钥匙以前的空手状态，随后首句已写取得钥匙。' },
    prerequisite: finding('established', [select('她拿到钥匙。')], '前置取物使空手状态转为持有，发生在交付以前。'),
    resultChange: finding('changed', [select('她将钥匙交给门卫。')], '交付动作将已取得钥匙转给门卫。') };
  const output = validate(raw, promptInput); assert.doesNotThrow(() => assertReviewCompleted(output));
  const normalized = output.actionStateChecks[0];
  assert.equal(normalized.verdict, 'earned');
  assert.equal(normalized.states[0].enablingTransitionRequired, true);
  assert.equal(normalized.states[0].stateChanged, true);
  assert.equal(normalized.states[0].assessment.prerequisite.evidence[0].quote, '她拿到钥匙。');
  assert.equal(normalized.states[0].assessment.resultChange.evidence[0].quote, '她将钥匙交给门卫。');
});

test('established prerequisite cannot use prior-chapter evidence to hide acquisition after the current action', () => {
  const promptInput = { ...input, chapterOrder: 2, content: '她将钥匙交给门卫。门卫收下钥匙。她随后才拿到钥匙。',
    establishedProse: [{ chapterId: 'earlier-key', order: 1, content: '她昨天曾经持有钥匙。' }] };
  const c = buildEvidenceCatalog(promptInput); const select = quote => reference(c, quote);
  const raw = response(); const check = raw.actionStateChecks[0];
  check.actionEvidence = [select('她将钥匙交给门卫。')];
  check.states[0] = { dimension: 'item', entity: '钥匙', before: '前章曾持有钥匙，本章取得却在交付以后',
    requiredForAction: '本次交付时实际持有钥匙', after: '门卫收下钥匙',
    beforeEvidence: [select('她昨天曾经持有钥匙。')], afterEvidence: [select('门卫收下钥匙。')],
    beforeEvidenceTiming: { relation: 'before_or_at_action', reason: '前章持有在时间上早于本章，但不能证明本次重新取得发生在交付前。' },
    prerequisite: finding('established', [select('她昨天曾经持有钥匙。'), select('她随后才拿到钥匙。')],
      '有意混合前章与事后取得的错误判断，必须被拒绝。'),
    resultChange: finding('changed', [select('她将钥匙交给门卫。')], '交付引起持有人变化。') };
  raw.progressionChecks = raw.progressionChecks.map(row => ({ ...row, status: 'insufficient_evidence',
    repeatsEstablishedBeat: null, addsNewConsequence: null, explanation: '本测试只核查行动证据，推进保留未知。' }));
  assert.throws(() => validate(raw, promptInput), error => {
    assert.ok(error.reviewContractIssues.some(issue => issue.includes('assessment_evidence_missing_or_invalid:item:钥匙:prerequisite')));
    assert.ok(error.reviewCorrectionHints.some(hint => hint.includes('prerequisite.evidence') && hint.includes('本章')));
    return true;
  });
  // The same prior-chapter source is legal for an explicitly satisfied, already-existing condition.
  const priorSatisfied = structuredClone(raw);
  priorSatisfied.actionStateChecks[0].states[0].prerequisite = finding('satisfied', [select('她昨天曾经持有钥匙。')],
    '这一反事实测试分支只核查已有条件可引用前章的来源角色；不声称整体故事语义正确。');
  assert.doesNotThrow(() => assertReviewCompleted(validate(priorSatisfied, promptInput)));
});
