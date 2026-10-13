const test = require('node:test');
const assert = require('node:assert/strict');
require('./offlineBootstrap.cjs');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const helpers = require('../../dist/services/novel/volume/volumeGenerationHelpers');
const documentTools = require('../../dist/services/novel/volume/volumeWorkspaceDocument');
const bounded = loadRuntimeSource('../volume/application/boundedChapterList.ts', { '../volumeGenerationHelpers': helpers });

function documentFixture(size = 50, secondSize = size) {
  const chapter = (order, title = `前卷既有计划${order}`) => ({ id: `plan-${order}`, chapterId: `chapter-${order}`,
    chapterOrder: order, beatKey: 'open_hook', title, summary: `已批准情节${order}`, taskSheet: '既有任务单', styleContract: '认可写法' });
  return documentTools.buildVolumeWorkspaceDocument({ novelId: 'novel',
    volumes: [
      { id: 'v1', sortOrder: 1, title: '前卷', chapters: Array.from({ length: size }, (_, i) => chapter(i + 1)) },
      { id: 'v2', sortOrder: 2, title: '后卷', chapters: [chapter(size + 1, '雾锁桥'), chapter(size + 2, '纸鸢破'), chapter(size + 3, '旧账来'), chapter(size + 5, '院门回声')] },
    ],
    beatSheets: ['v1', 'v2'].map(volumeId => ({ volumeId, beats: [
      { key: 'open_hook', label: '推进', summary: '已有卷级规划', chapterSpanHint: `1-${volumeId === 'v1' ? size : secondSize}章`, mustDeliver: ['阶段情节承诺'] },
    ] })),
  });
}

for (const size of [50, 200]) test(`bounded planning locates global ${size + 4} from accepted beat budgets without renumbering prior rows`, () => {
  const document = documentFixture(size), before = JSON.stringify(document);
  const plans = bounded.resolveBoundedChapterPlans(document, 'v2', { startOrder: size + 4, endOrder: size + 4 }, 'open_hook');
  assert.equal(plans.length, 1); assert.equal(plans[0].globalOrder, size + 4);
  assert.equal(plans[0].chapterStartOrder, 4); assert.equal(plans[0].chapterEndOrder, 4);
  assert.equal(JSON.stringify(document), before);
  assert.deepEqual(bounded.resolveBoundedChapterPlans(document, 'v2', { startOrder: size + 3, endOrder: size + 3 }, 'open_hook'), []);
  assert.throws(() => bounded.resolveBoundedChapterPlans(document, 'v2', { startOrder: size, endOrder: size + 1 }), /超出/);
});

