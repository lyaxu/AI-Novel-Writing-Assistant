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
const { chapterTaskSheetQualityPrompt: prompt } = load("../src/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.ts", {
  "@langchain/core/messages": require("@langchain/core/messages"), zod: require("zod"),
  "@ai-novel/shared/types/chapterTaskSheetQuality": schema, "./evidence/chapterEvidence": evidence,
});
const fixture = require("./fixtures/planningEvidenceLabeledQuotes.json");
const output = () => ({ verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is",
  summary: "已复核", issues: [], repairGuidance: [], confidence: 0.9, issueChecks: structuredClone(fixture.issueChecks) });
const input = () => ({ candidate: fixture.candidate, previousIssues: fixture.issueChecks.map((c) => ({ id: c.issueId })) });

test("eight saved field-labeled citations verify against the same candidate without paid recovery", () => {
  const index = evidence.buildChapterEvidenceIndex(fixture.candidate);
  assert.equal(fixture.issueChecks.flatMap((c) => c.candidateEvidence).length, 8);
  for (const quote of fixture.issueChecks.flatMap((c) => c.candidateEvidence)) assert.equal(evidence.matchesChapterEvidence(index, quote), true, quote);
  assert.equal(prompt.postValidate(output(), input()).safeToSync, true);
});
test("fresh schema requires separate leaf path and quote; wrong field and old candidate are rejected", () => {
  const fresh = output(); const index = evidence.buildChapterEvidenceIndex(fixture.candidate);
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
  const issues = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, severity: "high", target: "semantic", summary: "问题", repairHint: "修改" }));
  issues.push({ ...issues[0], id: "contract_overloaded" });
  const current = { ...output(), verdict: "repairable", safeToSync: false, recommendedHandling: "repair_contract", issues,
    issueChecks: issues.map((issue) => ({ issueId: issue.id, status: "unresolved", candidateEvidence: [], explanation: "仍缺少前提" })) };
  assert.equal(prompt.outputSchema.safeParse(current).success, true);
  prompt.postValidate(current, { candidate: {}, previousIssues: issues });
  assert.throws(() => prompt.postValidate({ ...current, issueChecks: current.issueChecks.slice(0, 8) }, { candidate: {}, previousIssues: issues }), /exactly once/);
  assert.equal(prompt.outputSchema.safeParse({ ...current, issues: issues.map((issue, i) => ({ ...issue, id: `new${i}` })) }).success, false);
});
test("render provides stable scene paths and legacy keyless scenes remain readable", () => {
  const rendered = prompt.render({ ...input(), mode: "ai_copilot" });
  assert.match(String(rendered[1].content), /crawl_to_swamp.prerequisites\[0\].condition/);
  const index = evidence.buildChapterEvidenceIndex({ sceneCards: JSON.stringify({ scenes: [{ turn: "原句" }] }) });
  assert.equal(evidence.matchesChapterEvidence(index, "原句"), true);
  assert.throws(() => evidence.buildChapterEvidenceIndex({ sceneCards: JSON.stringify({ scenes: [{ key: "same", turn: "甲" }, { key: "same", turn: "乙" }] }) }), /Ambiguous/);
});
