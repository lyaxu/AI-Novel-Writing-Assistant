const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(relative) {
  const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const native = createRequire(filename);
  const local = id => {
    const target = id.startsWith('.') ? path.resolve(path.dirname(filename), id).replace(/\.js$/, '')
      : id.startsWith('@ai-novel/shared/') ? path.join(root, 'shared', id.slice('@ai-novel/shared/'.length)).replace(/\.js$/, '') : null;
    const found = target && [`${target}.ts`, path.join(target, 'index.ts')].find(file => fs.existsSync(file));
    return found ? load(found) : native(id);
  };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(local, module, module.exports);
  return module.exports;
}
const prefix = 'server/src/prompting/prompts/novel/volume/';
const { bindStateClaimContract, resolveChapterStateClaims } = load(`${prefix}evidence/stateClaimBinding.ts`);
const { buildPrimaryProseCitationCatalog } = load(`${prefix}evidence/primaryProseCitationCatalog.ts`);
const { volumeChapterExecutionContractPrompt: prompt } = load(`${prefix}chapterDetail.prompts.ts`);
const { planningRepairPrompt: repair } = load(`${prefix}planningRepair.prompts.ts`);
const blocks = load(`${prefix}contextBlocks.ts`);
const { normalizeChapterScenePlan, parseChapterScenePlan, serializeChapterScenePlan } = load('shared/types/chapterLengthControl.ts');
const { createChapterExecutionContractSchema } = load('server/src/services/novel/volume/chapterDetail/chapterDetailSchemas.ts');
const { applyPlanningRepairCandidate } = load('server/src/services/novel/volume/planningRepair/planningRepairDomain.ts');
const prose = '她保管着两份证明，还没有决定是否向委员会提出申请。';
const writtenEvidence = { chapters: [{ chapterId: 'earlier', order: 1, content: prose }] };
const review = JSON.stringify({ writtenEvidence });
const evidenceId = buildPrimaryProseCitationCatalog(review, 2).sources[0].excerpts[0].evidenceId;
function fixture() {
  const stateClaims = [{ id: 'held', subject: '她', predicate: '保管两份证明', temporalScope: 'prior', modality: 'fact', source: { kind: 'written_prose', evidenceIds: [evidenceId] } }];
  const sceneCards = [1, 2, 3].map(i => {
    const key = `s${i}`, before = i === 1 ? 'held' : `result${i - 1}`;
    stateClaims.push({ id: `choice${i}`, subject: '她', predicate: `作出第${i}步选择`, temporalScope: 'planned', modality: 'intention', source: { kind: 'planned_scene', sceneKey: key, phase: 'action' } },
      { id: `result${i}`, subject: '她', predicate: `取得第${i}步反馈`, temporalScope: 'planned', modality: 'outcome', source: { kind: 'planned_scene', sceneKey: key, phase: 'exit' } });
    return { key, title: '申请', purpose: '核实下一步', mustAdvance: ['作出选择'], mustPreserve: [], entryState: '已持有证明', exitState: '取得反馈', forbiddenExpansion: [], targetWordCount: 800,
      resistance: '审查需要时间', turn: '收到回应', emotionalShift: '焦虑转为谨慎', readerValue: '申请向前推进',
      causality: { actor: '她', choice: '提出申请', motive: '希望弄清办理条件', prerequisites: [{ claimIds: [before] }],
        stateTransition: { beforeClaimIds: [before], actionClaimIds: [`choice${i}`], afterClaimIds: [`result${i}`] },
        resistanceResponse: '委员会核对材料', outcomeMechanism: '核对后给出下一步指引', resultingConstraints: [] } };
  });
  return { purpose: '提交申请并取得反馈', exclusiveEvent: '首次提交申请', endingState: '已得知下一步', nextChapterEntryState: '带着反馈准备补件', conflictLevel: 30, revealLevel: 20,
    targetWordCount: 2400, mustAvoid: '不能假装申请已经获准', payoffRefs: [], requiredElements: ['提交申请'], taskSheet: '提出申请，核对材料，取得反馈。',
    readerExperience: { readerQuestion: '申请如何推进', promisedReward: '取得明确反馈', rewardLevel: 'partial', protagonistWant: '获得答复', primaryResistance: '材料需要核对',
      keyTurn: '收到回应', emotionalShift: '焦虑转为谨慎', informationReveal: '所需补件', netChange: '申请进入下一阶段', inheritedHookResponsibilities: [], endingHook: '补件能否完成' },
    stateClaims, sceneCards, neighborEventUse: [], mustAvoidConflicts: [] };
}
function input() {
  const chapter = { id: 'c', chapterOrder: 2, title: '申请', summary: '向委员会提出申请', payoffRefs: [], targetWordCount: 2400 };
  const volume = { id: 'v', title: '第一卷', sortOrder: 1, openPayoffs: [], chapters: [chapter] };
  const beat = { key: 'opening', label: '开卷', summary: '推进申请', mustDeliver: ['获得答复'] };
  return { writtenEvidence, targetChapter: chapter, targetVolume: volume, novel: { title: '测试', characters: [] }, workspace: { novelId: 'n', volumes: [volume], beatSheets: [] },
    storyMacroPlan: null, strategyPlan: null, targetBeat: beat, targetBeatSheet: { volumeId: 'v', beats: [beat] }, detailMode: 'task_sheet',
    targetChapterStartOrder: 2, targetChapterEndOrder: 2, nextAvailableChapterOrder: 2, targetBeatChapterCount: 1 };
}

