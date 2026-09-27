const test = require("node:test");
const assert = require("node:assert/strict");
const runner = require("../dist/prompting/core/promptRunner.js");
const factory = require("../dist/llm/factory.js");
const live = require("../dist/platform/llm/live/llmLiveSession.js");
const { styleRewritePrompt } = require("../dist/prompting/prompts/style/style.prompts.js");
const { genreTreePrompt } = require("../dist/prompting/prompts/genre/genre.prompts.js");
const textInput = { asset: styleRewritePrompt, promptInput: {
  styleBlock: "plain", characterBlock: "action", antiAiBlock: "", content: "original", issuesBlock: "",
}, options: { maxTokens: 6000 } };

for (const mode of ["runText", "streamText", "streamStructured"]) {
  test(`${mode} records reasoning usage then rejects output exhaustion without empty fallback`, async () => {
    const originalBegin = live.beginLlmLiveSession;
    const events = [];
    let calls = 0, fallbacks = 0;
    live.beginLlmLiveSession = () => ({ phase() {}, delta() {}, reasoning() {},
      usage: value => events.push(["usage", value]), fail: error => events.push(["fail", error]), complete() {},
    });
    runner.setPromptRunnerLLMFactoryForTests(async () => ({ stream: async function* () {
      calls++;
      yield { content: "", response_metadata: { finish_reason: "length" },
        usage_metadata: { input_tokens: 100, output_tokens: 6000, total_tokens: 6100,
          output_token_details: { reasoning: 6000 } } };
    } }));
    runner.setPromptRunnerStructuredInvokerForTests(async () => { fallbacks++; throw new Error("must not retry"); });
    try {
      await assert.rejects(async () => {
        if (mode === "runText") return runner.runTextPrompt(textInput);
        const handle = await (mode === "streamText" ? runner.streamTextPrompt(textInput)
          : runner.streamStructuredPrompt({ asset: genreTreePrompt,
            promptInput: { prompt: "fiction", retry: false, forceJson: true }, options: { maxTokens: 6000 } }));
        for await (const chunk of handle.stream) {}
        return handle.complete;
      }, error => {
        assert.equal(error.code, "LLM_OUTPUT_LIMIT");
        assert.equal(error.category, "output_limit");
        assert.equal(error.details.reasoningTokens, 6000);
        return true;
      });
      assert.equal(calls, 1);
      assert.equal(fallbacks, 0);
      assert.equal(events[0][0], "usage");
      assert.equal(events[0][1].completionTokens, 6000);
      assert.equal(events.at(-1)[0], "fail");
    } finally {
      live.beginLlmLiveSession = originalBegin;
      runner.setPromptRunnerLLMFactoryForTests();
      runner.setPromptRunnerStructuredInvokerForTests();
    }
  });
}

test("text limit inference uses resolved budget and preserves a normally stopped empty response", async () => {
  const originalResolved = factory.getResolvedLLMClientOptionsFromInstance;
  factory.getResolvedLLMClientOptionsFromInstance = () => ({ maxTokens: 32768 });
  let tokens = 6000, finishReason;
  runner.setPromptRunnerLLMFactoryForTests(async () => ({ stream: async function* () {
    yield { content: "", response_metadata: { finish_reason: finishReason },
      usage_metadata: { input_tokens: 1, output_tokens: tokens, total_tokens: tokens + 1 } };
  } }));
  try {
    assert.equal((await runner.runTextPrompt(textInput)).output, "");
    tokens = 32768;
    await assert.rejects(runner.runTextPrompt(textInput), error => error.code === "LLM_OUTPUT_LIMIT"
      && error.details.maxTokens === 32768);
    finishReason = "stop";
    const handle = await runner.streamTextPrompt(textInput);
    for await (const chunk of handle.stream) {}
    assert.equal((await handle.complete).output, "");
  } finally {
    factory.getResolvedLLMClientOptionsFromInstance = originalResolved;
    runner.setPromptRunnerLLMFactoryForTests();
  }
});
