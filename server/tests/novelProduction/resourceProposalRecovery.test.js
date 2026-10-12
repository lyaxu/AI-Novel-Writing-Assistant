const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
// Read-only production capture, with entity identifiers sanitized. No live database imports.
const captured = require('./fixtures/firstChapterResourceProposal.json');
const decision = loadRuntimeSource('../production/actualState/proposalDecision.ts', {});
const contracts = loadRuntimeSource('../production/reliability/types.ts', { 'node:crypto': crypto });
const { createChapterProductionJournal } = loadRuntimeSource('../production/reliability/session.ts', {
  'node:crypto': crypto, './types': contracts,
});
const execution = loadRuntimeSource('../production/reliability/executionContext.ts', {
  'node:async_hooks': require('node:async_hooks'),
  '../../../../llm/invocation/executionPolicy': { withUnknownOutcomeProtection: action => action() },
});
const hashes = loadRuntimeSource('artifactSync/ChapterArtifactContentVersion.ts', { 'node:crypto': crypto });
const resourceSchema = loadRuntimeSource(path.resolve(__dirname, '../../../shared/types/characterResource.ts'), { zod: require('zod') });
const quality = loadRuntimeSource('../state/stateProposalSourceQuality.ts', {});

function harness() {
  const content = captured.content;
  const { novelId, chapterId } = captured.proposal;
  const operationId = JSON.parse(captured.proposal.payloadJson).syncOperationId;
  let chapter = { id: chapterId, novelId, order: 1, title: '首章', content,
    taskSheet: 'retained task sheet', sceneCards: null, expectation: null, targetWordCount: 3000 };
  let record = null;
  let rows = [];
  let resources = [];
  let boundaries = [];
  let consumers = [];
  let extractionCalls = 0;
  let versions = 0;
  let boundaryFailure = false;
  let hideActiveJournal = false;
  let concurrentConfirmation = false;
  let concurrentClaim = false;
  let mutateBeforeTransaction = false;
  let applyFailure = false;
  const queued = [];
  const matches = (row, where) => (!where.id || (typeof where.id === 'string' ? where.id === row.id : where.id.in.includes(row.id)))
    && (!where.novelId || where.novelId === row.novelId)
    && (!where.chapterId || where.chapterId === row.chapterId)
    && (!where.payloadJson || where.payloadJson === row.payloadJson)
    && (!where.status || (typeof where.status === 'string' ? where.status === row.status : where.status.in.includes(row.status)));
  const db = {
    chapter: { findFirst: async ({ where }) => (!where.content || where.content === chapter.content) ? structuredClone(chapter) : null },
    character: { findMany: async () => [] },
    characterTimeline: { findMany: async () => [], updateMany: async () => {}, createMany: async () => {} },
    consistencyFact: { findMany: async () => [] },
    characterResourceLedgerItem: { findUnique: async () => null },
    chapterArtifactSyncCheckpoint: {
      findFirst: async () => !hideActiveJournal && record ? { metadataJson: record } : null,
      upsert: async value => { if (boundaryFailure) throw new Error('offline boundary write failed'); boundaries.push(value); },
    },
    stateChangeProposal: {
      findMany: async ({ where }) => structuredClone(rows.filter(row => matches(row, where))),
      findFirst: async ({ where }) => structuredClone(rows.find(row => matches(row, where)) ?? null),
      create: async ({ data }) => { const row = { ...data, id: `proposal-${rows.length + 1}` }; rows.push(row); return structuredClone(row); },
      update: async ({ where, data }) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data); return structuredClone(row); },
      updateMany: async ({ where, data }) => {
        if (concurrentClaim && where.status === 'pending_review') {
          concurrentClaim = false; rows[0].status = 'committed';
          resources.push({ winner: 'other confirmation' }); versions++;
        }
        const found = rows.filter(row => matches(row, where));
        found.forEach(row => Object.assign(row, data)); return { count: found.length };
      },
    },
    $transaction: async action => {
      // A competing confirm completed after the outer pending read, before this transaction.
      if (concurrentConfirmation) {
        concurrentConfirmation = false;
        rows[0].status = 'committed';
        resources.push({ winner: 'other confirmation' });
        versions++;
      }
      if (mutateBeforeTransaction) {
        mutateBeforeTransaction = false;
        const payload = JSON.parse(rows[0].payloadJson);
        rows[0].payloadJson = JSON.stringify({ ...payload, statusAfter: 'destroyed' });
      }
      return transaction(() => action(db));
    },
  };
  async function transaction(action) {
    const before = structuredClone({ chapter, record, rows, resources, boundaries, consumers });
    try { return await action(); }
    catch (error) { ({ chapter, record, rows, resources, boundaries, consumers } = before); throw error; }
  }
  const adapter = loadRuntimeSource('../production/actualState/transactionContext.ts', {
    'node:async_hooks': require('node:async_hooks'), '../../../../db/prisma': { prisma: db },
  });
  const resourceValidation = loadRuntimeSource('../characterResource/CharacterResourceValidationService.ts', {
    '../production/actualState': adapter, '@ai-novel/shared/types/characterResource': resourceSchema,
    './characterResourceShared': { compactText: value => String(value ?? '').trim() },
    '../state/stateProposalSourceQuality': quality,
  });
  const { StateCommitService } = loadRuntimeSource('../state/StateCommitService.ts', {
    '../runtime/artifactSync/ChapterArtifactContentVersion': hashes,
    '../production/reliability': contracts,
    '@ai-novel/shared/types/characterResource': resourceSchema,
    '../production/actualState': { ...adapter, ...decision },
    '../runtime/artifactSync/ChapterArtifactSyncResult': { ChapterArtifactContentVersionError: class extends Error {} },
    '../characterResource/CharacterResourceLedgerService': { characterResourceLedgerService: {
      applyCommittedUpdate: async (_tx, value) => {
        resources.push(value);
        if (applyFailure) throw new Error('offline ledger insert failed');
      },
    } },
    '../characterResource/characterResourceShared': { compactText: value => String(value ?? '').trim(), normalizeResourceKey: () => 'key' },
    '../characterResource/CharacterResourceValidationService': resourceValidation,
    './CanonicalStateService': { canonicalStateService: { getSnapshot: async () => ({}) } },
    './ChapterFactExtractor': { chapterFactExtractor: { extract: async () => assert.fail('saved extraction must not invoke another model') } },
    './StateVersionLog': { stateVersionLog: { createVersion: async () => ({ id: `version-${++versions}` }) } },
    './stateProposalSourceQuality': quality,
  });
  const stateCommit = new StateCommitService();
  const journal = createChapterProductionJournal({ repository: { transaction: action => transaction(() => action({
    assetClient: db, readChapter: async () => structuredClone(chapter),
    readJournal: async () => record && { metadataJson: record },
    writeJournal: async (_n, _c, expected, next) => { assert.equal(record, expected); record = next; },
    archiveJournal: async () => assert.fail('must retain original operation'),
  })) } });
  const delta = {
    extractChapterArtifacts: async () => { extractionCalls++; return structuredClone(captured.extraction); },
    applyChapterArtifactConsumer: async input => {
      consumers.push(input.consumer);
      if (input.consumer === 'resources') {
        const row = captured.proposal;
        const proposal = { ...row, payload: JSON.parse(row.payloadJson), evidence: JSON.parse(row.evidenceJson),
          validationNotes: JSON.parse(row.validationNotesJson) };
        const result = await stateCommit.proposeAndCommit({ novelId, chapterId, chapterOrder: 1,
          expectedChapterContent: content, skipFactExtraction: true, contentProvenance: 'debt', proposals: [proposal] });
        assert.equal(result.pendingReview.length, 1);
        assert.equal(result.committed.length, 0);
      }
      return {};
    },
    toSyncResult: () => ({ requiresFullReconcile: false }),
  };
  const { ChapterActualStateService } = loadRuntimeSource('../production/actualState/ChapterActualStateService.ts', {
    './proposalDecision': decision,
    '../../../rag': { ragServices: { ragIndexService: { enqueueUpsert: async (...value) => queued.push(value) } } },
    '../../../payoff/PayoffLedgerSyncService': { payoffLedgerSyncService: { syncLedger: async () => assert.fail('no model reconciliation expected') } },
    '../reliability': { ...contracts, ...execution }, './transactionContext': adapter,
    '../../runtime/ChapterArtifactDeltaService': { ChapterArtifactDeltaService: class {},
      buildContentHash: hashes.buildChapterArtifactContentHash, CHAPTER_ARTIFACT_CONSUMERS: ['facts', 'snapshot', 'resources'] },
    '../../runtime/artifactSync/ChapterArtifactSyncBoundary': { CHAPTER_ARTIFACT_BOUNDARY_TYPE: 'boundary' },
  });
  const actualState = new ChapterActualStateService(delta);
  return {
    open: () => journal.open({ novelId, chapterId, operationId, request: { entry: 'pipeline', workflowTaskId: 'job-1' } }),
    run: session => execution.withProductionSession(session, () => actualState.sync({ novelId, chapterId, content, contentProvenance: 'debt' })),
    confirm: () => stateCommit.commitExistingProposals({ novelId, chapterId, proposalIds: ['proposal-1'], reason: 'manual confirmation' }),
    changeContent: () => { chapter.content += '\n作者新写的一句。'; },
    changeOwner: () => { const value = JSON.parse(record); value.operationId = 'other-operation'; record = JSON.stringify(value); },
    removeActiveJournal: () => { hideActiveJournal = true; },
    raceWithCompletedConfirmation: () => { concurrentConfirmation = true; },
    raceAtClaim: () => { concurrentClaim = true; },
    changeProposalBeforeTransaction: () => { mutateBeforeTransaction = true; },
    failApply: value => { applyFailure = value; },
    invalid: () => { rows[0].validationNotesJson = JSON.stringify([decision.ACTUAL_STATE_INVALID_PROPOSAL]); },
    reject: explicit => { rows[0].status = 'rejected'; rows[0].validationNotesJson = JSON.stringify([explicit ? decision.ACTUAL_STATE_MANUAL_IGNORE : 'auto_director_state_resolution:defer']); },
    failBoundary: value => { boundaryFailure = value; },
    state: () => ({ chapter, rows, resources, consumers, boundaries, extractionCalls, versions, queued, record: JSON.parse(record) }),
  };
}

