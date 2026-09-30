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
const schema = load("../../shared/types/chapterTaskSheetQuality.ts", { zod: require("zod"), "./chapterLengthControl.js": length });
const valid = { verdict: "usable", safeToSync: true, summary: "可执行", issues: [], repairGuidance: [], confidence: .9, loadRisk: "normal", recommendedHandling: "use_as_is" };
const output = () => ({ purpose: "核对账目", exclusiveEvent: "取得收据", endingState: "收据已核实", nextChapterEntryState: "带收据询问店主", conflictLevel: 20, revealLevel: 20, targetWordCount: 2200, mustAvoid: "不要提前结案", payoffRefs: [], taskSheet: "完成本次核对，保留店主解释入口。", sceneCards: [1,2,3].map(n=>({key:`s${n}`,title:"核对",purpose:"发现差异",mustAdvance:["查账"],mustPreserve:["未结案"],entryState:"有疑点",exitState:"取得线索",forbiddenExpansion:["勿结案"],targetWordCount:n===3?734:733})) });
function harness(responses) {
  const calls=[];
  const runner={runStructuredPrompt:async (input)=>{ calls.push(input); const response=responses.shift(); if(response instanceof Error)throw response; return {output:response}; }};
  const service=load("../src/services/novel/volume/ChapterTaskSheetQualityGateService.ts",{
    "@ai-novel/shared/types/chapterTaskSheetQuality":schema,
    "@ai-novel/shared/types/novel/planningPromises":{selectedPlanningPromiseIds:()=>[]},
    "../../../prompting/core/promptRunner":runner,
    "../../../prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts":{chapterTaskSheetQualityPrompt:{id:"quality"}},
  });
  const generation=load("../src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts",{
    "@ai-novel/shared/types/chapterTaskSheetQuality":schema,"@ai-novel/shared/types/chapterLengthControl":length,
    "../../../../prompting/core/promptRunner":runner,
    "../../../../prompting/prompts/novel/volume/chapterDetail.prompts":{volumeChapterExecutionContractPrompt:{id:"contract"}},
    "../../../../prompting/prompts/novel/volume/contextBlocks":{buildVolumeChapterDetailContextBlocks:()=>[]},
    "../ChapterTaskSheetQualityGateService":service,"../writtenEvidence":{},
    "../planningPromises":{projectPlanningHorizon:()=>({readonlyOpeningRoutes:[]})},
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
    "@langchain/core/messages":require("@langchain/core/messages"),
    "../../../core/renderContextBlocks":{renderSelectedContextBlocks:()=>""},
    "../../../../services/novel/volume/volumeGenerationSchemas":Object.fromEntries(["createChapterBoundarySchema","createChapterExecutionContractSchema","createChapterPurposeSchema","createChapterTaskSheetSchema"].map(k=>[k,()=>emptySchema])),
    "./contextBlocks":{},"../promptBudgetProfiles":{NOVEL_PROMPT_BUDGETS:{}},
  });
  const feedback=JSON.stringify({previousCandidate:{taskSheet:"保留有效设计"},qualityResult:{issues:[{id:"i",repairHint:"修正因果"}]}});
  const messages=assets.volumeChapterExecutionContractPrompt.render({detailMode:"task_sheet",contractRepairFeedback:feedback},{});
  assert.ok(messages.some(m=>typeof m.content==="string"&&m.content.includes(feedback)));
});
