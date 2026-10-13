const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../dist/db/prisma.js");
const { loadRuntimeSource } = require('./novelProduction/sourceHarness.cjs');
const { ChapterRouteWindowService } = loadRuntimeSource('../planning/ChapterRouteWindowService.ts', {
  '../../../db/prisma': { prisma },
  '../volume/NovelVolumeService': { NovelVolumeService: class {}, createVolumeGenerationWriteGuard: async () => undefined },
  '../volume/volumeGenerationHelpers': require('../dist/services/novel/volume/volumeGenerationHelpers.js'),
});
const { buildVolumeWorkspaceDocument } = require("../dist/services/novel/volume/volumeWorkspaceDocument.js");

const now = new Date(0).toISOString();

function createVolume(id, sortOrder, chapters = []) {
  return {
    id,
    novelId: "novel-1",
    sortOrder,
    title: `第${sortOrder}卷`,
    openPayoffs: [],
    status: "active",
    chapters,
    createdAt: now,
    updatedAt: now,
  };
}

function createChapter(id, volumeId, chapterOrder) {
  return {
    id,
    volumeId,
    chapterOrder,
    beatKey: "open_hook",
    title: `第${chapterOrder}章`,
    summary: "章节摘要",
    payoffRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

const strategyPlan = {
  recommendedVolumeCount: 2,
  hardPlannedVolumeCount: 2,
  readerRewardLadder: "逐步兑现",
  escalationLadder: "逐步升级",
  midpointShift: "中段转折",
  notes: "测试",
  volumes: [],
  uncertainties: [],
};

function buildWorkspace(volumes, beatSheets) {
  return buildVolumeWorkspaceDocument({
    novelId: "novel-1",
    volumes,
    strategyPlan,
    beatSheets,
    rebalanceDecisions: [],
  });
}

test("route window adds a future skeleton before planning the next beat and chapter", async () => {
  const firstVolume = createVolume("volume-1", 1, [createChapter("chapter-1", "volume-1", 1)]);
  const firstBeatSheet = {
    volumeId: "volume-1",
    volumeSortOrder: 1,
    status: "generated",
    beats: [{
      key: "opening",
      label: "开卷抓手",
      summary: "第一卷已完成",
      chapterSpanHint: "1章",
      mustDeliver: ["开局"],
    }],
  };
  let workspace = buildWorkspace([firstVolume], [firstBeatSheet]);
  let chapterWasPlanned = false;
  const scopes = [];
  const volumeService = {
    getVolumes: async () => workspace,
    generateVolumes: async (_novelId, options) => {
      scopes.push(options.scope);
      if (options.scope === "skeleton") {
        return buildWorkspace([
          firstVolume,
          createVolume("volume-2", 2),
        ], [firstBeatSheet]);
      }
      if (options.scope === "beat_sheet") {
        return buildWorkspace(options.draftWorkspace.volumes, [
          firstBeatSheet,
          {
            volumeId: options.targetVolumeId,
            volumeSortOrder: 2,
            status: "generated",
            beats: [{
              key: "opening",
              label: "承接",
              summary: "第二卷开始",
              chapterSpanHint: "1章",
              mustDeliver: ["承接"],
            }],
          },
        ]);
      }
      chapterWasPlanned = true;
      return buildWorkspace(options.draftWorkspace.volumes.map((volume) => (
        volume.id === "volume-2"
          ? { ...volume, chapters: [createChapter("chapter-2", "volume-2", 2)] }
          : volume
      )), options.draftWorkspace.beatSheets);
    },
    updateVolumesWithOptions: async (_novelId, input) => {
      workspace = buildWorkspace(input.volumes, input.beatSheets);
      return workspace;
    },
    syncVolumeChaptersWithOptions: async () => {},
  };
  const originalFindMany = prisma.chapter.findMany;
  prisma.chapter.findMany = async () => (chapterWasPlanned ? [{ order: 2 }] : []);

  try {
    const result = await new ChapterRouteWindowService(volumeService).ensureRouteWindow("novel-1", 2, {
      min: 1,
      target: 1,
      completionProfile: { targetChapterCount: 80 },
    });

    assert.deepEqual(scopes, ["skeleton", "beat_sheet", "chapter_list"]);
    assert.equal(result.availableRouteCount, 1);
    assert.equal(result.extended, true);
  } finally {
    prisma.chapter.findMany = originalFindMany;
  }
});

for (const fromOrder of [2, 3, 4]) {
  test(`bounded route window at chapter ${fromOrder} does not prefetch beyond sample chapter 3`, async () => {
    const originalFindMany = prisma.chapter.findMany;
    const queries = [];
    prisma.chapter.findMany = async ({ where }) => {
      queries.push(where);
      return [1, 2, 3, 4, 5, 6, 7].filter((order) => (
        order >= where.order.gte && (where.order.lte == null || order <= where.order.lte)
      )).map(order => ({ order }));
    };
    const service = new ChapterRouteWindowService({
      getVolumes: async () => { throw new Error("Existing in-scope routes must avoid generation"); },
    });
    try {
      const result = await service.ensureRouteWindow("sample-novel", fromOrder, {
        endOrder: 3, min: 3, target: 5,
        completionProfile: { mode: "serial_book", targetChapterCount: 80 },
      });
      assert.deepEqual(result, { availableRouteCount: Math.max(0, 4 - fromOrder), extended: false });
      if (fromOrder <= 3) assert.deepEqual(queries[0].order, { gte: fromOrder, lte: 3 });
      else assert.equal(queries.length, 0);
    } finally {
      prisma.chapter.findMany = originalFindMany;
    }
  });
}

function largeWorkspace(chapterOrders = []) {
  return buildWorkspace([
    createVolume('volume-1', 1, [createChapter('saved-first', 'volume-1', 1)]),
    createVolume('volume-2', 2, chapterOrders.map(order => createChapter(`route-${order}`, 'volume-2', order))),
  ], [
    { volumeId: 'volume-1', volumeSortOrder: 1, status: 'generated', beats: [
      { key: 'first_arc', label: '前卷', summary: '前卷职责', chapterSpanHint: '1-200章', mustDeliver: ['兑现前卷'] },
    ] },
    { volumeId: 'volume-2', volumeSortOrder: 2, status: 'generated', beats: [
      { key: 'next_arc', label: '后卷', summary: '后卷职责', chapterSpanHint: '1-5章', mustDeliver: ['承接后卷'] },
    ] },
  ]);
}

function routeHarness(initialOrders, initialWorkspace, generation) {
  const originalFindMany = prisma.chapter.findMany;
  const rows = initialOrders.map(order => ({ order, content: `saved-${order}` }));
  let workspace = structuredClone(initialWorkspace);
  const generated = []; const synced = [];
  prisma.chapter.findMany = async ({ where, select }) => {
    assert.deepEqual(select, { order: true });
    return rows.filter(row => row.order >= where.order.gte && (where.order.lte === undefined || row.order <= where.order.lte));
  };
  const service = new ChapterRouteWindowService({
    getVolumes: async () => workspace,
    generateVolumes: async (_novelId, options) => {
      generated.push(options);
      assert.equal(options.scope, 'chapter_list');
      const bound = options.chapterOrderRange;
      assert.equal(bound.startOrder, bound.endOrder);
      if (generation) workspace = await generation(workspace, options);
      else workspace = { ...workspace, volumes: workspace.volumes.map(volume => volume.id === options.targetVolumeId
        ? { ...volume, chapters: [...volume.chapters, createChapter(`new-${bound.startOrder}`, volume.id, bound.startOrder)] } : volume) };
      return workspace;
    },
    syncVolumeChaptersWithOptions: async (_novelId, input, options) => {
      assert.equal(input.preserveContent, true); assert.equal(input.applyDeletes, false);
      assert.ok(options.materializationRange); synced.push(options.materializationRange);
      for (const chapter of input.volumes.flatMap(volume => volume.chapters)) {
        if (chapter.chapterOrder < options.materializationRange.startOrder || chapter.chapterOrder > options.materializationRange.endOrder) continue;
        if (!rows.some(row => row.order === chapter.chapterOrder)) rows.push({ order: chapter.chapterOrder, content: '' });
      }
    },
  });
  return { service, rows, generated, synced, restore: () => { prisma.chapter.findMany = originalFindMany; } };
}

test('chapter 202 hole selects its global volume/beat even when chapter 203 already exists', async () => {
  const h = routeHarness([201, 203, 204], largeWorkspace([201, 203, 204]));
  try {
    const result = await h.service.ensureRouteWindow('long-book', 201, { endOrder: 203, min: 3, target: 3, taskId: 'same-task' });
    assert.equal(result.availableRouteCount, 3);
    assert.deepEqual(h.generated.map(options => [options.targetVolumeId, options.targetBeatKey, options.chapterOrderRange]),
      [['volume-2', 'next_arc', { startOrder: 202, endOrder: 202 }]]);
    assert.deepEqual(h.synced, [{ startOrder: 202, endOrder: 202 }]);
    assert.equal(h.rows.find(row => row.order === 201).content, 'saved-201');
    assert.equal(h.rows.find(row => row.order === 203).content, 'saved-203');
    assert.equal(h.rows.find(row => row.order === 204).content, 'saved-204');
  } finally { h.restore(); }
});

test('several missing routes are planned one at a time within the authorized high-order range', async () => {
  const h = routeHarness([204], largeWorkspace([204]));
  try {
    const result = await h.service.ensureRouteWindow('long-book', 201, { endOrder: 203, min: 3, target: 5 });
    assert.equal(result.availableRouteCount, 3);
    assert.deepEqual(h.generated.map(options => options.chapterOrderRange), [201, 202, 203].map(order => ({ startOrder: order, endOrder: order })));
    assert.deepEqual(h.synced, [201, 202, 203].map(order => ({ startOrder: order, endOrder: order })));
    assert.equal(h.rows.find(row => row.order === 204).content, 'saved-204');
  } finally { h.restore(); }
});

test('an existing workspace route is only materialized, never regenerated with its beat', async () => {
  const h = routeHarness([201, 203], largeWorkspace([201, 202, 203]), () => assert.fail('existing route cannot be regenerated'));
  try {
    const result = await h.service.ensureRouteWindow('long-book', 202, { endOrder: 202, min: 1, target: 1 });
    assert.equal(result.availableRouteCount, 1); assert.equal(h.generated.length, 0);
    assert.deepEqual(h.synced, [{ startOrder: 202, endOrder: 202 }]);
  } finally { h.restore(); }
});

test('generation without a new route stops instead of repeating model work', async () => {
  const h = routeHarness([], largeWorkspace(), workspace => workspace);
  try {
    await assert.rejects(h.service.ensureRouteWindow('long-book', 201, { endOrder: 201, min: 1, target: 1 }), /未取得进展/);
    assert.equal(h.generated.length, 1);
  } finally { h.restore(); }
});

test('concurrent requests wait then recheck their own different chapter instead of sharing the first result', async () => {
  let releaseFirst; const release = new Promise(resolve => { releaseFirst = resolve; });
  let markStarted; const started = new Promise(resolve => { markStarted = resolve; });
  const h = routeHarness([], largeWorkspace(), async (workspace, options) => {
    const order = options.chapterOrderRange.startOrder;
    if (order === 201) { markStarted(); await release; }
    return { ...workspace, volumes: workspace.volumes.map(volume => volume.id === options.targetVolumeId
      ? { ...volume, chapters: [...volume.chapters, createChapter(`route-${order}`, volume.id, order)] } : volume) };
  });
  try {
    const first = h.service.ensureRouteWindow('long-book', 201, { endOrder: 201, min: 1, target: 1 });
    await started;
    const second = h.service.ensureRouteWindow('long-book', 202, { endOrder: 202, min: 1, target: 1 });
    releaseFirst();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map(result => result.availableRouteCount), [1, 1]);
    assert.deepEqual(h.generated.map(options => options.chapterOrderRange.startOrder), [201, 202]);
  } finally { h.restore(); }
});
