const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports) {
  const filename = path.resolve(__dirname, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
    if (!(name in imports)) throw new Error(`Unmocked dependency: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
const length = require("../../shared/dist/types/chapterLengthControl.js");
const reliability = load("../src/services/novel/production/reliability/types.ts", { "node:crypto": require("node:crypto") });
const schema = load("../../shared/types/chapterTaskSheetQuality.ts", { zod: require("zod"), "./novel/planningReviewDecision.js": require("../../shared/dist/types/novel/planningReviewDecision.js"), "./chapterLengthControl.js": length });
const valid = { verdict: "usable", safeToSync: true, summary: "可执行", issues: [], repairGuidance: [], confidence: .9, loadRisk: "normal", recommendedHandling: "use_as_is" };
const output = () => ({ purpose: "核对账目", exclusiveEvent: "取得收据", endingState: "收据已核实", nextChapterEntryState: "带收据询问店主", conflictLevel: 20, revealLevel: 20, targetWordCount: 2200, mustAvoid: "不要提前结案", payoffRefs: [], taskSheet: "完成本次核对，保留店主解释入口。", sceneCards: [1,2,3].map(n=>({key:`s${n}`,title:"核对",purpose:"发现差异",mustAdvance:["查账"],mustPreserve:["未结案"],entryState:"有疑点",exitState:"取得线索",forbiddenExpansion:["勿结案"],targetWordCount:n===3?734:733})) });
function harness(responses, validatePlanningStateSources=()=>{}) {
  const calls=[];
  const runner={runStructuredPrompt:async (input)=>{ calls.push(input); const response=responses.shift(); if(response instanceof Error)throw response; return {output:response}; }};
  const service=load("../src/services/novel/volume/ChapterTaskSheetQualityGateService.ts",{
    "../production/reliability": reliability,
    "@ai-novel/shared/types/chapterTaskSheetQuality":schema,
    "@ai-novel/shared/types/novel/planningPromises":{selectedPlanningPromiseIds:()=>[]},
    "../../../prompting/core/promptRunner":runner,
    "../../../prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts":{chapterTaskSheetQualityPrompt:{id:"quality"},validatePlanningStateSources},
    "../../settings/storyCraftContractContext":{loadStoryCraftContractBlock:async()=>null},
  });
  const generation=load("../src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts",{
    "@ai-novel/shared/types/chapterTaskSheetQuality":schema,"@ai-novel/shared/types/chapterLengthControl":length,
    "../../../../prompting/core/promptRunner":runner,
    "../../../../prompting/prompts/novel/volume/chapterDetail.prompts":{volumeChapterExecutionContractPrompt:{id:"contract"}},
    "../../../../prompting/prompts/novel/volume/contextBlocks":{buildVolumeChapterDetailContextBlocks:()=>[]},
    "../../../../prompting/prompts/novel/promptBudgetProfiles":{PLANNING_OUTPUT_TOKEN_BUDGET:8192},
    "@ai-novel/shared/types/storyPlanningFramework":require("../../shared/dist/types/storyPlanningFramework.js"),
    "../ChapterTaskSheetQualityGateService":service,"../writtenEvidence":{},
    "../planningPromises":{projectPlanningHorizon:()=>({readonlyOpeningRoutes:[]})},
    // The contract guard trace writes to the chapter row; these tests assert retry/routing
    // behaviour, not persistence, so it is stubbed out rather than hitting the database.
    "./chapterContractGuardTrace":{recordChapterContractGuardEvent:async()=>{}},
    "../../../settings/storyCraftContractContext":{appendStoryCraftContractBlock:async (blocks)=>blocks},
  });
  const chapter={id:"c",chapterOrder:2,title:"查账",summary:"账目有疑点",payoffRefs:[]};
  const params={promptInput:{novel:{},workspace:{novelId:"n",volumes:[]},targetVolume:{id:"v",chapters:[chapter]},targetChapter:chapter,detailMode:"task_sheet"},options:{}};
  return {calls,service,generation,params};
}
function malformed(kind="post_validate_failed") { return Object.assign(new Error("Quote absent from current candidate"),{promptQualityFailureKind:kind}); }

test("invalid reviewer output retries the identical candidate without regenerating its contract",async()=>{
  const h=harness([output(),malformed(),valid]);
  await h.generation.generateChapterTaskSheetDetail(h.params);
  assert.deepEqual(h.calls.map(c=>c.asset.id),["contract","quality","quality"]);
  assert.strictEqual(h.calls[1].promptInput.candidate,h.calls[2].promptInput.candidate);
  assert.match(h.calls[2].promptInput.validationFeedback,/Quote absent/);
});

test("review wrapper preserves only validated completed post-validation failures", async () => {
  const receipt = { promptId: "novel.volume.chapter_task_sheet_quality", promptVersion: "v18", output: { summary: "Full but invalid answer" },
    validationError: "Quote absent", semanticRetryAttempts: 0, maxSemanticRetryAttempts: 0, repairAttempts: 0 };
  const confirmed = Object.assign(malformed(), { code: "PROMPT_POST_VALIDATION_FAILED", completedPromptResponse: receipt });
  const h = harness([output(), confirmed, confirmed]);
  await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params), error => {
    assert.equal(error.code, "PROMPT_POST_VALIDATION_FAILED");
    assert.strictEqual(error.originalError, confirmed);
    assert.strictEqual(reliability.completedPromptResponseFromError(error), receipt);
    return true;
  });
  for (const source of [
    new Error("transport unknown"),
    Object.assign(malformed(), { code: "LLM_OUTPUT_LIMIT", completedPromptResponse: receipt }),
    Object.assign(malformed(), { code: "PROMPT_POST_VALIDATION_FAILED" }),
    Object.assign(malformed(), { code: "PROMPT_POST_VALIDATION_FAILED", completedPromptResponse: { ...receipt, maxSemanticRetryAttempts: 1 } }),
    Object.assign(malformed(), { code: "PROMPT_POST_VALIDATION_FAILED", completedPromptResponse: { ...receipt, repairAttempts: -1 } }),
  ]) {
    const wrapped = new h.service.ChapterTaskSheetQualityReviewError(source);
    assert.equal(wrapped.code, undefined);
    assert.equal(reliability.completedPromptResponseFromError(wrapped), undefined);
    assert.strictEqual(wrapped.originalError, source);
  }
});
test("exhausted reviewer schema failures do not regenerate or approve the contract",async()=>{
  const h=harness([output(),malformed("schema_repair_failed"),malformed("schema_repair_failed")]);
  await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params),h.service.ChapterTaskSheetQualityReviewError);
  assert.deepEqual(h.calls.map(c=>c.asset.id),["contract","quality","quality"]);
});
test("verified repairable findings carry the complete candidate and issue result into one bounded repair",async()=>{
  const assessment={...valid,verdict:"repairable",safeToSync:false,recommendedHandling:"repair_contract",issues:[{id:"continuity",severity:"high",target:"semantic",summary:"核对前缺少收据来源",repairHint:"补齐收据取得过程"}],repairGuidance:["先取得收据"]};
  const h=harness([output(),assessment,output(),valid]);
  await h.generation.generateChapterTaskSheetDetail(h.params);
  assert.deepEqual(h.calls.map(c=>c.asset.id),["contract","quality","contract","quality"]);
  const feedback=JSON.parse(h.calls[2].promptInput.contractRepairFeedback);
  assert.deepEqual(feedback.previousCandidate,h.calls[1].promptInput.candidate);
  assert.deepEqual(feedback.qualityResult.issues,assessment.issues);
  const exhausted=harness([output(),assessment,output(),assessment]);
  await assert.rejects(exhausted.generation.generateChapterTaskSheetDetail(exhausted.params),exhausted.service.ChapterTaskSheetQualityGateError);
  assert.equal(exhausted.calls.length,4);
});
test("managed director repair retains its external review and persisted budget ownership",async()=>{
  const h=harness([output()]);h.params.options.planningRepairManaged=true;
  await h.generation.generateChapterTaskSheetDetail(h.params);
  assert.deepEqual(h.calls.map(c=>c.asset.id),["contract"]);
});
test("unexpected source-validator failures do not buy candidate repair or masquerade as quality findings",async()=>{
  const programmingError=new TypeError("unexpected canonical adapter failure");
  const h=harness([output(),output()],()=>{throw programmingError;});
  await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params),error=>error===programmingError);
  assert.equal(h.calls.length,1);
  const invalidSource=Object.assign(new Error("prior evidence ID is stale"),{code:"CHAPTER_CONTRACT_RELATIONSHIP_INVALID"});
  const known=harness([output(),output()],()=>{throw invalidSource;});
  await assert.rejects(known.generation.generateChapterTaskSheetDetail(known.params),error=>{
    assert.equal(error.result.issues[0].id,"state_claim_source_invalid");return true;
  });
  assert.equal(known.calls.length,2);
});
test("contract relationship correction includes the complete rejected response and structured diagnostics",async()=>{
  const rejected={sceneCards:[{key:"s1",causality:{stateTransition:{actionClaimIds:["wrong"]}}}],stateClaims:[{id:"wrong",source:{phase:"entry"}}]};
  const issues=[{path:"sceneCards[0].causality.stateTransition.actionClaimIds",expected:"action",actual:"entry"}];
  const failure=Object.assign(malformed(),{completedPromptResponse:{output:rejected,validationError:"wrong phase"},cause:{issues}});
  const h=harness([failure,output()]);h.params.options.planningRepairManaged=true;
  let reserved=0;h.params.onBeforeModelCall=async()=>{reserved++;};
  await h.generation.generateChapterTaskSheetDetail(h.params);
  const feedback=JSON.parse(h.calls[1].promptInput.contractRepairFeedback);
  assert.deepEqual(feedback.rejectedResponse,rejected);assert.deepEqual(feedback.relationshipIssues,issues);
  assert.equal(reserved,2);assert.equal(h.calls.length,2);
});
test("initial rejected-response recovery buys one correction and cannot silently regenerate",async()=>{
  const seed={output:{sceneCards:[{key:"retained-scene"}],taskSheet:"保留全部有效设计"},validationError:"invalid relationship"};
  const failure=Object.assign(malformed(),{completedPromptResponse:{output:{sceneCards:[]},validationError:"still invalid"}});
  const h=harness([failure,output()]);h.params.options.planningRepairManaged=true;h.params.initialRejectedResponse=seed;
  let reserved=0;h.params.onBeforeModelCall=async()=>{reserved++;};
  await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params),error=>error===failure);
  assert.deepEqual(JSON.parse(h.calls[0].promptInput.contractRepairFeedback).rejectedResponse,seed.output);
  assert.equal(reserved,1);assert.equal(h.calls.length,1);
  const success=harness([output()]);success.params.options.planningRepairManaged=true;success.params.initialRejectedResponse=seed;
  await success.generation.generateChapterTaskSheetDetail(success.params);assert.equal(success.calls.length,1);
});
test("missing completed response and output-limit errors never purchase a blind contract retry",async()=>{
  for(const failure of [malformed(),Object.assign(malformed(),{code:"LLM_OUTPUT_LIMIT",completedPromptResponse:{output:{},validationError:"truncated"}})]){
    const h=harness([failure,output()]);h.params.options.planningRepairManaged=true;
    await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params),error=>error===failure);
    assert.equal(h.calls.length,1);
  }
});
test("definitely completed malformed JSON retains full text for one contextual correction",async()=>{
  const failure=Object.assign(new Error("malformed JSON"),{name:"StructuredOutputError",category:"malformed_json",rejectedOutput:{rawContent:'{"purpose":"保留原始完整输出", BROKEN}',finishReason:"stop"}});
  const h=harness([failure,output()]);h.params.options.planningRepairManaged=true;
  await h.generation.generateChapterTaskSheetDetail(h.params);
  assert.equal(JSON.parse(h.calls[1].promptInput.contractRepairFeedback).rejectedResponse,failure.rejectedOutput.rawContent);
  assert.equal(h.calls[0].options.disableFallbackModel,true);assert.equal(h.calls[0].options.transportRetryCount,0);
  for(const item of [ {...failure,category:"output_limit"}, {...failure,rejectedOutput:{...failure.rejectedOutput,finishReason:"length"}}, {...failure,category:"transport_error"} ]){
    const original=Object.assign(new Error("not a completed contract"),item);
    assert.strictEqual(h.generation.preserveCompletedContractParseFailure(original),original);
  }
});
test("replan and transport failures cannot start local semantic repair",async()=>{
  const h=harness([output(),{...valid,verdict:"unusable",safeToSync:false,recommendedHandling:"replan_window",issues:[],repairGuidance:["需跨卷调整"]}]);
  await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params),h.service.ChapterTaskSheetQualityGateError);
  assert.equal(h.calls.length,2);
  const transport=harness([output(),new Error("connection closed")]);
  await assert.rejects(transport.generation.generateChapterTaskSheetDetail(transport.params),/connection closed/);
  assert.equal(transport.calls.length,2);
});
test("current revision replaces only duplicate current plan slots, preserving original promises and other chapters",()=>{
  const h=harness([]), candidate={chapterId:"c",taskSheet:"新合同",sceneCards:"新场景"};
  const context={planningContext:{targetVolume:{chapters:[{id:"c",taskSheet:"旧合同"},{id:"other",taskSheet:"另一章"}]}},readonlyOpeningRoutes:[{id:"c",taskSheet:"旧路线"}],selectedPlanningDirection:{candidate:{taskSheet:"原始承诺"}},writtenEvidence:{chapters:[{id:"c",content:"已写原文"}]}};
  const original=JSON.stringify(context);
  const projected=JSON.parse(h.service.projectCurrentQualityCandidate(candidate,original));
  assert.equal(projected.planningContext.targetVolume.chapters[0].taskSheet,"新合同");
  assert.equal(projected.readonlyOpeningRoutes[0].taskSheet,"新合同");
  assert.deepEqual(projected.planningContext.targetVolume.chapters[1],context.planningContext.targetVolume.chapters[1]);
  assert.deepEqual(projected.selectedPlanningDirection,context.selectedPlanningDirection);
  assert.deepEqual(projected.writtenEvidence,context.writtenEvidence);
  assert.equal(JSON.stringify(context),original);
});
test("repair feedback remains in the contract prompt even when the context budget selects no optional blocks",()=>{
  const emptySchema={};
  const assets=load("../src/prompting/prompts/novel/volume/chapterDetail.prompts.ts",{
    zod:require("zod"),
    "../../../../llm/generatedContentSchema":{preserveGeneratedContentConstraints:x=>x},
    "./contracts/sceneOwnershipProtocol":{sceneOwnershipRules:[],sceneOwnershipCorrectionRule:"",sceneOwnershipExampleNote:"",createTaskSheetWireExample:()=>({}),createExecutionContractWireExample:()=>({})},
    "@langchain/core/messages":require("@langchain/core/messages"),
    "../../../core/renderContextBlocks":{renderSelectedContextBlocks:()=>""},
    "../../../../services/novel/volume/volumeGenerationSchemas":Object.fromEntries(["createChapterBoundarySchema","createChapterExecutionContractSchema","createChapterPurposeSchema","createChapterTaskSheetSchema","createChapterExecutionContractWireSchema","createChapterTaskSheetWireSchema"].map(k=>[k,()=>emptySchema])),
    "./evidence/stateClaimBinding":{},
    "./contextBlocks":{},"../promptBudgetProfiles":{NOVEL_PROMPT_BUDGETS:{}},
  });
  const feedback=JSON.stringify({previousCandidate:{taskSheet:"保留有效设计"},qualityResult:{issues:[{id:"i",repairHint:"修正因果"}]}});
  const messages=assets.volumeChapterExecutionContractPrompt.render({detailMode:"task_sheet",contractRepairFeedback:feedback},{});
  assert.ok(messages.some(m=>typeof m.content==="string"&&m.content.includes(feedback)));
});
