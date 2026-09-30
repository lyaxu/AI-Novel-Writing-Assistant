const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SQLITE_ENABLE_WAL = 'false';
const { prisma } = require('../dist/db/prisma');
const persistence = require('../dist/services/novel/volume/volumeWorkspacePersistence');
const { buildVolumeWorkspaceDocument } = require('../dist/services/novel/volume/volumeWorkspaceDocument');
const { captureChapterDetailBaseline, rememberChapterDetailBaseline, commitGeneratedChapterDetail } = require('../dist/services/novel/volume/chapterDetail');

function contract(order) {
  return { id: `plan-${order}`, chapterId: `chapter-${order}`, volumeId: 'volume-1', chapterOrder: order,
    title: `章节${order}`, summary: '查明资源危机并取得证据。', purpose: '主动试探并取得证据。',
    exclusiveEvent: '拿到对手篡改账册的证据。', endingState: '掌握证据。', nextChapterEntryState: '带证据进行质问。',
    conflictLevel: 45, revealLevel: 35, targetWordCount: 3000, mustAvoid: '不提前解决下一章冲突。',
    payoffRefs: ['资源危机'], taskSheet: '主角发现危机，主动试探，取回证据并承担被发现的风险。',
    sceneCards: JSON.stringify({ targetWordCount: 3000, lengthBudget: { targetWordCount: 3000, softMinWordCount: 2550,
      softMaxWordCount: 3450, hardMaxWordCount: 3750 }, scenes: [1, 2, 3].map(n => ({
      key: `scene-${n}`, title: `步骤${n}`, purpose: '取得可验证证据。', mustAdvance: ['查证线索'], mustPreserve: ['保留对手'],
      entryState: '尚未拿到证据。', exitState: '取得新的线索。', forbiddenExpansion: ['不揭示幕后身份'], targetWordCount: 1000,
    })) }), createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
}

async function harness(fn) {
  const original = { findMany: prisma.chapter.findMany, active: persistence.getActiveVersionRow,
    transaction: persistence.runVolumeWorkspaceTransaction, persist: persistence.persistActiveVolumeWorkspace };
  let state = { version: { id: 'version-1', contentJson: 'original-version' },
    rows: [1, 2, 3].map(n => ({ id: `chapter-${n}`, novelId: 'novel-1', order: n, updatedAt: new Date(0),
      content: n === 1 ? '已写正文必须逐字保留' : '', chapterStatus: n === 1 ? 'completed' : 'unplanned' })),
    committed: null, stale: [] };
  let writes = 0;
  let failPersist = false;
  const workspace = buildVolumeWorkspaceDocument({ novelId: 'novel-1', source: 'volume', activeVersionId: 'version-1',
    volumes: [{ id: 'volume-1', novelId: 'novel-1', sortOrder: 1, title: '卷一', openPayoffs: [], status: 'active',
      chapters: [contract(1), contract(2), { ...contract(3), purpose: null, sceneCards: '半成品', taskSheet: '尚未细化' }] }],
    beatSheets: [], strategyPlan: null, critiqueReport: null, rebalanceDecisions: [] });
  prisma.chapter.findMany = async () => state.rows;
  persistence.getActiveVersionRow = async (_id, tx) => tx?._state?.version ?? state.version;
  persistence.persistActiveVolumeWorkspace = async tx => { writes++; if (failPersist) throw new Error('disk failure'); tx._state.persisted = true; };
  persistence.runVolumeWorkspaceTransaction = async callback => {
    const draft = structuredClone(state);
    const tx = { _state: draft, chapter: {
      findMany: async () => draft.rows,
      findFirst: async ({ where }) => draft.rows.find(c => c.novelId === where.novelId && (where.id ? c.id === where.id : c.order === where.order)),
      update: async ({ where, data }) => { writes++; Object.assign(draft.rows.find(c => c.id === where.id), data); },
      create: async ({ data }) => { writes++; const row = { ...data, id: `created-${data.order}`, updatedAt: new Date(0) }; draft.rows.push(row); return row; },
    }, storyPlan: { updateMany: async args => { draft.stale.push(args.where.chapterId); } },
    volumePlanVersion: { update: async ({ data }) => { draft.version.contentJson = data.contentJson; draft.committed = JSON.parse(data.contentJson); } } };
    const output = await callback(tx);
    state = draft;
    return output;
  };
  const target = { volumeId: 'volume-1', chapterId: 'plan-2', detailMode: 'task_sheet' };
  async function generated(writeGuard) {
    const baseline = await captureChapterDetailBaseline('novel-1', workspace, target, writeGuard);
    const result = structuredClone(workspace);
    result.volumes[0].chapters[1].taskSheet += ' 新执行职责。';
    // A whole-document draft must not overwrite adjacent chapters.
    result.volumes[0].chapters[0].summary = '不可覆盖的陈旧邻章草稿';
    rememberChapterDetailBaseline(result, baseline);
    return result;
  }
  const commit = document => commitGeneratedChapterDetail({ novelId: 'novel-1', generated: document, target,
    ensureActiveVersionRecord: async () => ({ versionId: 'version-1' }) });
  try { await fn({ workspace, generated, commit, get: () => state, writes: () => writes,
    fail: () => { failPersist = true; }, changeVersion: () => { state.version.contentJson = 'newer-version'; },
    changeProse: () => { state.rows[0].updatedAt = new Date(1000); },
    unlinkTarget: () => { workspace.volumes[0].chapters[1].chapterId = null; state.rows = state.rows.filter(c => c.order !== 2); } }); }
  finally { prisma.chapter.findMany = original.findMany; persistence.getActiveVersionRow = original.active;
    persistence.runVolumeWorkspaceTransaction = original.transaction; persistence.persistActiveVolumeWorkspace = original.persist; }
}

test('target detail commits atomically despite incomplete neighbor and preserves written prose and neighboring contracts', async () => harness(async h => {
  const generated = await h.generated();
  const saved = await h.commit(generated);
  assert.equal(saved.volumes[0].chapters[1].taskSheet, generated.volumes[0].chapters[1].taskSheet);
  assert.deepEqual(saved.volumes[0].chapters[0], h.workspace.volumes[0].chapters[0]);
  assert.deepEqual(saved.volumes[0].chapters[2], h.workspace.volumes[0].chapters[2]);
  assert.equal(h.get().rows[0].content, '已写正文必须逐字保留');
  assert.equal(h.get().rows[0].chapterStatus, 'completed');
  assert.equal(h.get().rows[1].content, '');
  assert.equal(h.get().rows[1].chapterStatus, 'unplanned');
  assert.equal(h.get().rows[2].taskSheet, undefined);
  assert.deepEqual(h.get().stale, ['chapter-2']);
  assert.equal(h.get().committed.volumes[0].chapters[1].taskSheet, h.get().rows[1].taskSheet);
}));

test('target invalid contract rejects before all writes, without using neighbor incompleteness as a bypass', async () => harness(async h => {
  const generated = await h.generated(); generated.volumes[0].chapters[1].sceneCards = 'invalid';
  await assert.rejects(h.commit(generated)); assert.equal(h.writes(), 0);
}));

test('workspace persistence failure rolls back chapter execution fields and version together', async () => harness(async h => {
  const generated = await h.generated(); const before = structuredClone(h.get()); h.fail();
  await assert.rejects(h.commit(generated), /disk failure/); assert.deepEqual(h.get(), before);
}));

test('concurrent workspace or prose change invalidates a generated detail receipt', async () => {
  await harness(async h => { const generated = await h.generated(); h.changeVersion();
    await assert.rejects(h.commit(generated), /发生修改/); assert.equal(h.writes(), 0); });
  await harness(async h => { const generated = await h.generated(); h.changeProse();
    await assert.rejects(h.commit(generated), /发生修改/); assert.equal(h.writes(), 0); });
});

test('a copied client document cannot grant a scoped commit or move the target', async () => harness(async h => {
  const generated = await h.generated();
  await assert.rejects(h.commit(structuredClone(generated)), /生成来源/);
  generated.volumes[0].chapters[1].chapterOrder = 3;
  await assert.rejects(h.commit(generated), /移动章节/); assert.equal(h.writes(), 0);
}));

test('first refinement creates only the target empty chapter without requiring a full-book sync', async () => harness(async h => {
  h.unlinkTarget(); const saved = await h.commit(await h.generated());
  assert.equal(saved.volumes[0].chapters[1].chapterId, 'created-2');
  const created = h.get().rows.find(c => c.id === 'created-2');
  assert.equal(created.content, ''); assert.equal(created.taskSheet, saved.volumes[0].chapters[1].taskSheet);
  assert.equal(h.get().rows.length, 3);
  assert.equal(h.get().rows[0].content, '已写正文必须逐字保留');
}));

test('generation ownership guard runs before and after writes and cancels the whole commit', async () => harness(async h => {
  let calls = 0; const before = structuredClone(h.get());
  const generated = await h.generated(async () => { if (++calls === 2) throw new Error('ownership expired'); });
  await assert.rejects(h.commit(generated), /ownership expired/);
  assert.equal(calls, 2); assert.deepEqual(h.get(), before);
}));
