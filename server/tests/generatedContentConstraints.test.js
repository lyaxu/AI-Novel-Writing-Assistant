const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { preserveGeneratedContentConstraints, relaxGeneratedContentSchema } = require("../dist/llm/generatedContentSchema");
const { planningRepairOutputSchema } = require("../dist/services/novel/volume/planningRepair/planningRepairDomain");
const { parseStructuredLlmRawContentDetailed } = require("../dist/llm/structuredInvokeParser");
const { resolveStructuredOutputProfile } = require("../dist/llm/structuredOutput");

test("the actual parser rejects an oversized strict contract before post-validation without an extra model call", async () => {
  const schema = preserveGeneratedContentConstraints(z.object({ taskSheet: z.string().max(600) }));
  const input = { schema, rawContent: JSON.stringify({ taskSheet: "a".repeat(601) }),
    provider: "deepseek", model: "deepseek-v4-flash", label: "strict-contract-test", maxRepairAttempts: 0,
    strategy: "prompt_json", profile: resolveStructuredOutputProfile({ provider: "deepseek", model: "deepseek-v4-flash" }) };
  await assert.rejects(parseStructuredLlmRawContentDetailed(input), /Schema/);
  const result = await parseStructuredLlmRawContentDetailed({ ...input, rawContent: JSON.stringify({ taskSheet: "a".repeat(600) }) });
  assert.equal(result.data.taskSheet.length, 600);
  assert.equal(result.repairUsed, false);
});

test("strict contracts retain nested text limits while ordinary generated content remains compatible", () => {
  const schema = z.object({ changes: z.array(z.object({ taskSheet: z.string().min(1).max(600) })) });
  const oversized = { changes: [{ taskSheet: "a".repeat(601) }] };
  assert.equal(relaxGeneratedContentSchema(schema).safeParse(oversized).success, true);
  preserveGeneratedContentConstraints(schema);
  assert.equal(relaxGeneratedContentSchema(schema), schema, "strict opt-in must override an existing relaxed cache entry");
  assert.equal(relaxGeneratedContentSchema(schema).safeParse(oversized).success, false);
  assert.equal(relaxGeneratedContentSchema(schema).safeParse({ changes: [{ taskSheet: "a".repeat(600) }] }).success, true);
  assert.equal(relaxGeneratedContentSchema(schema).safeParse({ changes: [{ taskSheet: "" }] }).success, false);
});

test("planning repairs use the same strict schema before and after prompt validation", () => {
  assert.equal(relaxGeneratedContentSchema(planningRepairOutputSchema), planningRepairOutputSchema);
  assert.equal(planningRepairOutputSchema.shape.changes.element.shape.taskSheet.safeParse("a".repeat(601)).success, false);
});
