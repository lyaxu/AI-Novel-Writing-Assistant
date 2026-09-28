const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { HumanMessage } = require("@langchain/core/messages");
const factory = require("../dist/llm/factory.js");
const fallbackSettings = require("../dist/llm/structuredFallbackSettings.js");
const { resolveStructuredOutputProfile } = require("../dist/llm/structuredOutput.js");
const { invokeStructuredLlmDetailed } = require("../dist/llm/structuredInvoke.js");
const {
  runStructuredPrompt, streamStructuredPrompt,
  setPromptRunnerStructuredInvokerForTests, setPromptRunnerLLMFactoryForTests,
} = require("../dist/prompting/core/promptRunner.js");

const singleRequestOptions = { disableFallbackModel: true, transportRetryCount: 0, disableStrategyFallback: true };
const schema = z.object({ value: z.literal("ok") });
function asset(overrides = {}) {
  return {
    // Reuse a registered identity; runner registration checks stay enabled in these isolated mocks.
    id: "genre.tree.generate", version: "v1", taskType: "planner", mode: "structured", language: "zh",
    contextPolicy: { maxTokensBudget: 100 }, repairPolicy: { maxAttempts: 0 },
    semanticRetryPolicy: { maxAttempts: 0 }, outputSchema: schema,
    render: () => [new HumanMessage("Return one JSON object")], ...overrides,
  };
}

async function withFactoryMock(run, behavior, settings = {}) {
  const original = { resolve: factory.resolveLLMClientOptions, create: factory.createLLMFromResolvedOptions,
    repair: factory.getLLM, fallback: fallbackSettings.getStructuredFallbackSettings };
  const observed = { calls: [], repairs: 0, settingsReads: 0 };
  factory.resolveLLMClientOptions = async (provider, options = {}) => ({
    ...options, provider, providerName: provider, apiKey: "test-key", model: options.model,
    temperature: options.temperature ?? 0.3, baseURL: "https://api.deepseek.com/v1",
    structuredProfile: resolveStructuredOutputProfile({ provider, model: options.model }), reasoningForcedOff: false,
  });
  factory.createLLMFromResolvedOptions = (options) => ({ stream: async function* () {
    observed.calls.push({ provider: options.provider, model: options.model, strategy: options.structuredStrategy });
    const raw = await behavior(observed.calls, options);
    yield { content: raw, response_metadata: { finish_reason: "stop" } };
  } });
  factory.getLLM = async () => { observed.repairs += 1; throw new Error("Unexpected JSON repair request"); };
  fallbackSettings.getStructuredFallbackSettings = async () => {
    observed.settingsReads += 1;
    return { enabled: true, provider: "openai", model: "fallback-model", retryCount: 3, temperature: 0.2, ...settings };
  };
  try { await run(observed); } finally {
    factory.resolveLLMClientOptions = original.resolve;
    factory.createLLMFromResolvedOptions = original.create;
    factory.getLLM = original.repair;
    fallbackSettings.getStructuredFallbackSettings = original.fallback;
  }
}

