const test = require('node:test');
const assert = require('node:assert/strict');
const { semanticActionAssessmentSchema, normalizeSemanticActions, SEMANTIC_ACTION_RULES } = require('../../dist/prompting/prompts/novel/acceptance/semantic/actionFacts');
const { buildEvidenceCatalog } = require('../../dist/prompting/prompts/novel/acceptance/evidenceCatalog');
const { validateActionStateEvidence } = require('../../dist/prompting/prompts/novel/acceptance/actionStateEvidence');

const input = { chapterId: 'c2', chapterOrder: 2, content: '她用钥匙开门。那把钥匙是父亲昨天交给她的。', expectedSceneKeys: ['s'],
  establishedProse: [{ chapterId: 'c1', order: 1, content: '父亲把钥匙交给她。' }] };
const refs = (catalog, includes) => [{ evidenceId: catalog.entries.find(e => e.quote.includes(includes)).id }];
const binding = (entity, dimension, claim, evidence, storyTime, reason) => ({ entity, dimension, claim, evidence,
  storyTime, support: 'supported', reason });
function example(source = input) {
  const catalog = buildEvidenceCatalog(source);
  const before = binding('她持有的钥匙', 'item', '她在开门前已持有钥匙', refs(catalog, '昨天交给'),
    'before_or_at_action', '后叙明确交付在昨天，早于今天开门。');
  const after = binding(before.entity, before.dimension, '她用已有钥匙开门时仍持有它', refs(catalog, '她用钥匙开门'),
    'during_or_after_action', '开门的实际运用证明持有持续到行动时。');
  const raw = { sceneKey: 's', actor: '她', action: '用钥匙开门', actionEvidence: after.evidence,
    states: [{ entity: before.entity, dimension: before.dimension, requiredForAction: '持有钥匙', before, after,
      prerequisite: { status: 'satisfied', basis: structuredClone(before), reason: '已有钥匙可用于开门。' },
      resultChange: { status: 'unchanged', basis: structuredClone(after), reason: '没有交出或丢失钥匙。' } }], explanation: '使用已有物品。' };
  return { raw, catalog };
}
function run(raw, catalog, source = input) {
  const normalized = normalizeSemanticActions([semanticActionAssessmentSchema.parse(raw)], catalog);
  return { ...normalized, audit: validateActionStateEvidence(normalized.checks, source, { citationMode: 'refs' }) };
}
function clean(result, verdict = 'earned') {
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.audit.coverageIssues, []);
  assert.deepEqual(result.audit.checks[0].validationIssues, []);
  assert.equal(result.audit.checks[0].verdict, verdict);
}

test('v16 accepts source-verified retrospective facts without inferring story time from offsets', () => {
  const { raw, catalog } = example(); const original = structuredClone(raw);
  const result = run(raw, catalog); clean(result);
  const check = result.checks[0];
  assert.ok(check.states[0].beforeEvidence[0].start >= check.actionEvidence[0].end);
  assert.ok(check.states[0].beforeEvidence[0].start > check.actionEvidence[0].start);
  assert.equal(check.states[0].semanticFacts.prerequisite.basis.storyTime, 'before_or_at_action');
  assert.deepEqual(raw, original);
});

test('prior chapter fact may prove an existing premise, but not current action/result or newly established premise', () => {
  const { raw, catalog } = example(); const prior = refs(catalog, '父亲把钥匙交给她');
  raw.states[0].before.evidence = prior; raw.states[0].prerequisite.basis.evidence = prior;
  clean(run(raw, catalog));
  for (const role of ['action', 'after', 'resultChange', 'established']) {
    const bad = structuredClone(raw);
    if (role === 'action') bad.actionEvidence = prior;
    if (role === 'after') bad.states[0].after.evidence = prior;
    if (role === 'resultChange') bad.states[0].resultChange.basis.evidence = prior;
    if (role === 'established') bad.states[0].prerequisite.status = 'established';
    assert.ok(run(bad, catalog).audit.checks[0].validationIssues.length, role);
  }
});

test('actual late acquisition cannot support a positive premise regardless of narrative location', () => {
  const { raw, catalog } = example();
  raw.states[0].prerequisite.basis.storyTime = 'during_or_after_action';
  raw.states[0].prerequisite.basis.claim = '钥匙在开门以后才交付';
  const result = run(raw, catalog);
  assert.match(result.problems.join('\n'), /prerequisite.basis.storyTime:finding_story_time_conflict/);
  assert.notEqual(result.audit.checks[0].verdict, 'earned');
});

test('subject and dimension mismatches aggregate with missing fields and wrong support', () => {
  const { raw, catalog } = example();
  raw.states[0].before.entity = '门卫';
  raw.states[0].after.dimension = 'knowledge';
  raw.states[0].prerequisite.basis.support = 'contradicted';
  delete raw.states[0].resultChange.reason;
  const result = run(raw, catalog); const problems = result.problems.join('\n');
  for (const code of ['semantic_entity_mismatch', 'semantic_dimension_mismatch', 'finding_requires_supported_fact', 'semantic_reason_missing']) assert.match(problems, new RegExp(code));
  assert.equal(result.audit.checks[0].verdict, 'insufficient_evidence');
});

