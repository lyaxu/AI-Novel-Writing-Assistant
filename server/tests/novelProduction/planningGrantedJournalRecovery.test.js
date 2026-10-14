const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('./offlineBootstrap.cjs');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../../dist/db/prisma');
const saved = require('./fixtures/planningGrantedJournalStop.json');
const earlier = require('../fixtures/planningRequiredElements-stop.json');
const { NovelDirectorContinueRuntime } = require('../../dist/services/novel/director/runtime/novelDirectorContinueRuntime');
const { DirectorCommandService } = require('../../dist/services/novel/director/commands/DirectorCommandService');
const { NovelCorePipelineService } = require('../../dist/services/novel/novelCorePipelineService');
const { PlanningRepairCoordinator } = require('../../dist/services/novel/volume/planningRepair/PlanningRepairCoordinator');
const { PlanningRepairStore } = require('../../dist/services/novel/volume/planningRepair/PlanningRepairStore');
const { PlanningRepairPipelineRecoveryService } = require('../../dist/services/novel/director/recovery/planningRepair');
const reliability = require('../../dist/services/novel/production/reliability');
const { ChapterExecutionPreparationService } = require('../../dist/services/novel/production/preparation/ChapterExecutionPreparationService');
const originalJournal = JSON.parse(saved.journalRow.metadataJson);
const originalJobId = originalJournal.operationId.split(':')[1];
const now = Date.parse(saved.provenance.capturedAt) + 60_000;
const sha = text => createHash('sha256').update(text).digest('hex');
const clone = structuredClone;

function hydrate(modelName, value) {
  if (!value) return value;
  const result = clone(value);
  for (const field of Prisma.dmmf.datamodel.models.find(m => m.name === modelName).fields) {
    if (result[field.name] == null) continue;
    if (field.type === 'DateTime') result[field.name] = new Date(result[field.name]);
    if (field.type === 'Boolean') result[field.name] = Boolean(result[field.name]);
  }
  return result;
}
const equal = (a, b) => a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : a === b;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some(v => matches(row, v));
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (key === 'NOT') return !matches(row, value);
    if (!(key in row) && key.includes('_')) return matches(row, value);
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, wanted]) => {
      if (op === 'in') return wanted.some(v => equal(actual, v));
      if (op === 'notIn') return !wanted.some(v => equal(actual, v));
      if (op === 'not') return !equal(actual, wanted);
      if (op === 'equals') return equal(actual, wanted);
      if (op === 'startsWith') return actual?.startsWith(wanted);
      if (op === 'lte') return actual <= wanted;
      if (op === 'lt') return actual < wanted;
      if (op === 'gte') return actual >= wanted;
      if (op === 'gt') return actual > wanted;
      assert.fail(`Unsupported query operator ${op}`);
    });
    return equal(actual, value);
  });
}

