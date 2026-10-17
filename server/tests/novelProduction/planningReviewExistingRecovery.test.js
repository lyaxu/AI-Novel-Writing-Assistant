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
const imports = {
  "../../../../../../db/prisma": {}, "../../../../../../middleware/errorHandler": { AppError },
  "@ai-novel/shared/types/planningRepair/recovery": policy, "../../../../production/reliability": reliability,
  "../../../../production/recovery": require("../../dist/services/novel/production/recovery"),
  "../../../../volume/planningRepair/PlanningRepairStore": {}, "../planningRepairRecovery": seedTools,
  "../domain/reviewExistingAcknowledgement": boundary,
};
const { PlanningRepairReviewExistingService } = loadRuntimeSource("../director/recovery/planningRepair/application/PlanningRepairReviewExistingService.ts", imports);
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
  const seed = { planningRepair: repair, planningRepairRecovery: { repairKey: "repair", resumePhase: "chapter_execution" },
    planningRepairSnapshot: { snapshotToken: "source", candidateHash: "candidate-hash", eligibleChapterIds: ["plan-6"] },
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
  const store = { assertPipelineRecoverySnapshot: async (_tx, row) => {
    witnesses++;
    const saved = JSON.parse(row.seedPayloadJson);
    assert.equal(saved.planningRepair.pendingOperation, undefined);
    if (saved.planningRepairSnapshot.snapshotToken !== data.source || saved.planningRepairSnapshot.candidateHash !== data.candidateHash) {
      throw Object.assign(new Error("source/candidate drift"), { code: "PLANNING_REPAIR_CONFLICT" });
    }
  } };
  const service = new PlanningRepairReviewExistingService({ db, store, now: () => now });
  const pipeline = new PlanningRepairPipelineRecoveryService({ db, store, now: () => now });
  return { service, pipeline, get data() { return data; }, get writes() { return writes; }, get witnesses() { return witnesses; },
    state: () => JSON.parse(data.task.seedPayloadJson), editSeed: fn => { const s = JSON.parse(data.task.seedPayloadJson); fn(s); data.task.seedPayloadJson = JSON.stringify(s); },
    editJournal: fn => { const j = JSON.parse(data.journals[0].metadataJson); fn(j); data.journals[0].metadataJson = JSON.stringify(j); },
    fail: table => { failTable = table; }, active: () => { activeCommand = true; }, other: () => { otherJob = true; }, liveDirector: () => { liveDirector = true; },
    request: async (mode) => { const status = await service.status("task",mode); assert.equal(status.available, true); return { repairKey: "repair", token: status.token, idempotencyKey: "explicit-review" }; } };
}

for (const settled of [false,true]) test(`source review-existing ${settled ? "known rejected review" : "unknown preparation"} is read-only until explicit grant then reconnects original job`, async () => {
  const f = fixture({ settled }), before = clone(f.data), request = await f.request();
  assert.deepEqual(f.data,before); assert.equal(f.writes,0);
  await f.service.grant("task",request);
  assert.equal(f.data.task.pendingManualRecovery,true); assert.equal(f.data.job.pendingManualRecovery,true);
  const s = f.state(); assert.equal(s.planningRepair.recoveryAction.mode,"review_existing");
  assert.equal(s.planningRepair.rounds,0); assert.equal(s.planningRepair.maxRounds,2);
  assert.equal(s.planningRepair.candidateVersionId,"candidate"); assert.equal(s.planningRepair.pendingOperation,undefined);
  assert.deepEqual(s.autoExecution, JSON.parse(before.task.seedPayloadJson).autoExecution);
  assert.deepEqual(f.data.originalManuscripts,before.originalManuscripts);
  const archive = JSON.parse(f.data.journals[1].metadataJson);
  assert.equal(archive.steps["prepare.execution_contract"].status, settled ? "failed" : "unknown");
  assert.equal(archive.recoveryDecision?.kind, settled ? undefined : "acknowledge_unknown");
  const result = await f.pipeline.recover({ taskId: "task", novelId: "novel", recoveryKey: request.idempotencyKey });
  assert.equal(result.pipelineJobId,"job"); assert.equal(result.chapterId,"chapter-6");
  assert.equal(f.state().planningRepairPipelineRecovery.proof.source,"user_acknowledgement");
  assert.ok(f.witnesses >= 3);
});