test('missing semantic facts parse for full-context correction and survive normalization as incomplete metadata', () => {
  const { raw, catalog } = example(); delete raw.states[0].before; delete raw.states[0].prerequisite.basis.storyTime;
  assert.doesNotThrow(() => semanticActionAssessmentSchema.parse(raw));
  const result = run(raw, catalog);
  assert.match(result.problems.join('\n'), /before:semantic_fact_missing/);
  assert.match(result.problems.join('\n'), /prerequisite.basis.storyTime:semantic_fact_field_missing/);
  assert.equal(result.checks[0].states[0].semanticFacts.before, undefined);
  assert.equal(result.checks[0].states[0].semanticFacts.prerequisite.basis.claim, raw.states[0].prerequisite.basis.claim);
});

test('honest unknown is never earned and does not become a fabricated source error', () => {
  const { raw, catalog } = example();
  for (const role of ['before', 'after']) Object.assign(raw.states[0][role], { evidence: [], support: 'insufficient', storyTime: 'unknown' });
  raw.states[0].prerequisite = { status: 'unknown', basis: structuredClone(raw.states[0].before), reason: '正文未确认。' };
  raw.states[0].resultChange = { status: 'unknown', basis: structuredClone(raw.states[0].after), reason: '正文未确认。' };
  clean(run(raw, catalog), 'insufficient_evidence');
});

test('supported true negative findings produce quality verdicts without review contract failure', () => {
  const source = { ...input, content: '她双手仍被绑在背后。她抬手开门。' };
  const catalog = buildEvidenceCatalog(source);
  for (const status of ['missing', 'contradicted']) {
    const before = binding('她的双手', 'body', '双手绑在背后', refs(catalog, '仍被绑'), 'before_or_at_action', '行动前双手仍被固定。');
    const after = binding(before.entity, 'body', '双手抬起来开门', refs(catalog, '抬手开门'), 'during_or_after_action', '正文写出手部自由行动，与固定状态存在缺失桥梁。');
    const raw = { sceneKey: 's', actor: '她', action: '抬手开门', actionEvidence: after.evidence,
      states: [{ entity: before.entity, dimension: 'body', requiredForAction: '手能自由移动', before, after,
        prerequisite: { status, basis: before, reason: '人工负例：前提确证未满足。' },
        resultChange: { status: 'changed', basis: after, reason: '正文写出手部运动。' } }], explanation: '已证实的局部动作问题。' };
    clean(run(raw, catalog, source), status === 'missing' ? 'unearned' : 'contradicted');
  }
});

test('authorized awakening may establish a prerequisite at its use within the same atomic action', () => {
  const source = { ...input, content: '她起初没有护盾。神明授权的一瞬，她展开神赐护盾挡住箭矢。' };
  const catalog = buildEvidenceCatalog(source);
  const before = binding('她的护盾能力', 'ability', '起初未获得护盾能力', refs(catalog, '起初没有'), 'before_or_at_action', '这是授权前的状态，不要求她事先学会护盾。');
  const after = binding(before.entity, 'ability', '获得并使用神赐护盾', refs(catalog, '神明授权'), 'during_or_after_action', '在同一动作中授权后立即使用护盾。');
  const basis = { ...after, storyTime: 'before_or_at_action', reason: '神明授权在护盾生效时建立前提，未晚于使用。' };
  const raw = { sceneKey: 's', actor: '她', action: '展开神赐护盾挡住箭矢', actionEvidence: after.evidence,
    states: [{ entity: before.entity, dimension: 'ability', requiredForAction: '获神明授权可用护盾', before, after,
      prerequisite: { status: 'established', basis, reason: '同一动作的授权在使用时生效。' },
      resultChange: { status: 'changed', basis: after, reason: '明确授权并生效，不要求额外训练。' } }], explanation: '合法的同动作授予。' };
  clean(run(raw, catalog, source));
  raw.states[0].prerequisite.basis.storyTime = 'during_or_after_action';
  assert.match(run(raw, catalog, source).problems.join('\n'), /finding_story_time_conflict/);
});

test('unknown IDs remain explicit problems; original raw references are not mutated or silently replaced', () => {
  const { raw, catalog } = example(); raw.states[0].before.evidence = [{ evidenceId: 'ev_stale_1' }];
  const original = structuredClone(raw); const result = run(raw, catalog);
  assert.match(result.problems.join('\n'), /unknown_evidence_id="ev_stale_1"/);
  assert.notEqual(result.audit.checks[0].verdict, 'earned'); assert.deepEqual(raw, original);
});

