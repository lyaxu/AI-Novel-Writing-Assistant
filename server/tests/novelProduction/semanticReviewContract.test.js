// Human-authored v16 contract simulations over the complete archived manuscripts.
// They are not recorded model answers, literary acceptance, or permission to alter the book.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const recorded = require('./fixtures/secondChapterReviewV15.json');
const corpus = require('./fixtures/reviewFailureCorpus.json');
const { asset, productionAsset, semanticChapterAcceptanceSchema } = require('./legacySemanticHarness.cjs');
const { buildEvidenceCatalog } = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const causal = require('../../dist/services/novel/runtime/acceptance/causalAssessment');
const lengthCompliance = require('../../dist/services/novel/runtime/acceptance/lengthCompliance');
const physicalProjection = require('../../dist/services/novel/runtime/acceptance/physicalContinuityProjection');
const { normalizeAssessment } = loadRuntimeSource('ChapterAcceptanceAssessmentService.ts', {
  '../production/actualState': { actualStateDb: {} },
  '../../../prompting/core/promptRunner': {},
  '../../../prompting/context/promptContextResolution': {},
  '../../../prompting/prompts/novel/chapterLayeredContext': {},
  '../../../prompting/prompts/novel/chapterLayeredContextShared': { resolveTargetWordRange: () => ({ minWordCount: null, maxWordCount: null }) },
  '../../../prompting/prompts/novel/chapterAcceptance.prompts': { chapterAcceptanceAssessmentPrompt: asset },
  '../../state/OpenConflictService': {},
  '../novelP0Utils': { normalizeScore: score => score, ruleScore: () => assert.fail('The archived score is supplied') },
  './proseQuality/ProseQualityDetector': {},
  './acceptance': { ...causal, assertReviewCompleted, ...lengthCompliance,
    projectPhysicalContinuityAssessment: physicalProjection.projectPhysicalContinuityAssessment },
});

const input = structuredClone(require('./fixtures/secondChapterReview.json').input);
input.chapterId = recorded.provenance.chapterId;
input.establishedProse[0].chapterId = recorded.provenance.previousChapterId;
const catalog = buildEvidenceCatalog(input);
const hash = value => createHash('sha256').update(value).digest('hex');
const originalInput = JSON.stringify(input);
const originalAnswers = JSON.stringify(recorded.outputs);

function ref(excerpt, source = 'current_prose') {
  const matches = catalog.entries.filter(entry => entry.source === source && entry.quote.includes(excerpt));
  assert.equal(matches.length, 1, `The manual reviewer must select one exact archived passage: ${excerpt}`);
  return { evidenceId: matches[0].id };
}
function fact(entity, dimension, claim, excerpt, storyTime, source = 'current_prose') {
  return { entity, dimension, claim, evidence: [ref(excerpt, source)], storyTime,
    support: 'supported', reason: claim };
}
function state(entity, dimension, before, after, resultStatus, resultReason) {
  return { entity, dimension, requiredForAction: before.claim, before, after,
    prerequisite: { status: 'satisfied', basis: structuredClone(before), reason: before.claim },
    resultChange: { status: resultStatus, basis: structuredClone(after), reason: resultReason } };
}
function action(sceneKey, actor, description, excerpt, states) {
  return { sceneKey, actor, action: description, actionEvidence: [ref(excerpt)], states,
    explanation: description };
}

