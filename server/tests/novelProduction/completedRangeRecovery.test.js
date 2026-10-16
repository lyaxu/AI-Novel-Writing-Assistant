const test = require('node:test');
const assert = require('node:assert/strict');
require('./offlineBootstrap.cjs');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const { AppError } = require('../../dist/middleware/errorHandler');
const { prisma } = require('../../dist/db/prisma');
const recovery = require('../../dist/services/novel/production/recovery');
const auto = loadRuntimeSource('../director/automation/novelDirectorAutoExecution.ts', {
  '@ai-novel/shared/types/chapterLengthControl': require('@ai-novel/shared/types/chapterLengthControl'),
  '../../pipelineJobState': {}, '../../production/ChapterExecutionStageRunner': {}, './novelDirectorAutoExecutionFailure': {},
});
const detector = loadRuntimeSource('../director/recovery/rangeCompletion/index.ts', {
  '../../automation/novelDirectorAutoExecution': auto, './acceptCommand': {},
});
const acceptance = loadRuntimeSource('../director/recovery/rangeCompletion/acceptCommand.ts', {
  '../../../../../middleware/errorHandler': { AppError }, '../../../production/recovery': recovery, './index': detector,
});

// Deterministic replay of the observed 1–3 range with only completed chapters 1 and 2.
// No manuscript fixtures are rewritten and no model or production database is used.
function fixture(options = {}) {
  const plan = { mode: 'chapter_range', startOrder: 1, endOrder: 3 };
  const seed = { directorInput: { idea: 'offline', candidate: { workingTitle: 'offline' }, runMode: 'full_book_autopilot', autoExecutionPlan: plan },
    autoExecution: { ...plan, enabled: true, pipelineJobId: 'job-2', pipelineStatus: 'succeeded', totalChapterCount: 3,
      completedChapterCount: 2, remainingChapterCount: 0, remainingChapterOrders: [],
      qualityLoopLedger: { consumedRounds: 2 }, circuitBreaker: { spent: 42 } },
    planningRepair: { version: 1, key: 'original-repair', phase: 'committed', roundsUsed: 2, maxRounds: 2 }, preserved: { style: 'approved', range: [1, 3] } };
  const row = { id: 'director', novelId: 'novel', lane: 'auto_director', status: 'succeeded',
    checkpointType: 'workflow_completed', updatedAt: new Date(1000), cancelRequestedAt: null, seedPayloadJson: JSON.stringify(seed) };
  const chapters = [1, 2].map(order => ({ id: `chapter-${order}`, order, content: `original prose ${order}`, chapterStatus: 'completed', generationState: 'approved' }));
  const job = { id: 'job-2', status: 'succeeded', payload: JSON.stringify({ workflowTaskId: 'director' }) };
  const commands = [], mutations = [];
  const tx = {
    chapter: { findMany: async () => chapters },
    generationJob: { findFirst: async ({where}) => where.id
      ? options.badJob ? null : job : options.activeJob ? { id: 'active' } : null },
    directorRunCommand: {
      findFirst: async () => options.activeCommand ? { id: 'active-command' } : null,
      create: async ({data}) => { if (options.createFails) throw new Error('command write failed'); const result = { id: 'command', ...data }; commands.push(result); return result; },
    },
    novelWorkflowTask: { updateMany: async query => {
      mutations.push(query);
      if (options.taskCasFails) return { count: 0 };
      assert.equal(query.where.seedPayloadJson, row.seedPayloadJson);
      assert.deepEqual(query.where.updatedAt, row.updatedAt);
      assert.equal(query.where.cancelRequestedAt, null);
      Object.assign(row, query.data); return { count: 1 };
    } },
  };
  return { row, seed, chapters, job, commands, mutations, tx,
    accept: () => acceptance.acceptIncompleteCompletedRangeCommand({ tx, task: structuredClone(row), forceResume: true,
      commandData: { taskId: row.id, novelId: row.novelId, commandType: 'continue', idempotencyKey: 'once', status: 'queued', payloadJson: '{"forceResume":true}' } }),
  };
}

test('read-only detector finds the absent order and corrects progress without changing task or chapters', () => {
  const f = fixture(); const before = JSON.stringify([f.row, f.chapters]);
  const result = detector.resolveIncompleteCompletedRange({ task: f.row, chapters: f.chapters });
  assert.deepEqual(result, { startOrder: 1, endOrder: 3, missingChapterOrders: [3], completedPipelineJobId: 'job-2',
    totalChapters: 3, completedChapters: 2, nextChapterOrder: 3, remainingChapterOrders: [3] });
  assert.equal(JSON.stringify([f.row, f.chapters]), before);
  const seed = JSON.parse(f.row.seedPayloadJson); seed.autoExecution.skippedChapterOrders = [3];
  f.row.seedPayloadJson = JSON.stringify(seed);
  assert.deepEqual(detector.resolveIncompleteCompletedRange({ task: f.row, chapters: f.chapters }).remainingChapterOrders, [3]);
});

