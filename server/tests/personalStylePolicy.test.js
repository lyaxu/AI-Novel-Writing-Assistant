const test = require("node:test");
const assert = require("node:assert/strict");
const { AntiAiPolicyResolver } = require("../dist/services/styleEngine/AntiAiPolicyResolver.js");
const { StyleCompiler } = require("../dist/services/styleEngine/StyleCompiler.js");
const profile = require("../../docs/style-profiles/shijing-xini.json");

const rule = {
  id: "psychology", key: "forbid-explicit-psychology", name: "psychology",
  type: "forbidden", enabled: true, description: "Original psychology prohibition",
  promptInstruction: "Original psychology prohibition", detectPatterns: ["他意识到"],
};
const other = { ...rule, id: "moralize", key: "forbid-moralize" };
function binding(id, targetType, characterRules) {
  return { styleProfileId: id, targetType, priority: 1, weight: 1,
    styleProfile: { id, name: id, characterRules, antiAiRules: [] } };
}
async function resolve(bindings) {
  const resolver = new AntiAiPolicyResolver();
  resolver.listGlobalBaselineRules = async () => [rule, other];
  return resolver.resolveFromBindings({ matchedBindings: bindings });
}

test("personal style allows situated thoughts without changing stored global rules", async () => {
  const policy = await resolve([binding("personal", "task", profile.characterRules)]);
  const rules = policy.effectiveRules.map((item) => item.rule);
  assert.match(rules[0].promptInstruction, /允许人物/);
  assert.deepEqual(rules[0].detectPatterns, []);
  assert.equal(rule.promptInstruction, "Original psychology prohibition");
  assert.equal(rules[1], other);
  const compiled = new StyleCompiler().compile({ styleProfile: profile, antiAiRules: rules });
  assert.match(compiled.selfCheck, /character-specific inner reasoning/);
  assert.match(compiled.style, /allowSwearing: must keep yes/);
  assert.match(compiled.character, /situated_inner_voice/);
  assert.doesNotMatch(compiled.antiAi.split("Original psychology prohibition")[0], /必须通过行为/);
});

test("existing profiles and no-profile generation retain the original policy", async () => {
  for (const bindings of [[], [binding("legacy", "task", { allowSelfReflection: true })]]) {
    const policy = await resolve(bindings);
    assert.equal(policy.effectiveRules[0].rule, rule);
  }
  const compiled = new StyleCompiler().compile({
    styleProfile: { narrativeRules: {}, characterRules: {}, languageRules: {}, rhythmRules: {} },
    antiAiRules: [rule],
  });
  assert.match(compiled.selfCheck, /instead of showing/);
});

test("more specific psychology modes override inherited book rules", async () => {
  const book = binding("personal-book", "novel", profile.characterRules);
  const inherited = await resolve([book, binding("chapter", "chapter", {})]);
  assert.match(inherited.effectiveRules[0].rule.promptInstruction, /允许人物/);
  const overridden = await resolve([book, binding("task", "task", { psychologyMode: "action_only" })]);
  assert.equal(overridden.effectiveRules[0].rule, rule);
});

test("profile-specific copies of the same rule use the same effective wording", async () => {
  const b = binding("personal", "task", profile.characterRules);
  b.styleProfile.antiAiRules = [rule];
  const policy = await resolve([b]);
  assert.equal(policy.styleSpecificRules[0].rule.promptInstruction, policy.globalBaselineRules[0].rule.promptInstruction);
});