function humanAnnotatedResponse() {
  const before = 'before_or_at_action', after = 'during_or_after_action';
  const raw = structuredClone(recorded.outputs[1]);
  delete raw.status; delete raw.repairability;
  raw.actionStateChecks = [
    action('arrive_and_meet', '劳梓凡', '向郑小满展示账本照片说明来意', '他掏出手机，把账本上那页拍的照片调出来', [
      state('劳梓凡', 'knowledge',
        fact('劳梓凡', 'knowledge', '已读到账本提供的客户姓名和地址', '下面还有一行小字，是个地址', before, 'established_context'),
        fact('劳梓凡', 'knowledge', '把已知姓名与地址展示给郑小满，而非此时才取得这些信息', '你这名字，和这地址，是有人让我来的', after),
        'unchanged', '展示已有信息不等于再次获得姓名与地址。'),
    ]),
    action('identify_source', '郑小满', '向劳梓凡说明木匣来自二手市场', '上个月在城西二手市场淘的', [
      state('郑小满', 'knowledge',
        fact('郑小满', 'knowledge', '她早在上个月购买木匣时就知道购买地点', '上个月在城西二手市场淘的', before),
        fact('郑小满', 'knowledge', '向对方说出自己早已知道的旧物来源', '上个月在城西二手市场淘的', after),
        'unchanged', '她说出自己的购买经历，改变的是听者的信息，不能把说话当作她重新获知来源。'),
    ]),
    action('suppress_with_fist', '劳梓凡', '连续以贴符的拳头击入阴气团', '他连续三拳，每一拳都贴着符纸打进去', [
      state('劳梓凡', 'ability',
        fact('劳梓凡', 'ability', '行动前已练了十几年八极拳', '八极拳的贴身靠，他练了十几年', before),
        fact('劳梓凡', 'ability', '用已有短打能力继续攻击，正文没有本次拳术升级', '八极拳讲究挨、崩、挤、靠', after),
        'unchanged', '连续打拳是已有能力的运用，没有新增能力或等级的依据。'),
      state('劳梓凡', 'item',
        fact('劳梓凡', 'item', '动作前已经从随身布袋取出黄纸符', '几张黄纸符，一小瓶朱砂', before),
        fact('劳梓凡', 'item', '打到第五拳后携带的符纸用完', '打到第五拳，符纸用完了', after),
        'changed', '正文明确交代每拳消耗符纸，随后符纸用完；这是耗材减少，不是拳术升级。'),
    ]),
    action('pay_and_depart', '劳梓凡', '接过郑小满支付的三百元并收好', '劳梓凡接过钱，折好塞进内兜', [
      state('劳梓凡', 'item',
        fact('劳梓凡', 'item', '收款前兜里仍只有六十七块三毛', '他兜里那六十七块三毛连买符纸都不够', before),
        fact('劳梓凡', 'item', '已经接过并收好郑小满交来的现金', '劳梓凡接过钱，折好塞进内兜', after),
        'changed', '收款动作增加劳梓凡持有的现金；拍照发生在之后，不能倒写成付款原因。'),
    ]),
  ];
  raw.sceneCausalityVerdicts = raw.actionStateChecks.map(check => ({
    sceneKey: check.sceneKey, outcomeObserved: true,
    choiceAndResistance: { claim: check.action, evidence: structuredClone(check.actionEvidence),
      support: 'supported', reason: '此人工模拟选择的单一行动在该正文片段中明确发生。' },
    constraints: [],
  }));
  raw.issueChecks = [
    { issueId: 'transport', issueIndex: 0, status: 'already_addressed', repairScope: 'none',
      reason: '来时乘末班公交、办完事后返程公交停运并不矛盾；正文已经明确此刻只能打车，没有依据追加线路设定。',
      nearbyEvidence: [ref('公交车在柳巷街口刹住'), ref('末班车早没了，这个点只能打车回去')] },
    { issueId: 'emotion', issueIndex: 1, status: 'uncertain', repairScope: 'none',
      reason: '附近已有追问根源和回头查看郑小满的行为。是否还需加强情绪表现属于待审意见，不能据此要求重复补动作。',
      nearbyEvidence: [ref('劳梓凡盯着那六个字，后背的汗还没干'), ref('他回头看了一眼郑小满')] },
  ];
  raw.repairDirectives = raw.repairDirectives.map((directive, index) => ({ ...directive,
    issueId: index === 0 ? 'transport' : 'emotion' }));
  return raw;
}

const validate = raw => asset.postValidate(asset.outputSchema.parse(raw), input, { blocks: [] });
test('current v17 envelope accepts the complete human-annotated review through strict semantics', () => {
  const raw = humanAnnotatedResponse();
  const output = productionAsset.postValidate(productionAsset.outputSchema.parse(raw), input, { blocks: [] });
  assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.deepEqual(output.reviewSemanticResponse, raw);
  assert.deepEqual(output.actionStateChecks.map(check => check.sceneKey), input.expectedSceneKeys);
  assert.deepEqual(output.repairDirectives, []);
});
function unchanged() {
  assert.equal(JSON.stringify(input), originalInput);
  assert.equal(JSON.stringify(recorded.outputs), originalAnswers);
  for (const entry of corpus.entries) {
    const document = require(`./fixtures/${entry.fixture}`);
    const output = entry.outputPath.split('.').reduce((node, key) => node[key], document);
    assert.equal(hash(JSON.stringify(output)), entry.responseObjectSha256);
  }
}

test('hand-annotated v16 simulation covers the complete archived manuscripts without accepting v15 as new wire output', () => {
  assert.equal(asset.version, productionAsset.version, 'Historical v16 hooks retain registered runner identity');
  assert.equal(asset.outputSchema, semanticChapterAcceptanceSchema);
  assert.equal(input.content.length, 3652);
  assert.equal(input.establishedProse[0].content.length, 3013);
  for (const answer of recorded.outputs) assert.equal(asset.outputSchema.safeParse(answer).success, false);
  const output = validate(humanAnnotatedResponse());
  assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.deepEqual(output.actionStateChecks.map(check => check.sceneKey), input.expectedSceneKeys);
  assert.equal(output.actionStateChecks[1].states[0].semanticFacts.resultChange.status, 'unchanged');
  assert.equal(output.actionStateChecks[2].states[0].semanticFacts.resultChange.status, 'unchanged');
  assert.equal(output.actionStateChecks[2].states[1].semanticFacts.resultChange.status, 'changed');
  assert.deepEqual(output.repairDirectives, []);
  assert.deepEqual(output.missingObligations, []);
  assert.equal(output.repairability, 'none');
  assert.equal(output.status, 'continue_with_risk');
  assert.equal(output.reviewQualityDebt.length, 1);
  assert.equal(output.reviewQualityDebt[0].issueId, 'emotion');
  assert.equal(output.deferredRepairDirectives.length, recorded.outputs[1].repairDirectives.length);
  assert.ok(output.reviewFindings.some(finding => finding.issueId === 'transport' && finding.status === 'already_addressed'));
  unchanged();
});

