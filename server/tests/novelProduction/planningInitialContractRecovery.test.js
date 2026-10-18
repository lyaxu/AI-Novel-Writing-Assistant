const test = require("node:test");
const assert = require("node:assert/strict");
require("./offlineBootstrap.cjs");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const reliability = require("../../dist/services/novel/production/reliability");
const policy = loadRuntimeSource(require("node:path").resolve(__dirname,"../../../shared/types/planningRepair/recovery.ts"), {});
class AppError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const seedTools = loadRuntimeSource("../director/recovery/planningRepair/planningRepairRecovery.ts", {
  "../../../../../middleware/errorHandler": { AppError }, "@ai-novel/shared/types/planningRepair/recovery": policy,
});
const boundary = loadRuntimeSource("../director/recovery/planningRepair/domain/reviewExistingAcknowledgement.ts", {
  "../../../../production/reliability": reliability,
  "@ai-novel/shared/types/planningRepair/recovery": policy,
});
const initialBoundary = loadRuntimeSource("../director/recovery/planningRepair/domain/initialContractAcknowledgement.ts", {
  "node:crypto": require("node:crypto"), "../../../../production/reliability": reliability,
  "./reviewExistingAcknowledgement": boundary,
});
const imports = {
  "../../../../../../db/prisma": {}, "../../../../../../middleware/errorHandler": { AppError },
  "@ai-novel/shared/types/planningRepair/recovery": policy, "../../../../production/reliability": reliability,
  "../../../../production/recovery": require("../../dist/services/novel/production/recovery"),
  "../../../../volume/planningRepair/PlanningRepairStore": {}, "../planningRepairRecovery": seedTools,
  "../domain/reviewExistingAcknowledgement": boundary, "../domain/initialContractAcknowledgement": initialBoundary,
};
const { PlanningRepairInitialContractService } = loadRuntimeSource("../director/recovery/planningRepair/application/PlanningRepairInitialContractService.ts", imports);
const { PlanningRepairPipelineRecoveryService } = loadRuntimeSource("../director/recovery/planningRepair/application/PlanningRepairPipelineRecoveryService.ts", {
  ...imports, "../domain/settledPipelinePause": loadRuntimeSource("../director/recovery/planningRepair/domain/settledPipelinePause.ts", { "node:crypto": require("node:crypto") }),
});
const now = Date.parse("2026-10-17T12:00:00Z");
const clone = structuredClone;
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
    }
    return JSON.stringify(row[key]) === JSON.stringify(value);
  });
}
function fixture({ settled = false, policyRecovery = false, qualityPause = false } = {}) {
  const chapter = { id: "chapter-6", novelId: "novel", order: 6, title: "six", content: "", taskSheet: "saved", sceneCards: "[]", expectation: null, targetWordCount: 3000 };
  const repair = { version: 1, key: "repair", novelId: "novel", volumeId: "volume", chapterId: "plan-6", chapterOrder: 6,
    rounds: 0, maxRounds: 2, phase: "technical_failed", candidateVersionId: "candidate", history: [], affectedChapterIds: ["plan-6"],
    pendingOperation: { kind: "review:plan-6", startedAt: "2026-10-17T09:01:01.762Z" } };
  const request = { entry: "pipeline", workflowTaskId: "task" };
  const journal = { version: 1, operationId: "pipeline:job:chapter-6", status: "paused", expiresAt: 0,
    token: "old", inputFingerprint: "input", request, requestFingerprint: reliability.productionFingerprint(request),
    expectedChapter: clone(chapter), expectedFingerprint: reliability.chapterFingerprint(chapter), values: {},
    error: "unknown", steps: { prepare: { status: "failed", external: false }, "prepare.contract": { status: "failed", external: false },
      "prepare.execution_contract": { status: "unknown", external: true, error: "invalid evidence" } } };
  if (settled) {
    repair.phase = "waiting_confirmation"; delete repair.pendingOperation;
    repair.history.push({ kind: "rejected_response", round: 0, promptId: "novel.volume.chapter_task_sheet_quality", output: { received: true } });
    Object.assign(journal.steps["prepare.execution_contract"], { status: "failed", planningPause: { version: 1,
      repairKey: repair.key, round: 0, candidateVersionId: "candidate", outcome: "settled" } });
  }
  delete repair.pendingOperation; delete repair.candidateVersionId;
  repair.phase = "waiting_confirmation"; repair.technicalError = "Invalid scene relationship";
  repair.history = [{kind:"rejected_response",round:0,promptId:"novel.volume.chapter_execution_contract",output:{scenes:[{key:"scene1"}]}}];
  Object.assign(journal.steps["prepare.execution_contract"],{status:"failed",planningPause:{version:1,repairKey:"repair",round:0,outcome:"settled"}});
  const seed = { planningRepair: repair, planningRepairRecovery: { repairKey: "repair", resumePhase: "chapter_execution" },
    planningRepairSnapshot: { snapshotToken: "source", eligibleChapterIds: ["plan-6"] },
    directorInput: { autoExecutionPlan: { mode: "chapter_range", startOrder: 4, endOrder: 10 } },
    autoExecution: { enabled: true, mode: "chapter_range", startOrder: 4, endOrder: 10, nextChapterOrder: 6, pipelineJobId: "job",
      completionProfile: { targetChapterCount: 100 }, usageBudget: { taskTokenLimit: 9000000 } } };
  if (policyRecovery) {
    seed.directorInput.runMode = "full_book_autopilot";
    seed.autoExecution.autoReview = true; seed.autoExecution.autoRepair = true;
    seed.directorInput.autoExecutionPlan.autoReview = true; seed.directorInput.autoExecutionPlan.autoRepair = true;
  }
  if (qualityPause) {
    repair.phase = "waiting_confirmation"; delete repair.pendingOperation;
    repair.history = [{ kind: "assessment", round: 0, result: { chapters: { "plan-6": { status: "needs_confirmation", safeToSync: false } } } }];
    Object.assign(journal.steps["prepare.execution_contract"], { status: "failed", planningPause: { version: 1,
      repairKey: repair.key, round: 0, candidateVersionId: "candidate", outcome: "settled" } });
  }
  let data = { task: { id: "task", novelId: "novel", lane: "auto_director", status: "waiting_approval", pendingManualRecovery: true,
    cancelRequestedAt: null, attemptCount: 1, startedAt: new Date(now - 900000), updatedAt: new Date(now - 600000), seedPayloadJson: JSON.stringify(seed) },
    job: { id: "job", novelId: "novel", status: "failed", pendingManualRecovery: true, cancelRequestedAt: null,
      executionOwner: null, executionLeaseExpiresAt: null, currentItemKey: chapter.id, startOrder: 6, endOrder: 6,
      currentStage: "preparing", updatedAt: new Date(now - 600000), payload: JSON.stringify({ workflowTaskId: "task" }) },
    chapter, journals: [{ novelId: "novel", chapterId: chapter.id, contentHash: "active", artifactType: "production_execution", syncMode: "journal", status: "paused", metadataJson: JSON.stringify(journal) }],
    originalManuscripts: Array.from({ length: 5 }, (_, i) => `synthetic preserved chapter ${i + 1}`), source: "source", candidateHash: "candidate-hash" };
  if (qualityPause) data.job.pendingManualRecovery = false;
  let failTable, activeCommand = false, otherJob = false, liveDirector = false, writes = 0, witnesses = 0;
  const update = (row, table, where, patch) => { if (failTable === table || !matches(row, where)) return { count: 0 }; writes++; Object.assign(row,patch); return { count: 1 }; };
  const tx = {
    novelWorkflowTask: { findUnique: async () => data.task, updateMany: async ({ where, data: patch }) => update(data.task, "task", where, patch) },
    chapter: { findFirst: async () => data.chapter },
    generationJob: { findUnique: async ({ where }) => where.id === data.job.id ? data.job : null,
      findFirst: async () => otherJob ? { id: "other" } : null,
      updateMany: async ({ where, data: patch }) => update(data.job, "job", where, patch) },
    directorRunCommand: { findFirst: async () => activeCommand ? { id: "active" } : null },
    directorRuntimeExecution: { findFirst: async () => liveDirector ? { id: "runtime" } : null },
    chapterArtifactSyncCheckpoint: {
      findUnique: async ({ where }) => data.journals.find(row => matches(row, where.novelId_chapterId_contentHash_artifactType_syncMode)) ?? null,
      upsert: async ({ where, create }) => { if (!data.journals.some(row => matches(row, where.novelId_chapterId_contentHash_artifactType_syncMode))) { writes++; data.journals.push(clone(create)); } },
      updateMany: async ({ where, data: patch }) => { const row = data.journals.find(row => matches(row,where)); return row ? update(row, "journal", where,patch) : { count: 0 }; },
    },
  };
  let pending = Promise.resolve();
  const db = { $transaction: fn => {
    const run = pending.then(async () => { const before = clone(data); try { return await fn(tx); } catch (error) { data = before; throw error; } });
    pending = run.catch(() => {}); return run;
  } };
  const store = { assertInitialContractRecoverySnapshot: async (_tx, row) => {
    witnesses++;
    const saved = JSON.parse(row.seedPayloadJson);
    assert.equal(saved.planningRepair.pendingOperation, undefined);
    if (saved.planningRepairSnapshot.snapshotToken !== data.source || saved.planningRepair.candidateVersionId) {
      throw Object.assign(new Error("source/candidate drift"), { code: "PLANNING_REPAIR_CONFLICT" });
    }
  } };
  const service = new PlanningRepairInitialContractService({ db, store, now: () => now });
  const pipeline = new PlanningRepairPipelineRecoveryService({ db, store, now: () => now });
  return { service, pipeline, get data() { return data; }, get writes() { return writes; }, get witnesses() { return witnesses; },
    state: () => JSON.parse(data.task.seedPayloadJson), editSeed: fn => { const s = JSON.parse(data.task.seedPayloadJson); fn(s); data.task.seedPayloadJson = JSON.stringify(s); },
    editJournal: fn => { const j = JSON.parse(data.journals[0].metadataJson); fn(j); data.journals[0].metadataJson = JSON.stringify(j); },
    fail: table => { failTable = table; }, active: () => { activeCommand = true; }, other: () => { otherJob = true; }, liveDirector: () => { liveDirector = true; },
    request: async (mode) => { const status = await service.status("task",mode); assert.equal(status.available, true); return { repairKey: "repair", token: status.token, idempotencyKey: "explicit-review" }; } };
}