async function pauseAtProposal(f) {
  const session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  await session.close();
  assert.equal(f.state().rows.length, 1);
  assert.equal(f.state().rows[0].status, 'pending_review');
  return session;
}

test('real saved high-risk proposal survives repeated resumes and explicit confirmation closes boundary once', async () => {
  const f = harness();
  assert.equal(f.state().chapter.content.length, 3013);
  assert.equal(crypto.createHash('sha256').update(f.state().chapter.content).digest('hex'), 'd4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6');
  await pauseAtProposal(f);
  await pauseAtProposal(f);
  await pauseAtProposal(f);
  assert.equal(f.state().extractionCalls, 1);
  assert.deepEqual(f.state().consumers, ['facts', 'snapshot', 'resources']);
  assert.equal(f.state().boundaries.length, 0);
  assert.equal(f.state().rows[0].riskLevel, 'high');
  assert.ok(JSON.parse(f.state().rows[0].validationNotesJson).includes('账本可能带来未知债务转移风险。'));
  const confirmed = await f.confirm();
  assert.equal(confirmed.committed.length, 1);
  assert.equal((await f.confirm()).committed.length, 0);
  const session = await f.open();
  assert.equal((await f.run(session)).status, 'completed');
  await f.run(session);
  await session.close({ completed: true });
  assert.equal(f.state().resources.length, 1);
  assert.equal(f.state().boundaries.length, 1);
  assert.equal(f.state().versions, 1);
  assert.equal(f.state().extractionCalls, 1);
  assert.equal(f.state().queued.length, 3);
  assert.equal(f.state().chapter.content, captured.content);
});

