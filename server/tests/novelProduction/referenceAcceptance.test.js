const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asset,
  chapterAcceptanceAssessmentSchema,
  generatedChapterAcceptanceAssessmentSchema,
} = require('./legacyReferenceHarness.cjs');
const { buildEvidenceCatalog, resolveEvidenceReference } = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests, preparePromptExecution } = require('../../dist/prompting/core/promptRunner');

const input = {
  chapterId: 'reference-chapter', chapterOrder: 1, novelTitle: '离线证据测试', chapterTitle: '开门',
  content: '她拿着钥匙。她用钥匙开门。', expectedSceneKeys: [], establishedProse: [],
};

function ref(catalog, text, occurrence = 0) {
  const entry = catalog.entries.filter(row => row.quote.trim() === text)[occurrence];
  assert.ok(entry, `fixture citation ${text} occurrence ${occurrence}`);
  return { evidenceId: entry.id };
}

// Hand-authored reviewer simulation only: selecting valid IDs is not literary acceptance.
function response(promptInput = input) {
  const catalog = buildEvidenceCatalog(promptInput);
  const action = ref(catalog, '她用钥匙开门。');
  return {
    status: 'accepted', score: { coherence: 80, pacing: 80, repetition: 80, engagement: 80, voice: 80, overall: 80 },
    summary: '持有钥匙后开门。', sceneCausalityVerdicts: [],
    actionStateChecks: [{ sceneKey: 'chapter', actor: '她', action: '用钥匙开门', actionEvidence: [action],
      states: [{ dimension: 'item', entity: '钥匙', before: '她持有钥匙', requiredForAction: '持有钥匙', after: '她用持有的钥匙开门',
        beforeEvidence: [ref(catalog, '她拿着钥匙。')], afterEvidence: [action], transitionEvidence: [],
        beforeEvidenceTiming: { relation: 'before_or_at_action', reason: '拿着钥匙在开门前已写出。' },
        stateChanged: false, enablingTransitionRequired: false, transitionStatus: 'not_needed' }],
      verdict: 'earned', explanation: '本次行动使用既有钥匙。' }],
    progressionChecks: ['event_repetition', 'knowledge_repetition', 'prior_goal_followthrough'].map(dimension => ({
      dimension, status: 'not_applicable', repeatsEstablishedBeat: null, addsNewConsequence: null,
      priorState: '首章无前章对照职责', actualChange: '本章开门', newConsequence: '', previousEvidence: [], currentEvidence: [],
      explanation: '首章不认证不存在的前章比较。', repairSuggestion: '',
    })),
    blockingIssues: [], repairDirectives: [], missingObligations: [], repairability: 'none', decisionReason: '正文可继续。',
    riskTags: [], assetSyncRecommendation: { priority: 'normal', reason: '常规同步。', requiresFullPayoffReconcile: false },
    continuePolicy: 'continue',
  };
}

function canonical(raw, promptInput = input) {
  const catalog = buildEvidenceCatalog(promptInput);
  const visit = value => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    if (typeof value.evidenceId === 'string') return resolveEvidenceReference(catalog, value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
  };
  return visit(raw);
}

function validate(raw, promptInput = input) {
  return asset.postValidate(asset.outputSchema.parse(raw), promptInput);
}

async function replay(outputs, promptInput, assertion) {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async request => {
    calls.push(request);
    return { data: asset.outputSchema.parse(structuredClone(outputs[Math.min(calls.length - 1, outputs.length - 1)])), repairUsed: false, repairAttempts: 0 };
  });
  try {
    const result = await runStructuredPrompt({ asset, promptInput, options: {
      provider: 'deepseek', model: 'offline-reference-fixture', disableFallbackModel: true,
      transportRetryCount: 0, disableStrategyFallback: true,
    } });
    await assertion(result, calls);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
}

