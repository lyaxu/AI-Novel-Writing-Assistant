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
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })(name => {
    if (!(name in imports)) throw new Error(`Unmocked boundary: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
const promises = load("../../shared/types/novel/planningPromises.ts", { zod: require("zod"),
  "./bookStoryFoundation.js": load("../../shared/types/novel/bookStoryFoundation.ts", { zod: require("zod") }),
});
const quality = load("../../shared/types/chapterTaskSheetQuality.ts", { zod: require("zod"), "./chapterLengthControl.js": require("../../shared/dist/types/chapterLengthControl.js") });
const chapterEvidence = load("../src/prompting/prompts/novel/volume/evidence/chapterEvidence.ts", {});
const promiseEvidence = load("../src/prompting/prompts/novel/volume/evidence/planningPromiseEvidence.ts", {
  "@ai-novel/shared/types/novel/planningPromises": promises, "./chapterEvidence": chapterEvidence,
});
const issueProjection = load("../src/prompting/prompts/novel/volume/evidence/issueCheckProjection.ts", { "./chapterEvidence": chapterEvidence });
const newIssueEvidence = load("../src/prompting/prompts/novel/volume/evidence/newIssueEvidence.ts", { "./chapterEvidence": chapterEvidence });
const { chapterTaskSheetQualityPrompt: prompt } = load("../src/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.ts", {
  "@langchain/core/messages": require("@langchain/core/messages"), zod: require("zod"),
  "@ai-novel/shared/types/chapterTaskSheetQuality": quality,
  "./evidence/chapterEvidence": chapterEvidence, "./evidence/planningPromiseEvidence": promiseEvidence, "./evidence/issueCheckProjection": issueProjection,
  "./evidence/newIssueEvidence": newIssueEvidence,
});
const candidate = { chapterOrder: 2, summary: "通过交换药物赢得初步信任" };
const source = { status: "available", sourceTaskId: "task", fingerprint: "source-1", candidate: {
  id: "chosen", sellingPoint: "用专业技能建立关系", protagonistPath: "从独行到相互照应",
  hookStrategy: "先建立冲突，再取得阶段回报", progressionLoop: "选择、代价与回报推进", endingDirection: "建立互信",
  storyPrototype: { protagonistWant: "活下去", opposition: "追赶者", difficultChoice: "是否冒险帮助他人", distinctiveEngine: "付出与互助",
    earlyPayoff: "获得初步信任和必要补给", appealRisk: "避免反复逃跑",
    openingChain: [{ chapterOrder: 2, action: "交换药物", resistance: "彼此不信任", choice: "先交出资源", consequence: "陌生人提供帮助", payoff: "关系从戒备变为互助", nextQuestion: "能否再次合作" }] },
} };
const context = (extra = {}) => JSON.stringify({ selectedPlanningDirection: source, ...extra });
const assessment = checks => ({ verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is", summary: "通过", issues: [], repairGuidance: [], confidence: 0.9, issueChecks: [], promiseChecks: checks, refinements: [] });
function checks() {
  const index = chapterEvidence.buildChapterEvidenceIndex(source.candidate);
  return promises.selectedPlanningPromiseIds(source).map(sourceId => {
    const sourcePath = [...index.leaves.keys()].find(key => key === sourceId || key.startsWith(sourceId + "."));
    return { sourceId, scope: "current_chapter", status: "preserved", handoffStatus: "not_needed", sourceEvidence: [{ sourcePath, quote: index.leaves.get(sourcePath) }],
      candidateEvidence: [{ sourcePath: "summary", quote: candidate.summary }], contextEvidence: [], explanation: "通过资源交换推进信任，保持同等回报价值。", repairHint: "" };
  });
}

test("selected source loads only from the matching director seed and its fingerprint follows user direction", async () => {
  const calls = []; let seed = { candidate: source.candidate, storyMacroPlan: { sellingPoint: "不得替代用户选择" } };
  const facade = load("../src/services/novel/volume/planningPromises/index.ts", {
    "node:crypto": require("node:crypto"), "@ai-novel/shared/types/novel/planningPromises": promises, "./planningHorizon": {},
    "../../../../db/prisma": { prisma: { novelWorkflowTask: { findFirst: async args => { calls.push(args); return { id: "task", seedPayloadJson: JSON.stringify(seed) }; } } } },
  });
  const first = await facade.loadSelectedPlanningDirection("novel", "task");
  assert.deepEqual(calls[0].where, { novelId: "novel", lane: "auto_director", id: "task" });
  assert.equal(first.status, "available"); assert.equal(first.candidate.storyPrototype.openingChain[0].payoff, "关系从戒备变为互助");
  assert.equal(first.candidate.hookStrategy, source.candidate.hookStrategy);
  assert.equal(first.candidate.progressionLoop, source.candidate.progressionLoop);
  seed.candidate = { ...source.candidate, sellingPoint: "新的用户确认方向" };
  assert.notEqual((await facade.loadSelectedPlanningDirection("novel", "task")).fingerprint, first.fingerprint);
  seed = { storyMacroPlan: { sellingPoint: "不得反推" } };
  assert.equal((await facade.loadSelectedPlanningDirection("novel", "task")).status, "missing");
});

test("fresh quality output requires promise checks; old saved assessments remain compatible", () => {
  const old = assessment(undefined);
  assert.equal(quality.aiChapterTaskSheetQualityAssessmentSchema.safeParse(old).success, true);
  assert.equal(prompt.outputSchema.safeParse(old).success, false);
  assert.equal(prompt.outputSchema.safeParse(assessment(checks())).success, true);
});

test("expected source IDs force opening and payoff coverage; exact evidence cannot come from another source", () => {
  const output = assessment(checks()); const input = { candidate, reviewContextJson: context() };
  assert.equal(prompt.postValidate(output, input), output);
  assert.throws(() => prompt.postValidate(assessment(checks().slice(0, -1)), input), /every selected source/);
  const duplicate = checks(); duplicate[1] = duplicate[0];
  assert.throws(() => prompt.postValidate(assessment(duplicate), input), /every selected source/);
  const invented = checks(); invented[0].sourceEvidence[0].quote = "凭空编造的确认方向";
  assert.throws(() => prompt.postValidate(assessment(invented), input), /exact selected-source/);
});

test("equivalent adaptation can pass without requiring the exact original action or fixed chapter number", () => {
  const value = checks(); value.at(-1).status = "adapted";
  const output = prompt.postValidate(assessment(value), { candidate, reviewContextJson: context() });
  assert.equal(quality.mapSemanticAssessmentToQualityGate(output, "ai_copilot").status, "passed");
});

test("selected source accepts its exact context prefix but rejects guessed prefixes and paraphrases", () => {
  const value = checks();
  for (const check of value) for (const evidence of check.sourceEvidence) evidence.sourcePath = `selectedPlanningDirection.candidate.${evidence.sourcePath}`;
  assert.doesNotThrow(() => prompt.postValidate(assessment(value), { candidate, reviewContextJson: context() }));
  for (const prefix of ["candidate.", "context.selectedPlanningDirection.candidate.", "selectedPlanningDirection.candidateExtra."]) {
    const wrong = checks(); wrong[0].sourceEvidence[0].sourcePath = prefix + wrong[0].sourceEvidence[0].sourcePath;
    assert.throws(() => prompt.postValidate(assessment(wrong), { candidate, reviewContextJson: context() }), /exact selected-source/);
  }
  value[0].sourceEvidence[0].quote = "专业技能促成了人际关系";
  assert.throws(() => prompt.postValidate(assessment(value), { candidate, reviewContextJson: context() }), /exact selected-source/);
});

test("lost relationship/payoff and vague opening postponement enter existing automatic repair even if AI says usable", () => {
  for (const status of ["dropped", "insufficient", "deferred"]) {
    const value = checks(); Object.assign(value.at(-1), { status, scope: "opening_sequence", candidateEvidence: [], contextEvidence: [], repairHint: "恢复关系由戒备转互助的具体行动与回报" });
    const result = quality.mapSemanticAssessmentToQualityGate(assessment(value), "full_book_autopilot");
    assert.equal(result.status, "repairable"); assert.equal(result.safeToSync, false); assert.equal(result.canEnterExecution, false);
    assert.match(result.repairGuidance.join(" "), /戒备转互助/); assert.equal(result.promiseChecks.at(-1).status, status);
  }
});

test("a concrete opening handoff needs real neighboring evidence; long-term book promise is not due in chapter two", () => {
  const value = checks(); const current = value.at(-1);
  Object.assign(current, { status: "deferred", handoffStatus: "covered", scope: "opening_sequence", candidateEvidence: [],
    contextEvidence: [{ sourcePath: "readonlyNext.summary", quote: "完成互助交换并建立信任" }], explanation: "因已写负伤事实改在相邻章完成，当前章先维持接触。" });
  const output = assessment(value);
  const reviewContextJson = context({ readonlyNext: { chapterOrder: 3, summary: "完成互助交换并建立信任" } });
  prompt.postValidate(output, { candidate, reviewContextJson });
  assert.equal(quality.mapSemanticAssessmentToQualityGate(output, "ai_copilot").status, "passed");
  assert.throws(() => prompt.postValidate(output, { candidate, reviewContextJson: context() }), /absent/);
  Object.assign(current, { scope: "book_arc", contextEvidence: [], explanation: "试图把开篇降为长期承诺" });
  assert.throws(() => prompt.postValidate(output, { candidate, reviewContextJson }), /cannot be reclassified/);
  Object.assign(current, { status: "preserved", handoffStatus: "not_needed", scope: "opening_sequence", candidateEvidence: [{ sourcePath: "summary", quote: candidate.summary }] });
  Object.assign(value[0], { status: "deferred", handoffStatus: "covered", scope: "book_arc", candidateEvidence: [], explanation: "这是全书技能成长方向，开篇只需建立方向而非完成全部目标。" });
  prompt.postValidate(output, { candidate, reviewContextJson });
  assert.equal(quality.mapSemanticAssessmentToQualityGate(output, "ai_copilot").status, "needs_confirmation");
});

test("not-yet-due opening nodes stay in source context but do not force unplanned chapter five into a chapter two review", () => {
  const extended = structuredClone(source);
  extended.candidate.storyPrototype.openingChain.push({ ...extended.candidate.storyPrototype.openingChain[0], chapterOrder: 5, payoff: "第五章的后续兑现" });
  const reviewContextJson = JSON.stringify({ selectedPlanningDirection: extended, readonlyOpeningRoutes: [{ chapterOrder: 5, summary: "第五章有明确互助回报" }] });
  const evidence = promiseEvidence.planningPromiseEvidenceContext(reviewContextJson, 2);
  assert.ok(!evidence.sourceIds.includes("storyPrototype.openingChain[1]"));
  assert.equal(evidence.sourceIndex.leaves.get("storyPrototype.openingChain[1].payoff"), "第五章的后续兑现");
  assert.equal(evidence.contextIndex.leaves.get("readonlyOpeningRoutes[0].summary"), "第五章有明确互助回报");
  const value = checks(); const early = value.find(check => check.sourceId === "storyPrototype.earlyPayoff");
  Object.assign(early, { status: "deferred", handoffStatus: "covered", scope: "opening_sequence", candidateEvidence: [], contextEvidence: [{ sourcePath: "readonlyOpeningRoutes[0].summary", quote: "第五章有明确互助回报" }] });
  prompt.postValidate(assessment(value), { candidate, reviewContextJson });
  early.scope = "book_arc";
  assert.throws(() => prompt.postValidate(assessment(value), { candidate, reviewContextJson }), /cannot be reclassified/);
});

test("unknown original direction stays unknown and cannot gain invented checks from the generated outline", () => {
  const reviewContextJson = JSON.stringify({ selectedPlanningDirection: { status: "missing", reason: "旧数据缺来源" }, planningContext: { sellingPoint: "生成的大纲" } });
  assert.deepEqual(promiseEvidence.planningPromiseEvidenceContext(reviewContextJson).sourceIds, []);
  assert.equal(prompt.postValidate(assessment([]), { candidate, reviewContextJson }).safeToSync, true);
  assert.throws(() => prompt.postValidate(assessment(checks()), { candidate, reviewContextJson }), /absent sources/);
});

test("synthesized direction gaps retain eight original issues and overload without dropping repair guidance", () => {
  const value = assessment(checks()); value.promiseChecks.at(-1).status = "dropped";
  value.issues = Array.from({ length: 8 }, (_, i) => ({ id: `original-${i}`, severity: "high", target: "semantic", summary: "问题", repairHint: "指导" }));
  value.issues.push({ ...value.issues[0], id: "contract_overloaded" }); value.recommendedHandling = "replan_window";
  value.repairGuidance = Array.from({ length: 8 }, (_, i) => `独立指导${i}`);
  const result = quality.mapSemanticAssessmentToQualityGate(value, "ai_copilot");
  assert.equal(result.issues.length, 10); assert.equal(result.recommendedHandling, "replan_window");
  for (const item of value.repairGuidance) assert.ok(result.repairGuidance.join(" ").includes(item));
  assert.equal(quality.aiChapterTaskSheetQualityAssessmentSchema.safeParse(result).success, true);
});

test("existing quality call receives bounded output headroom and no additional model invocation", async () => {
  const calls = [];
  const { ChapterTaskSheetQualityGateService } = load("../src/services/novel/volume/ChapterTaskSheetQualityGateService.ts", {
    "@ai-novel/shared/types/novel/planningPromises": promises,
    "@ai-novel/shared/types/chapterTaskSheetQuality": { ...quality, assessChapterExecutionContractShape: () => ({ canEnterExecution: true }) },
    "../../../prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts": { chapterTaskSheetQualityPrompt: prompt },
    "../../../prompting/core/promptRunner": { runStructuredPrompt: async input => { calls.push(input); return { output: assessment(checks()) }; } },
  });
  const result = await new ChapterTaskSheetQualityGateService().evaluate(candidate, { reviewContextJson: context() });
  assert.equal(calls.length, 1); assert.equal(result.status, "passed");
  assert.equal(calls[0].options.maxTokens, 4000 + checks().length * 600);
  assert.ok(calls[0].options.maxTokens <= 10000);
  assert.equal(calls[0].promptInput.reviewContextJson, context());
  await new ChapterTaskSheetQualityGateService().evaluate(candidate, { reviewContextJson: context(), previousIssues: Array(30).fill({ id: "old" }) });
  assert.equal(calls.length, 2); assert.equal(calls[1].options.maxTokens, 16000);
});

test("non-empty citations never turn an explicitly partial, missing or conflicting handoff into covered", () => {
  for (const handoffStatus of ["partial", "missing", "conflicting"]) {
    const value = checks(); Object.assign(value.at(-1), { status: "deferred", handoffStatus, scope: "opening_sequence",
      contextEvidence: [{ sourcePath: "readonlyNext.summary", quote: "取得地图" }], explanation: "前置动作有安排，但回报没有完整安排。" });
    const result = quality.mapSemanticAssessmentToQualityGate(assessment(value), "full_book_autopilot");
    assert.equal(result.safeToSync, false); assert.equal(result.canEnterExecution, false);
  }
  const value = checks(); Object.assign(value.at(-1), { status: "deferred", handoffStatus: "covered", contextEvidence: [{ sourcePath: "writtenEvidence.chapters[0].content", quote: "之前只取得地图" }] });
  assert.equal(quality.mapSemanticAssessmentToQualityGate(assessment(value), "full_book_autopilot").safeToSync, false);
  assert.equal(prompt.outputSchema.safeParse(assessment(checks().map(({ handoffStatus, ...legacy }) => legacy))).success, false);
  assert.equal(quality.aiChapterTaskSheetQualityAssessmentSchema.safeParse(assessment(checks().map(({ handoffStatus, ...legacy }) => legacy))).success, true);
});

test("validated unresolved checks retain original IDs and all new findings beyond the fresh-output issue limit", () => {
  const previous = Array.from({ length: 12 }, (_, i) => ({ id: `old-${i}`, severity: "medium", target: "boundary", summary: "原问题", repairHint: `原指导${i}` }));
  const value = assessment([]);
  value.issues = Array.from({ length: 8 }, (_, i) => ({ id: `new-${i}`, severity: "high", target: "semantic", summary: "新问题", repairHint: `新指导${i}`,
    basis: { kind: "missing_requirement", candidateEvidence: [{ sourcePath: "summary", quote: candidate.summary }], counterEvidence: [], contextEvidence: [],
      executionImpact: "缺少可执行来源", whyExistingConstraintsInsufficient: "现有动作未交代来源" },
  }));
  value.issueChecks = previous.map(issue => ({ issueId: issue.id, status: "partially_resolved", candidateEvidence: [], explanation: `本轮仍未解决${issue.id}` }));
  assert.equal(prompt.outputSchema.safeParse(value).success, true);
  const projected = issueProjection.projectValidatedIssueChecks(value, {}, previous);
  assert.equal(projected.issues.length, 20); assert.equal(projected.safeToSync, false); assert.equal(projected.verdict, "repairable");
  for (const issue of previous) assert.deepEqual(projected.issues.find(item => item.id === issue.id), { ...issue, summary: `本轮仍未解决${issue.id}` });
  assert.deepEqual(projected.issues.slice(0, 8), value.issues);
  assert.equal(quality.aiChapterTaskSheetQualityAssessmentSchema.safeParse(projected).success, true);
  assert.equal(prompt.outputSchema.safeParse(projected).success, false);
  assert.equal(quality.mapSemanticAssessmentToQualityGate(projected, "full_book_autopilot").canEnterExecution, false);
  assert.throws(() => issueProjection.projectValidatedIssueChecks({ ...value, issueChecks: value.issueChecks.slice(1) }, {}, previous), /exactly once/);
  const forged = structuredClone(value); forged.issueChecks[0].candidateEvidence = [{ sourcePath: "summary", quote: "伪造原文" }];
  assert.throws(() => issueProjection.projectValidatedIssueChecks(forged, { summary: "真实原文" }, previous), /absent/);
});

const capturedPath = path.resolve(__dirname, "../../.codex-run/mining-book-evidence.json");
test("legacy capture preserves unresolved issue projection without pretending to satisfy the fresh basis contract", { skip: !fs.existsSync(capturedPath) }, () => {
  // Read local diagnostic capture without adding the user's manuscript or complete output to fixtures.
  const capture = JSON.parse(fs.readFileSync(capturedPath, "utf8"));
  const task = capture.tasks.find(item => item.lane === "auto_director");
  const seed = JSON.parse(task.seedPayloadJson); const repair = seed.planningRepair;
  const change = repair.history.find(item => item.kind === "repair").output.changes[0];
  const current = { ...change, chapterOrder: repair.chapterOrder, sceneCards: { scenes: change.sceneCards } };
  const previousIssues = repair.history.find(item => item.kind === "assessment").result.chapters[repair.chapterId].issues;
  const all = seed.planningRepairSnapshot.baselineDocument.volumes.flatMap(volume => volume.chapters);
  const reviewContextJson = JSON.stringify({ selectedPlanningDirection: { status: "available", sourceTaskId: task.id, candidate: seed.candidate },
    readonlyPrevious: all.find(chapter => chapter.chapterOrder === repair.chapterOrder - 1), readonlyNext: all.find(chapter => chapter.chapterOrder === repair.chapterOrder + 1) });
  const rejected = repair.history.filter(item => item.kind === "rejected_response");
  for (const entry of rejected) {
    // Historical output predates mandatory fresh-issue basis. Its evidence and
    // saved projection remain readable, but it must not be certified as fresh output.
    promiseEvidence.validatePlanningPromiseEvidence(entry.output.promiseChecks, current, reviewContextJson);
    assert.throws(() => prompt.postValidate(entry.output, { candidate: current, previousIssues, reviewContextJson }), /requires an execution-impact basis/);
    const projected = issueProjection.projectValidatedIssueChecks(entry.output, current, previousIssues);
    assert.equal(projected.safeToSync, false); assert.equal(projected.verdict, "repairable");
    assert.equal(projected.issues.find(issue => issue.id === "opening_chain_deferred_handoff").severity, "low");
    assert.ok(entry.output.issues.every(issue => projected.issues.some(saved => saved.id === issue.id)));
    assert.equal(quality.mapSemanticAssessmentToQualityGate(projected, "full_book_autopilot").canEnterExecution, false);
  }
  assert.equal(rejected.length, 3);
});
