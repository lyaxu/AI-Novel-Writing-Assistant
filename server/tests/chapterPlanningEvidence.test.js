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
const evidence = load("../src/prompting/prompts/novel/volume/evidence/chapterEvidence.ts", {});
const schema = load("../../shared/types/chapterTaskSheetQuality.ts", { zod: require("zod"), "./chapterLengthControl.js": require("../../shared/dist/types/chapterLengthControl.js") });
const promiseEvidence = load("../src/prompting/prompts/novel/volume/evidence/planningPromiseEvidence.ts", {
  "./chapterEvidence": evidence,
  "@ai-novel/shared/types/novel/planningPromises": load("../../shared/types/novel/planningPromises.ts", { zod: require("zod"),
    "./bookStoryFoundation.js": load("../../shared/types/novel/bookStoryFoundation.ts", { zod: require("zod") }),
  }),
});
const issueProjection = load("../src/prompting/prompts/novel/volume/evidence/issueCheckProjection.ts", { "./chapterEvidence": evidence });
const { chapterTaskSheetQualityPrompt: prompt } = load("../src/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.ts", {
  "../context/capabilityAuthorization": load("../src/prompting/prompts/novel/context/capabilityAuthorization.ts", {}),
  "@langchain/core/messages": require("@langchain/core/messages"), zod: require("zod"),
  "@ai-novel/shared/types/chapterTaskSheetQuality": schema, "./evidence/chapterEvidence": evidence,
  "./evidence/planningPromiseEvidence": promiseEvidence, "./evidence/issueCheckProjection": issueProjection,
  "./evidence/newIssueEvidence": load("../src/prompting/prompts/novel/volume/evidence/newIssueEvidence.ts", { "./chapterEvidence": evidence }),
  "./evidence/primaryProseCitationCatalog": load("../src/prompting/prompts/novel/volume/evidence/primaryProseCitationCatalog.ts", {}),
  "./evidence/narrativeProgressionEvidence": load("../src/prompting/prompts/novel/volume/evidence/narrativeProgressionEvidence.ts", { "./chapterEvidence": evidence }),
});
const fixture = require("./fixtures/planningEvidenceLabeledQuotes.json");
const output = () => ({ verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is",
  summary: "已复核", issues: [], repairGuidance: [], confidence: 0.9, issueChecks: structuredClone(fixture.issueChecks), promiseChecks: [], refinements: [] });
const input = () => ({ candidate: fixture.candidate, previousIssues: fixture.issueChecks.map((c) => ({ id: c.issueId })) });

