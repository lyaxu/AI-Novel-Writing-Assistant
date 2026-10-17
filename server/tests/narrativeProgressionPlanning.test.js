function parseFreshStrict(value) {
 return prompt.outputSchema.parse({ ...value, stateChecks: [], issueDecisions: value.issues.map(issue => ({
 issueId: issue.id, claimIds: [], candidateAssertion: {subject:'chapter',statement:issue.summary, temporalScope:'planned',modality:'outcome',evidence:issue.basis.candidateEvidence},
 referenceAssertion:null,relation:'missing_requirement',comparisonScope:'unknown',transition:'missing',transitionEvidence:[],explanation:issue.summary,
 repair:{instruction:issue.repairHint,premiseEvidence:[]}
 })) });
}
// This suite isolates legacy evidence contracts; fresh state decisions have their own regression suite.
function parseFresh(value) { return prompt.outputSchema.safeParse({ issueDecisions: [], stateChecks: [], ...value }); }
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
const { buildPrimaryProseCitationCatalog, restorePrimaryProseCitations } = load(path.join(root, "server/src/prompting/prompts/novel/volume/evidence/primaryProseCitationCatalog.ts"));
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

function wire(value, reviewContextJson = context, chapterOrder = candidate.chapterOrder) {
  const catalog = buildPrimaryProseCitationCatalog(reviewContextJson, chapterOrder);
  return { ...value, progressionChecks: value.progressionChecks.map(check => ({ ...check,
    priorEvidence: check.priorEvidence.map(citation => {
      const source = catalog.sources.find(source => source.sourcePath === citation.sourcePath);
      const excerpt = source?.excerpts.find(excerpt => excerpt.quote.includes(citation.quote));
      assert.ok(excerpt?.evidenceId, "Fixture citation must resolve to an earlier prose ID");
      return { evidenceId: excerpt.evidenceId };
    }),
  })) };
}

test("fresh output requires all three unique dimensions, while historical assessments remain readable", () => {
  const value = assessment(); const { progressionChecks, ...legacy } = value;
  assert.equal(shared.aiChapterTaskSheetQualityAssessmentSchema.safeParse(legacy).success, true);
  assert.equal(parseFresh(legacy).success, false);
  assert.equal(parseFresh(wire(value)).success, true);
  assert.equal(parseFresh({ ...value, progressionChecks: progressionChecks.slice(1) }).success, false);
  assert.equal(parseFresh({ ...value, progressionChecks: [progressionChecks[0], progressionChecks[0], progressionChecks[2]] }).success, false);
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
  const parsed = parseFreshStrict(wire(value));
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
  const projected = prompt.postValidate(wire(value), { candidate, previousIssues: [historical], reviewContextJson: context });
  assert.equal(projected.issues[0].id, historical.id);
  assert.equal(projected.safeToSync, false);
  assert.ok(projected.repairGuidance.some(text => text.includes(historical.repairHint)));
  const gate = shared.mapSemanticAssessmentToQualityGate(projected, "full_book_autopilot");
  assert.equal(gate.canEnterExecution, false);
  assert.equal(gate.progressionChecks[2].issueId, gate.issues[0].id);
  value.issueChecks[0].status = "resolved";
  assert.throws(() => prompt.postValidate(wire(value), { candidate, previousIssues: [historical], reviewContextJson: context }), /must link/);
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
  prompt.postValidate(parseFreshStrict(value), { candidate, reviewContextJson });
  assert.equal(shared.mapSemanticAssessmentToQualityGate(value, "full_book_autopilot").canEnterExecution, true);
  value.progressionChecks[0].status = "effective";
  assert.throws(() => validate(value, candidate, reviewContextJson), /insufficient_context decision/);
});

test("wire selects earlier prose IDs and restores exact persisted citations before strict validation", () => {
  const model = wire(assessment());
  const parsed = parseFreshStrict(model);
  const result = prompt.postValidate(parsed, { candidate, reviewContextJson: context });
  assert.deepEqual(result.progressionChecks, assessment().progressionChecks);
  assert.equal(shared.aiChapterTaskSheetQualityAssessmentSchema.safeParse(result).success, true);
  assert.deepEqual(model.progressionChecks[0].priorEvidence, parsed.progressionChecks[0].priorEvidence);
  assert.match(prompt.render({ candidate, mode: "full_book_autopilot", reviewContextJson: context }, {})[1].content,
    new RegExp(model.progressionChecks[0].priorEvidence[0].evidenceId));
  const system = prompt.render({ candidate, mode: "full_book_autopilot", reviewContextJson: context }, {})[0].content;
  assert.ok(!system.includes(model.progressionChecks[0].priorEvidence[0].evidenceId));
  assert.match(system, /从本次正文目录选择支持此判断的evidenceId/);
  assert.match(system, /所有占位内容必须按实际证据替换，不可照抄/);
  assert.match(system, /依据本维实际比较选择允许的status/);
  assert.equal(prompt.version, "v19");
  assert.equal(parseFresh(assessment()).success, false);
  for (const extra of [{ quote: previous }, { quote: "Invented summary." }, { sourcePath: "writtenEvidence.chapters[0].content" }]) {
    const invalid = structuredClone(model);
    Object.assign(invalid.progressionChecks[0].priorEvidence[0], extra);
    assert.equal(parseFresh(invalid).success, false);
    assert.throws(() => prompt.postValidate(invalid, { candidate, reviewContextJson: context }));
  }
});

