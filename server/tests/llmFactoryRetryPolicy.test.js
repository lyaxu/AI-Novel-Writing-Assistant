const test = require("node:test");
const assert = require("node:assert/strict");

const { createLLMFromResolvedOptions, resolveLLMClientOptions, setProviderSecretCache } = require("../dist/llm/factory.js");

test("official K3 book candidates use low effort and a bounded native completion budget", async () => {
  const provider = "custom_k3_policy_test";
  setProviderSecretCache(provider, { key: "fake-test-key", reasoningEnabled: false, reasoningEffort: "max" });
  const options = {
    model: "kimi-k3", baseURL: "https://api.moonshot.cn/v1",
    executionMode: "structured", structuredStrategy: "json_object", maxTokens: 10000,
    promptMeta: { promptId: "novel.director.candidates", promptVersion: "v3" },
  };
  try {
    for (const [baseURL, promptId] of [
      ["https://api.moonshot.cn/v1", "novel.director.candidates"],
      ["https://api.moonshot.ai/v1", "novel.director.candidates"],
      ["https://api.moonshot.cn/v1", "novel.world.generate_from_theme"],
    ]) {
      const resolved = await resolveLLMClientOptions(provider, { ...options, baseURL, promptMeta: { ...options.promptMeta, promptId } });
      assert.equal(resolved.reasoningEnabled, true);
      assert.equal(resolved.reasoningEffort, "low");
      assert.equal(resolved.maxTokens, 32768);
      assert.equal(resolved.modelKwargs.thinking, undefined);
      const params = createLLMFromResolvedOptions(resolved).invocationParams({});
      assert.equal(params.reasoning_effort, "low");
      assert.equal(params.max_completion_tokens, 32768);
      assert.equal(params.max_tokens, undefined);
    }
    for (const changes of [
      { promptMeta: { promptId: "novel.chapter.writer" } },
      { promptMeta: { promptId: "novel.director.candidates.patch" } },
      { executionMode: "plain" },
      { model: "kimi-k2.5" },
      { requestProtocol: "anthropic" },
      { baseURL: "https://gateway.example/v1" },
      { baseURL: "https://api.moonshot.cn.attacker.example/v1" },
    ]) {
      const resolved = await resolveLLMClientOptions(provider, { ...options, ...changes });
      assert.notEqual(resolved.maxTokens, 32768);
      assert.equal(resolved.modelKwargs?.reasoning_effort, undefined);
      assert.equal(resolved.modelKwargs?.max_completion_tokens, undefined);
    }
  } finally { setProviderSecretCache(provider, null); }
});

test("OpenAI-compatible clients leave retries to explicit product workflows", () => {
  const llm = createLLMFromResolvedOptions({
    provider: "custom",
    providerName: "Custom",
    model: "test-model",
    temperature: 0.2,
    baseURL: "http://127.0.0.1:1/v1",
    authMode: "none",
    concurrencyLimit: 1,
    requestIntervalMs: 0,
    reasoningEnabled: false,
    reasoningEffort: null,
    includeRawResponse: false,
    requestProtocol: "openai",
    executionMode: "text",
    structuredProfile: null,
    structuredStrategy: null,
    reasoningForcedOff: false,
  });

  assert.equal(llm.caller.maxRetries, 0);
});