test('v14 accepts IDs and resolves exact source, quote and snapshot positions before existing review gates', () => {
  assert.equal(asset.outputSchema, require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts').referenceChapterAcceptanceAssessmentSchema);
  const raw = response();
  const original = structuredClone(raw);
  const output = validate(raw);
  assert.doesNotThrow(() => assertReviewCompleted(output));
  const evidence = output.actionStateChecks[0].actionEvidence[0];
  const catalog = buildEvidenceCatalog(input);
  assert.equal(evidence.quote, '她用钥匙开门。');
  assert.equal(evidence.source, 'current_prose');
  assert.equal(evidence.sourceId, input.chapterId);
  assert.equal(evidence.evidenceId, raw.actionStateChecks[0].actionEvidence[0].evidenceId);
  assert.equal(evidence.evidenceSnapshotId, catalog.snapshotId);
  assert.equal(input.content.slice(evidence.start, evidence.end), evidence.quote);
  assert.deepEqual(raw, original, 'resolving references must not mutate the model answer');
});

test('wire schema rejects copied quotes and forged source or offsets; persisted and canonical schemas retain old records', () => {
  const raw = response();
  const old = canonical(raw);
  assert.equal(chapterAcceptanceAssessmentSchema.safeParse(old).success, true);
  assert.equal(generatedChapterAcceptanceAssessmentSchema.safeParse(old).success, true);
  assert.equal(asset.outputSchema.safeParse(old).success, false);
  for (const injected of [{ quote: '模型多加“引号”。' }, { source: 'current_prose' }, { sourceId: 'other-chapter' }, { start: 0, end: 1 }]) {
    const forged = structuredClone(raw);
    Object.assign(forged.actionStateChecks[0].actionEvidence[0], injected);
    assert.equal(asset.outputSchema.safeParse(forged).success, false, JSON.stringify(injected));
  }
});

test('repeated action text binds to the selected occurrence instead of the first matching quote', () => {
  const repeated = { ...input, content: '她用钥匙开门。她拿着钥匙。她用钥匙开门。' };
  const catalog = buildEvidenceCatalog(repeated);
  const raw = response(repeated);
  const later = ref(catalog, '她用钥匙开门。', 1);
  raw.actionStateChecks[0].actionEvidence = [later];
  raw.actionStateChecks[0].states[0].afterEvidence = [later];
  const output = validate(raw, repeated);
  assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.equal(output.actionStateChecks[0].actionEvidence[0].start, repeated.content.lastIndexOf('她用钥匙开门。'));
  raw.actionStateChecks[0].actionEvidence = [ref(catalog, '她用钥匙开门。', 0)];
  assert.throws(() => validate(raw, repeated), /before_state_after_action/);
});

test('repeated state text selected after the action cannot borrow the earlier identical occurrence', () => {
  const repeated = { ...input, content: '她拿着钥匙。她用钥匙开门。她拿着钥匙。' };
  const raw = response(repeated);
  raw.actionStateChecks[0].states[0].beforeEvidence = [ref(buildEvidenceCatalog(repeated), '她拿着钥匙。', 1)];
  assert.throws(() => validate(raw, repeated), /before_state_after_action/);
});

test('IDs from another candidate snapshot cannot certify this candidate even under the same chapter ID', () => {
  const raw = response();
  const changed = { ...input, content: input.content + '门外下着雨。' };
  assert.notEqual(buildEvidenceCatalog(input).snapshotId, buildEvidenceCatalog(changed).snapshotId);
  assert.throws(() => validate(raw, changed), /evidenceId|证据编号|证据目录/);
  assert.equal(changed.content, input.content + '门外下着雨。');
});

test('changing prior prose invalidates IDs and matching IDs still cannot substitute prior prose for current action', () => {
  const current = { ...input, chapterOrder: 2, establishedProse: [{ chapterId: 'prior', order: 1, content: '她拿着钥匙。' }] };
  const raw = response(current);
  const changed = { ...current, establishedProse: [{ chapterId: 'prior', order: 1, content: '她拿着银钥匙。' }] };
  assert.throws(() => validate(raw, changed), /evidenceId|证据编号|证据目录/);
  const prior = buildEvidenceCatalog(current).entries.find(entry => entry.source === 'established_context');
  raw.actionStateChecks[0].actionEvidence = [{ evidenceId: prior.id }];
  assert.throws(() => validate(raw, current), /action_not_in_current_prose/);
});

test('an existing ID is not semantic approval of contradictory action-state findings', () => {
  const raw = response();
  raw.actionStateChecks[0].states[0].transitionStatus = 'contradicted';
  assert.throws(() => validate(raw), /earned_conflicts|contradict/);
});

test('one correction can replace an unknown ID without re-copying prose or altering the manuscript', async () => {
  const raw = response();
  const unknown = 'ev_unknown_copy_error';
  raw.actionStateChecks[0].actionEvidence = [{ evidenceId: unknown }];
  const before = structuredClone(input);
  await replay([raw, response()], input, (result, calls) => {
    assert.equal(calls.length, 2);
    assert.equal(asset.semanticRetryPolicy.maxAttempts, 1);
    assert.ok(String(calls[1].messages.at(-1).content).includes(unknown));
    assert.doesNotThrow(() => assertReviewCompleted(result.output));
    assert.deepEqual(input, before);
  });
});

test('unknown IDs after the existing correction budget remain inspectable incomplete review, not approval or prose repair', async () => {
  const raw = response();
  const unknown = 'ev_unknown_after_budget';
  raw.actionStateChecks[0].states[0].afterEvidence = [{ evidenceId: unknown }];
  raw.repairDirectives = [{ mode: 'patch', target: 'plot', instruction: '这条未经验证的修改不能执行。' }];
  await replay([raw, raw], input, (result, calls) => {
    assert.equal(calls.length, 2);
    assert.throws(() => assertReviewCompleted(result.output), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
    assert.ok(result.output.evidenceReferenceIssues.length);
    assert.ok(JSON.stringify(result.output).includes(unknown), 'retain the unknown ID in inspectable review evidence');
    assert.equal(result.output.evidenceCatalogSnapshotId, buildEvidenceCatalog(input).snapshotId);
    assert.deepEqual(result.output.repairDirectives, []);
    assert.equal(input.content, '她拿着钥匙。她用钥匙开门。');
  });
});

test('model-facing prompt and example consistently select IDs instead of asking the model to copy quotes', () => {
  const prepared = preparePromptExecution({ asset, promptInput: input });
  const messages = prepared.messages.map(message => String(message.content)).join('\n');
  assert.match(messages, /evidenceId/);
  assert.ok(messages.includes(buildEvidenceCatalog(input).entries[0].id));
  assert.doesNotMatch(messages, /所有 quote 必须逐字复制|quote逐字复制|证据格式\{source,sourceId,quote\}|证据对象为\{source,sourceId,quote\}|格式\{source,sourceId,quote\}/);
  const hint = asset.structuredOutputHint.example;
  const example = typeof hint === 'function' ? hint(input, prepared.context) : hint;
  assert.equal(asset.outputSchema.safeParse(example).success, true);
  const encoded = JSON.stringify(example);
  assert.match(encoded, /evidenceId/);
  assert.doesNotMatch(encoded, /"quote":|"sourceId":/);
});

test('hand-authored ID reviewer simulation for the recorded Maoshan v11 reply restores exact prose without rewriting either chapter', () => {
  const scene = require('./fixtures/secondChapterReview.json').input;
  const recorded = require('./fixtures/secondChapterReviewV11.json').outputs[1];
  const originalInput = structuredClone(scene);
  const originalReply = structuredClone(recorded);
  const catalog = buildEvidenceCatalog(scene);
  const sources = new Map([[scene.chapterId, scene.content], ...scene.establishedProse.map(chapter => [chapter.chapterId, chapter.content])]);
  let explicitPhoneSelectionCount = 0;

  // This is an explicit test-only reviewer choice for the known bad quote, not
  // production quote repair, fuzzy matching, or proof that the real model passed.
  const selectReferences = (evidence, location) => {
    if (location === 'review.progressionChecks[2].currentEvidence[0]') {
      assert.equal(evidence.quote, '账本说“毁物不毁根”。根在二手市场。那个摊主。');
      // Manual reviewer simulation selects two sentences supporting the new target.
      // The old three-sentence quote is NOT losslessly or automatically converted:
      // the actual contract still permits at most two IDs for each evidence role.
      return [ref(catalog, '根在二手市场。'), ref(catalog, '那个摊主。')];
    }
    const exactPhoneText = '我上个月丢过手机，后来补了卡。';
    const quote = evidence.quote === '“我上个月丢过手机，后来补了卡。”'
      ? (explicitPhoneSelectionCount++, exactPhoneText) : evidence.quote;
    const source = sources.get(evidence.sourceId);
    assert.equal(typeof source, 'string', `${location}: recorded source is supplied`);
    const start = source.indexOf(quote);
    assert.ok(start >= 0, `${location}: all other recorded quotes must already be exact`);
    if (location === 'review.progressionChecks[1].previousEvidence[0]') {
      // Manual reviewer choice: the ledger first displays the rule (not its later rereading).
      assert.equal(quote, '“不去，债转你身。”');
      assert.equal(start, 1972);
      assert.equal(source.indexOf(quote, start + 1), 2452);
    } else {
      assert.equal(source.indexOf(quote, start + 1), -1, `${location}: ambiguous occurrence needs an explicit reviewer choice`);
    }
    const end = start + quote.length;
    const entries = catalog.entries.filter(entry => entry.source === evidence.source && entry.sourceId === evidence.sourceId
      && entry.start < end && entry.end > start);
    assert.ok(entries.length > 0 && entries.length <= 2, `${location}: selected continuous quote must fit existing two-reference budget`);
    assert.ok(entries[0].start <= start && entries.at(-1).end >= end, `${location}: selected IDs cover the original quote`);
    return entries.map(entry => ({ evidenceId: entry.id }));
  };
  const mapReply = (value, location = 'review') => {
    if (Array.isArray(value)) {
      if (value.length && value.every(item => item && typeof item === 'object' && typeof item.quote === 'string')) {
        const references = value.flatMap((item, index) => selectReferences(item, `${location}[${index}]`));
        return [...new Map(references.map(reference => [reference.evidenceId, reference])).values()];
      }
      return value.map((item, index) => mapReply(item, `${location}[${index}]`));
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapReply(item, `${location}.${key}`)]));
  };
  const manuallySelected = mapReply(recorded);
  // This historical reviewer simulation explicitly supplies the new timing contract.
  for (const check of manuallySelected.actionStateChecks) for (const state of check.states) {
    state.beforeEvidenceTiming ??= { relation: 'before_or_at_action', reason: '此人工模拟选择的状态证据在关键行动前或开始时已写出。' };
  }
  assert.equal(explicitPhoneSelectionCount, 1);
  assert.doesNotMatch(JSON.stringify(manuallySelected), /"quote":|"sourceId":/);
  const output = validate(manuallySelected, scene);
  assert.doesNotThrow(() => assertReviewCompleted(output));
  assert.ok(output.actionStateChecks[1].states[0].afterEvidence.some(evidence => evidence.quote.includes('我上个月丢过手机，后来补了卡。')));
  assert.deepEqual(scene, originalInput);
  assert.deepEqual(recorded, originalReply);
  assert.equal(scene.content.length, 3652);
  assert.equal(scene.establishedProse[0].content.length, 3013);
});
