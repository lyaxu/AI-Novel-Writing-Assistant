const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const identity = loadRuntimeSource('../characters/identity/CharacterIdentityIndex.ts', {});
const repository = loadRuntimeSource('../characters/identity/characterIdentityRepository.ts', {});

test('identity index uses explicit aliases, rejects fuzzy names and keeps ambiguous names unresolved', () => {
  const current = { id: 'a', name: '档案新名', aliases: ['旧名', '共同称呼'] };
  const other = { id: 'b', name: '其他人', aliases: ['共同称呼'] };
  const index = identity.buildCharacterIdentityIndex([current, other]);
  assert.equal(index.resolve('旧名'), current); assert.equal(index.resolve('档案新名'), current);
  assert.equal(index.resolve('共同称呼'), null); assert.equal(index.isAmbiguous('共同称呼'), true);
  assert.equal(index.resolve('档案新名的朋友'), null);
  assert.equal(identity.buildCharacterIdentityIndex([current, { id: 'c', name: '旧名' }]).resolve('旧名'), null);
});

test('alias repository reads only bound candidate identities for the current book and retains the official name', async () => {
  let query;
  const rows = await repository.attachCharacterIdentityAliases({ characterCastOptionMember: { findMany: async input => {
    query = input; return [{ appliedCharacterId: 'a', name: '候选旧名', aliasesJson: '["更旧称呼"]' },
      { appliedCharacterId: null, name: '未应用候选', aliasesJson: '[]' }];
  } } }, 'book', [{ id: 'a', name: '档案新名' }]);
  assert.equal(query.where.option.novelId, 'book'); assert.deepEqual(query.where.appliedCharacterId.in, ['a']);
  assert.equal(rows[0].name, '档案新名'); assert.deepEqual(rows[0].aliases, ['候选旧名', '更旧称呼']);
});

function candidateHarness({ ambiguous = false, empty = false, failSave = false } = {}) {
  let state = { candidate: { id: 'candidate', novelId: 'book', status: 'pending', proposedName: empty ? '新角色' : '旧名', summary: '正文人物' },
    characters: empty ? [] : [{ id: 'asset', name: '当前名字', novelId: 'book' }], creates: 0 };
  if (ambiguous) state.characters.push({ id: 'asset2', name: '另一人', novelId: 'book' });
  const db = {
    characterCandidate: {
      findFirst: async () => structuredClone(state.candidate),
      updateMany: async ({ data }) => { if (failSave) return { count: 0 }; Object.assign(state.candidate, data); return { count: 1 }; },
    },
    character: { findMany: async () => structuredClone(state.characters), create: async ({ data }) => {
      const result = { id: 'created', ...data }; state.creates++; state.characters.push(result); return result;
    } },
  };
  const module = loadRuntimeSource('../dynamics/commands/confirmCharacterCandidateIdentity.ts', {
    '../../../../db/prisma': { prisma: { $transaction: async fn => {
      const before = structuredClone(state); try { return await fn(db); } catch (error) { state = before; throw error; }
    } } },
    '../../characters/identity': { ...identity, attachCharacterIdentityAliases: async (_db, _novel, chars) => chars.map(item => ({ ...item, aliases: ['旧名'] })) },
  });
  return { get state() { return state; }, run: (automatic = true) => module.confirmCharacterCandidateIdentity('book', 'candidate', {}, automatic) };
}

test('automatic confirmation binds an old-name candidate to the current official identity without creating or renaming', async () => {
  const h = candidateHarness(); const result = await h.run();
  assert.equal(result.character.id, 'asset'); assert.equal(result.created, false);
  assert.equal(h.state.creates, 0); assert.equal(h.state.candidate.matchedCharacterId, 'asset');
  assert.equal(h.state.characters[0].name, '当前名字');
});

test('ambiguous aliases stay pending automatically and require explicit identity selection manually', async () => {
  const h = candidateHarness({ ambiguous: true });
  assert.equal(await h.run(), null); assert.equal(h.state.candidate.status, 'pending'); assert.equal(h.state.creates, 0);
  await assert.rejects(h.run(false), /称呼对应多位角色/);
});

test('new character creation and candidate binding are atomic and retry is idempotent', async () => {
  const h = candidateHarness({ empty: true });
  assert.equal((await h.run()).created, true);
  assert.equal((await h.run()).created, false);
  assert.equal(h.state.creates, 1); assert.equal(h.state.characters.length, 1);
  const broken = candidateHarness({ empty: true, failSave: true });
  const before = structuredClone(broken.state);
  await assert.rejects(broken.run(), /正在处理/); assert.deepEqual(broken.state, before);
});
