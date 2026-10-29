// Offline guard simulation: a second "继续自动导演" on the identical pause must not start
// another model round. No model call, no database and no task mutation is performed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const helpers = require('../../dist/services/novel/director/commands/DirectorCommandServiceHelpers');
const scope = loadRuntimeSource('../production/recovery/ChapterPipelineRecoveryService.ts', {
  '../reliability': { ChapterProductionError: class extends Error {} },
});

const PAUSE = {
  checkpointType: 'chapter_batch_ready',
  currentItemKey: 'quality_repair',
  lastError: '审查尚未完成：部分引文或检查范围未通过核验。正文已保留，请从审查步骤恢复；不会根据未核实意见修改正文。',
  job: { id: 'original', status: 'failed', currentStage: 'reviewing', currentItemKey: 'chapter', error: '审查尚未完成：部分引文或检查范围未通过核验。' },
};
const signature = (pause = PAUSE) => helpers.hashPayload({
  taskId: 'director', checkpointType: pause.checkpointType, currentItemKey: pause.currentItemKey,
  lastError: pause.lastError,
  job: { id: pause.job.id, status: pause.job.status, stage: pause.job.currentStage, itemKey: pause.job.currentItemKey, error: pause.job.error },
});

function fixture({ previousCommands = [], paused = true } = {}) {
  const calls = [];
  const created = [];
  const row = {
    id: 'director', novelId: 'novel', lane: 'auto_director', status: paused ? 'queued' : 'waiting_approval',
    pendingManualRecovery: paused, checkpointType: PAUSE.checkpointType, currentItemKey: PAUSE.currentItemKey,
    lastError: PAUSE.lastError, updatedAt: new Date(1000), cancelRequestedAt: null,
    seedPayloadJson: JSON.stringify({ autoExecution: { pipelineJobId: 'original' } }),
  };
  const expected = { kind: 'paused', novelId: 'novel', chapterId: 'chapter', updatedAt: new Date(900), payload: '{"workflowTaskId":"director"}' };
  class AppError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const prisma = {
    directorRunCommand: {
      findFirst: async () => null,
      findMany: async (query) => { calls.push(['recent-commands', query]); return previousCommands; },
      create: async (query) => { created.push(query.data); return { id: 'command', ...query.data }; },
    },
    novelWorkflowTask: { updateMany: async () => assert.fail('must preserve task CAS') },
    generationJob: { findUnique: async () => PAUSE.job },
    $transaction: async (fn) => {
      calls.push(['transaction']);
      return fn({
        generationJob: { findFirst: async () => ({ id: 'original' }) },
        novelWorkflowTask: { updateMany: async () => ({ count: 1 }) },
        directorRunCommand: { create: async (query) => { created.push(query.data); return { id: 'command', ...query.data }; } },
      });
    },
  };
  const { DirectorCommandService } = loadRuntimeSource('../director/commands/DirectorCommandService.ts', {
    "../workflowStepRuntime/directorWorkflowStepIds": require('../../dist/services/novel/director/workflowStepRuntime/directorWorkflowStepIds'),
    "@ai-novel/shared/types/novelFraming": {},
    "../../../../db/prisma": { prisma },
    "../../../../db/sqliteRetry": { withSqliteRetry: fn => fn() },
    "../../../../middleware/errorHandler": { AppError }, "../../workflow/NovelWorkflowService": {},
    "../runtime/novelDirectorHelpers": {}, "../../workflow/novelWorkflow.shared": { parseSeedPayload: JSON.parse },
    "./DirectorCommandServiceHelpers": helpers,
    "../../../../workers/TaskDispatcher": { taskDispatcher: { notify: () => calls.push(['notify']) } },
    "./leases/DirectorCommandLeaseService": {},
    "../recovery/planningRepair/planningRepairRecovery": { assertPlanningRepairResumeAllowed: () => {} },
    "../recovery/rangeCompletion": {},
    "../recovery/DirectorRecoveryConvergenceService": { createDirectorRecoveryConvergenceService: () => ({ converge: async () => ({ changed: false, actions: [] }) }) },
    "../../novelCoreShared": { logPipelineWarn: () => {} },
    "@ai-novel/shared/types/planningRepair/recovery": {},
    "../../production/recovery": { assertUnchangedPipelineRecoveryScope: scope.assertUnchangedPipelineRecoveryScope,
      createChapterPipelineRecoveryService: () => ({ prepareDirectorContinuation: async () => expected }) },
  });
  const service = new DirectorCommandService({ getTaskById: async () => row, getTaskByIdWithoutHealing: async () => row });
  service.recoverStaleLeases = async () => 0;
  return { service, row, calls, created };
}

function previous(pauseSignature, finishedAt) {
  const at = finishedAt ?? new Date();
  return { id: 'previous-command', taskId: 'director', commandType: 'approve_gate', status: 'succeeded',
    payloadJson: JSON.stringify({ continuationMode: 'resume', forceResume: true, resumePauseSignature: pauseSignature }),
    createdAt: at, updatedAt: at, finishedAt: at };
}

test('the first resume from a pause records its checkpoint signature', async () => {
  const f = fixture();
  await f.service.enqueueApproveGateCommand('director');
  assert.equal(f.created.length, 1);
  const payload = JSON.parse(f.created[0].payloadJson);
  assert.equal(payload.resumePauseSignature, signature());
  assert.equal(payload.forceResume, true);
});

test('a second resume of the identical pause is rejected instead of running another round', async () => {
  const f = fixture({ previousCommands: [previous(signature())] });
  await assert.rejects(f.service.enqueueApproveGateCommand('director'), error => {
    assert.equal(error.status, 409);
    assert.match(error.message, /刚刚执行过/);
    return true;
  });
  assert.equal(f.created.length, 0);
  assert.equal(f.calls.some(call => call[0] === 'transaction' || call[0] === 'notify'), false);
});

test('a deliberate retry after the duplicate window or a changed pause still runs', async () => {
  const old = fixture({ previousCommands: [previous(signature(), new Date(Date.now() - 10 * 60_000))] });
  await old.service.enqueueApproveGateCommand('director');
  assert.equal(old.created.length, 1);

  const changed = fixture({ previousCommands: [previous(signature({ ...PAUSE, lastError: '上一次不同的失败' }))] });
  await changed.service.enqueueApproveGateCommand('director');
  assert.equal(changed.created.length, 1);
});

test('a task that is not paused is never blocked by resume bookkeeping', async () => {
  const f = fixture({ paused: false });
  await f.service.enqueueContinueCommand('director', { forceResume: true });
  assert.equal(f.created.length, 1);
  assert.equal(JSON.parse(f.created[0].payloadJson).resumePauseSignature, undefined);
});