function harness() {
  const task = hydrate('NovelWorkflowTask', { ...saved.task, seedPayloadJson: JSON.stringify(saved.seed) });
  const data = {
    novelWorkflowTask: [task], generationJob: saved.jobs.map(j => hydrate('GenerationJob', j)),
    chapter: saved.chapters.map(c => hydrate('Chapter', c)),
    chapterArtifactSyncCheckpoint: [hydrate('ChapterArtifactSyncCheckpoint', saved.journalRow)],
    novel: [hydrate('Novel', saved.novel)],
    volumePlan: saved.volumes.map(v => { const row = hydrate('VolumePlan', v); delete row.chapters; return row; }),
    volumeChapterPlan: saved.volumes.flatMap(v => v.chapters.map(c => hydrate('VolumeChapterPlan', c))),
    volumePlanVersion: saved.versions.map(v => hydrate('VolumePlanVersion', v)),
    storyMacroPlan: saved.macro ? [hydrate('StoryMacroPlan', saved.macro)] : [],
    directorRunCommand: saved.commands.map(c => hydrate('DirectorRunCommand', c)), storyPlan: [],
  };
  const calls = { scheduled: [], review: 0, window: 0, repair: 0, newJobs: 0, writes: [], continued: [], initialized: 0 };
  const background = [];
  let tail = Promise.resolve(); let serial = 0; let failWriteTable;
  const read = (table, query = {}) => {
    let rows = data[table].filter(row => matches(row, query.where));
    const orders = query.orderBy ? Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy] : [];
    rows = [...rows].sort((a, b) => {
      for (const order of orders) for (const [key, dir] of Object.entries(order)) {
        if (a[key] < b[key]) return dir === 'asc' ? -1 : 1;
        if (a[key] > b[key]) return dir === 'asc' ? 1 : -1;
      }
      return 0;
    });
    if (query.take) rows = rows.slice(0, query.take);
    return rows.map(row => {
      const result = clone(row);
      if (table === 'volumePlan' && (query.include?.chapters || query.select?.chapters)) {
        result.chapters = read('volumeChapterPlan', { where: { volumeId: row.id }, orderBy: { chapterOrder: 'asc' } });
      }
      return query.select ? Object.fromEntries(Object.keys(query.select).filter(k => query.select[k]).map(k => [k, result[k]])) : result;
    });
  };
  const mutate = (table, row, patch) => {
    calls.writes.push({ table, id: row.id, fields: Object.keys(patch) });
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) {
      row[key] = value && typeof value === 'object' && Object.hasOwn(value, 'increment') ? row[key] + value.increment : clone(value);
    }
    if ('updatedAt' in row) row.updatedAt = new Date(now + ++serial);
    return clone(row);
  };
  const insert = (table, value) => {
    if (table === 'directorRunCommand' && data[table].some(c => c.taskId === value.taskId && c.idempotencyKey === value.idempotencyKey)) {
      throw Object.assign(new Error('Unique command'), { code: 'P2002' });
    }
    const row = { id: `offline-${++serial}`, createdAt: new Date(now), updatedAt: new Date(now), ...clone(value) };
    data[table].push(row); calls.writes.push({ table, id: row.id, fields: Object.keys(value), create: true }); return clone(row);
  };
  for (const table of Object.keys(data)) {
    Object.assign(prisma[table], {
      findUnique: async q => read(table, q)[0] ?? null, findFirst: async q => read(table, q)[0] ?? null,
      findMany: async q => read(table, q), count: async q => read(table, q).length,
      create: async ({ data: value }) => insert(table, value),
      updateMany: async ({ where, data: value }) => {
        if (failWriteTable === table) { failWriteTable = undefined; return { count: 0 }; }
        const rows = data[table].filter(row => matches(row, where)); for (const row of rows) mutate(table, row, value); return { count: rows.length };
      },
      update: async ({ where, data: value }) => { const row = data[table].find(row => matches(row, where)); assert.ok(row); return mutate(table, row, value); },
      upsert: async ({ where, create, update }) => { const row = data[table].find(row => matches(row, where)); return row ? mutate(table, row, update) : insert(table, create); },
      deleteMany: async ({ where }) => { const before = data[table].length; data[table] = data[table].filter(row => !matches(row, where)); return { count: before - data[table].length }; },
    });
  }
  prisma.$transaction = fn => {
    const run = tail.then(async () => {
      const before = clone(data);
      try { return await fn(prisma); } catch (error) { for (const k of Object.keys(data)) data[k] = before[k]; throw error; }
    });
    tail = run.catch(() => {}); return run;
  };
  const row = () => data.novelWorkflowTask[0];
  const seed = () => JSON.parse(row().seedPayloadJson);
  const changeSeed = fn => { const current = seed(); fn(current); row().seedPayloadJson = JSON.stringify(current); };
  const mergeSeed = extra => changeSeed(current => Object.assign(current, extra));
  const workflowService = {
    getTaskById: async () => clone(row()), getTaskByIdWithoutHealing: async () => clone(row()),
    markTaskRunning: async (_id, patch) => { row().status = 'running'; row().pendingManualRecovery = false; if (patch.seedPayload) mergeSeed(patch.seedPayload); },
    bootstrapTask: async input => mergeSeed(input.seedPayload),
    recordCheckpoint: async () => assert.fail('Recovery must enter the saved planning operation'),
  };
  const command = new DirectorCommandService(workflowService); command.recoverStaleLeases = async () => 0;
  const recovery = new PlanningRepairPipelineRecoveryService({ db: prisma, now: () => now });
  const journal = reliability.createDefaultChapterProductionJournal();
  const core = Object.create(NovelCorePipelineService.prototype);
  core.parsePipelinePayload = JSON.parse;
  core.schedulePipelineExecution = (...args) => calls.scheduled.push(args);
  const repairOutput = () => {
    const output = clone(earlier.repairs[1].output);
    const plan = JSON.parse(earlier.initialCandidateChapters[0].sceneCards);
    output.changes[0].requiredElementRevisions = [
      { original: plan.requiredElements[4], replacement: '劳梓凡确认第2章已收的三百元仍在内兜，郑小满补充城西二手市场最里面一排靠墙第三个摊位的位置。', reason: '已写正文已经收款。', preservedFunction: '保留报酬确认和摊位线索。', sceneKeys: ['scene_4'] },
      { original: plan.requiredElements[5], replacement: '劳梓凡确认手机内已有木匣花纹、符纸残迹和匣盖裂缝照片，补拍本章封匣后的新状态用于追查。', reason: '已写正文已经留证。', preservedFunction: '保留追查证据并补充新状态。', sceneKeys: ['scene_4'] },
    ];
    return output;
  };
  const planningStore = new PlanningRepairStore();
  const planning = new PlanningRepairCoordinator(planningStore, {
    evaluate: async () => { calls.review++; return { status: 'passed', verdict: 'usable', safeToSync: true, canEnterExecution: true, issues: [], summary: 'Synthetic offline reviewer' }; },
  }, async ({ asset }) => {
    if (asset.id === 'novel.volume.planning_repair') { calls.repair++; return { output: repairOutput() }; }
    assert.equal(asset.id, 'novel.volume.planning_repair_review'); calls.window++;
    return { output: { usable: true, safeToSync: true, requiresUserDecision: false, summary: 'Synthetic offline window reviewer', issues: [] } };
  });
  const backgroundExecution = async args => {
    calls.continued.push(args);
    assert.equal(args.existingPipelineJobId, originalJobId);
    assert.equal(args.resumePendingManualRecovery, true);
    await core.resumePipelineJob(originalJobId, { novelId: row().novelId, directorTaskId: row().id });
    assert.equal(calls.scheduled.length, 1);
    const operation = await journal.open({ novelId: row().novelId, chapterId: originalJournal.expectedChapter.id,
      operationId: originalJournal.operationId, request: originalJournal.request });
    try {
      const preparation = new ChapterExecutionPreparationService({
        chapterPlanJITService: { ensureExecutionReady: async () => {
          const snapshot = seed().planningRepairSnapshot;
          return planning.run({ document: snapshot.baselineDocument, volumeId: seed().planningRepair.volumeId,
            chapterId: seed().planningRepair.chapterId, options: { taskId: row().id },
            writtenEvidence: earlier.writtenEvidence, context: {}, generateInitial: async () => assert.fail('Must reuse saved candidate') });
        } },
        loadChapter: async () => clone(data.chapter.find(c => c.id === originalJournal.expectedChapter.id)),
        loadEstimatedChapterCount: async () => saved.novel.estimatedChapterCount,
        planner: { ensureChapterPlan: async () => ({ id: 'offline-approved-plan' }), getChapterPlan: async () => null },
      });
      await reliability.withProductionSession(operation, () => preparation.prepare(row().novelId, originalJournal.expectedChapter.id, originalJournal.request));
    } finally { await operation.close(); }
  };
  const runtime = new NovelDirectorContinueRuntime({ workflowService,
    preparePlanningPipelineRecovery: input => recovery.recover(input),
    autoExecutionRuntime: { runFromReady: backgroundExecution },
    directorRuntime: { initializeRun: async () => { calls.initialized++; }, recordRunResumed: async () => {} },
    candidateRuntime: { continueTask: async () => false },
    novelContextService: { listChapters: async () => read('chapter') },
    storyMacroService: { getPlan: async () => ({ storyInput: 'existing', decomposition: {} }) },
    volumeService: { getVolumes: async () => clone(saved.seed.planningRepairSnapshot.baselineDocument) },
    getDirectorAssetSnapshot: async () => ({}),
    buildDirectorSeedPayload: (directorInput, novelId, extra) => ({ directorInput, novelId, ...extra }),
    assertHighMemoryStartAllowed: async () => {}, runDirectorPipeline: async () => assert.fail('No whole-outline rerun'),
    novelService: { startPipelineJob: async () => { calls.newJobs++; assert.fail('Do not replace original job'); } },
    scheduleBackgroundRun: (_id, fn) => background.push(fn),
  });
  const recoveryInput = { taskId: row().id, novelId: row().novelId, recoveryKey: seed().planningRepairRecovery.idempotencyKey };
  const run = async (dispatch = true) => {
    if (dispatch) await command.enqueuePlanningRepairRecoveryCommand(row().id, seed().planningRepair.key, recoveryInput.recoveryKey);
    await runtime.continueTask(row().id, { planningRepairRecoveryKey: recoveryInput.recoveryKey, forceResume: true, continuationMode: 'resume' });
    for (const fn of background.splice(0)) await fn();
  };
  return { data, row, seed, changeSeed, calls, run, recovery, recoveryInput, command, runtime, journal,
    failWrite: table => { failWriteTable = table; },
    activeJournal: () => JSON.parse(data.chapterArtifactSyncCheckpoint.find(r => r.contentHash === 'active').metadataJson) };
}