test('fresh contract IDs restore readable prerequisites and survive scene-plan persistence', () => {
  const wire = prompt.outputSchema.parse(fixture());
  const result = prompt.postValidate(wire, input(), {});
  assert.equal(result.sceneCards[0].causality.prerequisites[0].condition, '她：保管两份证明');
  assert.equal(result.sceneCards[0].causality.prerequisites[0].sourceKind, 'established_in_context');
  assert.deepEqual(result.stateClaims[0].source.evidence, [{ sourcePath: 'writtenEvidence.chapters[0].content', quote: prose }]);
  assert.equal(result.sceneCards[1].causality.prerequisites[0].sourceKind, 'establish_in_scene');
  const plan = normalizeChapterScenePlan({ scenes: result.sceneCards, stateClaims: result.stateClaims }, 2400);
  const restored = parseChapterScenePlan(serializeChapterScenePlan(plan), { targetWordCount: 2400 });
  assert.deepEqual(restored.stateClaims, result.stateClaims);
  assert.deepEqual(restored.scenes[0].causality.stateTransition, wire.sceneCards[0].causality.stateTransition);
  assert.equal(wire.stateClaims[0].source.evidence, undefined);
});

test('legacy contracts remain readable but fresh generation requires state binding and forbids model evidence text', () => {
  const canonical = prompt.postValidate(prompt.outputSchema.parse(fixture()), input(), {});
  const old = structuredClone(canonical); delete old.stateClaims;
  old.sceneCards.forEach(scene => { delete scene.causality.stateTransition; scene.causality.prerequisites.forEach(item => delete item.claimIds); });
  assert.equal(createChapterExecutionContractSchema().safeParse(old).success, true);
  assert.equal(prompt.outputSchema.safeParse(old).success, false);
  for (const mutate of [
    value => { value.stateClaims[0].source.evidence = [{ sourcePath: 'fake', quote: prose }]; },
    value => { value.sceneCards[0].causality.prerequisites[0].condition = '另一项被改写的状态'; },
    value => { delete value.sceneCards[0].causality.stateTransition; },
  ]) { const value = fixture(); mutate(value); assert.equal(prompt.outputSchema.safeParse(value).success, false); assert.throws(() => prompt.postValidate(value, input(), {})); }
});

