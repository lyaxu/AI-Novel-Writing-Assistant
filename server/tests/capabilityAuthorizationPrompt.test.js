const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const native = createRequire(filename);
  function local(id) {
    const target = id.startsWith(".") ? path.resolve(path.dirname(filename), id).replace(/\.js$/, "")
      : id.startsWith("@ai-novel/shared/") ? path.join(root, "shared", id.slice("@ai-novel/shared/".length)) : null;
    if (target) {
      const file = [`${target}.ts`, path.join(target, "index.ts")].find(file => fs.existsSync(file));
      if (file) return load(file);
    }
    return native(id);
  }
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(local, module, module.exports);
  return module.exports;
}
const { CAPABILITY_AUTHORIZATION_RULES: rules } = load(path.join(root, "server/src/prompting/prompts/novel/context/capabilityAuthorization.ts"));
const writer = load(path.join(root, "server/src/prompting/prompts/novel/chapterWriter.prompts.ts")).chapterWriterPrompt;
const official = load(path.join(root, "server/src/prompting/templates/officialTemplates.ts"));
const director = load(path.join(root, "server/src/prompting/prompts/novel/directorPlanning.prompts.ts"));
const quality = load(path.join(root, "server/src/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.ts")).chapterTaskSheetQualityPrompt;
const acceptance = load(path.join(root, "server/src/prompting/prompts/novel/chapterAcceptance.prompts.ts")).chapterAcceptanceAssessmentPrompt;
const context = { blocks: [], slots: { text: () => undefined, enabled: () => false, token: () => undefined, choiceCopy: () => undefined } };
const input = { novelTitle: "示例", chapterId: "c1", chapterOrder: 1, chapterTitle: "获得能力", content: "系统赠予御剑术，他当即飞过深渊。", expectedSceneKeys: [] };
function assertRules(text) { for (const rule of rules) assert.ok(text.includes(rule), rule); }
test("writer, official advanced template, planning quality and acceptance all deliver the same capability policy", () => {
  const text = writer.render(input, context).map(m => m.content).join("\n");
  assertRules(text);
  assert.doesNotMatch(text, /禁止引入未铺垫的重大转折/);
  assertRules(JSON.stringify(official.getOfficialPromptTemplate(writer.id)));
  assert.equal(official.getOfficialPromptTemplateVersion(writer.id), writer.version);
  const candidate = { ...input, summary: "获得御剑术", purpose: "跨越深渊", exclusiveEvent: "赠予能力", endingState: "已越过", nextChapterEntryState: "继续旅途", payoffRefs: [] };
  assertRules(quality.render({ candidate, mode: "ai_copilot" }, context).map(m => m.content).join("\n"));
  assertRules(acceptance.render(input, context).map(m => m.content).join("\n"));
});
test("new candidate and selected-candidate correction preserve the user's fast-power genre choice", () => {
  const seed = { idea: "签到即满级", context: {}, count: 2, batches: [], presets: [], feedback: "保留直接赠予",
    candidate: { workingTitle: "示例", hookStrategy: "签到", storyPrototype: { earlyPayoff: "满级", openingChain: [] } } };
  assertRules(director.directorCandidatePrompt.render(seed, context).map(m => m.content).join("\n"));
  assertRules(director.directorCandidatePatchPrompt.render(seed, context).map(m => m.content).join("\n"));
});