test("prompt runner forwards explicit single-request controls and zero JSON repair budget", async () => {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async (input) => {
    calls.push(input);
    return { data: { value: "ok" }, repairUsed: false, repairAttempts: 0 };
  });
  try {
    await runStructuredPrompt({ asset: asset(), promptInput: {}, options: singleRequestOptions });
    assert.equal(calls.length, 1);
    for (const [key, value] of Object.entries(singleRequestOptions)) assert.equal(calls[0][key], value);
    assert.equal(calls[0].maxRepairAttempts, 0);
    await runStructuredPrompt({ asset: asset(), promptInput: {} });
    for (const key of Object.keys(singleRequestOptions)) assert.equal(calls[1][key], undefined);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test("explicitly disabled semantic repair preserves a failed completed response without a second invocation", async () => {
  let calls = 0;
  setPromptRunnerStructuredInvokerForTests(async () => {
    calls += 1;
    return { data: { value: "ok" }, repairUsed: false, repairAttempts: 0 };
  });
  try {
    await assert.rejects(runStructuredPrompt({ asset: asset({ postValidate: () => { throw new Error("Plan needs revision"); } }),
      promptInput: {}, options: singleRequestOptions }), (error) => {
      assert.deepEqual(error.completedPromptResponse.output, { value: "ok" });
      return error.message === "Plan needs revision";
    });
    assert.equal(calls, 1);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test("a caller that deliberately enables semantic retry keeps its transport controls on that retry", async () => {
  const calls = [];
  setPromptRunnerStructuredInvokerForTests(async (input) => {
    calls.push(input);
    return { data: { value: "ok" }, repairUsed: false, repairAttempts: 0 };
  });
  try {
    await runStructuredPrompt({ asset: asset({ semanticRetryPolicy: { maxAttempts: 1 }, postValidate: (output) => {
      if (calls.length === 1) throw new Error("One explicit semantic retry is allowed");
      return output;
    } }), promptInput: {}, options: singleRequestOptions });
    assert.equal(calls.length, 2);
    for (const [key, value] of Object.entries(singleRequestOptions)) assert.equal(calls[1][key], value);
    assert.equal(calls[1].maxRepairAttempts, 0);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test("structured invocation sends exactly one request for transport, empty, format and schema failures", async () => {
  const cases = [
    () => { const error = new Error("503 service unavailable"); error.status = 503; throw error; },
    () => { const error = new Error("400 response_format json_object is unsupported"); error.status = 400; throw error; },
    () => "",
    () => "not valid JSON",
    () => '{"value":"wrong"}',
  ];
  for (const behavior of cases) {
    await withFactoryMock(async (observed) => {
      await assert.rejects(runStructuredPrompt({ asset: asset(), promptInput: {},
        options: { provider: "deepseek", model: "deepseek-chat", ...singleRequestOptions } }));
      assert.equal(observed.calls.length, 1, JSON.stringify(observed.calls));
      assert.equal(observed.repairs, 0);
      assert.equal(observed.settingsReads, 0);
    }, behavior);
  }
});

test("omitting transport override preserves configured retries", async () => {
  await withFactoryMock(async (observed) => {
    const result = await invokeStructuredLlmDetailed({ provider: "deepseek", model: "deepseek-chat", schema,
      label: "test.default-transport", systemPrompt: "JSON", userPrompt: "Return value", maxRepairAttempts: 0 });
    assert.deepEqual(result.data, { value: "ok" });
    assert.equal(observed.calls.length, 2);
  }, (calls) => {
    if (calls.length === 1) { const error = new Error("503 service unavailable"); error.status = 503; throw error; }
    return '{"value":"ok"}';
  }, { enabled: false, retryCount: 1 });
});

test("omitting strategy and model fallback flags preserves existing recovery", async () => {
  await withFactoryMock(async (observed) => {
    const result = await invokeStructuredLlmDetailed({ provider: "deepseek", model: "deepseek-chat", schema,
      label: "test.default-strategy", systemPrompt: "JSON", userPrompt: "Return value", maxRepairAttempts: 0 });
    assert.deepEqual(result.data, { value: "ok" });
    assert.ok(observed.calls.some((call) => call.provider === "deepseek" && call.strategy === "prompt_json"));
    assert.equal(observed.calls.at(-1).model, "fallback-model");
  }, (_calls, options) => options.model === "fallback-model" ? '{"value":"ok"}' : "invalid JSON", { retryCount: 0 });
});

test("empty structured stream does not spawn a replacement request when strategy fallback is disabled", async () => {
  let streamed = 0;
  let fallbackCalls = 0;
  setPromptRunnerLLMFactoryForTests(async () => ({ stream: async function* () { streamed += 1; } }));
  setPromptRunnerStructuredInvokerForTests(async () => { fallbackCalls += 1; throw new Error("Unexpected replacement request"); });
  try {
    const handle = await streamStructuredPrompt({ asset: asset(), promptInput: {},
      options: { provider: "deepseek", model: "deepseek-chat", ...singleRequestOptions } });
    for await (const _chunk of handle.stream) { /* consume the only stream */ }
    await assert.rejects(handle.complete, /没有返回可用内容/);
    assert.equal(streamed, 1);
    assert.equal(fallbackCalls, 0);
  } finally { setPromptRunnerLLMFactoryForTests(); setPromptRunnerStructuredInvokerForTests(); }
});