test('claims reject stale provenance, forged history, duplicate IDs and invalid scene dependencies', () => {
  assert.throws(() => resolveChapterStateClaims(fixture().stateClaims, review.replace(prose, `${prose}新内容`), 2), /Unknown or stale/);
  for (const mutate of [
    v => { v.stateClaims[0].temporalScope = 'planned'; },
    v => { v.stateClaims[1].temporalScope = 'prior'; },
    v => { v.stateClaims[1].id = 'held'; },
    v => { v.stateClaims[1].source.sceneKey = 'absent'; },
    v => { v.sceneCards[0].causality.stateTransition.beforeClaimIds = ['result3']; },
    v => { v.sceneCards[0].causality.stateTransition.beforeClaimIds = ['choice1']; },
    v => { v.sceneCards[0].causality.stateTransition.actionClaimIds = ['held']; },
    v => { v.sceneCards[0].causality.prerequisites[0].claimIds = ['result1']; },
    v => { v.sceneCards[0].causality.stateTransition.afterClaimIds = ['missing']; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => bindStateClaimContract(value, review, 2)); }
});

test('new planned intentions and attempts are not mistaken for already achieved results', () => {
  const value = fixture();
  value.stateClaims[1].predicate = '决定提出申请'; value.stateClaims[1].modality = 'intention';
  value.stateClaims[2].predicate = '尝试递交后被要求补件'; value.stateClaims[2].modality = 'attempt';
  assert.doesNotThrow(() => prompt.postValidate(value, input(), {}));
  // Citation validity does not certify predicate semantics: the independent state review must catch this.
  value.stateClaims[0].predicate = '保管二十份证明';
  assert.equal(resolveChapterStateClaims(value.stateClaims, review, 2)[0].predicate, '保管二十份证明');
});

test('chapter list and detail receive mandatory non-summarized prior prose, while absent evidence remains unknown', () => {
  const fixtureInput = input();
  for (const build of [blocks.buildVolumeChapterListContextBlocks, blocks.buildVolumeChapterDetailContextBlocks]) {
    const evidence = build(fixtureInput).find(block => block.id === 'written_evidence');
    assert.equal(evidence.required, true); assert.equal(evidence.allowSummary, false); assert.ok(evidence.content.includes(prose));
    const missing = build({ ...fixtureInput, writtenEvidence: undefined }).find(block => block.id === 'written_evidence');
    assert.match(missing.content, /未提供已写正文来源/);
  }
  assert.ok(blocks.buildVolumeChapterDetailContextBlocks(fixtureInput).find(block => block.id === 'written_evidence').content.includes(evidenceId));
});

test('planning repair uses the same bound output and preserves its resolved claims', () => {
  const { neighborEventUse, mustAvoidConflicts, targetWordCount, requiredElements, ...change } = fixture();
  Object.assign(change, { chapterId: 'c', summary: '递交后取得反馈' });
  const proposal = { requiresUserDecision: false, reason: '保留申请功能并核对来源', changes: [change], obligationMoves: [] };
  const contextJson = JSON.stringify({ writtenEvidence, candidateChapters: [{ id: 'c', chapterOrder: 2 }] });
  const result = repair.postValidate(repair.outputSchema.parse(proposal), { contextJson }, {});
  assert.equal(result.changes[0].stateClaims[0].source.evidence[0].quote, prose);
  assert.equal(result.changes[0].sceneCards[0].causality.prerequisites[0].condition, '她：保管两份证明');
  const originalPlan = prompt.postValidate(prompt.outputSchema.parse(fixture()), input(), {});
  const chapter = { ...input().targetChapter, volumeId: 'v', conflictLevel: 30, revealLevel: 20,
    sceneCards: serializeChapterScenePlan(normalizeChapterScenePlan({ scenes: originalPlan.sceneCards, stateClaims: originalPlan.stateClaims }, 2400)) };
  const document = { novelId: 'n', volumes: [{ id: 'v', chapters: [chapter] }] };
  const saved = applyPlanningRepairCandidate(document, 'v', ['c'], result);
  const persisted = parseChapterScenePlan(saved.volumes[0].chapters[0].sceneCards, { targetWordCount: 2400 });
  assert.deepEqual(persisted.stateClaims, result.changes[0].stateClaims);
  assert.deepEqual(persisted.scenes[1].causality.stateTransition, result.changes[0].sceneCards[1].causality.stateTransition);
  const missingClaims = structuredClone(result); delete missingClaims.changes[0].stateClaims;
  assert.throws(() => applyPlanningRepairCandidate(document, 'v', ['c'], missingClaims), /must return its state claims/);
  assert.throws(() => repair.postValidate(proposal, { contextJson: JSON.stringify({ writtenEvidence, candidateChapters: [] }) }, {}), /exact candidate/);
});
