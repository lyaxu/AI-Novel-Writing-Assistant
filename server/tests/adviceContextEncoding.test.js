const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../src/services/novel/director/recovery/planningRepair/advice/AdviceContextEncoding.ts");
const moduleExports = {};
vm.runInThisContext(`(function(exports){${ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText}\n})`, { filename })(moduleExports);
const { encodeAdviceContext, prepareAdviceContext, AdviceContextCapacityError } = moduleExports;

function decode(text) {
  const encoded = JSON.parse(text);
  if (encoded.encoding !== "exact_source_references_v1") return encoded;
  const active = new Set();
  const used = new Set();
  function expand(node) {
    if (node && typeof node === "object" && Object.keys(node).length === 1 && Object.hasOwn(node, encoded.referenceKey)) {
      const id = node[encoded.referenceKey];
      assert.ok(Object.hasOwn(encoded.sources, id), `missing definition: ${id}`);
      assert.equal(active.has(id), false, `circular definition: ${id}`);
      active.add(id); used.add(id);
      const result = expand(encoded.sources[id]);
      active.delete(id); return result;
    }
    if (Array.isArray(node)) return node.map(expand);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, expand(value)]));
    return node;
  }
  const restored = expand(encoded.context);
  assert.equal(used.size, Object.keys(encoded.sources).length, "no orphaned source definitions");
  return restored;
}

test("repeated strings and subtrees reconstruct exactly without changing permissions or reserved source keys", () => {
  const text = "原文包含完整行动、前提、代价。".repeat(200);
  const subtree = { summary: text, sceneCards: JSON.stringify({ content: text }), nested: [text, null, 0, false] };
  const input = { baseline: subtree, candidate: structuredClone(subtree), chapter: { content: text },
    originalReferenceObject: { $adviceSourceRef: "source_1" }, writable: ["chapter2"] };
  const encoded = encodeAdviceContext(input);
  assert.ok(encoded.length < JSON.stringify(input).length);
  assert.equal(JSON.stringify(decode(encoded)), JSON.stringify(input));
  assert.equal(JSON.parse(encoded).coverage.omittedTextCount, 0);
});

test("unique oversized material stays intact and is refused at the unchanged capacity limit", () => {
  const input = { content: "唯一正文".repeat(50000) };
  assert.equal(encodeAdviceContext(input), JSON.stringify(input));
  assert.throws(() => prepareAdviceContext(input), AdviceContextCapacityError);
});

const actual = path.resolve(__dirname, "../../.codex-run/mining-capacity-before.json");
test("actual captured advice context fits after lossless encoding", { skip: !fs.existsSync(actual) }, t => {
  const input = JSON.parse(fs.readFileSync(actual, "utf8").replace(/^\uFEFF/, ""));
  const original = JSON.stringify(input);
  const encoded = prepareAdviceContext(input);
  assert.equal(JSON.stringify(decode(encoded)), original);
  assert.ok(encoded.length <= 160000);
  t.diagnostic(`original=${original.length}; encoded=${encoded.length}; saved=${original.length - encoded.length}`);
});
