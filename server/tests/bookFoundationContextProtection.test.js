const test = require("node:test");
const assert = require("node:assert/strict");
const { getAllContextBlocks, buildMacroConstraintContext } = require("../dist/prompting/prompts/novel/chapterLayeredContext.js");
const { buildPreviewChapterWriteContext } = require("../dist/prompting/workbench/writerPreviewContext.js");
const { createRuntimeContextResolvers } = require("../dist/prompting/context/runtimeContextResolvers.js");
const { createContextBlock } = require("../dist/prompting/core/contextBudget.js");
const { selectContextBlocks } = require("../dist/prompting/core/contextSelection.js");
// Keep this contract test independent of a real database or native SQLite runtime.
const overridePath = require.resolve("../dist/prompting/templates/PromptTemplateOverrideService.js");
const previousOverrideModule = require.cache[overridePath];
const promptTemplateOverrideService = { getActiveCustomTemplate: async () => null };
require.cache[overridePath] = { id: overridePath, filename: overridePath, loaded: true, exports: { promptTemplateOverrideService } };
const { resolveAdvancedPromptMessages } = require("../dist/prompting/templates/templateRuntime.js");
if (previousOverrideModule) require.cache[overridePath] = previousOverrideModule;
else delete require.cache[overridePath];
const { getRequiredTemplateContextGroups } = require("../dist/prompting/templates/templateTypes.js");

const foundation = {
  throughline: { centralQuestion: "FOUNDATION_START_CAN_THEY_SHARE", thematicAnswer: "Cooperate through choices",
    endingChoice: "Share ownership", choiceCost: "Give up control", resolution: "Keep a shared workshop",
    setupPayoffs: [{ setup: "An old key", payoff: "Open together" }] },
  worldBoundary: { baseline: "Historical workshop", crossingRules: "Memories cross; objects do not", knowledgeBoundary: "The ending is author knowledge", hardLimits: ["NO_UNSOURCED_MODERN_OBJECTS"] },
  characterDynamics: [{ role: "Apprentice", independentGoal: "Earn a living", mainlineEffect: "Controls production", relationshipChange: "Earn mutual trust" }],
  viewpoint: { anchor: "Ordinary artisan", scopeConnection: "Changing rules affect wages" },
  progression: { escalationLogic: "Decisions create consequences", emotionalMovement: "FOUNDATION_END_EARNED_WARMTH" },
};
function writeContext(withFoundation = true) {
  const context = buildPreviewChapterWriteContext({ novel: { id: "book-test", title: "Workshop", characters: [] },
    chapter: { id: "chapter-test", title: "First shift", order: 1, expectation: "Earn a place", targetWordCount: 2000 } });
  context.macroConstraints = buildMacroConstraintContext({ constraints: [], decomposition: {
    selling_point: "Workshop", core_conflict: "Trust", main_hook: "Can they share?", progression_loop: "Work and negotiate",
    growth_path: "Accept help", ending_flavor: "Warm" }, ...(withFoundation ? { bookStoryFoundation: foundation } : {}) });
  return context;
}
function assertProtected(block, blocks) {
  assert.ok(block);
  assert.equal(block.required, true);
  assert.equal(block.allowSummary, false);
  const result = selectContextBlocks(blocks, { maxTokensBudget: 1, requiredGroups: [], preferredGroups: [], dropOrder: ["story_macro"] });
  const selected = result.selectedBlocks.find(item => item.group === "story_macro");
  assert.ok(selected, "foundation survives an exhausted prompt budget");
  assert.equal(selected.content, block.content, "foundation is not truncated or summarized");
  assert.match(selected.content, /FOUNDATION_START_CAN_THEY_SHARE/);
  assert.match(selected.content, /NO_UNSOURCED_MODERN_OBJECTS/);
  assert.match(selected.content, /FOUNDATION_END_EARNED_WARMTH/);
  assert.equal(result.summarizedBlockIds.includes(block.id), false);
  assert.equal(result.droppedBlockIds.includes(block.id), false);
}