for (const [label, mutate, expected] of [
  ['changed manuscript', f => f.changeContent(), 'CHAPTER_PRODUCTION_CONFLICT'],
  ['invalid extraction marker', f => f.invalid(), 'CHAPTER_PRODUCTION_STORAGE'],
  ['different operation ownership', f => f.changeOwner(), 'CHAPTER_PRODUCTION_CONFLICT'],
  ['missing active execution journal', f => f.removeActiveJournal(), 'CHAPTER_PRODUCTION_CONFLICT'],
]) test(`${label} prevents confirming saved resource proposal`, async () => {
  const f = harness(); await pauseAtProposal(f); mutate(f);
  await assert.rejects(f.confirm(), { code: expected });
  assert.equal(f.state().resources.length, 0);
  assert.equal(f.state().rows[0].status, 'pending_review');
  assert.equal(f.state().versions, 0);
});

test('live journal lease prevents confirmation until the original execution stops', async () => {
  const f = harness(); const session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  await assert.rejects(f.confirm(), { code: 'CHAPTER_PRODUCTION_BUSY' });
  assert.equal(f.state().resources.length, 0);
  await session.close();
  assert.equal((await f.confirm()).committed.length, 1);
});

test('automatic rejection cannot clear saved proposal; explicit ignore can complete without applying the resource', async () => {
  const f = harness(); await pauseAtProposal(f); f.reject(false);
  let session = await f.open();
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  await session.close();
  assert.equal(f.state().boundaries.length, 0);
  f.reject(true); session = await f.open();
  assert.equal((await f.run(session)).status, 'completed');
  await session.close({ completed: true });
  assert.equal(f.state().resources.length, 0);
  assert.equal(f.state().extractionCalls, 1);
  assert.equal(f.state().boundaries.length, 1);
  assert.equal(f.state().chapter.content, captured.content);
});