test("eight saved field-labeled citations verify against the same candidate without paid recovery", () => {
  const index = evidence.buildChapterEvidenceIndex(fixture.candidate);
  assert.equal(fixture.issueChecks.flatMap((c) => c.candidateEvidence).length, 8);
  for (const quote of fixture.issueChecks.flatMap((c) => c.candidateEvidence)) assert.equal(evidence.matchesChapterEvidence(index, quote), true, quote);
  assert.equal(prompt.postValidate(output(), input()).safeToSync, true);
});
test("fresh schema requires separate leaf path and quote; wrong field and old candidate are rejected", () => {
  const fresh = output(); const index = evidence.buildChapterEvidenceIndex(fixture.candidate);
  fresh.progressionChecks = ["event_repetition", "knowledge_repetition", "prior_goal_followthrough"].map(dimension => ({ dimension, status: "insufficient_context",
    candidateEvidence: [{ sourcePath: "readerExperience.keyTurn", quote: index.leaves.get("readerExperience.keyTurn") }], priorEvidence: [], explanation: "未提供前文正文", issueId: null, repairHint: "" }));
  fresh.issueChecks = fresh.issueChecks.map((check) => ({ ...check, candidateEvidence: [{ sourcePath: "readerExperience.keyTurn", quote: index.leaves.get("readerExperience.keyTurn") }] }));
  assert.equal(prompt.outputSchema.safeParse(fresh).success, true);
  assert.equal(prompt.outputSchema.safeParse(output()).success, false);
  prompt.postValidate(fresh, input());
  fresh.issueChecks[0].candidateEvidence[0].sourcePath = "smoke_wall.turn";
  assert.throws(() => prompt.postValidate(fresh, input()), /absent/);
  assert.throws(() => prompt.postValidate(output(), { ...input(), candidate: { taskSheet: "旧候选" } }), /absent/);
});
test("legacy compatibility rejects fake labels, arbitrary splicing, altered punctuation and mixed prerequisite objects", () => {
  const candidate = { sceneCards: JSON.stringify({ scenes: [{ key: "s", turn: "甲，乙。", causality: { prerequisites: [
    { condition: "条件甲", sourceKind: "establish_in_scene", reference: "来源甲" },
    { condition: "条件乙", sourceKind: "established_in_context", reference: "来源乙" },
  ] } }] }) };
  const index = evidence.buildChapterEvidenceIndex(candidate);
  for (const quote of ["", "  ", "wrong.turn：甲，乙。", "s.turn：甲乙", "s.prerequisites：条件甲，sourceKind=establish_in_scene，reference=来源乙", "s.prerequisites：条件甲，来源甲"])
    assert.equal(evidence.matchesChapterEvidence(index, quote), false, quote);
  assert.equal(evidence.matchesChapterEvidence(index, "s.prerequisites：条件甲，sourceKind=establish_in_scene，reference=来源甲"), true);
  assert.equal(evidence.matchesChapterEvidence(index, { sourcePath: "s.turn", quote: "甲， 乙。" }), true);
});
test("coverage includes eight real issues plus synthetic overload without dropping any issue", () => {
  const issues = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, severity: "high", target: "semantic", summary: "问题", repairHint: "修改",
    basis: { kind: "unsupported_prerequisite", candidateEvidence: [{ sourcePath: "summary", quote: "完成交换" }], counterEvidence: [], contextEvidence: [],
      executionImpact: "交换缺少必要前提", whyExistingConstraintsInsufficient: "既有说明没有资源来源" },
  }));
  issues.push({ ...issues[0], id: "contract_overloaded" });
  const current = { ...output(), verdict: "repairable", safeToSync: false, recommendedHandling: "repair_contract", issues,
    issueChecks: issues.map((issue) => ({ issueId: issue.id, status: "unresolved", candidateEvidence: [], explanation: "仍缺少前提" })) };
  current.progressionChecks = ["event_repetition", "knowledge_repetition", "prior_goal_followthrough"].map(dimension => ({ dimension, status: "insufficient_context",
    candidateEvidence: [{ sourcePath: "summary", quote: "完成交换" }], priorEvidence: [], explanation: "未提供前文正文", issueId: null, repairHint: "" }));
  assert.equal(prompt.outputSchema.safeParse(current).success, true);
  prompt.postValidate(current, { candidate: { summary: "完成交换" }, previousIssues: issues });
  assert.throws(() => prompt.postValidate({ ...current, issueChecks: current.issueChecks.slice(0, 8) }, { candidate: { summary: "完成交换" }, previousIssues: issues }), /exactly once/);
  assert.equal(prompt.outputSchema.safeParse({ ...current, issues: issues.map((issue, i) => ({ ...issue, id: `new${i}` })) }).success, false);
});
test("render provides stable scene paths and legacy keyless scenes remain readable", () => {
  const rendered = prompt.render({ ...input(), mode: "ai_copilot" });
  assert.match(String(rendered[1].content), /crawl_to_swamp.prerequisites\[0\].condition/);
  const index = evidence.buildChapterEvidenceIndex({ sceneCards: JSON.stringify({ scenes: [{ turn: "原句" }] }) });
  assert.equal(evidence.matchesChapterEvidence(index, "原句"), true);
  assert.throws(() => evidence.buildChapterEvidenceIndex({ sceneCards: JSON.stringify({ scenes: [{ key: "same", turn: "甲" }, { key: "same", turn: "乙" }] }) }), /Ambiguous/);
});

test("received review citations retain actual causality paths and exact leaf identity", () => {
  const candidate = { sceneCards: { scenes: [{ key: "dragged_continue", causality: { prerequisites: [
    { sourceKind: "established_in_context", reference: "前场已建立" },
    { sourceKind: "established_in_context", reference: "押送命令" },
    { sourceKind: "establish_in_scene", reference: "本场由沈砚觉醒后血脉感知被动接收矿区方向微弱同源共鸣，感知来源为觉醒本身，非既有残留" },
  ] } }] } };
  for (const cards of [candidate.sceneCards, JSON.stringify(candidate.sceneCards)]) {
    const current = { ...candidate, sceneCards: cards };
    const index = evidence.buildChapterEvidenceIndex(current);
    for (const prefix of ["dragged_continue", "dragged_continue.causality", "sceneCards.scenes[0].causality"]) {
      assert.equal(evidence.matchesChapterEvidence(index, { sourcePath: `${prefix}.prerequisites[2].sourceKind`, quote: "establish_in_scene" }), true);
    }
    const result = { ...output(), issueChecks: [{ issueId: "resume_unresolved_prerequisite", status: "resolved",
      candidateEvidence: [{ sourcePath: "dragged_continue.causality.prerequisites[2].sourceKind", quote: "establish_in_scene" },
        { sourcePath: "dragged_continue.causality.prerequisites[2].reference", quote: candidate.sceneCards.scenes[0].causality.prerequisites[2].reference }], explanation: "来源已在场景中建立" }] };
    assert.equal(prompt.postValidate(result, { candidate: current, previousIssues: [{ id: "resume_unresolved_prerequisite" }] }).safeToSync, true);
    for (const sourcePath of ["dragged_continue.causality.prerequisites[1].reference", "sceneCards.scenes[1].causality.prerequisites[2].reference", "fake.causality.prerequisites[2].reference"]) {
      assert.equal(evidence.matchesChapterEvidence(index, { sourcePath, quote: "血脉感知被动接收矿区方向微弱同源共鸣" }), false);
    }
    assert.equal(evidence.matchesChapterEvidence(index, { sourcePath: "dragged_continue.causality.prerequisites[2].reference", quote: "血脉感知主动接收" }), false);
  }
});

