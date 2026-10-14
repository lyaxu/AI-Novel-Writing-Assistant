const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
require('./offlineBootstrap.cjs');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const { normalizeChapterScenePlan, serializeChapterScenePlan, parseChapterScenePlan } = require('@ai-novel/shared/types/chapterLengthControl');

// Reuse the existing in-memory store fixture without registering its test suite.
// It evaluates the production store with explicit DB/event doubles; no real DB is opened.
const fixturePath = path.resolve(__dirname, '../planningRepairStore.test.js');
const fixtureRequire = createRequire(fixturePath);
const fixtureExports = {};
vm.runInThisContext(`(function(require,exports,__dirname){${fs.readFileSync(fixturePath, 'utf8')}\nexports.fixture=fixture;})`,
  { filename: fixturePath })(id => id === 'node:test' ? () => {} : fixtureRequire(id), fixtureExports, path.dirname(fixturePath));
const { AppError } = require('../../dist/middleware/errorHandler');
const { NovelDirectorContinueRuntime } = require('../../dist/services/novel/director/runtime/novelDirectorContinueRuntime');
const recoveryModule = loadRuntimeSource('../director/recovery/planningRepair/planningRepairRecovery.ts', {
  '../../../../../middleware/errorHandler': { AppError },
  '@ai-novel/shared/types/planningRepair/recovery': require('@ai-novel/shared/types/planningRepair/recovery'),
});
const { PlanningRepairRecoveryService } = loadRuntimeSource('../director/recovery/planningRepair/PlanningRepairRecoveryService.ts', {
  '../../../../../db/prisma': {}, '../../../../../middleware/errorHandler': { AppError },
  '../../../workflow/NovelWorkflowService': {}, '../../../volume/planningRepair/PlanningRepairStore': {},
  '../../../workflow/novelWorkflow.shared': require('../../dist/services/novel/workflow/novelWorkflow.shared'),
  './planningRepairRecovery': recoveryModule,
  '@ai-novel/shared/types/planningRepair/recovery': require('@ai-novel/shared/types/planningRepair/recovery'),
  '../pipelinePause': {},
});

// Mirrors the observed chapter-3 stop: two exhausted rounds, saved candidate with residual
// payment/photo requirements, no uncertain call, and only the current unwritten chapter eligible.
// Text below is a synthetic contract fixture, not a model answer or literary acceptance.
async function stoppedFixture() {
  const h = fixtureExports.fixture();
  h.input.chapterId = 'p3';
  const doc = h.input.document;
  doc.volumes[0].chapters = doc.volumes[0].chapters.filter(c => c.chapterOrder <= 3);
  h.db.volumes[0].chapters = h.db.volumes[0].chapters.filter(c => c.chapterOrder <= 3);
  h.db.chapters = h.db.chapters.filter(c => c.order <= 3 || c.order === 6);
  h.db.chapters.filter(c => c.order < 3).forEach(c => { c.content = `saved chapter ${c.order}`; c.generationState = 'approved'; c.chapterStatus = 'completed'; });
  h.db.versions[0].contentJson = JSON.stringify(doc);
  const s = await h.store.begin(h.input);
  const candidate = structuredClone(doc);
  candidate.volumes[0].chapters[2].sceneCards = serializeChapterScenePlan(normalizeChapterScenePlan({
    requiredElements: ['重复执行已经完成的付款', '重复执行已经完成的拍照'],
    scenes: [1, 2, 3].map(i => ({ key: `scene-${i}`, title: `后续调查${i}`, purpose: '调查后续结果',
      mustAdvance: ['发现新线索'], mustPreserve: ['付款与拍照已经完成'], targetWordCount: i === 3 ? 666 : 667,
      entryState: '沿用已写结果', exitState: '取得后续信息', forbiddenExpansion: ['重复付款与拍照'],
      resistance: '线索不完整', turn: '辨认新线索', emotionalShift: '警惕', readerValue: '后续信息',
      causality: require('../fixtures/sceneCausality.js').createSceneCausality() })),
  }, 2000));
  candidate.volumes[0].chapters[2].mustAvoid = '付款与拍照已完成，当前场景只处理后续结果';
  await h.store.save(s, { ...s.state, rounds: 1, phase: 'repairing', history: [{ round: 1, kind: 'repair', output: { preserved: true } }] }, candidate);
  await h.store.save(s, { ...s.state, rounds: 2, phase: 'waiting_confirmation',
    history: [...s.state.history, { round: 2, kind: 'assessment', result: { status: 'rejected', reason: 'requiredElements still conflict' } }],
    obligationMoves: [{ obligation: 'retain future consequence', fromChapterId: 'p3', toChapterId: 'p3' }],
    requiredElementRevisions: [{ chapterId: 'p3', revisionId: 'previously-applied' }],
    quality: { chapters: { p3: { status: 'failed', safeToSync: false } } },
  });
  h.db.task.status = 'waiting_approval'; h.db.task.pendingManualRecovery = true;
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  seed.planningRepairRecovery = { repairKey: s.state.key, resumePhase: 'chapter_execution' };
  h.db.task.seedPayloadJson = JSON.stringify(seed);
  const workflow = {
    volumeService: { getVolumes: async () => doc }, getTaskByIdWithoutHealing: async () => structuredClone(h.db.task),
    updateTaskManyWithRetry: async ({ where, data }) => {
      if (where.seedPayloadJson !== h.db.task.seedPayloadJson) return { count: 0 };
      Object.assign(h.db.task, data); return { count: 1 };
    },
  };
  return { h, s, candidate, service: new PlanningRepairRecoveryService(workflow, h.store) };
}