test('failed boundary save after confirmation retries only the local boundary write', async () => {
  const f = harness(); await pauseAtProposal(f); await f.confirm();
  let session = await f.open(); f.failBoundary(true);
  await assert.rejects(f.run(session), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  await session.close();
  assert.equal(f.state().resources.length, 1);
  assert.equal(f.state().boundaries.length, 0);
  f.failBoundary(false); session = await f.open(); await f.run(session);
  await session.close({ completed: true });
  assert.equal(f.state().resources.length, 1);
  assert.equal(f.state().boundaries.length, 1);
  assert.equal(f.state().extractionCalls, 1);
  assert.deepEqual(f.state().consumers, ['facts', 'snapshot', 'resources']);
});

for (const [label, race] of [
  ['completed confirmation before transaction', f => f.raceWithCompletedConfirmation()],
  ['lost claim after fresh pending read', f => f.raceAtClaim()],
]) test(`${label} does not apply or version the resource twice`, async () => {
  const f = harness(); await pauseAtProposal(f); race(f);
  const result = await f.confirm();
  assert.equal(result.committed.length, 0);
  assert.equal(result.versionRecord, null);
  assert.deepEqual(f.state().resources, [{ winner: 'other confirmation' }]);
  assert.equal(f.state().versions, 1);
  const session = await f.open();
  assert.equal((await f.run(session)).status, 'completed');
  await session.close({ completed: true });
  assert.equal(f.state().boundaries.length, 1);
  assert.equal(f.state().extractionCalls, 1);
});

test('proposal changed after outer pending read is rejected before claiming or applying', async () => {
  const f = harness(); await pauseAtProposal(f); f.changeProposalBeforeTransaction();
  await assert.rejects(f.confirm(), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
  assert.equal(f.state().rows[0].status, 'pending_review');
  assert.equal(f.state().resources.length, 0);
  assert.equal(f.state().versions, 0);
  assert.equal(f.state().boundaries.length, 0);
});

test('resource application failure rolls back the pending claim and retries exactly one committed update', async () => {
  const f = harness(); await pauseAtProposal(f); f.failApply(true);
  await assert.rejects(f.confirm(), /offline ledger insert failed/);
  assert.equal(f.state().rows[0].status, 'pending_review');
  assert.equal(f.state().resources.length, 0);
  assert.equal(f.state().versions, 0);
  f.failApply(false); assert.equal((await f.confirm()).committed.length, 1);
  const session = await f.open(); await f.run(session); await session.close({ completed: true });
  assert.equal(f.state().rows[0].status, 'committed');
  assert.equal(f.state().resources.length, 1);
  assert.equal(f.state().versions, 1);
  assert.equal(f.state().boundaries.length, 1);
  assert.equal(f.state().extractionCalls, 1);
});