test("same explicit click is idempotent across concurrent requests and replay", async () => {
  const f = fixture(), request = await f.request();
  const results = await Promise.all([f.service.grant("task",request), f.service.grant("task",request)]);
  assert.deepEqual(results.map(r => r.replayed).sort(),[false,true]);
  const before = clone(f.data); await f.service.grant("task",request); assert.deepEqual(f.data,before);
  await assert.rejects(f.service.grant("task",{...request, token:"changed"}),{statusCode:409});
});

for (const reason of ["source", "candidate", "job_owner", "job_lease", "job_cancel", "task_cancel", "written", "prepared", "partial", "other_unknown", "pending_repair", "window", "active_command", "other_job", "live_director", "stale_token"]) {
  test(`review-existing rejects ${reason} without partial authorization`, async () => {
    const f = fixture(), request = await f.request();
    if(reason === "source") f.data.source = "changed";
    if(reason === "candidate") f.data.candidateHash = "changed";
    if(reason === "job_owner") f.data.job.payload = JSON.stringify({workflowTaskId:"other"});
    if(reason === "job_lease") Object.assign(f.data.job,{executionOwner:"worker",executionLeaseExpiresAt:new Date(now+1)});
    if(reason === "job_cancel") f.data.job.cancelRequestedAt = new Date(now);
    if(reason === "task_cancel") f.data.task.cancelRequestedAt = new Date(now);
    if(reason === "written") f.data.chapter.content = "human edit";
    if(reason === "prepared") f.editJournal(j => { j.prepared = {}; });
    if(reason === "partial") f.editJournal(j => { j.partialText = "partial"; });
    if(reason === "other_unknown") f.editJournal(j => { j.steps.writer = {status:"unknown",external:true}; });
    if(reason === "pending_repair") f.editSeed(s => { s.planningRepair.pendingOperation.kind = "repair"; });
    if(reason === "window") f.editSeed(s => { s.directorInput.autoExecutionPlan.endOrder = 20; });
    if(reason === "active_command") f.active();
    if(reason === "other_job") f.other();
    if(reason === "live_director") f.liveDirector();
    if(reason === "stale_token") request.token = "stale";
    const before = clone(f.data); await assert.rejects(f.service.grant("task",request)); assert.deepEqual(f.data,before);
  });
}

for (const table of ["task","job","journal"]) test(`review-existing rolls back archive and acknowledgement on ${table} CAS loss`, async () => {
  const f=fixture(), request=await f.request(), before=clone(f.data); f.fail(table);
  await assert.rejects(f.service.grant("task",request)); assert.deepEqual(f.data,before);
});

test("acknowledgement archive cannot be modified to bypass pipeline recovery proof", async () => {
  const f=fixture(), request=await f.request(); await f.service.grant("task",request);
  const archive = JSON.parse(f.data.journals[1].metadataJson); archive.recoveryDecision.affectedSteps.push("writer");
  f.data.journals[1].metadataJson = JSON.stringify(archive);
  const before=clone(f.data);
  await assert.rejects(f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey}));
  assert.deepEqual(f.data,before);
});

for (const reason of ["source", "candidate", "round", "job_parent", "active_task"]) test(`a saved grant HTTP replay cannot reauthorize ${reason} drift`, async () => {
  const f=fixture(), request=await f.request(); await f.service.grant("task",request);
  if(reason==="source") f.data.source="changed";
  if(reason==="candidate") f.editSeed(s=>{s.planningRepair.candidateVersionId="replacement";});
  if(reason==="round") f.editSeed(s=>{s.planningRepair.rounds++;});
  if(reason==="job_parent") f.data.job.payload=JSON.stringify({workflowTaskId:"other"});
  if(reason==="active_task") { f.data.task.status="running"; f.data.task.pendingManualRecovery=false; }
  const before=clone(f.data); await assert.rejects(f.service.grant("task",request)); assert.deepEqual(f.data,before);
});