test("initial rejection GET is mutation-free and explicit grant reconnects the same job without candidate or semantic budget",async()=>{
 const f=fixture(), before=clone(f.data), status=await f.service.status("task");
 assert.equal(status.available,true);assert.equal(status.initialGenerationAttempts,null);assert.equal(status.correctionCalls,1);
 assert.deepEqual(f.data,before);assert.equal(f.writes,0);
 const request=await f.request();await f.service.grant("task",request);
 const state=f.state();assert.equal(state.planningRepair.candidateVersionId,undefined);assert.equal(state.planningRepair.rounds,0);assert.equal(state.planningRepair.maxRounds,2);
 assert.equal(state.planningRepair.initialGenerationAttempts,undefined);assert.equal(state.planningRepair.initialContractCorrection.allowedAttempts,1);
 assert.equal(f.data.task.pendingManualRecovery,true);assert.deepEqual(f.data.originalManuscripts,before.originalManuscripts);
 assert.throws(()=>seedTools.assertPlanningRepairResumeAllowed(f.data.task.seedPayloadJson),{statusCode:409});
 seedTools.assertPlanningRepairResumeAllowed(f.data.task.seedPayloadJson,request.idempotencyKey);
 const result=await f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey});
 assert.equal(result.pipelineJobId,"job");assert.equal(f.state().planningRepairPipelineRecovery.proof.kind,"explicit_initial_contract");
 const prepared=clone(f.data);await f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey});
 await f.service.grant("task",request);assert.deepEqual(f.data,prepared);
});
test("parallel same-token grant and lost enqueue retry do not grant another correction",async()=>{
 const f=fixture(), request=await f.request();
 const results=await Promise.all([f.service.grant("task",request),f.service.grant("task",request)]);
 assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);assert.equal(f.data.journals.length,2);
 assert.equal(f.state().planningRepair.initialContractCorrection.allowedAttempts,1);
 await assert.rejects(f.service.grant("task",{...request,idempotencyKey:"another"}),{statusCode:409});
});
for(const reason of ["source","candidate","output","pending","receipt","unknown","prepared","partial","written","lease","owner_without_expiry","task_cancel","job_cancel","other_job","live_director","active_command","range","stale_token","other_prompt","invalid_budget"]){
 test(`initial correction rejects ${reason} with no partial writes`,async()=>{
  const f=fixture(), request=await f.request();
  if(reason==="source")f.data.source="changed";
  if(reason==="candidate")f.editSeed(s=>s.planningRepair.candidateVersionId="candidate");
  if(reason==="output")f.editSeed(s=>s.planningRepair.history[0].output.scenes=[]);
  if(reason==="pending")f.editSeed(s=>s.planningRepair.pendingOperation={kind:"initial_generation",startedAt:"today"});
  if(reason==="receipt")f.editJournal(j=>j.steps["prepare.execution_contract"].planningPause.outcome="unknown");
  if(reason==="unknown")f.editJournal(j=>j.steps["prepare.execution_contract"].status="unknown");
  if(reason==="prepared")f.editJournal(j=>j.prepared={saved:true});
  if(reason==="partial")f.editJournal(j=>j.partialText="some prose");
  if(reason==="written")f.data.chapter.content="some prose";
  if(reason==="lease")Object.assign(f.data.job,{executionOwner:"worker",executionLeaseExpiresAt:new Date(now+10000)});
  if(reason==="owner_without_expiry")f.data.job.executionOwner="worker";
  if(reason==="task_cancel")f.data.task.cancelRequestedAt=new Date(now);
  if(reason==="job_cancel")f.data.job.cancelRequestedAt=new Date(now);
  if(reason==="other_job")f.other();if(reason==="live_director")f.liveDirector();if(reason==="active_command")f.active();
  if(reason==="range")f.editSeed(s=>s.autoExecution.endOrder=12);
  if(reason==="stale_token")request.token="stale";
  if(reason==="other_prompt")f.editSeed(s=>s.planningRepair.history[0].promptId="novel.volume.chapter_task_sheet_quality");
  if(reason==="invalid_budget")f.editSeed(s=>s.planningRepair.initialContractCorrection={attempts:0,allowedAttempts:1});
  const before=clone(f.data);await assert.rejects(f.service.grant("task",request));assert.deepEqual(f.data,before);
 });
}
for(const table of ["task","job","journal"])test(`initial grant ${table} CAS failure rolls back archive and budget`,async()=>{
 const f=fixture(), request=await f.request(), before=clone(f.data);f.fail(table);await assert.rejects(f.service.grant("task",request));assert.deepEqual(f.data,before);
});
test("failed one-shot correction requires a fresh response token and explicit extra one-call grant",async()=>{
 const f=fixture(), old=await f.request();await f.service.grant("task",old);
 f.editSeed(s=>{s.planningRepair.phase="waiting_confirmation";s.planningRepair.initialContractCorrection.attempts=1;
  s.planningRepair.history.push({kind:"rejected_response",round:0,promptId:"novel.volume.chapter_execution_contract",output:{stillInvalid:true}});
  s.planningRepairRecovery={repairKey:"repair",resumePhase:"chapter_execution"};});
 await assert.rejects(f.service.grant("task",old));
 const request={...await f.request(),idempotencyKey:"new-consent"};assert.notEqual(request.token,old.token);
 await f.service.grant("task",request);assert.equal(f.state().planningRepair.initialContractCorrection.allowedAttempts,2);
 assert.equal(f.state().planningRepair.initialContractCorrection.attempts,1);assert.equal(f.state().planningRepair.maxRounds,2);
});
test("post-grant response drift and consumed correction cannot be replayed",async()=>{
 for(const change of [s=>s.planningRepair.history[0].output={changed:true},s=>s.planningRepair.initialContractCorrection.attempts=1]){
 const f=fixture(),request=await f.request();await f.service.grant("task",request);f.editSeed(change);const before=clone(f.data);
 await assert.rejects(f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey}));
 await assert.rejects(f.service.grant("task",request));assert.deepEqual(f.data,before);
 }
});
test("initial HTTP strict POST saves grant before enqueue; lost enqueue retries same grant",async()=>{
  const f=fixture(),routes=[];let attempts=0;const endpoint="initial-contract";
  const { createPlanningRepairRouter } = loadRuntimeSource("../director/http/planningRepairRoutes.ts", {
    express:{Router:()=>({get:(...args)=>routes.push(["GET",...args]),post:(...args)=>routes.push(["POST",...args])})},
    zod:require("zod"), "../../../../middleware/validate":{validate:x=>x},
    "../recovery/planningRepair/PlanningRepairRecoveryService":{}, "../commands/DirectorCommandService":{},
    "../../../../middleware/errorHandler":{AppError}, "../recovery/planningRepair/planningRepairRecovery":seedTools,
    "../recovery/planningRepair/advice/PlanningRepairAdviceService":{},
    "../../volume/planningRepair/PlanningRepairStore":{}, "../recovery/planningRepair":{PlanningRepairReviewExistingService:class{},PlanningRepairInitialContractService},
  });
  createPlanningRepairRouter({}, {enqueuePlanningRepairRecoveryCommand:async (...args)=>{
    assert.deepEqual(args,["task","repair","explicit-review"]); attempts++;
    if(attempts===1) throw new Error("command enqueue interrupted"); return {commandId:"one-command"};
  }}, {}, {}, {}, f.service);
  async function invoke(method,body) {
    const route=routes.find(r=>r[0]===method && r[1]===`/:id/planning-repair/${endpoint}`);
    if(body) route[2].body.parse(body);
    let result,error,status=200; const response={status:n=>{status=n;return response;},json:x=>{result=x;}};
    await route.at(-1)({params:{id:"task"},body},response,e=>{error=e;}); if(error) throw error; return {status,result};
  }
  const before=clone(f.data); const preview=await invoke("GET"); assert.equal(preview.result.data.available,true); assert.deepEqual(f.data,before);
  const request={repairKey:"repair",token:preview.result.data.token,idempotencyKey:"explicit-review"};
  await assert.rejects(invoke("POST",{...request,executionMode:"repair_then_review"})); assert.deepEqual(f.data,before);
  await assert.rejects(invoke("POST",request),/command enqueue interrupted/);
  assert.equal(f.data.task.pendingManualRecovery,true); const granted=clone(f.data);
  const result=await invoke("POST",request); assert.equal(result.status,202); assert.equal(result.result.data.replayed,true);
  assert.equal(result.result.data.command.commandId,"one-command"); assert.deepEqual(f.data,granted); assert.equal(f.data.journals.length,2);
  assert.equal(f.state().planningRepair.recoveryAction.mode,"retry_initial_contract");
  assert.equal(f.state().planningRepair.maxRounds,2);
});
for(const output of ["{ incomplete but fully returned",null,false,0])test(`settled initial rejected value ${JSON.stringify(output)} remains correctable without pretending it is a candidate`,async()=>{
 const f=fixture();f.editSeed(s=>{s.planningRepair.history[0].output=output;});
 const request=await f.request();await f.service.grant("task",request);
 const result=await f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey});assert.equal(result.pipelineJobId,"job");
 assert.equal(f.state().planningRepair.candidateVersionId,undefined);
});
test("missing rejected output is not a complete response",async()=>{const f=fixture();f.editSeed(s=>delete s.planningRepair.history[0].output);assert.equal((await f.service.status("task")).available,false);});

