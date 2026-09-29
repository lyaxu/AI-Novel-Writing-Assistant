const test = require("node:test");
const assert = require("node:assert/strict");
const { STORY_MACRO_RESPONSE_SCHEMA } = require("../dist/services/novel/storyMacro/storyMacroPlanSchema");
const { buildConstraintEngine, setEditablePlanFieldValue, mergeLockedFields } = require("../dist/services/novel/storyMacro/storyMacroConstraintEngine");
const { mapRowToPlan, serializeConstraintPayload } = require("../dist/services/novel/storyMacro/storyMacroPlanPersistence");
const { toEditablePlan } = require("../dist/services/novel/storyMacro/storyMacroPlanService.shared");
const { storyMacroDecompositionPrompt, storyMacroFieldRegenerationPrompt } = require("../dist/prompting/prompts/novel/storyMacro.prompts");

const foundation = {
  throughline: { centralQuestion: "Can neighbors keep a shared garden?", thematicAnswer: "Cooperation takes responsibility",
    endingChoice: "Share the lease", choiceCost: "Give up exclusive use", resolution: "Keep a common garden",
    setupPayoffs: [{ setup: "A spare key", payoff: "Neighbors open together" }] },
  worldBoundary: { baseline: "Ordinary modern neighborhood", crossingRules: "No crossing", knowledgeBoundary: "Private plans are not known to everyone", hardLimits: ["No supernatural intervention"] },
  characterDynamics: [{ role: "Neighbor", independentGoal: "Keep space to rest", mainlineEffect: "Negotiate lease", relationshipChange: "Distrust becomes cooperation" }],
  viewpoint: { anchor: "Tenant", scopeConnection: "Lease policy affects home life" },
  progression: { escalationLogic: "Choices build commitments", emotionalMovement: "Awkward humor becomes warmth" },
};
const phases = [{ name: "Find shared interests", goal: "Listen and negotiate" }, { name: "Keep a promise", goal: "Open the garden together" }];
function editable() { return {
  bookStoryFoundation: foundation, progressionPhases: phases,
  expansion: { expanded_premise: "Keep a garden", protagonist_core: "Tenant wants company", conflict_engine: "Different schedules",
    conflict_layers: { external: "Lease", internal: "Shyness", relational: "Distrust" }, mystery_box: "No hidden mastermind; will they cooperate?",
    emotional_line: "Warmth", setpiece_seeds: ["A meeting", "An opening"], tone_reference: "Light comedy" },
  decomposition: { selling_point: "Neighbors", core_conflict: "Privacy and company", main_hook: "Can they share?",
    progression_loop: "Listen and act", growth_path: "Learn to ask", major_payoffs: ["An invitation", "A shared meal"], ending_flavor: "Warm" },
  constraints: ["Everyday scale", "No magic"],
}; }
function row(plan, engine = buildConstraintEngine(plan)) { return {
  id: "macro", novelId: "book", storyInput: "Neighborhood comedy",
  expansionJson: JSON.stringify(plan.expansion), decompositionJson: JSON.stringify(plan.decomposition),
  issuesJson: "[]", lockedFieldsJson: "{}", stateJson: null,
  constraintEngineJson: serializeConstraintPayload({ constraints: plan.constraints, constraintEngine: engine,
    bookStoryFoundation: plan.bookStoryFoundation, progressionPhases: plan.progressionPhases }),
  createdAt: new Date(0), updatedAt: new Date(0),
}; }

test("new macro generation requires complete foundation and free AI stages", () => {
  const output = { ...editable(), issues: [] };
  assert.equal(STORY_MACRO_RESPONSE_SCHEMA.safeParse(output).success, true);
  assert.equal(STORY_MACRO_RESPONSE_SCHEMA.safeParse({ ...output, bookStoryFoundation: undefined }).success, false);
  assert.equal(STORY_MACRO_RESPONSE_SCHEMA.safeParse({ ...output, progressionPhases: [phases[0]] }).success, false);
  assert.equal(STORY_MACRO_RESPONSE_SCHEMA.safeParse({ ...output, bookStoryFoundation: { ...foundation, worldBoundary: {} } }).success, false);
});

test("saved author foundation and AI phase names survive persistence without fixed five-stage rewrite", () => {
  const plan = editable();
  const engine = buildConstraintEngine(plan);
  assert.deepEqual(engine.phase_model, phases);
  const savedEngine = { ...engine, phase_model: [{ name: "Saved authored phase", goal: "Keep this saved decision" }] };
  const loaded = mapRowToPlan(row(plan, savedEngine));
  assert.deepEqual(loaded.bookStoryFoundation, foundation);
  assert.deepEqual(loaded.progressionPhases, phases);
  assert.deepEqual(loaded.constraintEngine.phase_model, savedEngine.phase_model);
  assert.deepEqual(mapRowToPlan(row(toEditablePlan(loaded))).bookStoryFoundation, foundation);
});

test("legacy macro remains readable and is not represented as upgraded foundation", () => {
  const plan = editable(); delete plan.bookStoryFoundation; delete plan.progressionPhases;
  const loaded = mapRowToPlan(row(plan));
  assert.equal(loaded.bookStoryFoundation, undefined);
  assert.equal(loaded.progressionPhases, undefined);
  assert.equal(loaded.constraintEngine.phase_model.length, 5);
});

test("single-field edits and locked-field merges preserve foundation and AI phases", () => {
  const current = editable();
  const edited = setEditablePlanFieldValue(current, "ending_flavor", "Joyful");
  assert.deepEqual(edited.bookStoryFoundation, foundation);
  assert.deepEqual(edited.progressionPhases, phases);
  const merged = mergeLockedFields(edited, current, { ending_flavor: true });
  assert.equal(merged.decomposition.ending_flavor, "Warm");
  assert.deepEqual(merged.bookStoryFoundation, foundation);
  assert.deepEqual(merged.progressionPhases, phases);
});

test("author foundation guards single-field regeneration even without selected optional context", () => {
  const rendered = storyMacroFieldRegenerationPrompt.render({ ...editable(), field: "ending_flavor", storyInput: "Garden", lockedFields: {}, projectContext: "" }, { blocks: [] });
  const text = rendered.map(message => message.content).join("\n");
  assert.match(text, /No supernatural intervention/);
  assert.match(text, /Share the lease/);
  const macro = storyMacroDecompositionPrompt.render({ storyInput: "Garden", projectContext: "" }, { blocks: [] }).map(message => message.content).join("\n");
  assert.match(macro, /progressionPhases/);
  assert.match(macro, /不预设误判/);
  assert.doesNotMatch(macro, /必须清晰体现：发现 -> 介入/);
});

test("malformed persisted foundation is not silently downgraded to a legacy book", () => {
  const saved = row(editable());
  const payload = JSON.parse(saved.constraintEngineJson);
  payload.bookStoryFoundation.worldBoundary = {};
  saved.constraintEngineJson = JSON.stringify(payload);
  assert.throws(() => mapRowToPlan(saved));
});
