const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');

function fixture() {
  let state = {
    option: { id: 'cast', novelId: 'book', status: 'draft', updatedAt: new Date(1000),
      coveragePlanJson: JSON.stringify({ version: 1, scope: 'book', targetChapterCount: 100, roles: [
        { identityKey: 'hero', name: '旧名', tier: 'core', detailStatus: 'completed' },
        { identityKey: 'later', name: '后期人物', tier: 'arc', detailStatus: 'planned' },
      ] }),
      members: [{ id: 'member', optionId: 'cast', identityKey: 'hero', name: '旧名', role: '主角', gender: 'unknown',
        castRole: 'protagonist', storyFunction: '承担故事', aliasesJson: '[]', prohibitionsJson: '[]', nameLocked: false }],
      relations: [{ id: 'relation', sourceIdentityKey: 'hero', sourceName: '旧名', targetIdentityKey: 'later', targetName: '后期人物', surfaceRelation: '同行' }] },
    characters: [], relations: [], writes: [], manuscripts: [{ id: 'chapter', content: '五章保护稿' }],
  };
  let failBinding = false;
  const db = {
    characterCastOption: {
      findFirst: async ({ where }) => state.option?.id === where.id && state.option.novelId === where.novelId ? structuredClone(state.option) : null,
      updateMany: async ({ where, data }) => {
        if (typeof where.id === 'object') return { count: 0 };
        if (where.updatedAt && where.updatedAt.getTime() !== state.option.updatedAt.getTime()) return { count: 0 };
        Object.assign(state.option, data); return { count: 1 };
      },
      update: async ({ data }) => Object.assign(state.option, data),
    },
    characterCastOptionMember: { findMany: async () => [...state.option.members, ...(state.extraBindings ?? [])].filter(item => item.appliedCharacterId),
      update: async ({ where, data }) => {
      if (failBinding && data.appliedCharacterId) throw new Error('injected binding failure');
      state.writes.push('binding'); return Object.assign(state.option.members.find(item => item.id === where.id), data);
    } },
    characterCastOptionRelation: { update: async ({ where, data }) => Object.assign(state.option.relations.find(item => item.id === where.id), data) },
    character: {
      findMany: async ({ where }) => state.characters.filter(item => item.novelId === where.novelId),
      create: async ({ data }) => { const row = { id: `asset-${state.characters.length}`, ...data }; state.characters.push(row); state.writes.push('create'); return row; },
      update: async ({ where, data }) => Object.assign(state.characters.find(item => item.id === where.id), data),
    },
    characterRelation: { upsert: async ({ where, create }) => {
      const key = where.novelId_sourceCharacterId_targetCharacterId;
      const existing = state.relations.find(item => item.novelId === key.novelId && item.sourceCharacterId === key.sourceCharacterId && item.targetCharacterId === key.targetCharacterId);
      if (!existing) state.relations.push(create);
      return existing || create;
    } },
  };
  const prisma = { $transaction: async fn => { const before = structuredClone(state); try { return await fn(db); } catch (error) { state = before; throw error; } } };
  const rename = loadRuntimeSource('../characterPrep/application/renameCharacterCastMember.ts', {
    '../../../../db/prisma': { prisma }, '../domain/characterCastCoverage': { parseCastCoverage: raw => raw ? JSON.parse(raw) : null },
  });
  const apply = loadRuntimeSource('../characterPrep/application/applyCharacterCastIdentity.ts', {
    '../../../../db/prisma': { prisma }, './renameCharacterCastMember': rename,
    '../../characters/identity': { ...loadRuntimeSource('../characters/identity/CharacterIdentityIndex.ts', {}),
      ...loadRuntimeSource('../characters/identity/characterIdentityRepository.ts', {}) },
  });
  return { get state() { return state; }, rename: (identityKey, name, expectedUpdatedAt = state.option.updatedAt.toISOString(), novelId = 'book') =>
    rename.renameCharacterCastMember(novelId, 'cast', { identityKey, name, expectedUpdatedAt }),
    apply: () => apply.applyCharacterCastIdentity('book', 'cast', state.option.updatedAt),
    failBinding: () => { failBinding = true; } };
}

test('candidate rename locks stable identity and updates aliases, coverage and relationship endpoints only', async () => {
  const f = fixture();
  await f.rename('hero', '用户名字');
  assert.equal(f.state.option.members[0].identityKey, 'hero');
  assert.equal(f.state.option.members[0].name, '用户名字');
  assert.equal(f.state.option.members[0].nameLocked, true);
  assert.deepEqual(JSON.parse(f.state.option.members[0].aliasesJson), ['旧名']);
  assert.equal(f.state.option.relations[0].sourceIdentityKey, 'hero');
  assert.equal(f.state.option.relations[0].sourceName, '用户名字');
  const role = JSON.parse(f.state.option.coveragePlanJson).roles[0];
  assert.equal(role.name, '用户名字'); assert.equal(role.nameLocked, true);
  assert.deepEqual(f.state.manuscripts, [{ id: 'chapter', content: '五章保护稿' }]);
  assert.equal(f.state.characters.length, 0);
});