test('wrong exact source occurrence is rejected while v16 canonical facts retain all four roles', () => {
  const { raw, catalog } = example(); const result = run(raw, catalog); clean(result);
  result.checks[0].states[0].semanticFacts.before.evidence[0].start = 0;
  const audit = validateActionStateEvidence(result.checks, input, { citationMode: 'refs' });
  assert.match(audit.checks[0].validationIssues.join('\n'), /unverified_semantic_source/);
  assert.deepEqual(Object.keys(result.checks[0].states[0].semanticFacts), ['before', 'after', 'prerequisite', 'resultChange']);
});

test('wire excludes copied quote, legacy verdict/flags and compound action anchors', () => {
  const { raw } = example();
  for (const change of [r => r.verdict = 'earned', r => r.states[0].stateChanged = false,
    r => r.actionEvidence.push(r.actionEvidence[0]), r => r.states[0].before.evidence[0].quote = '抄写引文']) {
    const bad = structuredClone(raw); change(bad); assert.equal(semanticActionAssessmentSchema.safeParse(bad).success, false);
  }
  assert.match(SEMANTIC_ACTION_RULES.join('\n'), /故事发生时间/);
});

const recorded = require('./fixtures/secondChapterReviewV15.json');
const actualInput = { ...require('./fixtures/secondChapterReview.json').input, chapterId: recorded.provenance.chapterId };
actualInput.establishedProse = actualInput.establishedProse.map(row => ({ ...row, chapterId: recorded.provenance.previousChapterId }));

test('manual reviewer simulation of both recorded answers separates existing ability from item/body costs', () => {
  const catalog = buildEvidenceCatalog(actualInput); assert.equal(catalog.snapshotId.slice(0, 12), '65723ef4510a');
  const original = structuredClone(recorded);
  for (const response of recorded.outputs) {
    const old = response.actionStateChecks.find(c => c.sceneKey === 'suppress_with_fist');
    assert.equal(old.states[0].resultChange.status, 'changed'); // Actual model answer was semantically disputed.
    const before = binding('劳梓凡的八极拳功底', 'ability', '练了十几年八极拳', [{ evidenceId: 'ev_65723ef4510a_98' }], 'before_or_at_action', '练了十几年的回叙说明拳术早已掌握。');
    const after = binding(before.entity, before.dimension, '实际使用既有贴身靠功底', [{ evidenceId: 'ev_65723ef4510a_98' }], 'during_or_after_action', '这一靠的实际运用证明技能延续，符纸消耗和酸麻分别属于item/body。');
    const raw = { sceneKey: old.sceneKey, actor: old.actor, action: '以八极拳贴身靠撞进阴气团', actionEvidence: [{ evidenceId: 'ev_65723ef4510a_97' }],
      states: [{ entity: before.entity, dimension: 'ability', requiredForAction: '具备贴身靠拳术', before, after,
        prerequisite: { status: 'satisfied', basis: before, reason: '多年练习形成既有拳术。' },
        resultChange: { status: 'unchanged', basis: after, reason: '使用技能不等于能力改变。' } }], explanation: '人工标注语义期望；不是原模型答复自动通过。' };
    clean(run(raw, catalog, { ...actualInput, expectedSceneKeys: [old.sceneKey] }));
  }
  assert.deepEqual(recorded, original);
});

test('manual reviewer simulation corrects prior knowledge and speaker disclosure without copying v15 disputed conclusions', () => {
  const catalog = buildEvidenceCatalog(actualInput); const original = structuredClone(recorded.outputs[1]);
  const cases = [
    { key: 'arrive_and_meet', actor: '劳梓凡', entity: '劳梓凡对姓名地址的知情', action: '展示载有姓名地址的账本照片',
      before: [291, 293], after: 31, claim: '已知道账本提供的姓名地址', reason: '前章显字发生在本次到访前；展示照片是在运用既有信息。' },
    { key: 'identify_source', actor: '郑小满', entity: '郑小满对旧物来源的知情', action: '说出旧物在城西二手市场购买',
      before: [69], after: 68, claim: '本人购买旧物，已知购买来源', reason: '本人购买早于这次对话，后叙购买经过不表示说完才知道。' },
  ];
  for (const row of cases) {
    const before = binding(row.entity, 'knowledge', row.claim, row.before.map(n => ({ evidenceId: `ev_65723ef4510a_${n}` })), 'before_or_at_action', row.reason);
    const after = binding(row.entity, 'knowledge', row.claim, [{ evidenceId: `ev_65723ef4510a_${row.after}` }], 'during_or_after_action', '在本次行动中运用已知信息，未据此新获得知识。');
    const raw = { sceneKey: row.key, actor: row.actor, action: row.action, actionEvidence: after.evidence,
      states: [{ entity: row.entity, dimension: 'knowledge', requiredForAction: '知道所展示或说出的信息', before, after,
        prerequisite: { status: 'satisfied', basis: before, reason: row.reason }, resultChange: { status: 'unchanged', basis: after, reason: '披露已有信息，不是说话者学到新信息。' } }],
      explanation: '人工reviewer simulation：更正语义与原子行动，非原模型自通过。' };
    clean(run(raw, catalog, { ...actualInput, expectedSceneKeys: [row.key] }));
  }
  assert.deepEqual(recorded.outputs[1], original);
});
