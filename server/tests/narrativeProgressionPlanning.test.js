const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const native = createRequire(filename);
  function local(id) {
    const target = id.startsWith(".") ? path.resolve(path.dirname(filename), id).replace(/\.js$/, "")
      : id.startsWith("@ai-novel/shared/") ? path.join(root, "shared", id.slice("@ai-novel/shared/".length)) : null;
    if (target) {
      const file = [`${target}.ts`, path.join(target, "index.ts")].find(file => fs.existsSync(file));
      if (file) return load(file);
    }
    return native(id);
  }
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(local, module, module.exports);
  return module.exports;
}
const shared = load(path.join(root, "shared/types/chapterTaskSheetQuality.ts"));
const { chapterTaskSheetQualityPrompt: prompt } = load(path.join(root, "server/src/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.ts"));
const { validateNarrativeProgressionEvidence: validate } = load(path.join(root, "server/src/prompting/prompts/novel/volume/evidence/narrativeProgressionEvidence.ts"));
const previous = "He decided to visit the clinic. The guards refused him entry, so he returned home.";
const candidate = { chapterOrder: 3, summary: "He decides to visit the clinic again. The guards refuse him entry and he returns home." };
const context = JSON.stringify({ writtenEvidence: { chapters: [{ order: 2, content: previous }] } });
const quote = (sourcePath, quote) => ({ sourcePath, quote });
function assessment(status = "effective", current = candidate, prior = previous) {
  return { verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is", summary: "Review", issues: [], repairGuidance: [], confidence: 0.9,
    issueChecks: [], promiseChecks: [], refinements: [], progressionChecks: shared.NARRATIVE_PROGRESSION_DIMENSIONS.map(dimension => ({
      dimension, status, candidateEvidence: [quote("summary", current.summary)], priorEvidence: prior ? [quote("writtenEvidence.chapters[0].content", prior)] : [],
      explanation: "Compare the current action, knowledge and relationship consequences with the earlier passage.", issueId: null, repairHint: "",
    })) };
}

test("fresh output requires all three unique dimensions, while historical assessments remain readable", () => {
  const value = assessment(); const { progressionChecks, ...legacy } = value;
  assert.equal(shared.aiChapterTaskSheetQualityAssessmentSchema.safeParse(legacy).success, true);
  assert.equal(prompt.outputSchema.safeParse(legacy).success, false);
  assert.equal(prompt.outputSchema.safeParse(value).success, true);
  assert.equal(prompt.outputSchema.safeParse({ ...value, progressionChecks: progressionChecks.slice(1) }).success, false);
  assert.equal(prompt.outputSchema.safeParse({ ...value, progressionChecks: [progressionChecks[0], progressionChecks[0], progressionChecks[2]] }).success, false);
  assert.doesNotThrow(() => validate(legacy, candidate));
});

test("AI-identified repeated pressure and re-deciding a prior goal use the existing issue repair channel", () => {
  const value = assessment();
  value.verdict = "repairable"; value.safeToSync = false; value.recommendedHandling = "repair_contract";
  value.issues = [{ id: "repeat_without_consequence", severity: "high", target: "semantic", summary: "Repeats the decision and refusal without a changed situation", repairHint: "Execute the visit with a changed obstacle or a consequential alternative",
    basis: { kind: "missing_requirement", candidateEvidence: [quote("summary", candidate.summary)], counterEvidence: [],
      contextEvidence: [quote("writtenEvidence.chapters[0].content", previous)], executionImpact: "No new result from the promised visit", whyExistingConstraintsInsufficient: "Repeating a choice does not execute it" } }];
  for (const check of value.progressionChecks.filter(c => c.dimension !== "knowledge_repetition")) Object.assign(check, {
    status: "stalled", issueId: value.issues[0].id, repairHint: value.issues[0].repairHint, explanation: "The same refusal and return leave the goal, resources and relationship unchanged.",
  });
  const parsed = prompt.outputSchema.parse(value);
  const projected = prompt.postValidate(parsed, { candidate, reviewContextJson: context });
  for (const mode of shared.CHAPTER_TASK_SHEET_QUALITY_MODES) {
    const result = shared.mapSemanticAssessmentToQualityGate(projected, mode);
    assert.equal(result.canEnterExecution, false);
    assert.deepEqual(result.progressionChecks, projected.progressionChecks);
    assert.equal(result.issues[0].id, "repeat_without_consequence");
  }
  assert.throws(() => validate({ ...value, issues: [] }, candidate, context), /must link/);
  assert.throws(() => validate({ ...value, verdict: "usable", safeToSync: true }, candidate, context), /admission/);
  assert.equal(shared.mapSemanticAssessmentToQualityGate({ ...value, verdict: "usable", safeToSync: true }, "full_book_autopilot").canEnterExecution, false);
});

