const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(relative, imports) {
  const filename = path.resolve(__dirname, relative), exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
    if (!(name in imports)) throw new Error(`Unmocked boundary ${name}`); return imports[name];
  }, exports); return exports;
}
function fixture({ changed = false, rejected = false } = {}) {
  let reviews = 0, initial = 0, reads = 0;
  const candidate = { id: "p2", chapterOrder: 2, title: "chapter", summary: "summary", purpose: "purpose", taskSheet: "saved contract",
    sceneCards: "{}", targetWordCount: 2800, conflictLevel: 40, revealLevel: 30, payoffRefs: [] };
  const direction = { status: "available", candidate: { storyPrototype: { openingChain: [{ chapterOrder: 5 }] } } };
  const targetVolume = { id: "v", chapters: [candidate,
    { id: "p5", chapterOrder: 5, title: "later route", summary: "actual saved route" },
    { id: "p6", chapterOrder: 6, title: "outside opening", summary: "excluded" }] };
  const workspace = { novelId: "n", volumes: [targetVolume] };
  const generation = load("../src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts", {
    "@ai-novel/shared/types/chapterTaskSheetQuality": { assessChapterExecutionContractShape: () => ({ canEnterExecution: true }) },
    "@ai-novel/shared/types/chapterLengthControl": { normalizeChapterScenePlan: x => x, serializeChapterScenePlan: JSON.stringify },
    "../../../../prompting/core/promptRunner": { runStructuredPrompt: () => { initial++; throw new Error("unexpected initial generation"); } },
    "../../../../prompting/prompts/novel/volume/chapterDetail.prompts": {},
    "../../../../prompting/prompts/novel/volume/contextBlocks": {},
    "../ChapterTaskSheetQualityGateService": { ChapterTaskSheetQualityGateService: class { async assertCanEnterExecution(value, options) {
      reviews++; assert.equal(value.taskSheet, "saved contract"); assert.equal(JSON.parse(options.reviewContextJson).writtenEvidence.chapters[0].content, "刀具收缴，烙印胸口");
      const context = JSON.parse(options.reviewContextJson);
      assert.deepEqual(context.readonlyOpeningRoutes.map(route => route.id), ["p5", "p6"]);
      assert.equal(context.readonlyPlanningHorizon.authority, "readonly_planning_not_prose");
      assert.equal(context.readonlyOpeningRoutes[0].summary, "actual saved route");
      assert.equal(context.readonlyOpeningRoutes[0].authority, "readonly_planning_not_prose");
      assert.equal(context.planningContext.targetVolume.id, "v");
      if (rejected) throw new Error("semantic failure");
    } } },
    "../writtenEvidence": { loadPlanningWrittenEvidence: async () => ({ sourceFingerprint: changed && reads++ > 0 ? "changed" : "same", chapters: [{ content: "刀具收缴，烙印胸口" }] }) },
    "../planningPromises": { ...load("../src/services/novel/volume/planningPromises/planningHorizon.ts", {}), loadSelectedPlanningDirection: async () => direction },
  });
  const params = { promptInput: { novel: {}, workspace, targetVolume, targetChapter: candidate }, options: {} };
  return { generation, params, candidate, counts: () => ({ reviews, initial }) };
}
test("nonmanaged complete contract is reviewed with prose evidence and never regenerated", async () => {
  const h = fixture(); const result = await h.generation.generateChapterTaskSheetDetail(h.params);
  assert.equal(result.taskSheet, "saved contract"); assert.deepEqual(h.counts(), { reviews: 1, initial: 0 });
});
test("managed complete contract leaves semantic review to coordinator without duplicate call", async () => {
  const h = fixture(); await h.generation.generateChapterTaskSheetDetail({ ...h.params, options: { planningRepairManaged: true } });
  assert.deepEqual(h.counts(), { reviews: 0, initial: 0 });
});
test("unapproved or concurrently edited sources do not pass reused contract", async () => {
  for (const flags of [{ changed: true }, { rejected: true }]) {
    const h = fixture(flags); await assert.rejects(h.generation.generateChapterTaskSheetDetail(h.params));
    assert.deepEqual(h.counts(), { reviews: 1, initial: 0 });
  }
});
test("public nonmanaged readiness shortcut invokes same review before returning saved chapter", async () => {
  const h = fixture(); const row = { id: "c2", order: 2, title: "chapter", taskSheet: "saved contract", sceneCards: "{}" };
  const mod = load("../src/services/novel/volume/ChapterExecutionContractService.ts", {
    "@ai-novel/shared/types/chapterLengthControl": {}, "@ai-novel/shared/types/chapterTaskSheetQuality": {},
    "../../../db/prisma": { prisma: { chapter: { findFirst: async () => row } } },
    "../../styleEngine/styleContractText": { buildWriterStyleContractText: () => "style" },
    "./volumeGenerationOrchestrator": { generateVolumePlanDocument: () => { throw new Error("must not regenerate"); } },
    "./volumeWorkspacePersistence": {}, "./volumeWorkspaceDocument": {},
    "./chapterDetail/chapterExecutionContractReadiness": { inspectChapterExecutionContractReadiness: () => ({ canReuse: true }) },
    "./planningRepair/PlanningRepairCoordinator": {}, "./chapterDetail/chapterExecutionContractGeneration": h.generation,
  });
  const service = new mod.ChapterExecutionContractService({ ensureVolumeWorkspace: async () => h.params.promptInput.workspace,
    findVolumeChapterMatch: () => ({ volumeId: "v", volumeChapterId: "p2" }), styleBindingService: { resolveForGeneration: async () => null } });
  const result = await service.ensureChapterExecutionContract("n", "c2", {});
  assert.equal(result.taskSheet, row.taskSheet); assert.deepEqual(h.counts(), { reviews: 1, initial: 0 });
});