for(const key of ["provider","model","temperature","guidance","styleProfileId","taskStyleProfileId","styleIntentSummary","postGenerationStyleReviewEnabled","issuePolicy","issuePolicySource","issueGovernanceVersion","completionProfile","autoExecutionPlan","candidate","startupPreparation","directorInput"])
 test(`initial consent rejects stable generation input ${key} drift after grant`,async()=>{
  const f=fixture(),request=await f.request();await f.service.grant("task",request);f.editSeed(s=>{s[key]={changed:true};});const before=clone(f.data);
  await assert.rejects(f.service.grant("task",request));await assert.rejects(f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey}));assert.deepEqual(f.data,before);
 });
for(const value of [null,"0",-1,3,1.5])test(`corrupt known initial count ${JSON.stringify(value)} is unavailable, never reset to zero`,async()=>{
 const f=fixture();f.editSeed(s=>s.planningRepair.initialGenerationAttempts=value);const before=clone(f.data);
 assert.equal((await f.service.status("task")).available,false);assert.deepEqual(f.data,before);
});
test("correction count overflow is refused before granting budget",async()=>{
 const f=fixture();f.editSeed(s=>s.planningRepair.initialContractCorrection={attempts:Number.MAX_SAFE_INTEGER,allowedAttempts:Number.MAX_SAFE_INTEGER});
 assert.equal((await f.service.status("task")).available,false);assert.equal(f.writes,0);
});

