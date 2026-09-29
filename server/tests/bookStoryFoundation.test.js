const test = require("node:test");
const assert = require("node:assert/strict");
const { foundation, storyPrototype, legacyCandidate } = require("./fixtures/bookStoryFoundation");
const { bookStoryFoundationSchema } = require("@ai-novel/shared/types/novel/bookStoryFoundation");
const { selectedPlanningCandidateSchema, selectedPlanningPromiseIds, isOpeningPlanningPromise } = require("@ai-novel/shared/types/novel/planningPromises");
// Legacy shared ESM files contain extensionless relative imports. Load the real
// schema and its local dependencies as CJS without changing production resolution.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const schemaModules = new Map();
function loadSharedSchema(filename) {
  if (schemaModules.has(filename)) return schemaModules.get(filename).exports;
  const module = { exports: {} };
  schemaModules.set(filename, module);
  const localRequire = createRequire(filename);
  const sourceRequire = (specifier) => {
    if (!specifier.startsWith(".")) return localRequire(specifier);
    const target = path.resolve(path.dirname(filename), specifier).replace(/\.js$/, "");
    const source = [`${target}.ts`, path.join(target, "index.ts")].find(file => fs.existsSync(file));
    return source ? loadSharedSchema(source) : localRequire(specifier);
  };
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(sourceRequire, module, module.exports);
  return module.exports;
}
const { macroConstraintContextSchema } = loadSharedSchema(path.resolve(__dirname, "../../shared/types/chapterRuntime.ts"));
const { directorCandidateSchema, directorPersistedCandidateSchema, directorCandidateResponseSchema } = require("../dist/services/novel/director/runtime/novelDirectorSchemas");
const { normalizeCandidate, buildStoryInput, toBookSpec } = require("../dist/services/novel/director/runtime/novelDirectorHelpers");
const { buildDirectorBookContractContextBlocks } = require("../dist/prompting/prompts/novel/planningContextBlocks");
const { buildMacroConstraintContext } = require("../dist/prompting/prompts/novel/chapterLayeredContext");
const { renderStoryMacroText } = require("../dist/prompting/prompts/novel/chapterLayeredContextShared");

const candidate = { ...legacyCandidate, storyPrototype, bookStoryFoundation: foundation };

test("new candidate generation requires a foundation while saved legacy candidates remain readable", () => {
  assert.equal(directorCandidateSchema.safeParse(legacyCandidate).success, true);
  assert.equal(directorPersistedCandidateSchema.safeParse(legacyCandidate).success, true);
  const oldWithOpening = { ...legacyCandidate, storyPrototype };
  assert.equal(directorCandidateResponseSchema.safeParse({ candidates: [oldWithOpening, oldWithOpening] }).success, false);
  assert.deepEqual(directorCandidateResponseSchema.parse({ candidates: [candidate, candidate] }).candidates[0].bookStoryFoundation, foundation);
});

test("foundation accepts everyday stakes and explicit inapplicability but rejects empty or unbounded structures", () => {
  assert.deepEqual(bookStoryFoundationSchema.parse(foundation), foundation);
  const invalid = [
    { ...foundation, throughline: { ...foundation.throughline, thematicAnswer: "  " } },
    { ...foundation, worldBoundary: { ...foundation.worldBoundary, crossingRules: "x".repeat(601) } },
    { ...foundation, characterDynamics: [] },
    { ...foundation, characterDynamics: Array(6).fill(foundation.characterDynamics[0]) },
    { ...foundation, throughline: { ...foundation.throughline, setupPayoffs: Array(5).fill(foundation.throughline.setupPayoffs[0]) } },
    { ...foundation, worldBoundary: { ...foundation.worldBoundary, hardLimits: Array(6).fill("limit") } },
  ];
  for (const input of invalid) assert.equal(bookStoryFoundationSchema.safeParse(input).success, false);
});

test("candidate normalization, macro input and book contract context retain each foundation group", () => {
  const normalized = normalizeCandidate(candidate, 0);
  assert.deepEqual(normalized.bookStoryFoundation, foundation);
  const input = { idea: "A tenant and a street", candidate: normalized };
  const storyInput = buildStoryInput(input, toBookSpec(normalized, input.idea));
  const contractBlocks = JSON.stringify(buildDirectorBookContractContextBlocks({ ...input, context: {}, storyMacroPlan: null, targetChapterCount: 80 }));
  for (const text of [foundation.throughline.endingChoice, foundation.worldBoundary.knowledgeBoundary,
    foundation.characterDynamics[0].independentGoal, foundation.viewpoint.anchor, foundation.progression.emotionalMovement]) {
    assert.ok(storyInput.includes(text), text);
    assert.ok(contractBlocks.includes(text), text);
  }
});

test("selected direction retains the book foundation without adding chapter payoff obligations", () => {
  const projected = selectedPlanningCandidateSchema.parse(candidate);
  assert.deepEqual(projected.bookStoryFoundation, foundation);
  const source = { status: "available", sourceTaskId: "task", fingerprint: "test", candidate: projected };
  const ids = selectedPlanningPromiseIds(source, 1);
  for (const group of Object.keys(foundation)) {
    const id = `bookStoryFoundation.${group}`;
    assert.ok(!ids.includes(id));
    assert.equal(isOpeningPlanningPromise(id), false);
  }
  assert.ok(ids.includes("storyPrototype.openingChain[0]"));
  assert.ok(!ids.includes("storyPrototype.openingChain[1]"));
  const { bookStoryFoundation: unusedFoundation, ...withoutFoundation } = projected;
  assert.deepEqual(ids, selectedPlanningPromiseIds({ ...source, candidate: withoutFoundation }, 1));
  const legacy = { ...source, candidate: selectedPlanningCandidateSchema.parse(legacyCandidate) };
  assert.ok(selectedPlanningPromiseIds(legacy).every(id => !id.startsWith("bookStoryFoundation.")));
});

test("runtime macro projection and rendering retain world, endgame and relationship constraints", () => {
  const context = buildMacroConstraintContext({ bookStoryFoundation: foundation, constraints: [], decomposition: {} });
  assert.deepEqual(context.bookStoryFoundation, foundation);
  const parsed = macroConstraintContextSchema.parse(context);
  assert.deepEqual(parsed.bookStoryFoundation, foundation);
  const text = renderStoryMacroText(parsed);
  for (const value of [foundation.throughline.resolution, foundation.worldBoundary.baseline,
    foundation.characterDynamics[0].mainlineEffect, foundation.progression.escalationLogic]) assert.ok(text.includes(value), value);
  const { bookStoryFoundation: unused, ...legacy } = context;
  assert.equal(macroConstraintContextSchema.safeParse(legacy).success, true);
});
