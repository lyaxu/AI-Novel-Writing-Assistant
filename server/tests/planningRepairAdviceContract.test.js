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
const reviewContract = load("../src/services/novel/director/recovery/planningRepair/advice/semanticReview/contract.ts", {
  zod, "@ai-novel/shared/types/planningRepair/advice": contract,
});
const reviewPrompt = load("../src/prompting/prompts/novel/volume/recovery/planningRepairAdviceReview.prompts.ts", {
  "@langchain/core/messages": require("@langchain/core/messages"), zod,
  "../../../../../llm/generatedContentSchema": { preserveGeneratedContentConstraints: schema => schema },
  "../../../../../services/novel/director/recovery/planningRepair/advice/semanticReview": reviewContract,
});

test("current review wire owns one required check per final option and rejects orphan IDs", () => {
  const wire = structuredClone(reviewPrompt.planningRepairAdviceReviewExample);
  const parse = value => reviewContract.planningRepairAdviceReviewModelOutputSchema.safeParse(value);
  assert.equal(parse(wire).success, true);
  const missing = structuredClone(wire); delete missing.options[0].check;
  assert.equal(parse(missing).success, false);
  assert.equal(parse({ ...wire, checks: [{ optionId: "deleted-b", ...wire.options[0].check }] }).success, false);
  const mismatched = structuredClone(wire); mismatched.options[0].check.optionId = "deleted-b";
  assert.equal(parse(mismatched).success, false);
  const duplicate = structuredClone(wire); duplicate.options.push(structuredClone(duplicate.options[0]));
  assert.equal(parse(duplicate).success, false);
  assert.equal(parse({ ...wire, recommendedOptionId: "deleted-b" }).success, false);
});

test("nested wire still enforces shared cross-field rules and retains the two-call boundary", () => {
  const wire = structuredClone(reviewPrompt.planningRepairAdviceReviewExample);
  wire.options[0].changes = [];
  assert.equal(reviewContract.planningRepairAdviceReviewModelOutputSchema.safeParse(wire).success, false);
  const long = structuredClone(reviewPrompt.planningRepairAdviceReviewExample);
  long.options[0].guidance.actions = Array(8).fill("长".repeat(400));
  long.options[0].guidance.verification = Array(8).fill("长".repeat(300));
  assert.equal(reviewContract.planningRepairAdviceReviewModelOutputSchema.safeParse(long).success, false);
  assert.deepEqual(reviewPrompt.planningRepairAdviceReviewPrompt.repairPolicy, { maxAttempts: 0 });
  assert.deepEqual(reviewPrompt.planningRepairAdviceReviewPrompt.semanticRetryPolicy, { maxAttempts: 0 });
  assert.match(fs.readFileSync(path.join(__dirname, "../src/prompting/registry/promptAssetLoaderEntries.ts"), "utf8"), /novel\.planning_repair\.advice_review@v6/);
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
