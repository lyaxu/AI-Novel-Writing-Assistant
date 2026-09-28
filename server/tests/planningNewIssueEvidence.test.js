const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports = {}) {
  const filename = path.resolve(__dirname, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((id) => {
    if (!(id in imports)) throw new Error(`Forbidden external boundary: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}
const evidence = load("../src/prompting/prompts/novel/volume/evidence/chapterEvidence.ts");
const { validateNewIssueEvidence } = load("../src/prompting/prompts/novel/volume/evidence/newIssueEvidence.ts", {
  "./chapterEvidence": evidence,
});
const candidate = {
  mustAvoid: "禁止本章兑现越级反杀或逆转弱势地位",
  sceneCards: JSON.stringify({ scenes: [{ key: "awakening", mustAdvance: [
    "获得可短暂越级反杀的潜力，但当前伤势与代价使其无法立即使用",
    "当场发动血脉力量击杀押送者",
  ], forbiddenExpansion: ["禁止立刻兑现越级反杀"] }] }),
};
const quote = (sourcePath, quote) => ({ sourcePath, quote });
const conflicting = () => ({
  id: "contradictory_action", severity: "medium", target: "scene_cards",
  summary: "场景仍要求执行被禁止的动作", repairHint: "修正具体行动安排",
  basis: {
    kind: "conflicting_requirements",
    candidateEvidence: [quote("awakening.mustAdvance[1]", "当场发动血脉力量击杀押送者"), quote("mustAvoid", "禁止本章兑现越级反杀")],
    counterEvidence: [quote("awakening.mustAdvance[0]", "当前伤势与代价使其无法立即使用")],
    executionImpact: "正文执行器收到同时执行与禁止同一动作的要求。",
    whyExistingConstraintsInsufficient: "已有能力限制并未消除另一必达动作的正面指令。",
  },
});
const assessment = (issues = [conflicting()]) => ({
  verdict: "repairable", safeToSync: false, recommendedHandling: "repair_contract", issues,
});

test("real conflicting action retains a blocking issue despite capability restrictions", () => {
  assert.doesNotThrow(() => validateNewIssueEvidence(assessment(), candidate));
});
test("AI may leave redundant wording as refinement without validator changing admission", () => {
  const bounded = structuredClone(candidate);
  const cards = JSON.parse(bounded.sceneCards);
  cards.scenes[0].mustAdvance.pop();
  bounded.sceneCards = JSON.stringify(cards);
  const usable = { ...assessment([]), verdict: "usable", safeToSync: true, recommendedHandling: "use_as_is",
    refinements: ["可将禁止兑现的表述集中到同一字段"] };
  const before = structuredClone(usable);
  assert.doesNotThrow(() => validateNewIssueEvidence(usable, bounded));
  assert.deepEqual(usable, before);
  const notApproved = { ...usable, verdict: "repairable", safeToSync: false, recommendedHandling: "repair_contract" };
  validateNewIssueEvidence(notApproved, bounded);
  assert.equal(notApproved.safeToSync, false);
  assert.equal(notApproved.verdict, "repairable");
});
test("fresh issues require basis while legacy previous issue records remain compatible", () => {
  const issue = conflicting();
  delete issue.basis;
  assert.throws(() => validateNewIssueEvidence(assessment([issue]), candidate), /requires an execution-impact basis/);
  assert.doesNotThrow(() => validateNewIssueEvidence(assessment([issue]), candidate, [issue]));
});
test("forged candidate or counter evidence and wrong paths are rejected", () => {
  for (const field of ["candidateEvidence", "counterEvidence"]) {
    const issue = conflicting();
    issue.basis[field][0].quote = "当前候选没有的原文";
    assert.throws(() => validateNewIssueEvidence(assessment([issue]), candidate), /absent from the current candidate/);
  }
  const issue = conflicting();
  issue.basis.candidateEvidence[0].sourcePath = "awakening.mustAdvance[0]";
  assert.throws(() => validateNewIssueEvidence(assessment([issue]), candidate), /absent from the current candidate/);
});
test("conflicts require two actual leaves, not duplicate quotes or aliases for the same leaf", () => {
  for (const secondPath of ["awakening.mustAdvance[1]", "sceneCards.scenes[0].mustAdvance[1]"]) {
    const issue = conflicting();
    issue.basis.candidateEvidence[1] = quote(secondPath, "当场发动血脉力量击杀押送者");
    assert.throws(() => validateNewIssueEvidence(assessment([issue]), candidate), /two distinct candidate requirements/);
  }
});
test("new blocking issue cannot coexist with any admission flag", () => {
  for (const flags of [{ verdict: "usable" }, { safeToSync: true }, { recommendedHandling: "use_as_is" }]) {
    assert.throws(() => validateNewIssueEvidence({ ...assessment(), ...flags }, candidate), /New blocking issues cannot/);
  }
});
test("missing prerequisite can cite its consuming action without fabricating a second requirement", () => {
  const issue = conflicting();
  issue.basis.kind = "unsupported_prerequisite";
  issue.basis.candidateEvidence = [issue.basis.candidateEvidence[0]];
  issue.basis.executionImpact = "动作依赖的可用力量尚未建立。";
  assert.doesNotThrow(() => validateNewIssueEvidence(assessment([issue]), candidate));
});
test("execution impact and consideration of existing constraints cannot be empty", () => {
  for (const field of ["executionImpact", "whyExistingConstraintsInsufficient"]) {
    const issue = conflicting();
    issue.basis[field] = " ";
    assert.throws(() => validateNewIssueEvidence(assessment([issue]), candidate), /requires an execution-impact basis/);
  }
});