test('real granted fixture attributes the failed replacement to a different job while preserving the paused original operation', () => {
  assert.equal(sha(saved.journalRow.metadataJson), saved.provenance.journalMetadataSha256);
  assert.equal(saved.seed.planningRepair.rounds, 2); assert.equal(saved.seed.planningRepair.maxRounds, 3);
  assert.equal(saved.seed.planningRepair.recoveryAction.mode, 'repair_then_review');
  assert.notEqual(saved.seed.autoExecution.pipelineJobId, originalJobId);
  assert.equal(originalJournal.steps['prepare.execution_contract'].status, 'unknown');
  assert.equal(saved.jobs.find(j => j.id === saved.seed.autoExecution.pipelineJobId).llmCallCount, 0);
  assert.equal(saved.usage, 51);
});

test('same source grant redispatches through Continue, original job and journal into the authorized planning round and actual commit', async () => {
  const h = harness(); const originalChapters = clone(h.data.chapter.slice(0, 2));
  const originalHistory = clone(h.seed().planningRepair.history);
  const oldReplacement = clone(h.data.generationJob.find(j => j.id !== originalJobId));
  await h.run();
  assert.equal(h.calls.repair, 1); assert.equal(h.calls.review, 1); assert.equal(h.calls.window, 1);
  assert.equal(h.calls.newJobs, 0); assert.equal(h.calls.scheduled[0][0], originalJobId);
  assert.equal(h.seed().planningRepair.rounds, 3); assert.equal(h.seed().planningRepair.maxRounds, 3);
  assert.equal(h.seed().planningRepair.phase, 'committed');
  assert.deepEqual(h.seed().planningRepair.history.slice(0, originalHistory.length), originalHistory);
  assert.deepEqual(h.data.chapter.slice(0, 2), originalChapters);
  assert.equal(h.data.chapter[2].content, '');
  assert.deepEqual(h.data.generationJob.find(j => j.id === oldReplacement.id), oldReplacement);
  assert.equal(h.activeJournal().operationId, originalJournal.operationId);
  assert.equal(h.activeJournal().steps['prepare.execution_contract'].status, 'done');
  const archive = h.data.chapterArtifactSyncCheckpoint.find(c => c.contentHash.includes(':planning-grant:'));
  assert.equal(archive.metadataJson, saved.journalRow.metadataJson, 'The original ambiguous legacy record remains intact');
  assert.equal(h.data.directorRunCommand.filter(c => c.idempotencyKey.startsWith('planning_repair:')).length, 2);
  assert.ok(h.data.volumePlanVersion.some(v => v.status === 'active' && v.id !== saved.versions.find(v => v.status === 'active').id));
});