test('observed exhausted 2/2 contract remains paused under ordinary continuation with zero calls or writes', async () => {
  const { h, s, candidate } = await stoppedFixture();
  const before = JSON.stringify(h.db);
  let calls = 0;
  const runtime = new NovelDirectorContinueRuntime({ workflowService: { getTaskById: async () => structuredClone(h.db.task),
    continueTask: async () => { calls++; } }, directorRuntime: { initializeRun: async () => { calls++; } } });
  for (const input of [undefined, { forceResume: true }, { forceResume: true, continuationMode: 'skip_quality_repair' }]) {
    await assert.rejects(runtime.continueTask('t', input), { statusCode: 409 });
  }
  assert.equal(calls, 0); assert.equal(JSON.stringify(h.db), before);
  assert.deepEqual(JSON.parse(h.db.task.seedPayloadJson).planningRepairSnapshot.eligibleChapterIds, ['p3']);
  assert.equal(s.state.rounds, 2); assert.equal(s.state.maxRounds, 2);
  assert.deepEqual(parseChapterScenePlan(candidate.volumes[0].chapters[2].sceneCards).requiredElements,
    ['重复执行已经完成的付款', '重复执行已经完成的拍照']);
});

test('explicit repair_then_review preserves paid candidate/history/mappings and grants exactly one additional round', async () => {
  const { h, service } = await stoppedFixture();
  const before = JSON.parse(h.db.task.seedPayloadJson).planningRepair;
  const chapters = JSON.stringify(h.db.chapters);
  const input = { action: 'retry', repairKey: before.key, guidance: '核对所有合同字段，以已写事实修正重复动作并保留后续义务',
    executionMode: 'repair_then_review', affectedChapterIds: ['p3'], idempotencyKey: 'explicit-contract-recovery' };
  await service.grant('t', input);
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  assert.equal(seed.planningRepair.rounds, 2); assert.equal(seed.planningRepair.maxRounds, 3);
  assert.equal(seed.planningRepair.candidateVersionId, before.candidateVersionId);
  assert.deepEqual(seed.planningRepair.history, before.history);
  assert.deepEqual(seed.planningRepair.obligationMoves, before.obligationMoves);
  assert.deepEqual(seed.planningRepair.requiredElementRevisions, before.requiredElementRevisions);
  assert.equal(seed.planningRepair.quality, undefined); assert.equal(seed.planningRepairRecovery.resumePhase, 'chapter_execution');
  assert.equal(seed.planningRepair.recoveryAction.mode, 'repair_then_review');
  assert.equal(h.db.task.status, 'waiting_approval'); assert.equal(h.db.task.pendingManualRecovery, true);
  assert.equal(JSON.stringify(h.db.chapters), chapters);
  const after = h.db.task.seedPayloadJson;
  assert.equal((await service.grant('t', input)).replayed, true); assert.equal(h.db.task.seedPayloadJson, after);
});

test('changed written evidence invalidates review while retaining applied mappings in the committed source and consumed rounds', async () => {
  const h = fixtureExports.fixture(), s = await h.store.begin(h.input);
  await h.store.save(s, { ...s.state, rounds: 1, obligationMoves: [{ old: true }],
    requiredElementRevisions: [{ chapterId: 'p2', old: true }], history: [{ kind: 'repair', round: 1, output: { old: true } }] });
  await h.ready(s);
  const document = await h.store.commit(s, s.candidate);
  const before = h.state();
  h.db.chapters[0].content = 'new written source';
  const { writtenSourceFingerprint } = loadRuntimeSource('../volume/writtenEvidence/evidencePolicy.ts', { 'node:crypto': require('node:crypto') });
  const refreshed = await h.store.begin({ ...h.input, document, expectedWrittenSourceFingerprint: writtenSourceFingerprint(h.db.chapters, 2) });
  assert.equal(refreshed.state.rounds, before.rounds); assert.equal(refreshed.state.maxRounds, before.maxRounds);
  assert.deepEqual(refreshed.state.history.slice(0, -1), before.history);
  assert.equal(refreshed.state.history.at(-1).kind, 'evidence_refresh');
  // The new baseline is the already-committed candidate. Its applied mappings remain historical
  // facts; they do not confer approval under changed prose. Only old review authority expires.
  assert.deepEqual(refreshed.state.requiredElementRevisions, before.requiredElementRevisions);
  assert.deepEqual(refreshed.state.obligationMoves, before.obligationMoves);
  assert.deepEqual(refreshed.state.quality, { chapters: {} });
});

test('explicit rebase onto changed source clears discarded candidate mappings but preserves paid history and 2/2 budget', async () => {
  const { h } = await stoppedFixture();
  const before = h.state();
  const versions = structuredClone(h.db.versions);
  const chapters = JSON.stringify(h.db.chapters);
  h.db.novel.title = 'explicitly changed planning source';
  const rebased = await h.store.rebase(h.input);
  assert.equal(rebased.candidate, undefined); assert.equal(rebased.state.candidateVersionId, undefined);
  assert.equal(rebased.state.rounds, 2); assert.equal(rebased.state.maxRounds, 2);
  assert.deepEqual(rebased.state.history, before.history);
  assert.deepEqual(rebased.state.requiredElementRevisions, []); assert.deepEqual(rebased.state.obligationMoves, []);
  assert.equal(rebased.state.quality, undefined); assert.equal(rebased.state.phase, 'assessing');
  assert.deepEqual(h.db.versions, versions); assert.equal(JSON.stringify(h.db.chapters), chapters);
});
