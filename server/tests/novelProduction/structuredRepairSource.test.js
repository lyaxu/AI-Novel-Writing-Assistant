const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const zod = require('zod');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const fixture = require('./fixtures/secondChapterReviewV16.json');

const novelText = loadRuntimeSource('../novelP0Utils.ts', {});
const diagnostics = loadRuntimeSource('../../../platform/llm/streaming/responseDiagnostics.ts', {});
const omission = '\n...[中间的异常重复或退化内容已省略，不能复述或延续]...\n';
const sourceStart = '原始模型输出（可能包含多余文本、markdown 或截断）：\n';
const sourceEnd = '\n\n请修复后只输出最终 JSON。';

function harness({ response = '{"ok":true}', finishReason = 'stop' } = {}) {
  const calls = [];
  const logs = [];
  class Message { constructor(content) { this.content = content; } }
  const repair = loadRuntimeSource('../../../llm/structuredInvokeRepair.ts', {
    '@langchain/core/messages': { HumanMessage: Message, SystemMessage: Message },
    zod,
    './factory': { getLLM: async (_provider, options) => ({
      async *stream(messages) {
        calls.push({ options, messages });
        yield { content: response, response_metadata: { finish_reason: finishReason } };
      },
    }) },
    './invokeTimeout': { runWithEnforcedTimeout: ({ run }) => run(undefined) },
    './repairLogging': { logStructuredRepairSession: entry => logs.push(entry) },
    '../services/novel/novelP0Utils': novelText,
    './usageTracking': { extractLlmTokenUsage: () => null, mergeStreamTokenUsage: () => null },
    '../platform/llm/streaming/responseDiagnostics': diagnostics,
  });
  const helpers = {
    tryParseStructuredJsonValue: source => {
      try { return { parsed: JSON.parse(source) }; } catch (error) { return { error: error.message }; }
    },
    tryUnwrapSingletonArrayWrapper: () => null,
    normalizeOversizedArrays: () => null,
    formatZodErrors: error => error.message,
    logStructuredInvokeEvent: () => {},
  };
  const input = { label: 'offline-lossless-repair', schema: zod.z.object({ ok: zod.z.boolean() }),
    maxTokens: 6000, finishReason: 'stop' };
  return { calls, logs, repair, input,
    run: raw => repair.repairWithLlm(input, raw, '- constraints: expected array', 1, helpers),
    source: () => {
      const human = calls[0].messages[1].content;
      return human.slice(human.indexOf(sourceStart) + sourceStart.length, -sourceEnd.length);
    },
  };
}

for (let index = 0; index < 4; index++) {
  test(`real v16 response ${index + 1} reaches repair in full with original bytes and budget`, async () => {
    const raw = fixture.responseContents[index];
    assert.ok(raw.length > 12000);
    assert.equal(createHash('sha256').update(raw).digest('hex'), fixture.responses[index].rawContentSha256);
    assert.deepEqual(JSON.parse(raw), fixture.outputs[index]);
    const h = harness();
    assert.deepEqual(await h.run(raw), { ok: true });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].options.maxTokens, 6000);
    assert.equal(h.source(), raw);
    assert.equal(h.source().includes(omission), false);
    assert.ok(h.logs.find(entry => entry.event === 'repair_start').repairHuman.includes(raw));
    // The two original review answers lost this action in the previous 9000/2000 cut.
    if (index === 0 || index === 2) {
      const payIndex = raw.indexOf('pay_and_depart', raw.indexOf('actionStateChecks'));
      assert.ok(payIndex > 9000 && payIndex < raw.length - 2000);
      assert.ok(h.source().slice(9000, -2000).includes('pay_and_depart'));
    }
  });
}

test('large valid primitive, array and repeated strings remain complete JSON data', async () => {
  for (const value of ['合法重复内容'.repeat(4000), Array.from({ length: 1500 }, (_, i) => ({ id: i, value: '保留' }))]) {
    const raw = JSON.stringify(value);
    const h = harness();
    await h.run(raw);
    assert.equal(h.source(), raw);
  }
});

