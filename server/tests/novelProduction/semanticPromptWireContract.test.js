// Exercise current prompt source, not a historical model answer or a copied schema example.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

function loadSource(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '../../src', relative);
  const runtimeRequire = createRequire(path.resolve(__dirname, '../../dist', relative.replace(/\.ts$/, '.js')));
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${compiled}\n})`, { filename })(
    id => Object.hasOwn(overrides, id) ? overrides[id] : runtimeRequire(id), exports);
  return exports;
}

const prefix = 'prompting/prompts/novel/acceptance/semantic/';
const actions = loadSource(`${prefix}actionFacts.ts`);
const scenes = loadSource(`${prefix}sceneFindings.ts`);
const physical = loadSource(`${prefix}physicalContinuity.ts`);
const contract = loadSource(`${prefix}reviewContract.ts`, {
  './actionFacts': actions, './sceneFindings': scenes, './physicalContinuity': physical,
});
const wire = loadSource(`${prefix}wireReview.ts`, { './reviewContract': contract });
const semantic = { ...require('../../dist/prompting/prompts/novel/acceptance/semantic'), ...actions, ...scenes, ...physical, ...contract, ...wire };
const { chapterAcceptanceAssessmentPrompt: asset, semanticChapterAcceptanceSchema: reviewSchema } = loadSource('prompting/prompts/novel/chapterAcceptance.prompts.ts', {
  './acceptance/semantic': semantic,
  './acceptance/semantic/physicalContinuity': physical,
});
const { appendStructuredOutputHintMessages } = require('../../dist/prompting/core/structuredOutputHint');
const { actionStateDimensionCheckSchema } = require('@ai-novel/shared/types/novel/sceneCausality');
const input = { chapterId: 'offline', chapterOrder: 1, novelTitle: '离线结构样例', chapterTitle: '结构样例',
  expectedSceneKeys: ['arrival', 'decision', 'departure'], content: '她读完条款。她拒绝签字。对方收回合同。' };
const context = { blocks: [], droppedBlockIds: [], summarizedBlockIds: [], estimatedInputTokens: 0 };
function rendered() {
  return appendStructuredOutputHintMessages({ asset, promptInput: input, context, messages: asset.render(input, context) })
    .map(message => String(message.content));
}

test('actual rendered prompt exposes the schema dimension enum and distinguishes all five meanings', () => {
  const text = rendered().join('\n');
  const enumText = actionStateDimensionCheckSchema.shape.dimension.options.join('|');
  assert.ok(text.includes(`只能是：${enumText}`));
  for (const definition of ['body=身体', 'item=物品、现金', 'ability=技能', 'knowledge=对一个具体命题', 'location=位置']) {
    assert.ok(text.includes(definition), definition);
  }
  assert.ok(text.includes('不要创造resources、money等别名'));
  const invalid = contract.semanticExample(); invalid.actionStateChecks[0].states[0].dimension = 'resources';
  assert.equal(reviewSchema.safeParse(invalid).success, false);
});

test('actual prompt says constraints is an array and output hint demonstrates a nonempty one', () => {
  const messages = rendered(); const text = messages.join('\n');
  assert.ok(text.includes('constraints始终是finding对象数组'));
  assert.ok(text.includes('只有一项也必须带方括号'));
  assert.match(messages.at(-1), /"sceneCausalityVerdicts"\s*:\s*\[\s*\{/);
  assert.match(messages.at(-1), /"constraints"\s*:\s*\[\s*\{/);
  const bad = contract.semanticExample(); bad.sceneCausalityVerdicts[0].constraints = bad.sceneCausalityVerdicts[0].constraints[0];
  assert.equal(reviewSchema.safeParse(bad).success, false);
});

test('example satisfies real output schema, retains all four roles and stays one illustration for many scenes', () => {
  const example = contract.semanticExample(input);
  assert.doesNotThrow(() => reviewSchema.parse(example));
  assert.equal(example.sceneCausalityVerdicts.length, 1);
  assert.equal(example.actionStateChecks.length, 1);
  assert.equal(example.sceneCausalityVerdicts[0].sceneKey, 'arrival');
  const state = example.actionStateChecks[0].states[0];
  for (const fact of [state.before, state.after, state.prerequisite.basis, state.resultChange.basis]) {
    assert.equal(fact.entity, state.entity);
    assert.equal(fact.dimension, state.dimension);
    assert.ok(fact.claim && fact.reason && fact.evidence.length);
    assert.equal(fact.support, 'supported');
  }
  assert.equal(state.resultChange.status, 'unchanged');
  assert.equal(example.status, undefined);
  assert.equal(example.repairability, undefined);
  assert.equal(example.actionStateChecks[0].verdict, undefined);
  assert.ok(rendered().join('\n').includes(JSON.stringify(input.expectedSceneKeys)));
});

test('state instructions distinguish a property comparison from unrelated consequences without demanding manuscript changes', () => {
  const text = actions.SEMANTIC_ACTION_RULES.join('\n');
  assert.ok(text.includes('同一具体属性'));
  assert.ok(text.includes('不要求五维齐全'));
  assert.ok(text.includes('不能仅统一dimension标签'));
  assert.ok(text.includes('身体受伤和工具耗尽不能作为掌握技能这一属性的after'));
  assert.ok(text.includes('不是现金的after'));
  assert.ok(text.includes('不同命题'));
  assert.ok(text.includes('审查字段错绑应纠正审查回答'));
  assert.ok(text.includes('该句必须支持action所述全部行动'));
  assert.doesNotMatch(text, /劳梓凡|郑小满|茅山|八极拳/);
});

test('scene instructions preserve actual effects and prohibit reversing their chronology into motives', () => {
  const text = scenes.SEMANTIC_SCENE_RULES.join('\n');
  assert.ok(text.includes('先发生的披露不能写成后续事件促成'));
  assert.ok(text.includes('不必都成为动作必要前提'));
  assert.ok(text.includes('程度和数量须一致'));
});