test("composition: saved initial rejection grants once, reconnects original job, corrects canonical contract, reviews and commits",async()=>{
 const f=fixture(),originalJob=clone(f.data.job),request=await f.request(),rejected=clone(f.state().planningRepair.history[0].output);
 await f.service.grant("task",request);await f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey});
 const length=require("../../../shared/dist/types/chapterLengthControl.js"),quality=require("../../../shared/dist/types/chapterTaskSheetQuality.js");
 const workspace=require("../../dist/services/novel/volume/volumeWorkspaceDocument.js"),promises=require("../../dist/services/novel/volume/planningPromises");
 const gateModule=require("../../dist/services/novel/volume/ChapterTaskSheetQualityGateService.js");
 const assets=require("../../dist/prompting/prompts/novel/volume/planningRepair.prompts.js");
 const detailAsset=require("../../dist/prompting/prompts/novel/volume/chapterDetail.prompts.js");
 const {buildPrimaryProseCitationCatalog}=require("../../dist/prompting/prompts/novel/volume/evidence/primaryProseCitationCatalog.js");
 const writtenEvidence={chapters:[{chapterId:"previous",order:5,content:"她保管着两份证明，还没有决定是否向委员会提出申请。"}]};
 const evidenceId=buildPrimaryProseCitationCatalog(JSON.stringify({writtenEvidence}),6).sources[0].excerpts[0].evidenceId;
 const target={id:"plan-6",volumeId:"volume",chapterOrder:6,title:"提出申请",summary:"提交证明并核对答复",targetWordCount:3000,payoffRefs:[],taskSheet:null,sceneCards:null};
 const document=workspace.buildVolumeWorkspaceDocument({novelId:"novel",source:"volume",volumes:[{id:"volume",sortOrder:1,title:"申请",status:"active",openPayoffs:[],chapters:[target]}]});
 const wire={purpose:"提交证明并核对答复",exclusiveEvent:"首次提交申请",endingState:"已得知下一步",nextChapterEntryState:"带着反馈准备补件",conflictLevel:30,revealLevel:20,targetWordCount:3000,mustAvoid:"不能假装申请已获准",payoffRefs:[],requiredElements:["提交申请"],taskSheet:"提出申请，核对材料，取得反馈。",
 readerExperience:{readerQuestion:"申请如何推进",promisedReward:"取得反馈",rewardLevel:"partial",protagonistWant:"取得答复",primaryResistance:"需要核对",keyTurn:"收到回应",emotionalShift:"谨慎",informationReveal:"所需补件",netChange:"进入下一阶段",inheritedHookResponsibilities:[],endingHook:"补件能否完成"},
 stateClaims:[{id:"held",subject:"她",predicate:"保管两份证明",temporalScope:"prior",modality:"fact",source:{kind:"written_prose",evidenceIds:[evidenceId]}}],
 sceneCards:[1,2,3].map(i=>({key:`s${i}`,title:"申请",purpose:"核实下一步",mustAdvance:["作出选择"],mustPreserve:[],forbiddenExpansion:[],targetWordCount:1000,resistance:"需核查",turn:"回应",emotionalShift:"谨慎",readerValue:"推进",
 causality:{actor:"她",choice:"提出申请",motive:"弄清条件",prerequisites:[{claimIds:[i===1?"held":`result${i-1}`]}],stateTransition:{beforeClaimIds:[i===1?"held":`result${i-1}`],entryClaims:[],actionClaims:[{id:`choice${i}`,subject:"她",predicate:`作出第${i}步选择`,modality:"intention"}],afterClaims:[{id:`result${i}`,subject:"她",predicate:`取得第${i}步反馈`,modality:"outcome"}]},resistanceResponse:"核对材料",outcomeMechanism:"给出指引",resultingConstraints:[]}})),neighborEventUse:[],mustAvoidConflicts:[]};
 const events=[];let session,commits=0,paid=0;
 const runner={runStructuredPrompt:async input=>{
  assert.equal(f.state().planningRepair.initialContractCorrection.attempts,1,"durable budget precedes model boundary");paid++;events.push("initial-correction");
  assert.deepEqual(JSON.parse(input.promptInput.contractRepairFeedback).rejectedResponse,rejected);
  const parsed=input.asset.outputSchema.parse(clone(wire));return {output:input.asset.postValidate(parsed,input.promptInput,{})};
 }};
 const generation=loadRuntimeSource("../volume/chapterDetail/chapterExecutionContractGeneration.ts",{
  "@ai-novel/shared/types/chapterTaskSheetQuality":quality,"@ai-novel/shared/types/chapterLengthControl":length,
  "../../../../prompting/core/promptRunner":runner,"../../../../prompting/prompts/novel/volume/chapterDetail.prompts":detailAsset,
  "../../../../prompting/prompts/novel/volume/contextBlocks":require("../../dist/prompting/prompts/novel/volume/contextBlocks.js"),
  "../ChapterTaskSheetQualityGateService":gateModule,"../writtenEvidence":{},"../planningPromises":promises,
  "./chapterContractGuardTrace":{recordChapterContractGuardEvent:async()=>{}},
 });
 const {PlanningRepairCoordinator}=loadRuntimeSource("../volume/planningRepair/PlanningRepairCoordinator.ts",{
  "node:crypto":require("node:crypto"),"@ai-novel/shared/types/chapterLengthControl":length,"@ai-novel/shared/types/planningRepair/recovery":policy,
  "../../../../prompting/core/promptRunner":runner,"../../../../prompting/prompts/novel/volume/planningRepair.prompts":assets,
  "../ChapterTaskSheetQualityGateService":gateModule,"../volumeWorkspaceDocument":workspace,"./PlanningRepairStore":{},
  "./planningRepairDomain":require("../../dist/services/novel/volume/planningRepair/planningRepairDomain.js"),"../planningPromises":promises,
  "./domain/reviewIssueHistory":require("../../dist/services/novel/volume/planningRepair/domain/reviewIssueHistory.js"),
 });
 // Persistence double mirrors candidate creation and writes every coordinator state into the same durable seed.
 const store={begin:async()=>session={state:clone(f.state().planningRepair),baselineDocument:document,inputFingerprint:"source",eligibleChapterIds:["plan-6"]},
  save:async(s,state,candidate)=>{s.state=clone(state);if(candidate){s.candidate=clone(candidate);s.state.candidateVersionId="validated-candidate";events.push("save-candidate");}
   f.editSeed(seed=>seed.planningRepair=clone(s.state));},
  commit:async(s,candidate)=>{assert.equal(s.state.quality.chapters["plan-6"].status,"passed");assert.equal(s.state.quality.window.usable,true);commits++;
   s.state.phase="committed";f.editSeed(seed=>seed.planningRepair=clone(s.state));events.push("commit");return candidate;}};
 const gate=new gateModule.ChapterTaskSheetQualityGateService(async({candidate})=>{
  events.push("semantic-review");assert.equal(session.state.candidateVersionId,"validated-candidate");
  const cards=JSON.parse(candidate.sceneCards);assert.ok(cards.stateClaims.length===7);assert.ok(cards.scenes[0].causality.stateTransition.actionClaimIds.length);
  assert.equal(cards.scenes[0].causality.stateTransition.actionClaims,undefined,"wire declarations must not reach the canonical review");
  return {verdict:"usable",safeToSync:true,summary:"通过",issues:[],repairGuidance:[],confidence:.9,loadRisk:"normal",recommendedHandling:"use_as_is"};
 });
 const invoke=async({asset,promptInput})=>{assert.equal(asset.id,"novel.volume.planning_repair_review");events.push("window-review");
  const value=asset.outputSchema.parse({usable:true,safeToSync:true,requiresUserDecision:false,summary:"通过",issues:[]});return {output:asset.postValidate?asset.postValidate(value,promptInput,{}):value};};
 const result=await new PlanningRepairCoordinator(store,gate,invoke).run({document,volumeId:"volume",chapterId:"plan-6",writtenEvidence,
  options:{taskId:"task",provider:"deepseek",model:"offline"},context:{novel:{}},generateInitial:async(before,seed)=>{
   assert.deepEqual(seed,{output:rejected,validationError:"Invalid scene relationship"});return generation.generateChapterTaskSheetDetail({onBeforeModelCall:before,initialRejectedResponse:seed,
    promptInput:{novel:{title:"离线申请",characters:[]},workspace:document,targetVolume:document.volumes[0],targetChapter:document.volumes[0].chapters[0],writtenEvidence,detailMode:"task_sheet"},options:{planningRepairManaged:true}});
  }});
 assert.equal(commits,1);assert.equal(paid,1);assert.deepEqual(events,["initial-correction","save-candidate","semantic-review","window-review","commit"]);
 assert.equal(f.state().planningRepair.phase,"committed");assert.equal(f.state().planningRepair.rounds,0);assert.equal(f.state().planningRepair.maxRounds,2);
 assert.equal(f.state().planningRepair.pendingOperation,undefined);assert.equal(f.state().planningRepair.initialContractCorrection.attempts,1);
 assert.equal(f.data.job.id,originalJob.id);assert.equal(f.state().autoExecution.pipelineJobId,originalJob.id);assert.equal(f.data.chapter.content,"");
 assert.ok(result.volumes[0].chapters[0].sceneCards);assert.equal(f.state().planningRepairPipelineRecovery.proof.kind,"explicit_initial_contract");
});