test("citation IDs bind actual entire prose, identity, source path and offset, rejecting stale or non-prior selections", () => {
  const text = "A".repeat(240) + "B".repeat(240);
  const source = { chapterId: "prior", order: 1, contentHash: "untrusted", content: text };
  const review = JSON.stringify({ writtenEvidence: { chapters: [source] } });
  const catalog = buildPrimaryProseCitationCatalog(review, 3);
  const first = catalog.sources[0].excerpts[0].evidenceId;
  const second = catalog.sources[0].excerpts[1].evidenceId;
  assert.notEqual(first, second);
  assert.deepEqual(restorePrimaryProseCitations([{ evidenceId: second }], review, 3),
    [quote("writtenEvidence.chapters[0].content", "B".repeat(240))]);
  assert.equal(buildPrimaryProseCitationCatalog(review, 3).sources[0].excerpts[0].evidenceId, first);
  const changedMetadata = JSON.stringify({ writtenEvidence: { chapters: [{ ...source, contentHash: "forged" }] } });
  assert.equal(buildPrimaryProseCitationCatalog(changedMetadata, 3).sources[0].excerpts[0].evidenceId, first);
  for (const changed of [
    { writtenEvidence: { chapters: [{ ...source, content: text + "!" }] } },
    { writtenEvidence: { chapters: [null, source] } },
    { writtenEvidence: { chapters: [{ ...source, chapterId: "other" }] } },
    { writtenEvidence: { chapters: [{ ...source, order: 3 }] } },
    { writtenEvidence: { chapters: [{ ...source, order: 4 }] } },
    { readonlyPrevious: { summary: text }, writtenEvidence: { compressedFacts: { items: [{ text }] } } },
  ]) assert.throws(() => restorePrimaryProseCitations([{ evidenceId: first }], JSON.stringify(changed), 3), /Unknown or stale/);
  assert.throws(() => restorePrimaryProseCitations([{ evidenceId: `prose_${"0".repeat(64)}` }], review, 3), /Unknown or stale/);
  assert.equal(buildPrimaryProseCitationCatalog(review, 1).sources[0].excerpts[0].evidenceId, undefined);
  // Existing display-only consumers retain their original shape and full text.
  assert.equal(buildPrimaryProseCitationCatalog(review).sources[0].excerpts[0].evidenceId, undefined);
  const unicode = JSON.stringify({ writtenEvidence: { chapters: [{ order: 1, content: "中".repeat(239) + "😀" + "文".repeat(241) }] } });
  const unicodeSource = buildPrimaryProseCitationCatalog(unicode, 2).sources[0];
  assert.equal(unicodeSource.excerpts[0].quote.length, 239);
  for (const excerpt of unicodeSource.excerpts) {
    assert.deepEqual(restorePrimaryProseCitations([{ evidenceId: excerpt.evidenceId }], unicode, 2), [quote(unicodeSource.sourcePath, excerpt.quote)]);
    assert.ok(!/[\uD800-\uDBFF]$/.test(excerpt.quote));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(excerpt.quote));
  }
});

test("ID resolution does not weaken exact candidate checks, prior-prose requirements or stalled admission guards", () => {
  const invalid = wire(assessment());
  invalid.progressionChecks[0].candidateEvidence[0].quote = "An invented candidate action";
  assert.throws(() => prompt.postValidate(parseFreshStrict(invalid), { candidate, reviewContextJson: context }), /exact current/);
  const noPrior = wire(assessment()); noPrior.progressionChecks[0].priorEvidence = [];
  assert.throws(() => prompt.postValidate(parseFreshStrict(noPrior), { candidate, reviewContextJson: context }), /needs earlier prose/);
  const stalled = wire(assessment()); stalled.progressionChecks[0].status = "stalled";
  assert.throws(() => prompt.postValidate(parseFreshStrict(stalled), { candidate, reviewContextJson: context }), /must link/);
});
