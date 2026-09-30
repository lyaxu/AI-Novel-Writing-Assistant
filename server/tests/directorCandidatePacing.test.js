const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Render the edited source without a build or a model call. This verifies prompt
// delivery, not whether a model can satisfy the literary constraints.
const filename = path.resolve(__dirname, "../src/prompting/prompts/novel/directorPlanning.prompts.ts");
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const schemas = { extend: () => ({}) };
const mocks = {
  "./context/capabilityAuthorization": { CAPABILITY_AUTHORIZATION_RULES: [] },
  "@ai-novel/shared/types/novel/bookStoryFoundation": {},
  "./bookFoundation": { BOOK_STORY_FOUNDATION_RULES: [], renderBookStoryFoundation: () => "" },
  "@langchain/core/messages": require("@langchain/core/messages"),
  "@ai-novel/shared/types/novelDirector": { DIRECTOR_CORRECTION_PRESETS: [] },
  "../../core/renderContextBlocks": { renderSelectedContextBlocks: () => "selected context" },
  "./planningContextBlocks": { formatProjectContext: () => "project context" },
  "../../../services/novel/director/runtime/novelDirectorSchemas": {
    directorBookContractSchema: schemas, directorCandidateSchema: schemas,
    directorCandidateResponseSchema: schemas, directorPlanBlueprintSchema: schemas, storyPrototypeSchema: schemas,
  },
  "./promptBudgetProfiles": { NOVEL_PROMPT_BUDGETS: {} },
};
const loaded = {};
vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
  if (name in mocks) return mocks[name];
  throw new Error(`Unmocked dependency: ${name}`);
}, loaded);
const input = {
  idea: "关系与代价", context: {}, count: 2, batches: [], presets: [], feedback: "调整前期回报",
  candidate: {
    workingTitle: "示例", hookStrategy: "第3章首次取得资源",
    storyPrototype: { earlyPayoff: "前三章取得资源", openingChain: [{ chapterOrder: 1, payoff: "首次取得资源" }] },
  },
};
const assets = [loaded.directorCandidatePrompt, loaded.directorCandidatePatchPrompt];

test("generation and patch deliver the same opening schedule contract", () => {
  const sharedSections = assets.map((asset) => {
    const text = asset.render(input, {})[0].content;
    const start = text.indexOf("【开篇兑现节奏自检】");
    assert.ok(start >= 0);
    const section = text.slice(start).split("\n").slice(0, 6).join("\n");
    assert.match(section, /hookStrategy、storyPrototype\.earlyPayoff 与 storyPrototype\.openingChain/);
    assert.match(section, /同一事件、首次发生章次和回报时点/);
    assert.match(section, /实际拟议章节序号，不是阶段编号或整卷情节摘要/);
    assert.match(section, /前3章找到具体兑现事件/);
    assert.match(section, /旧候选已有冲突也须在本次候选内消解/);
    return section;
  });
  assert.equal(sharedSections[0], sharedSections[1]);
  assert.equal(assets[0].version, "v6");
  assert.equal(assets[1].version, "v5");
});

test("capacity and pressure rules preserve genre freedom while requiring progression", () => {
  for (const asset of assets) {
    const text = asset.render(input, {})[0].content;
    assert.match(text, /按正常单章容量安排/);
    assert.match(text, /总章节数不能成为把已承诺早期回报延后的理由/);
    assert.match(text, /允许连续受压、失败或安静场景/);
    assert.match(text, /不要求主角每章获胜或第一章就启动全部卖点/);
    assert.match(text, /信息、关系、选择或行动后果的实质增量/);
  }
});

test("patch receives both existing schedules so it can reconcile rather than silently replace", () => {
  const text = loaded.directorCandidatePatchPrompt.render(input, {})[1].content;
  assert.match(text, /hook strategy: 第3章首次取得资源/);
  assert.match(text, /"chapterOrder":1,"payoff":"首次取得资源"/);
  assert.match(text, /调整前期回报/);
});