test('causal and service projections cannot recreate unbound repairs after v16 issue decisions', () => {
  const output = validate(humanAnnotatedResponse());
  // Exercise warning branches after semantic normalization; this synthetic
  // projection input does not assert the archived manuscript has these faults.
  output.actionStateChecks[0].verdict = 'unearned';
  output.sceneCausalityVerdicts[0].verdict = 'contradicted';
  for (const projected of [causal.projectCausalAssessment(output), normalizeAssessment(output, input.content)]) {
    assert.deepEqual(projected.repairDirectives, []);
    assert.deepEqual(projected.blockingIssues, []);
    assert.deepEqual(projected.missingObligations, []);
    assert.equal(projected.repairability, 'none');
    assert.equal(projected.continuePolicy, 'continue');
    assert.ok(projected.riskTags.includes('action_state_unearned_arrive_and_meet'));
    assert.deepEqual(projected.reviewFindings, output.reviewFindings);
    assert.deepEqual(projected.deferredRepairDirectives, output.deferredRepairDirectives);
  }
  unchanged();
});

test('scene chronology comes from the selected action facts, with no independent story rewrite', () => {
  const raw = humanAnnotatedResponse(); const output = validate(raw);
  raw.actionStateChecks.forEach((check, index) => {
    assert.equal(Object.hasOwn(raw.sceneCausalityVerdicts[index], 'outcomeMechanismEvidence'), false);
    assert.equal(output.sceneCausalityVerdicts[index].outcomeMechanismEvidence,
      check.states.map(item => item.resultChange.reason).join('；').slice(0, 240));
    assert.ok(output.sceneCausalityVerdicts[index].explanation.startsWith(check.action));
  });
  const doubled = structuredClone(raw);
  doubled.sceneCausalityVerdicts[3].outcomeMechanismEvidence = '因为他后来拍照，所以郑小满之前付钱。';
  assert.equal(asset.outputSchema.safeParse(doubled).success, false);
  unchanged();
});

for (const [name, mutate] of [
  ['different subject', raw => { raw.actionStateChecks[1].states[0].after.entity = '劳梓凡'; }],
  ['different state dimension', raw => { raw.actionStateChecks[2].states[0].resultChange.basis.dimension = 'item'; }],
  ['a prerequisite only established after the action', raw => {
    raw.actionStateChecks[2].states[0].prerequisite.basis.storyTime = 'during_or_after_action';
  }],
]) test(`v16 rejects ${name} rather than flattening four roles into a valid label`, () => {
  const raw = humanAnnotatedResponse(); mutate(raw);
  assert.throws(() => validate(raw));
  unchanged();
});

test('a compound action with two distant anchors cannot hide incompatible temporal boundaries', () => {
  const raw = humanAnnotatedResponse();
  raw.actionStateChecks[3].actionEvidence.push(ref('劳梓凡掏出手机，对着梳妆台上的木匣拍了张照'));
  assert.throws(() => validate(raw));
  unchanged();
});

function badResponse() {
  const raw = humanAnnotatedResponse();
  raw.actionStateChecks[1].states[0].after.entity = '劳梓凡';
  raw.actionStateChecks[2].states[0].resultChange.basis.dimension = 'item';
  raw.issueChecks[0].repairScope = 'local';
  return raw;
}
async function replay(responses, assertion) {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    return { data: asset.outputSchema.parse(structuredClone(responses[Math.min(calls.length - 1, responses.length - 1)])),
      repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await runStructuredPrompt({ asset, promptInput: input,
      options: { provider: 'deepseek', model: 'offline-human-annotation', disableFallbackModel: true,
        transportRetryCount: 0, disableStrategyFallback: true } });
    assertion(result.output, calls);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
}

test('one bounded correction receives subject, dimension and repair authorization failures together', async () => {
  await replay([badResponse(), humanAnnotatedResponse()], (output, calls) => {
    assert.equal(calls.length, 2);
    const feedback = String(calls[1].messages.at(-1).content).split('上一次的 JSON 输出')[0];
    assert.match(feedback, /actionStateChecks\[1\]/);
    assert.match(feedback, /actionStateChecks\[2\]/);
    assert.match(feedback, /issueChecks\[0\]/);
    assert.doesNotThrow(() => assertReviewCompleted(output));
    assert.deepEqual(output.repairDirectives, []);
  });
  unchanged();
});

test('exhausted correction preserves raw review metadata and manuscripts without authorizing repair', async () => {
  const bad = badResponse();
  await replay([bad, bad], (output, calls) => {
    assert.equal(calls.length, 2);
    assert.throws(() => assertReviewCompleted(output), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    assert.deepEqual(output.reviewRawResponse, asset.outputSchema.parse(bad));
    assert.deepEqual(output.repairDirectives, []);
    assert.deepEqual(output.missingObligations, []);
    assert.ok(output.reviewContractIssues.length >= 3);
    assert.ok(output.deferredRepairDirectives.length >= 2);
  });
  unchanged();
});
