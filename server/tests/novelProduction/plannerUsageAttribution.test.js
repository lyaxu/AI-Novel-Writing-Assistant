const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');

test('chapter planning records the persisted chapter identity through the shared prompt runner', async () => {
  const invocations = [];
  const { invokePlannerLLM } = loadRuntimeSource('../../planner/plannerLlm.ts', {
    '../../prompting/core/promptRunner': { runStructuredPrompt: async (input) => {
      invocations.push(input); return { output: { title: 'plan' } };
    } },
    './plannerOutputNormalization': { normalizePlannerOutput: value => value },
    '../../prompting/prompts/planner/plannerPlan.prompts': {
      plannerBookPlanPrompt: { id: 'book' }, plannerArcPlanPrompt: { id: 'arc' }, plannerChapterPlanPrompt: { id: 'chapter' },
    },
  });
  for (const planLevel of ['book', 'arc', 'chapter']) {
    await invokePlannerLLM({ planLevel, options: {}, scopeLabel: 'scope', contextBlocks: [],
      attribution: { novelId: 'book-id', ...(planLevel === 'chapter' ? { chapterId: 'chapter-id' } : {}) } });
  }
  assert.equal(invocations[2].options.chapterId, 'chapter-id');
  assert.equal(invocations[2].options.novelId, 'book-id');
  assert.equal(invocations[2].options.stage, 'story_plan');
  assert.equal(invocations[2].options.scope, 'chapter');
  assert.ok(invocations.slice(0, 2).every(input => input.options.chapterId === undefined));
});