test("quiet relationship movement and reinterpretation of an old clue can retain AI approval", () => {
  for (const example of [
    { previous: "She would not sit beside him.", next: "She silently leaves a seat for him and waits.", status: "effective", explanation: "The quiet gesture changes mutual trust without a confrontation." },
    { previous: "They assumed the wet footprints belonged to the guard.", next: "Revisiting the footprints, she notices they point toward the locked door, not away.", status: "justified_repetition", explanation: "The repeated clue acquires a new interpretation and redirects the investigation." },
  ]) {
    const current = { chapterOrder: 2, summary: example.next };
    const value = assessment(example.status, current, example.previous);
    value.progressionChecks.forEach(check => { check.explanation = example.explanation; });
    const reviewContextJson = JSON.stringify({ writtenEvidence: { chapters: [{ order: 1, content: example.previous }] } });
    validate(value, current, reviewContextJson);
    assert.equal(shared.mapSemanticAssessmentToQualityGate(value, "full_book_autopilot").canEnterExecution, true);
  }
});

test("a stalled check may link an unresolved historical issue restored by issueChecks projection", () => {
  const historical = { id: "existing_stall", severity: "high", target: "semantic", summary: "Repeats the prior goal without execution", repairHint: "Carry the earlier choice into a consequential action" };
  const value = assessment();
  value.progressionChecks[2] = { ...value.progressionChecks[2], status: "stalled", issueId: historical.id, repairHint: historical.repairHint };
  value.issueChecks = [{ issueId: historical.id, status: "unresolved", candidateEvidence: [quote("summary", candidate.summary)], explanation: "The goal is still only decided again." }];
  const projected = prompt.postValidate(value, { candidate, previousIssues: [historical], reviewContextJson: context });
  assert.equal(projected.issues[0].id, historical.id);
  assert.equal(projected.safeToSync, false);
  assert.ok(projected.repairGuidance.some(text => text.includes(historical.repairHint)));
  const gate = shared.mapSemanticAssessmentToQualityGate(projected, "full_book_autopilot");
  assert.equal(gate.canEnterExecution, false);
  assert.equal(gate.progressionChecks[2].issueId, gate.issues[0].id);
  value.issueChecks[0].status = "resolved";
  assert.throws(() => prompt.postValidate(value, { candidate, previousIssues: [historical], reviewContextJson: context }), /must link/);
});

test("future plans, summaries and wrong prose cannot establish previous events", () => {
  const value = assessment();
  for (const sourcePath of ["readonlyPrevious.summary", "writtenEvidence.compressedFacts.items[0].text", "writtenEvidence.chapters[1].content"]) {
    const changed = structuredClone(value); changed.progressionChecks[0].priorEvidence = [quote(sourcePath, previous)];
    const reviewContextJson = JSON.stringify({ readonlyPrevious: { summary: previous }, writtenEvidence: {
      chapters: [{ order: 2, content: previous }, { order: 4, content: previous }], compressedFacts: { items: [{ text: previous }] },
    } });
    assert.throws(() => validate(changed, candidate, reviewContextJson), /earlier written prose/);
  }
  value.progressionChecks[0].priorEvidence[0].quote = "The guards welcomed him.";
  assert.throws(() => validate(value, candidate, context), /earlier written prose/);
});

test("no earlier prose yields explicit uncertainty without an automatic block or invented history", () => {
  const value = assessment("insufficient_context", candidate, null);
  const reviewContextJson = JSON.stringify({ readonlyPrevious: { summary: previous } });
  prompt.postValidate(prompt.outputSchema.parse(value), { candidate, reviewContextJson });
  assert.equal(shared.mapSemanticAssessmentToQualityGate(value, "full_book_autopilot").canEnterExecution, true);
  value.progressionChecks[0].status = "effective";
  assert.throws(() => validate(value, candidate, reviewContextJson), /insufficient_context decision/);
});
