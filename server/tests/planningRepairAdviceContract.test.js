const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const zod = require("zod");

function load(file, imports) {
  const filename = path.resolve(__dirname, file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${compiled}\n})`, { filename })((id) => {
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

const contract = load("../../shared/types/planningRepair/advice.ts", { zod });
const prompt = load("../src/prompting/prompts/novel/volume/recovery/planningRepairAdvice.prompts.ts", {
  "@langchain/core/messages": require("@langchain/core/messages"),
  zod,
  "@ai-novel/shared/types/planningRepair/advice": contract,
  "../../../../../llm/generatedContentSchema": { preserveGeneratedContentConstraints: (schema) => schema },
});

test("review-only advice with no candidate changes survives the full response contract", () => {
  // The observed failure had a valid repair option plus a review-only option with changes: [].
  // Rejecting the second option made the entire usable response unavailable.
  const result = contract.planningRepairAdviceOutputSchema.safeParse(prompt.planningRepairAdviceExample);
  assert.equal(result.success, true, result.success ? undefined : result.error.message);
  const review = result.data.options.find((option) => option.executionMode === "review_existing");
  assert.deepEqual(review.changes, []);
  assert.ok(review.guidance.actions.length > 0);
});

test("mutating advice still requires actual changes even when another option is review-only", () => {
  for (const executionMode of ["repair_then_review", "source_edit"]) {
    const response = structuredClone(prompt.planningRepairAdviceExample);
    response.options[0].executionMode = executionMode;
    response.options[0].changes = [];
    const result = contract.planningRepairAdviceOutputSchema.safeParse(response);
    assert.equal(result.success, false, executionMode);
    assert.ok(result.error.issues.some((issue) => issue.path.join(".") === "options.0.changes"));
  }
});

test("review-only advice cannot omit the actions and verification needed for a real review", () => {
  for (const field of ["actions", "verification"]) {
    const response = structuredClone(prompt.planningRepairAdviceExample);
    response.options[1].guidance[field] = [];
    const result = contract.planningRepairAdviceOutputSchema.safeParse(response);
    assert.equal(result.success, false, field);
  }
});