test("a conflicting archive slot rejects the grant before changing unknown outcome", async () => {
  const f=fixture(), request=await f.request();
  f.data.journals.push({...clone(f.data.journals[0]),contentHash:"pipeline:job:chapter-6:decision:explicit-review",metadataJson:"{}"});
  const before=clone(f.data); await assert.rejects(f.service.grant("task",request)); assert.deepEqual(f.data,before);
});

test("owner without lease expiry appearing after grant blocks original pipeline recovery", async () => {
  const f=fixture(), request=await f.request(); await f.service.grant("task",request);
  f.data.job.executionOwner="worker"; f.data.job.executionLeaseExpiresAt=null;
  const before=clone(f.data); await assert.rejects(f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey}));
  assert.deepEqual(f.data,before);
});

for (const endpoint of ["review-existing", "resume-policy"]) test(`HTTP ${endpoint} preview is read-only; explicit POST and retry after enqueue failure preserve one grant and archive`, async () => {
  const f=fixture({policyRecovery:true,qualityPause:endpoint==="resume-policy"}), routes=[]; let attempts=0;
  const { createPlanningRepairRouter } = loadRuntimeSource("../director/http/planningRepairRoutes.ts", {
    express:{Router:()=>({get:(...args)=>routes.push(["GET",...args]),post:(...args)=>routes.push(["POST",...args])})},
    zod:require("zod"), "../../../../middleware/validate":{validate:x=>x},
    "../recovery/planningRepair/PlanningRepairRecoveryService":{}, "../commands/DirectorCommandService":{},
    "../../../../middleware/errorHandler":{AppError}, "../recovery/planningRepair/planningRepairRecovery":seedTools,
    "../recovery/planningRepair/advice/PlanningRepairAdviceService":{},
    "../../volume/planningRepair/PlanningRepairStore":{}, "../recovery/planningRepair":{PlanningRepairReviewExistingService},
  });
  createPlanningRepairRouter({}, {enqueuePlanningRepairRecoveryCommand:async (...args)=>{
    assert.deepEqual(args,["task","repair","explicit-review"]); attempts++;
    if(attempts===1) throw new Error("command enqueue interrupted"); return {commandId:"one-command"};
  }}, {}, {}, f.service);
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
  assert.equal(f.state().planningRepair.recoveryAction.mode,endpoint==="resume-policy"?"resume_existing_policy":"review_existing");
  assert.equal(f.state().planningRepair.maxRounds,2);
});

for (const boundary of ["unknown", "rejected", "quality"]) test(`original policy ${boundary} keeps saved budget and source until explicit click then reconnects original pipeline`, async () => {
  const mode="resume_existing_policy", f=fixture({policyRecovery:true,settled:boundary==="rejected",qualityPause:boundary==="quality"});
  const before=clone(f.data), request=await f.request(mode);
  assert.deepEqual(f.data,before); assert.equal(f.writes,0);
  assert.equal((await f.service.status("task",mode)).remainingRounds,2);
  await f.service.grant("task",request,mode);
  assert.equal(f.state().planningRepair.rounds,0); assert.equal(f.state().planningRepair.maxRounds,2);
  assert.equal(f.state().planningRepair.recoveryAction.mode,mode);
  assert.deepEqual(f.state().autoExecution,JSON.parse(before.task.seedPayloadJson).autoExecution);
  assert.deepEqual(f.data.originalManuscripts,before.originalManuscripts);
  const granted=clone(f.data); await f.service.grant("task",request,mode); assert.deepEqual(f.data,granted);
  const result=await f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey});
  assert.equal(result.pipelineJobId,"job");
  assert.equal(f.state().planningRepairPipelineRecovery.proof.executionMode,mode);
});