test('not-yet-developed coverage role can be renamed and retains its stable planned identity', async () => {
  const f = fixture(); await f.rename('later', '后期新名');
  const role = JSON.parse(f.state.option.coveragePlanJson).roles[1];
  assert.equal(role.identityKey, 'later'); assert.equal(role.detailStatus, 'planned');
  assert.equal(role.nameLocked, true); assert.deepEqual(role.aliases, ['后期人物']);
  assert.equal(f.state.option.members.length, 1);
  assert.equal(f.state.option.relations[0].targetName, '后期新名');
});

test('stale version, cross-book access, duplicate name and missing identity reject without writes', async () => {
  for (const args of [['hero', 'new', new Date(999).toISOString()], ['hero', 'new', undefined, 'other'],
    ['hero', '后期人物'], ['missing', 'new']]) {
    const f = fixture(); const before = structuredClone(f.state);
    await assert.rejects(f.rename(...args)); assert.deepEqual(f.state, before);
  }
});

test('apply binds the chosen name atomically; repeated old option cannot restore an asset old name or create duplicates', async () => {
  const f = fixture(); await f.rename('hero', '候选新名');
  const first = await f.apply();
  assert.equal(first.createdCount, 1); assert.equal(f.state.option.members[0].appliedCharacterId, first.primaryCharacterId);
  f.state.characters[0].name = '档案最新姓名';
  f.state.characters[0].personality = '用户修改的性格';
  const second = await f.apply();
  assert.equal(second.createdCount, 0); assert.equal(f.state.characters.length, 1);
  assert.equal(second.primaryCharacterId, first.primaryCharacterId);
  assert.equal(f.state.characters[0].name, '档案最新姓名');
  assert.equal(f.state.characters[0].personality, '用户修改的性格');
  await assert.rejects(f.rename('hero', '再改'), /角色档案/);
  assert.equal(f.state.manuscripts[0].content, '五章保护稿');
});

test('binding write failure rolls back character creation and status, permitting safe retry', async () => {
  const f = fixture(); const before = structuredClone(f.state); f.failBinding();
  await assert.rejects(f.apply(), /binding failure/); assert.deepEqual(f.state, before);
});

test('newly developed members can be renamed and applied after the original core cast was applied', async () => {
  const f = fixture(); await f.apply();
  f.state.option.members.push({ ...f.state.option.members[0], id: 'later-member', identityKey: 'later', name: '后期人物', appliedCharacterId: null });
  await f.rename('later', '后期新名');
  await f.apply();
  assert.equal(f.state.characters.length, 2);
  assert.equal(f.state.characters[1].name, '后期新名');
  assert.equal(f.state.relations.length, 1);
  f.state.relations[0].surfaceRelation = '正文推进后的反目';
  await f.apply();
  assert.equal(f.state.relations.length, 1); assert.equal(f.state.relations[0].surfaceRelation, '正文推进后的反目');
});

test('lost bound asset does not silently create a replacement identity', async () => {
  const f = fixture(); f.state.option.members[0].appliedCharacterId = 'missing';
  const before = structuredClone(f.state); await assert.rejects(f.apply(), /角色资产不存在/); assert.deepEqual(f.state, before);
});

test('legacy relationship aliases shared by two people reject instead of binding the last candidate', async () => {
  const f = fixture();
  f.state.option.members[0].aliasesJson = '["共同称呼"]';
  f.state.option.members.push({ ...f.state.option.members[0], id: 'later-member', identityKey: 'later', name: '另一位' });
  f.state.option.relations[0].sourceIdentityKey = null; f.state.option.relations[0].sourceName = '共同称呼';
  const before = structuredClone(f.state);
  await assert.rejects(f.apply(), /称呼对应多位角色/); assert.deepEqual(f.state, before);
});

test('first application recognizes a reliably bound alias instead of creating the same person again', async () => {
  const f = fixture();
  f.state.characters.push({ id: 'asset-old', novelId: 'book', name: '正式新名' });
  f.state.extraBindings = [{ appliedCharacterId: 'asset-old', name: '旧名', aliasesJson: '[]' }];
  const result = await f.apply();
  assert.equal(result.createdCount, 0); assert.equal(result.primaryCharacterId, 'asset-old');
  assert.equal(f.state.characters.length, 1); assert.equal(f.state.characters[0].name, '正式新名');
});

test('first application rejects a name shared by an official name and another bound alias', async () => {
  const f = fixture();
  f.state.characters.push({ id: 'asset-a', novelId: 'book', name: '正式新名' }, { id: 'asset-b', novelId: 'book', name: '旧名' });
  f.state.extraBindings = [{ appliedCharacterId: 'asset-a', name: '旧名', aliasesJson: '[]' }];
  const before = structuredClone(f.state);
  await assert.rejects(f.apply(), /多个.*称呼/); assert.deepEqual(f.state, before);
});

test('legacy draft without identity cannot recreate an old name after its applied status was reset', async () => {
  const f = fixture(); f.state.option.members[0].identityKey = null;
  f.state.characters.push({ id: 'asset', novelId: 'book', name: '后来改名' });
  const before = structuredClone(f.state);
  await assert.rejects(f.apply(), /旧方案缺少身份关联/); assert.deepEqual(f.state, before);
  await assert.rejects(f.rename('member', '新候选名'), /旧方案缺少人物身份关联/); assert.deepEqual(f.state, before);
});
