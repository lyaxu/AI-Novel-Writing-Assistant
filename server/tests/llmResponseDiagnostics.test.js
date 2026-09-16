const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFinishReason, reachedOutputLimit, resolveRepairOutputBudget, extractTransportErrorCode } = require("../dist/platform/llm/streaming/responseDiagnostics");

test("output limits distinguish explicit stops, missing metadata and token exhaustion", () => {
  assert.equal(extractFinishReason({response_metadata:{finish_reason:"length"}}), "length");
  assert.equal(extractFinishReason({responseMetadata:{stop_reason:"max_tokens"}}), "max_tokens");
  assert.equal(extractFinishReason({content:"stop"}), null);
  assert.equal(reachedOutputLimit({finishReason:"length"}), true);
  assert.equal(reachedOutputLimit({finishReason:"max_tokens"}), true);
  assert.equal(reachedOutputLimit({maxTokens:3200,completionTokens:3200}), true);
  assert.equal(reachedOutputLimit({finishReason:"stop",maxTokens:3200,completionTokens:3200}), false);
  assert.equal(reachedOutputLimit({maxTokens:3200,completionTokens:3100}), false);
});

test("repair budget grows only for exhausted output and remains bounded", () => {
  assert.equal(resolveRepairOutputBudget({maxTokens:3200,finishReason:"length"}), 6400);
  assert.equal(resolveRepairOutputBudget({maxTokens:6000,completionTokens:6000}), 8192);
  assert.equal(resolveRepairOutputBudget({maxTokens:8192,finishReason:"length"}), 8192);
  assert.equal(resolveRepairOutputBudget({maxTokens:16000,finishReason:"length"}), 16000);
  assert.equal(resolveRepairOutputBudget({maxTokens:3200,completionTokens:1500}), 3200);
  assert.equal(resolveRepairOutputBudget({}), undefined);
});

test("transport diagnostics retain a nested network code without serializing secrets", () => {
  assert.equal(extractTransportErrorCode(new TypeError("terminated", {cause: {code:"UND_ERR_SOCKET", socket:{secret:"hidden"}}})), "UND_ERR_SOCKET");
  assert.equal(extractTransportErrorCode(new Error("other")), null);
  const cycle = {}; cycle.cause = cycle;
  assert.equal(extractTransportErrorCode(cycle), null);
});

test("stream file logs keep finish reason, both token counts and nested transport code", async () => {
  const logs = require("../dist/llm/sessionLogFile");
  const {attachLLMDebugLogging} = require("../dist/llm/debugLogging");
  const originalAppend = logs.appendLlmSessionLog;
  const originalDebug = process.env.LLM_DEBUG_LOG;
  const captured = [];
  logs.appendLlmSessionLog = entry => captured.push(entry);
  process.env.LLM_DEBUG_LOG = "true";
  const failure = new TypeError("terminated", {cause:{code:"UND_ERR_SOCKET"}});
  const llm = {
    invoke:async () => ({}), batch:async () => [],
    stream:async function* () {
      yield {content:'partial',usage_metadata:{input_tokens:99,output_tokens:3200,total_tokens:3299}};
      yield {content:'',response_metadata:{finish_reason:'length'}};
    },
  };
  try {
    attachLLMDebugLogging(llm,{provider:"deepseek",model:"fixture",temperature:0,maxTokens:3200});
    for await(const chunk of await llm.stream([])) {}
    const response = captured.find(entry => entry.event === "response");
    assert.equal(response.finishReason,"length");
    assert.equal(response.actualPromptTokens,99);
    assert.equal(response.actualCompletionTokens,3200);
    assert.equal(response.outputLimitReached,true);
    const broken = {invoke:async () => ({}),batch:async () => [],stream:async function* () {throw failure;}};
    attachLLMDebugLogging(broken,{provider:"deepseek",model:"fixture",temperature:0});
    await assert.rejects(async () => {for await(const chunk of await broken.stream([])) {}}, error => error === failure);
    assert.equal(captured.find(entry => entry.event === "error").error.code,"UND_ERR_SOCKET");
  } finally {
    logs.appendLlmSessionLog = originalAppend;
    if(originalDebug === undefined) delete process.env.LLM_DEBUG_LOG;
    else process.env.LLM_DEBUG_LOG = originalDebug;
  }
});

test("Anthropic streaming preserves stop reason and usage and propagates error frames", async () => {
  const {createAnthropicLLM} = require("../dist/llm/anthropicClient");
  const {HumanMessage} = require("@langchain/core/messages");
  const originalFetch = global.fetch;
  const client = createAnthropicLLM({baseURL:"https://example.invalid",model:"fixture",temperature:0,maxTokens:3200});
  const events = [
    {type:"message_start",message:{usage:{input_tokens:10,output_tokens:0}}},
    {type:"content_block_delta",delta:{type:"text_delta",text:"partial"}},
    {type:"message_delta",delta:{stop_reason:"max_tokens"},usage:{output_tokens:3200}},
    {type:"message_stop"},
  ];
  global.fetch = async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
  try {
    const chunks = [];
    for await(const chunk of await client.stream([new HumanMessage("test")])) chunks.push(chunk);
    assert.equal(chunks.map(c => c.content).join(""), "partial");
    assert.equal(extractFinishReason(chunks.at(-1)), "max_tokens");
    assert.equal(chunks[0].response_metadata.usage.input_tokens, 10);
    assert.equal(chunks.at(-1).response_metadata.usage.output_tokens, 3200);
    global.fetch = async () => new Response('data: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n');
    await assert.rejects(async () => {
      for await(const chunk of await client.stream([new HumanMessage("test")])) {}
    }, /overloaded_error/);
  } finally { global.fetch = originalFetch; }
});