for (const [size, secondSize] of [[50, 50], [200, 200], [70, 30]]) test(`single missing chapter in an accepted ${size}/${secondSize} chapter plan preserves budgets and finale position`, async () => {
  const document = documentFixture(size, secondSize), before = structuredClone(document);
  const calls = [];
  const { generateBeatChunkedChapterList } = loadRuntimeSource('../volume/volumeChapterListGeneration.ts', {
    '../../../prompting/core/promptRunner': { runStructuredPrompt: async input => {
      calls.push(input); return { output: { beatKey: 'open_hook', chapterCount: 1,
        chapters: [{ beatKey: 'open_hook', title: '青瓦客', summary: '本次唯一新增的授权章节' }] } };
    } },
    '../../../runtime/memoryTelemetry': { logMemoryUsage() {} },
    '../../../prompting/prompts/novel/volume/chapterList.prompts': { createVolumeChapterListPrompt: input => input },
    '../../../prompting/prompts/novel/volume/contextBlocks': { buildVolumeChapterListContextBlocks: () => [] },
    './volumeBeatSheetChapterBudget': require('../../dist/services/novel/volume/volumeBeatSheetChapterBudget'),
    './volumeGenerationHelpers': helpers,
    './chapterTitleDiversity': require('../../dist/services/novel/volume/chapterTitleDiversity'),
    './application/boundedChapterList': bounded, './volumeWorkspaceDocument': documentTools,
  });
  const result = await generateBeatChunkedChapterList({ document, workspace: document,
    novel: { estimatedChapterCount: size + secondSize, title: '离线长篇', characters: [],
      completionProfile: { mode: 'compact_book', endingRequiredBy: size + secondSize } }, storyMacroPlan: null,
    options: { targetVolumeId: 'v2', targetBeatKey: 'open_hook', generationMode: 'single_beat',
      chapterOrderRange: { startOrder: size + 4, endOrder: size + 4 } }, notifyPhase: async () => {},
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].promptInput.targetChapterStartOrder, 4);
  assert.equal(calls[0].promptInput.targetBeatChapterCount, 1);
  assert.equal(calls[0].asset.isBookFinale, false, 'accepted prior-volume budgets must prevent a premature finale');
  const added = result.mergedDocument.volumes.flatMap(v => v.chapters).filter(c => !before.volumes.flatMap(v => v.chapters).some(old => old.id === c.id));
  assert.equal(added.length, 1); assert.equal(added[0].chapterOrder, size + 4);
  for (const oldVolume of before.volumes) for (const old of oldVolume.chapters) {
    const retained = result.mergedDocument.volumes.flatMap(v => v.chapters).find(c => c.id === old.id);
    assert.deepEqual(retained, old, `must preserve approved plan ${old.chapterOrder}`);
  }
});

test('materialization range creates only the missing row while preserving the complete planning workspace and all old prose', async () => {
  const document = documentFixture();
  document.volumes[1].chapters.push({ ...document.volumes[1].chapters[0], id: 'plan-54', chapterId: null, chapterOrder: 54, title: '青瓦客' });
  const existing = document.volumes.flatMap(v => v.chapters).filter(c => c.chapterOrder !== 54)
    .map(c => ({ ...c, id: c.chapterId, order: c.chapterOrder, content: `原稿${c.chapterOrder}`, generationState: 'approved', chapterStatus: 'completed' }));
  const before = structuredClone(existing), creates = []; let persisted;
  const tx = { chapter: {
    create: async ({data}) => { creates.push(data); return { id: 'chapter-54' }; },
    updateMany: async () => assert.fail('must not update existing manuscripts or their contracts'),
    deleteMany: async () => assert.fail('must not delete chapters'),
  }, volumePlanVersion: { update: async () => {} } };
  const { VolumeChapterSyncService } = loadRuntimeSource('../volume/VolumeChapterSyncService.ts', {
    '@ai-novel/shared/types/chapterTaskSheetQuality': {},
    '../../../db/prisma': { prisma: { chapter: { findMany: async () => existing } } },
    './volumePlanUtils': require('../../dist/services/novel/volume/volumePlanUtils'),
    './volumeWorkspaceDocument': documentTools,
    './volumeWorkspacePersistence': { runVolumeWorkspaceTransaction: fn => fn(tx), persistActiveVolumeWorkspace: async (_tx, _id, next) => { persisted = next; } },
  });
  const service = new VolumeChapterSyncService({ ensureVolumeWorkspace: async () => document,
    ensureActiveVersionRecord: async () => ({ versionId: 'version' }), emitVolumeUpdated() {}, syncPayoffLedger() {} });
  await service.syncVolumeChaptersWithOptions('novel', { volumes: document.volumes,
    preserveContent: true, applyDeletes: false, allowIncompleteExecutionContracts: true }, {
    materializationRange: { startOrder: 54, endOrder: 54 }, preparedWorkspace: { current: document, merged: document }, syncPayoffLedger: false,
  });
  assert.deepEqual(creates.map(c => c.order), [54]); assert.deepEqual(existing, before);
  assert.equal(persisted.volumes.flatMap(v => v.chapters).length, 55);
  assert.equal(persisted.volumes[1].chapters.find(c => c.chapterOrder === 54).chapterId, 'chapter-54');
  assert.equal(persisted.volumes[0].chapters.length, 50);
});