function commandService(f) {
  const events = [];
  const database = { directorRunCommand: { findFirst: async () => f.commands[0] ?? null },
    $transaction: async fn => {
      const original = structuredClone(f.row);
      try { return await fn(f.tx); } catch (error) {
        for (const key of Object.keys(f.row)) delete f.row[key];
        Object.assign(f.row, original); throw error;
      }
    } };
  const { DirectorCommandService } = loadRuntimeSource('../director/commands/DirectorCommandService.ts', {
    '../workflowStepRuntime/directorWorkflowStepIds': require('../../dist/services/novel/director/workflowStepRuntime/directorWorkflowStepIds'),
    '@ai-novel/shared/types/novelFraming': {}, '../../../../db/prisma': { prisma: database },
    '../../../../db/sqliteRetry': { withSqliteRetry: fn => fn() }, '../../../../middleware/errorHandler': { AppError },
    '../../workflow/NovelWorkflowService': {}, '../runtime/novelDirectorHelpers': {},
    '../../workflow/novelWorkflow.shared': { parseSeedPayload: JSON.parse },
    './DirectorCommandServiceHelpers': require('../../dist/services/novel/director/commands/DirectorCommandServiceHelpers'),
    '../../../../workers/TaskDispatcher': { taskDispatcher: { notify: () => events.push('notify') } },
    './leases/DirectorCommandLeaseService': {},
    '../recovery/planningRepair/planningRepairRecovery': { assertPlanningRepairResumeAllowed() {} },
    '@ai-novel/shared/types/planningRepair/recovery': {}, '../../production/recovery': recovery,
    '../recovery/rangeCompletion': acceptance,
  });
  const service = new DirectorCommandService({ getTaskById: async () => structuredClone(f.row) });
  service.recoverStaleLeases = async () => 0;
  return { service, events };
}

test('real continue-command branch requires explicit consent and duplicate clicks reuse the queued original task command', async () => {
  const f = fixture(); const { service, events } = commandService(f);
  await assert.rejects(service.enqueueContinueCommand('director'), { statusCode: 409 });
  assert.equal(f.row.status, 'succeeded'); assert.equal(f.commands.length, 0);
  await service.enqueueContinueCommand('director', { forceResume: true });
  await service.enqueueContinueCommand('director', { forceResume: true });
  assert.equal(f.commands.length, 1); assert.equal(f.row.status, 'queued');
  assert.deepEqual(events, ['notify']);
});

test('command write failure rolls back task reopening; no task or job is marked running', async () => {
  const f = fixture({ createFails: true }); const { service, events } = commandService(f);
  const original = JSON.stringify(f.row);
  await assert.rejects(service.enqueueContinueCommand('director', { forceResume: true }), /command write failed/);
  assert.equal(JSON.stringify(f.row), original); assert.equal(f.commands.length, 0); assert.equal(events.length, 0);
});

for (const change of ['complete', 'cancelled', 'unapproved', 'invalid', 'not-completed']) test(`range recovery excludes ${change}`, () => {
  const f = fixture();
  if (change === 'complete') f.chapters.push({ id: 'chapter-3', order: 3 });
  if (change === 'cancelled') f.row.cancelRequestedAt = new Date();
  if (change === 'not-completed') f.row.status = 'failed';
  if (change === 'invalid') f.row.seedPayloadJson = '{';
  if (change === 'unapproved') { f.seed.autoExecution.enabled = false; f.row.seedPayloadJson = JSON.stringify(f.seed); }
  assert.equal(detector.resolveIncompleteCompletedRange({ task: f.row, chapters: f.chapters }), null);
});

test('explicit command atomically reopens original task, preserves scope/budgets and leaves old successful job untouched', async () => {
  const f = fixture(); const originals = JSON.stringify([f.chapters, f.job]);
  await f.accept();
  const seed = JSON.parse(f.row.seedPayloadJson);
  assert.equal(f.row.status, 'queued'); assert.equal(f.row.checkpointType, 'chapter_batch_ready');
  assert.equal(f.row.progress, 2 / 3);
  assert.equal(seed.autoExecution.pipelineJobId, null);
  assert.equal(seed.rangeCompletionRecovery.completedPipelineJobId, 'job-2');
  assert.deepEqual(seed.autoExecution.remainingChapterOrders, [3]);
  assert.deepEqual(seed.directorInput, f.seed.directorInput);
  for (const key of ['qualityLoopLedger', 'circuitBreaker']) assert.deepEqual(seed.autoExecution[key], f.seed.autoExecution[key]);
  assert.deepEqual(seed.planningRepair, f.seed.planningRepair); assert.deepEqual(seed.preserved, f.seed.preserved);
  assert.equal(JSON.stringify([f.chapters, f.job]), originals);
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].taskId, 'director');
});