test('complete Markdown JSON fence keeps the exact raw response', async () => {
  const raw = '```json\r\n' + fixture.responseContents[0] + '\r\n```';
  const h = harness();
  await h.run(raw);
  assert.equal(h.source(), raw);
});

test('malformed or degraded long output keeps existing bounded head/tail behavior', async () => {
  for (const raw of ['{"value":"' + '损坏'.repeat(10000), '退化'.repeat(10000) + '{}']) {
    const h = harness();
    await h.run(raw);
    assert.equal(h.source(), raw.slice(0, 9000) + omission + raw.slice(-2000));
    assert.ok(h.source().length < 12000);
    assert.equal(h.calls[0].options.maxTokens, 6000);
  }
});

test('initial output_limit stays terminal even for a large valid JSON response', async () => {
  const h = harness();
  class StructuredOutputError extends Error {
    constructor(input) { super(input.message); Object.assign(this, input); }
  }
  const parser = loadRuntimeSource('../../../llm/structuredInvokeParser.ts', {
    zod,
    './generatedContentSchema': { relaxGeneratedContentSchema: schema => schema, hasPreservedGeneratedContentConstraints: () => false },
    './structuredInvokeRepair': h.repair,
    './structuredOutput': { StructuredOutputError },
    '../services/novel/novelP0Utils': novelText,
    '../platform/llm/streaming/responseDiagnostics': diagnostics,
  });
  for (const rawContent of [fixture.responseContents[0], '{"unfinished":']) {
    await assert.rejects(parser.parseStructuredLlmRawContentDetailed({ ...h.input,
      rawContent, finishReason: 'length', maxRepairAttempts: 2, strategy: 'prompt_json', profile: {},
    }), error => error.category === 'output_limit');
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.logs.length, 0);
});

test('a truncated repair response fails at its existing budget without another module call', async () => {
  const h = harness({ response: '{"ok":', finishReason: 'length' });
  await assert.rejects(h.run(fixture.responseContents[0]), /修复输出也达到额度上限（6000 tokens）/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.maxTokens, 6000);
});

test('real structured parser preserves every complete JSON root through an unknown envelope', async () => {
  const h = harness();
  class StructuredOutputError extends Error {
    constructor(input) { super(input.message); Object.assign(this, input); }
  }
  const parser = loadRuntimeSource('../../../llm/structuredInvokeParser.ts', {
    zod,
    './generatedContentSchema': { relaxGeneratedContentSchema: schema => schema, hasPreservedGeneratedContentConstraints: () => false },
    './structuredInvokeRepair': h.repair,
    './structuredOutput': { StructuredOutputError },
    '../services/novel/novelP0Utils': novelText,
    '../platform/llm/streaming/responseDiagnostics': diagnostics,
  });
  for (const value of [[fixture.outputs[0]], null, '字符串里的 {"field":true} 和 [1,2] 不是外层对象', 17.5, true, false]) {
    const result = await parser.parseStructuredLlmRawContentDetailed({ ...h.input,
      schema: zod.z.unknown(), rawContent: JSON.stringify(value), maxRepairAttempts: 0,
      strategy: 'prompt_json', profile: {},
    });
    assert.deepEqual(result.data, value);
    assert.equal(result.repairUsed, false);
    assert.equal(result.repairAttempts, 0);
  }
  // Objects in explanatory wrappers retain the pre-existing extraction path.
  const wrapped = await parser.parseStructuredLlmRawContentDetailed({ ...h.input,
    schema: zod.z.unknown(), rawContent: '```json\n{"ok":true}\n```', maxRepairAttempts: 0,
    strategy: 'prompt_json', profile: {},
  });
  assert.deepEqual(wrapped.data, { ok: true });
  await assert.rejects(parser.parseStructuredLlmRawContentDetailed({ ...h.input,
    schema: zod.z.unknown(), rawContent: '{"value":"unterminated', maxRepairAttempts: 0,
    strategy: 'prompt_json', profile: {},
  }), error => error.category === 'malformed_json');
  assert.equal(h.calls.length, 0);
  assert.equal(h.logs.length, 0);
});
