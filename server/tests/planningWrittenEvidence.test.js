const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports) {
  const filename = path.resolve(__dirname, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
    if (!(name in imports)) throw new Error(`Unmocked dependency ${name}`); return imports[name];
  }, exports); return exports;
}
const policy = load("../src/services/novel/volume/writtenEvidence/evidencePolicy.ts", { "node:crypto": require("node:crypto") });
const schema = load("../../shared/types/novel/writtenEvidence.ts", { zod: require("zod") });
const chapter = (order, content = `完整正文${order}`) => ({ id: `c${order}`, order, title: `第${order}章`, content });
test("evidence preserves full previous text including opening confiscation and ending body location", () => {
  const content = "开头：所有刀具火石已收缴。\n" + "中间过程。".repeat(400) + "\n结尾：烙印只在胸口。";
  const evidence = policy.buildPlanningWrittenEvidence({ chapters: [chapter(1, content), chapter(2, "future")], targetChapterOrder: 2,
    facts: [{ chapterOrder: 1, category: "completed", text: "未收缴所有物品" }] });
  assert.equal(evidence.chapters[0].content, content); assert.equal(evidence.chapters.length, 1);
  assert.equal(evidence.compressedFacts.authority, "secondary_not_proof"); assert.equal(evidence.compressedFacts.items[0].chapterId, "c1");
  assert.equal(schema.planningWrittenEvidenceSchema.safeParse(evidence).success, true);
});
test("bounded complete chapters report omissions and do not silently slice oversized prose", () => {
  const evidence = policy.buildPlanningWrittenEvidence({ chapters: [chapter(1), chapter(2), chapter(3), chapter(4, "x".repeat(24001))], targetChapterOrder: 5 });
  assert.deepEqual(evidence.chapters.map(c => c.order), [2, 3]); assert.deepEqual(evidence.coverage.excludedOversizeChapterIds, ["c4"]);
  assert.equal(evidence.coverage.missingPreviousChapter, true); assert.equal(evidence.coverage.omittedWrittenChapterCount, 2);
  assert.equal(evidence.coverage.complete, false); assert.ok(evidence.coverage.unknown.length);
});
test("fingerprint detects any prior prose edit but ignores future writing and runtime status", () => {
  const rows = [chapter(1), chapter(2)]; const original = policy.writtenSourceFingerprint(rows, 2);
  rows[1].content = "future edited"; rows[0].chapterStatus = "completed";
  assert.equal(policy.writtenSourceFingerprint(rows, 2), original);
  rows[0].content += " edited"; assert.notEqual(policy.writtenSourceFingerprint(rows, 2), original);
});
test("facade only reads scoped chapters and secondary facts in one transaction", async () => {
  const calls = [];
  const tx = { chapter: { findMany: async (args) => { calls.push(args); return [chapter(1)]; } },
    novelFactEntry: { findMany: async (args) => { calls.push(args); return []; } } };
  const facade = load("../src/services/novel/volume/writtenEvidence/index.ts", {
    "../../../../db/prisma": { prisma: { $transaction: fn => fn(tx) } }, "./evidencePolicy": policy,
  });
  const result = await facade.loadPlanningWrittenEvidence("n", 2);
  assert.equal(result.chapters[0].chapterId, "c1"); assert.deepEqual(calls[0].where, { novelId: "n", order: { lt: 2 } });
});