test('concurrent source-button retries reuse one redispatched command and consume the same existing authorization once', async () => {
  const h = harness();
  const dispatch = () => h.command.enqueuePlanningRepairRecoveryCommand(h.row().id, h.seed().planningRepair.key, h.recoveryInput.recoveryKey);
  const replies = await Promise.all([dispatch(), dispatch()]);
  assert.equal(replies[0].commandId, replies[1].commandId);
  assert.notEqual(replies[0].commandId, saved.commands[0].id);
  assert.equal(h.data.directorRunCommand.length, saved.commands.length + 1);
  assert.equal(h.seed().planningRepair.rounds, 2); assert.equal(h.seed().planningRepair.maxRounds, 3);
  assert.equal(h.calls.repair, 0);
  await h.run(false);
  assert.equal(h.calls.repair, 1); assert.equal(h.seed().planningRepair.phase, 'committed');
  const again = await dispatch();
  assert.equal(again.commandId, replies[0].commandId);
  assert.equal(h.data.directorRunCommand.length, saved.commands.length + 1);
  assert.equal(h.seed().planningRepair.maxRounds, 3);
});

for (const scenario of ['source_change', 'cancel_task', 'cancel_job', 'live_lease', 'true_unknown', 'pending_model', 'wrong_key']) {
  test(`granted Continue refuses ${scenario} before a model or replacement job`, async () => {
    const h = harness();
    if (scenario === 'source_change') h.data.chapter[1].content += '人工新内容';
    if (scenario === 'cancel_task') h.row().cancelRequestedAt = new Date(now);
    if (scenario === 'cancel_job') h.data.generationJob.find(j => j.id === originalJobId).cancelRequestedAt = new Date(now);
    if (scenario === 'live_lease') Object.assign(h.data.generationJob.find(j => j.id === originalJobId), { executionOwner: 'other', executionLeaseExpiresAt: new Date(now + 60_000) });
    if (scenario === 'true_unknown') { const row = h.data.chapterArtifactSyncCheckpoint[0], j = JSON.parse(row.metadataJson); j.steps.writer = { status: 'unknown', external: true, error: 'connection lost' }; row.metadataJson = JSON.stringify(j); }
    if (scenario === 'pending_model') h.changeSeed(seed => { seed.planningRepair.pendingOperation = { kind: 'repair', startedAt: new Date(now).toISOString() }; });
    if (scenario === 'wrong_key') h.recoveryInput.recoveryKey = 'different-grant';
    const before = clone(h.data);
    await assert.rejects(h.run(false));
    assert.equal(h.calls.repair + h.calls.review + h.calls.window + h.calls.scheduled.length, 0);
    assert.deepEqual(h.data, before, 'Failed preflight cannot partially rewrite task, job or journal');
  });
}

test('concurrent same grant preparation has one durable transition, preserves its budget and cannot purchase a retry', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.recovery.recover(h.recoveryInput), h.recovery.recover(h.recoveryInput)]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.equal(h.seed().planningRepair.rounds, 2); assert.equal(h.seed().planningRepair.maxRounds, 3);
  assert.equal(h.calls.repair + h.calls.review + h.calls.window, 0);
  assert.equal(h.activeJournal().operationId, originalJournal.operationId);
  const once = clone(h.data);
  await h.recovery.recover(h.recoveryInput);
  assert.deepEqual(h.data, once, 'Same grant preparation must be idempotent');
});

for (const table of ['chapterArtifactSyncCheckpoint', 'generationJob', 'novelWorkflowTask']) {
  test(`recovery transaction rolls back the archive, binding and pause when ${table} CAS loses`, async () => {
    const h = harness(); const before = clone(h.data); h.failWrite(table);
    await assert.rejects(h.recovery.recover(h.recoveryInput));
    assert.deepEqual(h.data, before); assert.equal(h.calls.repair, 0);
  });
}