test("package writer context retains the full book foundation under a tiny budget", () => {
  const blocks = getAllContextBlocks({ chapterWriteContext: writeContext(), ragContext: "" });
  assertProtected(blocks.find(block => block.group === "story_macro"), blocks);
});

test("runtime story macro resolver independently protects the full book foundation", async () => {
  const resolver = createRuntimeContextResolvers().find(item => item.group === "story_macro");
  const blocks = await resolver.resolve({ executionContext: { metadata: { chapterWriteContext: writeContext() } } });
  assertProtected(blocks.find(block => block.group === "story_macro"), blocks);
});

test("legacy macro remains optional at both entry points and can yield its budget", async () => {
  const context = writeContext(false);
  const packageBlocks = getAllContextBlocks({ chapterWriteContext: context, ragContext: "" });
  const resolver = createRuntimeContextResolvers().find(item => item.group === "story_macro");
  const runtimeBlocks = await resolver.resolve({ executionContext: { metadata: { chapterWriteContext: context } } });
  for (const blocks of [packageBlocks, runtimeBlocks]) {
    const block = blocks.find(item => item.group === "story_macro");
    assert.ok(block);
    assert.equal(block.required, false);
    const result = selectContextBlocks(blocks, { maxTokensBudget: 1, requiredGroups: [] });
    assert.equal(result.selectedBlocks.some(item => item.group === "story_macro"), false);
  }
});

function templateInput(extraBlocks = []) {
  const groups = getRequiredTemplateContextGroups("novel.chapter.writer");
  const blocks = groups.map(group => createContextBlock({ id: group, group, priority: 100, required: true, content: `Required ${group}` }));
  blocks.push(...extraBlocks);
  return { asset: { id: "novel.chapter.writer", contextPolicy: { maxTokensBudget: 8000, requiredGroups: groups,
      preferredGroups: ["story_macro"] }, slots: [] }, novelId: "book-test", promptInput: {},
    context: { blocks, selectedBlockIds: blocks.map(block => block.id), droppedBlockIds: [], summarizedBlockIds: [], estimatedInputTokens: 10 }, officialMessages: [] };
}
async function withCustomTemplate(run, content = "Write the next scene.") {
  const original = promptTemplateOverrideService.getActiveCustomTemplate;
  promptTemplateOverrideService.getActiveCustomTemplate = async () => ({ template: { kind: "chat", messages: [{ role: "system", content: "Write fiction following the supplied story context." }, { role: "human", content }] } });
  try { return await run(); } finally { promptTemplateOverrideService.getActiveCustomTemplate = original; }
}

test("custom writer template omitting story_macro receives the protected foundation", async () => {
  const block = getAllContextBlocks({ chapterWriteContext: writeContext(), ragContext: "" }).find(item => item.group === "story_macro");
  await withCustomTemplate(async () => {
    const messages = await resolveAdvancedPromptMessages(templateInput([block]));
    const text = messages.map(message => message.content).join("\n");
    assert.ok(text.includes(block.content), "runtime-required foundation is backfilled in full");
    assert.match(text, /NO_UNSOURCED_MODERN_OBJECTS/);
  });
});

test("explicit custom template foundation token renders once without duplicate fallback", async () => {
  const block = getAllContextBlocks({ chapterWriteContext: writeContext(), ragContext: "" }).find(item => item.group === "story_macro");
  await withCustomTemplate(async () => {
    const text = (await resolveAdvancedPromptMessages(templateInput([block]))).map(message => message.content).join("\n");
    assert.equal(text.split("FOUNDATION_START_CAN_THEY_SHARE").length - 1, 1);
  }, "Write within these boundaries: {{context.story_macro}}");
});

test("custom writer templates remain usable for legacy books without any foundation block", async () => {
  await withCustomTemplate(async () => {
    const messages = await resolveAdvancedPromptMessages(templateInput());
    assert.ok(messages.length > 0);
    const text = messages.map(message => message.content).join("\n");
    assert.match(text, /Write the next scene/);
    assert.doesNotMatch(text, /FOUNDATION_START/);
  });
});
