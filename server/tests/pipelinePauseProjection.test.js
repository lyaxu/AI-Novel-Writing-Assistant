const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })(name => mocks[name] ?? {}, exports);
  return exports;
}
let stored, job, command;
const prisma = {
  novelWorkflowTask: { findUnique: async () => stored },
  generationJob: { findUnique: async () => job },
  directorRunCommand: { findFirst: async () => command },
  directorRun: { findUnique: async () => ({ id: 'run' }) },
  directorStepRun: { findFirst: async () => ({ nodeKey: 'stale', status: 'running' }) },
};
const projection = load('../src/services/novel/director/recovery/pipelinePause/index.ts', {
  '../../../../../db/prisma': { prisma },
  '../../../workflow/novelWorkflow.shared': { buildNovelEditResumeTarget: input => input },
});
function setup() {
  command = { status: 'succeeded' };
  stored = { id: 'task', novelId: 'novel', lane: 'auto_director', status: 'queued', pendingManualRecovery: false,
    checkpointType: null, lastError: 'retained error', heartbeatAt: 'unchanged', seedPayloadJson: JSON.stringify({
      autoExecution: { pipelineJobId: 'job' }, directorSession: { isBackgroundRunning: true },
      planningRepair: { novelId: 'novel', key: 'repair', phase: 'reviewing', rounds: 1, maxRounds: 2,
        volumeId: 'volume', chapterId: 'chapter', recoveryAction: { requestId: 'authorized' } },
      planningRepairRecovery: { repairKey: 'repair', idempotencyKey: 'authorized', guidance: 'Review current plan', executionMode: 'review_existing', resumePhase: 'chapter_execution' },
    }) };
  job = { id: 'job', novelId: 'novel', status: 'queued', pendingManualRecovery: true, executionOwner: null, executionLeaseExpiresAt: null,
    payload: JSON.stringify({ workflowTaskId: 'task' }) };
}
test('owned suspended job exposes existing authorized recovery without mutating persistence or budget', async () => {
  setup(); const before = structuredClone(stored);
  const view = await projection.readPipelinePauseProjection(stored);
  assert.equal(view.status, 'waiting_approval'); assert.equal(view.pendingManualRecovery, true);
  assert.equal(view.checkpointType, 'step_review_required'); assert.equal(view.heartbeatAt, 'unchanged');
  const seed = JSON.parse(view.seedPayloadJson);
  assert.equal(seed.resumeTarget.stage, 'structured'); assert.equal(seed.directorSession.isBackgroundRunning, false);
  assert.deepEqual(seed.planningRepair, JSON.parse(before.seedPayloadJson).planningRepair);
  assert.deepEqual(stored, before); assert.equal(view.lastError, before.lastError);
});
test('active commands, cancellation, ownership gaps and leases cannot synthesize a pause', () => {
  for (const status of ['queued', 'leased', 'running']) {
    setup(); assert.equal(projection.projectPipelinePause(stored, job, { status }), stored);
  }
  for (const patch of [{ novelId: 'other' }, { status: 'succeeded' }, { payload: '{}' }, { payload: '{' }, { id: 'other' },
    { pendingManualRecovery: false }, { cancelRequestedAt: 'now' }, { executionOwner: 'worker' },
    { executionLeaseExpiresAt: '2000-01-01' }]) {
    setup(); assert.equal(projection.projectPipelinePause(stored, { ...job, ...patch }, command), stored);
  }
  for (const patch of [{ status: 'cancelled' }, { status: 'succeeded' }, { cancelRequestedAt: 'now' }, { lane: 'manual' }]) {
    setup(); const row = { ...stored, ...patch }; assert.equal(projection.projectPipelinePause(row, job, command), row);
  }
});
test('a newer terminal command cannot hide an older active command when projecting a pause', async () => {
  setup(); command = { status: 'running' };
  const original = prisma.directorRunCommand.findFirst;
  prisma.directorRunCommand.findFirst = async ({ where }) => {
    assert.deepEqual(where.status.in, ['queued', 'leased', 'running']);
    return command;
  };
  try {
    assert.equal(await projection.readPipelinePauseProjection(stored, { status: 'succeeded' }), stored);
  } finally { prisma.directorRunCommand.findFirst = original; }
});
test('unrelated pause preserves real checkpoint and source route without guessing a planning stage', () => {
  setup(); const seed = JSON.parse(stored.seedPayloadJson); seed.planningRepairRecovery.idempotencyKey = 'other';
  stored.seedPayloadJson = JSON.stringify(seed); stored.checkpointType = 'real_checkpoint'; stored.resumeTargetJson = 'original route';
  const view = projection.projectPipelinePause(stored, job, null);
  assert.equal(view.status, 'waiting_approval'); assert.equal(view.checkpointType, 'real_checkpoint');
  assert.equal(view.resumeTargetJson, 'original route'); assert.equal(view.currentItemKey, undefined);
  assert.equal(view.lastError, stored.lastError);
});
test('canonical reader overlays pause before suppressing stale active step', async () => {
  setup(); const before = structuredClone(stored);
  const { DirectorStateReader } = load('../src/services/novel/director/state/DirectorStateReader.ts', {
    '../../../../db/prisma': { prisma }, '../../workflow/novelWorkflow.shared': { parseSeedPayload: JSON.parse },
    '../recovery/pipelinePause': projection,
    '../runtime/ChapterExecutionProgressInspector': { ChapterExecutionProgressInspector: class {} },
  });
  const reader = new DirectorStateReader({ inspectNovel: async () => null });
  const view = await reader.readByTaskId('task');
  assert.equal(view.activeStep, null); assert.equal(view.runtime.status, 'waiting_approval');
  assert.equal(view.task.pendingManualRecovery, true); assert.deepEqual(stored, before);
});
test('status exposes the original authorized request for resuming, with no write or grant', async () => {
  setup(); const before = structuredClone(stored);
  const { PlanningRepairRecoveryService } = load('../src/services/novel/director/recovery/planningRepair/PlanningRepairRecoveryService.ts', {
    '../../../../../db/prisma': { prisma }, '../pipelinePause': projection,
    './planningRepairRecovery': { readPlanningRepairSeed: text => { const seed = JSON.parse(text); return { repair: seed.planningRepair, recovery: seed.planningRepairRecovery }; } },
    '@ai-novel/shared/types/planningRepair/recovery': { isPlanningRepairTaskPaused: row => row.status === 'waiting_approval' && row.pendingManualRecovery },
  });
  const view = await new PlanningRepairRecoveryService({}, {}).status('task');
  assert.equal(view.status, 'waiting_approval'); assert.equal(view.recoveryRequest.idempotencyKey, 'authorized');
  assert.equal(view.recoveryRequest.executionMode, 'review_existing'); assert.deepEqual(stored, before);
});
test('an exhausted or uncertain repair needs fresh source confirmation even if an old authorization remains', () => {
  for (const phase of ['waiting_confirmation', 'uncertain', 'technical_failed', 'committed']) {
    setup(); const seed = JSON.parse(stored.seedPayloadJson); seed.planningRepair.phase = phase;
    stored.seedPayloadJson = JSON.stringify(seed);
    const view = projection.projectPipelinePause(stored, job, null);
    assert.equal(view.pendingManualRecovery, true);
    assert.notEqual(view.currentItemKey, 'planning_repair_confirmation');
    assert.equal(JSON.parse(view.seedPayloadJson).planningRepair.phase, phase);
  }
});