for (const option of ['badJob', 'activeJob', 'activeCommand', 'taskCasFails']) test(`range recovery cannot queue when ${option}`, async () => {
  const f = fixture({ [option]: true });
  await assert.rejects(f.accept(), { statusCode: 409 });
  assert.equal(f.commands.length, 0);
});

test('scope drift and wrong successful-job binding cannot authorize remaining work', async () => {
  const f = fixture(); f.seed.directorInput.autoExecutionPlan = { mode: 'chapter_range', startOrder: 1, endOrder: 10 };
  f.row.seedPayloadJson = JSON.stringify(f.seed);
  await assert.rejects(f.accept(), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
  const g = fixture(); g.job.payload = '{"workflowTaskId":"another-director"}';
  await assert.rejects(g.accept(), { statusCode: 409 });
  assert.equal(f.commands.length + g.commands.length, 0);
});

test('explicit restored range enters existing auto execution without repeating succeeded review or whole-volume planning', async () => {
  const f = fixture(); await f.accept();
  const imports = {
    '@ai-novel/shared/types/novelDirector': require('@ai-novel/shared/types/novelDirector'),
    '@ai-novel/shared/types/planningRepair/recovery': require('@ai-novel/shared/types/planningRepair/recovery'),
    '../../workflow/novelWorkflow.shared': require('../../dist/services/novel/workflow/novelWorkflow.shared'),
    './autoDirectorMemorySafety': {}, './novelDirectorErrors': {},
    './novelDirectorHelpers': require('../../dist/services/novel/director/runtime/novelDirectorHelpers'),
    '../recovery/novelDirectorRecovery': {}, './novelDirectorTakeoverRuntime': {}, '../phases/novelDirectorExecutionNodeAdapters': {},
    './directorRuntimeDefaults': {}, '../../../../db/prisma': { prisma },
    '../recovery/planningRepair/planningRepairRecovery': require('../../dist/services/novel/director/recovery/planningRepair/planningRepairRecovery'),
    '../recovery/planningRepair': { PlanningRepairPipelineRecoveryService: class {
      constructor() { assert.fail('Completed-range recovery has no active planning grant to reconnect'); }
    } },
    '../automation/novelDirectorAutoExecution': auto,
    '../automation/novelDirectorAutoExecutionScopeRuntime': require('../../dist/services/novel/director/automation/novelDirectorAutoExecutionScopeRuntime'),
    '../../production/recovery': recovery, '../../production/reliability': require('../../dist/services/novel/production/reliability'),
  };
  const { NovelDirectorContinueRuntime } = loadRuntimeSource('../director/runtime/novelDirectorContinueRuntime.ts', imports);
  const runs = [], scheduled = [];
  const runtime = new NovelDirectorContinueRuntime({
    workflowService: { getTaskById: async () => f.row,
      markTaskRunning: async (_id, patch) => { f.row.status = 'running'; f.row.seedPayloadJson = JSON.stringify({ ...JSON.parse(f.row.seedPayloadJson), ...patch.seedPayload }); },
      recordCheckpoint: async () => assert.fail('saved scope must not require first-run setup') },
    directorRuntime: { initializeRun: async () => {}, recordRunResumed: async () => {} },
    continueCandidateStageTask: async () => false,
    resolveAssetFirstRecovery: async () => assert.fail('do not reconstruct unrelated whole-volume planning'),
    prepareSavedPipelineRecovery: async () => assert.fail('never resume successful old job'),
    buildDirectorSeedPayload: (request, novelId, extra) => ({ directorInput: request, novelId, ...extra }),
    autoExecutionRuntime: { runFromReady: async input => runs.push(input) },
    scheduleBackgroundRun: (_id, run) => scheduled.push(run),
  });
  await runtime.continueTask('director', { forceResume: true, continuationMode: 'auto_execute_range' });
  assert.equal(scheduled.length, 1); await scheduled[0]();
  assert.equal(runs.length, 1); assert.equal(runs[0].taskId, 'director'); assert.equal(runs[0].existingPipelineJobId, null);
  assert.deepEqual(runs[0].existingState.remainingChapterOrders, [3]);
  assert.deepEqual(runs[0].request.autoExecutionPlan, f.seed.directorInput.autoExecutionPlan);
  assert.deepEqual(runs[0].existingState.qualityLoopLedger, f.seed.autoExecution.qualityLoopLedger);
});