for (const reason of ["exhausted","disabled","review_disabled","repair_disabled","copilot","changed_policy","cross_mode","source","candidate","other_unknown","lease"]) test(`original policy rejects ${reason} without authorizing or extending budget`, async () => {
  const mode="resume_existing_policy", f=fixture({policyRecovery:true}), request=await f.request(mode);
  if(reason==="exhausted") f.editSeed(s=>{s.planningRepair.rounds=2;});
  if(reason==="disabled") f.editSeed(s=>{s.autoExecution.enabled=false;});
  if(reason==="review_disabled") f.editSeed(s=>{s.autoExecution.autoReview=false;});
  if(reason==="repair_disabled") f.editSeed(s=>{s.autoExecution.autoRepair=false;});
  if(reason==="copilot") f.editSeed(s=>{s.directorInput.runMode="ai_copilot";});
  if(reason==="changed_policy") f.editSeed(s=>{s.directorInput.autoExecutionPlan.autoRepair=false;});
  if(reason==="cross_mode") request.token=(await f.request()).token;
  if(reason==="source") f.data.source="new";
  if(reason==="candidate") f.data.candidateHash="new";
  if(reason==="other_unknown") f.editJournal(j=>{j.steps.writer={status:"unknown",external:true};});
  if(reason==="lease") f.data.job.executionOwner="worker";
  const before=clone(f.data); await assert.rejects(f.service.grant("task",request,mode)); assert.deepEqual(f.data,before);
  assert.equal(f.state().planningRepair.maxRounds,2);
});

test("original-policy authorization cannot replay as review-only or survive later policy drift",async()=>{
  const mode="resume_existing_policy",f=fixture({policyRecovery:true}),request=await f.request(mode);
  await f.service.grant("task",request,mode);
  await assert.rejects(f.service.grant("task",request));
  f.editSeed(s=>{s.autoExecution.autoRepair=false;}); const before=clone(f.data);
  await assert.rejects(f.service.grant("task",request,mode));
  await assert.rejects(f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey}));
  assert.deepEqual(f.data,before);
});

for(const drift of ["repairBudget","usageBudget","range"]) test(`original-policy saved consent rejects ${drift} changes even if both current copies agree`,async()=>{
  const f=fixture({policyRecovery:true}),mode="resume_existing_policy",request=await f.request(mode);
  await f.service.grant("task",request,mode);
  f.editSeed(s=>{
    if(drift==="repairBudget") s.planningRepair.maxRounds=3;
    if(drift==="usageBudget") s.autoExecution.usageBudget.taskTokenLimit++;
    if(drift==="range") {s.autoExecution.endOrder=20;s.directorInput.autoExecutionPlan.endOrder=20;}
  });
  const before=clone(f.data);await assert.rejects(f.service.grant("task",request,mode));
  await assert.rejects(f.pipeline.recover({taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey}));
  assert.deepEqual(f.data,before);
});

test("status exposes the original consent token for enqueue retry without changing paused task",async()=>{
  const f=fixture({policyRecovery:true}),mode="resume_existing_policy",request=await f.request(mode);
  await f.service.grant("task",request,mode);
  const {PlanningRepairRecoveryService}=loadRuntimeSource("../director/recovery/planningRepair/PlanningRepairRecoveryService.ts",{
    "../../../../../db/prisma":{prisma:{novelWorkflowTask:{findUnique:async()=>f.data.task}}},
    "../../../../../middleware/errorHandler":{AppError},"../../../workflow/NovelWorkflowService":{},
    "../../../workflow/novelWorkflow.shared":{},"./planningRepairRecovery":seedTools,
    "../../../volume/planningRepair/PlanningRepairStore":{},"@ai-novel/shared/types/planningRepair/recovery":policy,
    "../pipelinePause":{readPipelinePauseProjection:async row=>row},
  });
  const before=clone(f.data),status=await new PlanningRepairRecoveryService({},{}).status("task");
  assert.equal(status.recoveryRequest.executionMode,mode);assert.equal(status.recoveryRequest.candidateRecoveryToken,request.token);
  assert.equal(status.pendingManualRecovery,true);assert.deepEqual(f.data,before);
});

for(const pipelineStatus of [undefined,"running","failed"]) test(`original-policy recovery tolerates its own pipeline status projection (${pipelineStatus}) while retaining consent`,async()=>{
  const f=fixture({policyRecovery:true}),mode="resume_existing_policy";
  f.editSeed(s=>{s.autoExecution.pipelineStatus=pipelineStatus;});
  const request=await f.request(mode);await f.service.grant("task",request,mode);
  const input={taskId:"task",novelId:"novel",recoveryKey:request.idempotencyKey};
  await f.pipeline.recover(input);const before=clone(f.data);
  await f.pipeline.recover(input);await f.service.grant("task",request,mode);
  assert.deepEqual(f.data,before);assert.equal(f.state().planningRepair.maxRounds,2);
});