test("actual scene-card aliases cannot collide with another indexed leaf", () => {
  assert.throws(() => evidence.buildChapterEvidenceIndex({
    sceneCards: { scenes: [
      { key: "s", causality: { prerequisites: [{ reference: "真实来源" }] } },
      { key: "s.causality", prerequisites: [{ reference: "冲突来源" }] },
    ] },
  }), /Ambiguous/);
});

const followupCapturePaths = ["mining-followup-evidence.json", "mining-followup-candidate.json", "mining-followup-review-request.json"]
  .map(name => path.resolve(__dirname, "../../.codex-run", name));
test("historical rejected review retains evidence projection without satisfying the newer fresh-output schema", {
  skip: !followupCapturePaths.every(file => fs.existsSync(file)),
}, () => {
  const [seed, candidate, request] = followupCapturePaths.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  const human = request.payload.find(message => message.role === "human").content;
  const reviewContextJson = human.split("reviewContext (current source and repair history):\n")[1].split("\npreviousIssues:\n")[0];
  const previousIssues = JSON.parse(human.split("\npreviousIssues:\n")[1]);
  const rejected = seed.planningRepair.history.filter(item => item.kind === "rejected_response").at(-1);
  const received = schema.aiChapterTaskSheetQualityAssessmentSchema.parse(rejected.output);
  // This capture predates basis/refinements. Do not invent evidence to certify it
  // under the fresh-output contract; verify its original historical projection.
  assert.equal(prompt.outputSchema.safeParse(received).success, false);
  assert.throws(() => prompt.postValidate(received, { candidate, previousIssues, reviewContextJson }), /requires an execution-impact basis/);
  promiseEvidence.validatePlanningPromiseEvidence(received.promiseChecks, candidate, reviewContextJson);
  const projected = issueProjection.projectValidatedIssueChecks(received, candidate, previousIssues);
  assert.equal(projected.safeToSync, false);
  assert.equal(projected.verdict, "repairable");
  assert.equal(projected.issueChecks.find(check => check.issueId === "resume_unresolved_prerequisite").status, "resolved");
  assert.ok(projected.issues.some(issue => issue.id === "opening_chain_deferred_handoff"));
  assert.equal(schema.mapSemanticAssessmentToQualityGate(projected, "full_book_autopilot").canEnterExecution, false);
});

test("a field carried by both the chapter and its scene plan is not ambiguous when the text matches", () => {
  // requiredElements is part of the chapter contract and is also carried inside the scene plan, and
  // both are projected into one root namespace. That used to throw "Ambiguous evidence source path:
  // requiredElements[0]" and stopped every auto-director book at chapter 1.
  const elements = ["劳梓凡深夜送外卖到祥和里三号楼", "客户电话催单并威胁差评", "楼道灯坏了两层"];
  const candidate = {
    requiredElements: elements,
    sceneCards: JSON.stringify({ requiredElements: elements, scenes: [{ key: "s1", turn: "原句" }] }),
  };
  const index = evidence.buildChapterEvidenceIndex(candidate);
  // The path must still resolve to exactly one value, which is what evidence matching needs.
  assert.equal(index.leaves.get("requiredElements[0]"), elements[0]);
  assert.equal(index.leaves.get("requiredElements[2]"), elements[2]);
});

test("the same path with different text is still reported as ambiguous", () => {
  // Guarding this case is the point of the check: identical text resolves unambiguously, differing
  // text does not, and silently picking one would mis-attribute evidence.
  const candidate = {
    requiredElements: ["章节合同里的说法"],
    sceneCards: JSON.stringify({ requiredElements: ["场景计划里的另一种说法"], scenes: [{ key: "s1", turn: "原句" }] }),
  };
  assert.throws(() => evidence.buildChapterEvidenceIndex(candidate), /Ambiguous evidence source path: requiredElements\[0\]/);
});
