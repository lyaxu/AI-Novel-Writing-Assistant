const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const raw = require('./fixtures/productionChoiceFailed.json');
class AppError extends Error { constructor(message, status) { super(message); this.status = status; } }
const auto = loadRuntimeSource('../director/automation/novelDirectorAutoExecution.ts', {
  '@ai-novel/shared/types/chapterLengthControl': require('@ai-novel/shared/types/chapterLengthControl'),
  '../../pipelineJobState': {}, '../../production/ChapterExecutionStageRunner': {}, './novelDirectorAutoExecutionFailure': {},
});
const recovery = loadRuntimeSource('../director/commands/productionExperience/preparedChoiceRecovery.ts', {
  '../../../../../middleware/errorHandler': { AppError }, '../../automation/novelDirectorAutoExecution': auto,
});
function dates(row) { return Object.fromEntries(Object.entries(row).map(([key,value]) => [key, key.endsWith('At') && value ? new Date(value) : value])); }
function fixture() {
  const task = dates(structuredClone(raw.task)); const steps = raw.steps.map(step => dates(structuredClone(step)));
  const chapters = structuredClone(raw.chapters); const events = [], writes = [], commands = [];
  const state = { active: null, execution: null, jobs: [], sideEffect: null, laterCall: null, otherTask: null, journal: null, cas: 1 };
  const tx = {
    directorRunCommand: { findFirst: async () => state.active },
    directorRuntimeExecution: { findFirst: async () => state.execution },
    generationJob: { findMany: async () => state.jobs }, novelSideEffectJob: { findFirst: async () => state.sideEffect },
    directorLlmUsageRecord: { findFirst: async () => state.laterCall }, directorStepRun: { findMany: async () => steps },
    chapter: { findMany: async () => chapters }, directorEvent: { create: async input => events.push(input.data) },
    chapterArtifactSyncCheckpoint: { findFirst: async () => state.journal },
    novelWorkflowTask: { findFirst: async () => state.otherTask, updateMany: async input => { writes.push(input); if (state.cas) Object.assign(task,input.data); return {count:state.cas}; } },
    novel: { update: async input => writes.push(input) },
  };
  const prisma = { novelWorkflowTask: { findUnique: async () => ({...task}), findMany: async () => [{...task}] },
    $transaction: async run => run(tx) };
  const { DirectorProductionExperienceService } = loadRuntimeSource('../director/commands/DirectorProductionExperienceService.ts', {
    '@ai-novel/shared/types/novelDirector': require('@ai-novel/shared/types/novelDirector'),
    '@ai-novel/shared/types/autoDirectorApproval': require('@ai-novel/shared/types/autoDirectorApproval'),
    '../../../../db/prisma': {prisma}, '../../../../middleware/errorHandler': {AppError},
    '../../workflow/novelWorkflow.shared': {parseSeedPayload: JSON.parse}, '../runtime/novelDirectorHelpers': {},
    './DirectorCommandService': {}, './productionExperience/preparedChoiceRecovery': recovery,
  });
  const service = new DirectorProductionExperienceService({enqueueContinueCommand: async (id,input) => {
    commands.push({id,input}); task.status='queued'; return {commandId:'resume-original'};
  }});
  return {task,steps,chapters,state,events,writes,commands,service,prisma};
}
test('actual failed choice preserves manuscript/planning and resumes same task across full 4-10 authorization', async () => {
  const f=fixture(), beforeChapters=JSON.stringify(f.chapters), beforeSteps=JSON.stringify(f.steps), beforeSeed=JSON.parse(f.task.seedPayloadJson);
  const result=await f.service.select(f.task.id,'professional'); const seed=JSON.parse(f.task.seedPayloadJson);
  assert.equal(result.workflowTaskId,raw.task.id); assert.equal(result.commandId,'resume-original');
  assert.deepEqual(seed.directorInput,beforeSeed.directorInput); assert.deepEqual(seed.takeover,beforeSeed.takeover);
  assert.deepEqual(seed.autoExecutionPlan,beforeSeed.directorInput.autoExecutionPlan);
  assert.equal(seed.autoExecution.startOrder,4); assert.equal(seed.autoExecution.endOrder,10);
  assert.equal(seed.autoExecution.totalChapterCount,7); assert.equal(seed.autoExecution.remainingChapterCount,7);
  assert.deepEqual(seed.autoExecution.remainingChapterOrders,[4,5,6,7,8,9,10]);
  assert.equal(f.task.lastError,null); assert.equal(f.task.finishedAt,null);
  assert.equal(f.events[0].type,'run_resumed');
  assert.equal(JSON.parse(f.events[0].metadataJson).retainedFailedStepIds.length,4);
  assert.equal(JSON.stringify(f.chapters),beforeChapters); assert.equal(JSON.stringify(f.steps),beforeSteps);
  await f.service.select(f.task.id,'professional'); assert.equal(f.commands.length,1);
});
for (const [label, mutate] of [
  ['cancelled', f=>f.task.status='cancelled'], ['cancelling', f=>f.task.cancelRequestedAt=new Date()],
  ['other active book task',f=>f.state.otherTask={id:'other'}], ['unknown production journal',f=>f.state.journal={status:'paused'}],
  ['active command',f=>f.state.active={id:'active'}], ['unknown execution',f=>f.state.execution={status:'unknown'}],
  ['active side effect',f=>f.state.sideEffect={status:'running'}], ['later model call',f=>f.state.laterCall={id:'call'}],
  ['unknown step',f=>f.steps[0].status='unknown'], ['unrelated failure',f=>f.steps[0].error='unknown response'],
  ['owned pipeline',f=>f.state.jobs.push({id:'existing',payload:JSON.stringify({workflowTaskId:f.task.id}),status:'failed',createdAt:new Date(0)})],
  ['post-gate pipeline',f=>f.state.jobs.push({id:'new',payload:'{}',status:'failed',createdAt:new Date()})],
  ['pending planning repair',f=>{const s=JSON.parse(f.task.seedPayloadJson);s.planningRepair={phase:'uncertain'};f.task.seedPayloadJson=JSON.stringify(s)}],
  ['missing settled checkpoint',f=>f.task.milestonesJson='[]'],
]) test(`explicit choice rejects ${label} before changes or dispatch`,async()=>{
  const f=fixture();mutate(f);const before=JSON.stringify(f.task);
  await assert.rejects(f.service.select(f.task.id,'professional'));
  assert.equal(f.writes.length,0);assert.equal(f.commands.length,0);assert.equal(f.events.length,0);assert.equal(JSON.stringify(f.task),before);
});
test('CAS conflict does not dispatch, retry against changed state, or write novel settings',async()=>{
 const f=fixture();f.state.cas=0;await assert.rejects(f.service.select(f.task.id,'professional'),/发生变化/);
 assert.equal(f.writes.length,1);assert.equal(f.events.length,0);assert.equal(f.commands.length,0);
 assert.equal(f.writes[0].where.status,'failed');assert.equal(f.writes[0].where.cancelRequestedAt,null);
 assert.equal(f.writes[0].where.seedPayloadJson,raw.task.seedPayloadJson);
});
test('choice detail/list preserve row checkpoint despite stale session and never heal on GET',async()=>{
 const f=fixture();const s=JSON.parse(f.task.seedPayloadJson);s.directorSession.checkpointType='chapter_batch_ready';f.task.seedPayloadJson=JSON.stringify(s);
 const workflow=loadRuntimeSource('../workflow/novelWorkflow.shared.ts',{'@ai-novel/shared/types/novelWorkflow':require('@ai-novel/shared/types/novelWorkflow')});
 const {NovelWorkflowTaskAdapter}=loadRuntimeSource('../../task/adapters/NovelWorkflowTaskAdapter.ts',{
  '../../../db/prisma':{prisma:f.prisma},'../../../middleware/errorHandler':{},
  '../../novel/director/commands/DirectorCommandService':{DirectorCommandService:class{}},
  '../../novel/director/automation/novelDirectorAutoExecutionFailure':{isSkippableAutoExecutionReviewFailure:()=>false},
  '../../novel/workflow/NovelWorkflowService':{NovelWorkflowService:class{healAutoDirectorTaskState(){assert.fail('GET cannot heal choice');}}},
  '../../novel/director/runtime/novelDirectorHelpers':{getDirectorLlmOptionsFromSeedPayload:()=>null},
  '../../novel/workflow/novelWorkflowRecoveryHeuristics':{isAutoDirectorRecoveryInProgress:()=>false},
  '../../novel/workflow/novelWorkflow.shared':workflow,
  '../taskSupport':{buildTaskRecoveryHint:()=>null,normalizeFailureSummary:x=>x},
  '../taskTokenUsageSummary':{toTaskTokenUsageSummary:()=>null},
  '../taskArchive':{getArchivedTaskIds:async()=>[],isTaskArchived:async()=>false},
  '../novelWorkflowDetailSteps':{buildNovelWorkflowDetailSteps:()=>[]},
  '../novelWorkflowExplainability':{buildWorkflowExplainability:()=>({displayStatus:'failed'})},
  '../novelWorkflowTaskSummary':{buildNovelWorkflowNextActionLabel:()=> '选择创作界面'},
  '../../novel/director/projections/rangeCompletion':{readIncompleteCompletedRangeProjection:async row=>row},
 });
 const adapter=new NovelWorkflowTaskAdapter(),before=JSON.stringify(f.task);
 for(let i=0;i<2;i++){
  const detail=await adapter.detail(f.task.id),list=await adapter.list({take:20});
  assert.equal(detail.checkpointType,'production_experience_required');assert.equal(detail.meta.checkpointType,detail.checkpointType);
  assert.equal(detail.meta.seedPayload.directorInput.autoExecutionPlan.endOrder,10);
  assert.equal(list[0].checkpointType,detail.checkpointType);assert.equal(detail.status,'failed');
 }
 assert.equal(JSON.stringify(f.task),before);assert.equal(f.writes.length,0);assert.equal(f.commands.length,0);
});
function continuation(f) {
 const workflow=loadRuntimeSource('../workflow/novelWorkflow.shared.ts',{'@ai-novel/shared/types/novelWorkflow':require('@ai-novel/shared/types/novelWorkflow')});
 const helpers=require('../../dist/services/novel/director/runtime/novelDirectorHelpers');
 const {NovelDirectorContinueRuntime}=loadRuntimeSource('../director/runtime/novelDirectorContinueRuntime.ts',{
  '@ai-novel/shared/types/novelDirector':require('@ai-novel/shared/types/novelDirector'),
  '@ai-novel/shared/types/planningRepair/recovery':require('@ai-novel/shared/types/planningRepair/recovery'),
  '../../workflow/novelWorkflow.shared':workflow,'./autoDirectorMemorySafety':{},'./novelDirectorErrors':{},
  './novelDirectorHelpers':helpers,'../recovery/novelDirectorRecovery':{},'./novelDirectorTakeoverRuntime':{},
  '../phases/novelDirectorExecutionNodeAdapters':{},'./directorRuntimeDefaults':{},'../../../../db/prisma':{prisma:{}},
  '../recovery/planningRepair/planningRepairRecovery':{assertPlanningRepairResumeAllowed:()=>{},readPlanningRepairSeed:()=>({})},
  '../automation/novelDirectorAutoExecution':auto,'../automation/novelDirectorAutoExecutionScopeRuntime':{},
  '../../production/recovery':{},'../../production/reliability':{},'../recovery/planningRepair':{},
 });
 const scheduled=[],executions=[];
 const runtime=new NovelDirectorContinueRuntime({
  workflowService:{getTaskById:async()=>({...f.task}),markTaskRunning:async(_id,input)=>{f.task.status='running';f.task.currentStage=input.stage;}},
  directorRuntime:{initializeRun:async()=>{},recordRunResumed:async()=>{}},
  continueCandidateStageTask:async()=>false,
  resolveAssetFirstRecovery:async()=>{throw new Error('must not redo prepared structured planning');},
  buildDirectorSeedPayload:(directorInput,novelId,extra)=>({directorInput,novelId,...extra}),
  autoExecutionRuntime:{runFromReady:async input=>executions.push(input)},
  scheduleBackgroundRun:(_id,fn)=>scheduled.push(fn),
  runDirectorPipeline:async()=>assert.fail('must not rerun structured pipeline'),
 });
 return {runtime,scheduled,executions};
}
test('actual saved choice to original ContinueRuntime enters bounded production without replaying prepared planning or historical failed nodes',async()=>{
 const f=fixture(), protectedChapters=JSON.stringify(f.chapters), failedHistory=JSON.stringify(f.steps);
 await f.service.select(f.task.id,'professional');
 const c=continuation(f);await c.runtime.continueTask(f.task.id,f.commands[0].input);
 assert.equal(c.scheduled.length,1);for(const run of c.scheduled)await run();
 assert.equal(c.executions.length,1);const entry=c.executions[0];
 assert.equal(entry.taskId,raw.task.id);assert.equal(entry.existingState.startOrder,4);assert.equal(entry.existingState.endOrder,10);
 assert.equal(entry.request.autoExecutionPlan.startOrder,4);assert.equal(entry.request.autoExecutionPlan.endOrder,10);
 assert.equal(entry.previousFailureMessage,null);assert.equal(entry.allowSkipReviewBlockedChapter,false);
 assert.equal(entry.existingPipelineJobId,null);assert.equal(entry.resumeCheckpointType,'chapter_batch_ready');
 assert.equal(JSON.stringify(f.chapters),protectedChapters);assert.equal(JSON.stringify(f.steps),failedHistory);
});
for(const [label,mutate] of [
 ['foreign task',s=>s.productionChoiceAuthorization.taskId='foreign'],
 ['changed scope',s=>s.directorInput.autoExecutionPlan.endOrder=100],
 ['missing explicit choice',s=>delete s.productionExperience],
 ['missing saved receipt',s=>delete s.productionChoiceAuthorization],
]) test(`prepared-choice shortcut rejects ${label}`,async()=>{
 const f=fixture();await f.service.select(f.task.id,'professional');const seed=JSON.parse(f.task.seedPayloadJson);mutate(seed);f.task.seedPayloadJson=JSON.stringify(seed);
 const c=continuation(f);await assert.rejects(c.runtime.continueTask(f.task.id,f.commands[0].input),/must not redo/);
 assert.equal(c.scheduled.length,0);assert.equal(c.executions.length,0);
});
