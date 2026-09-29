const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(relative) {
  const filename = path.resolve(__dirname, relative);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(exports){${code}\n})`, { filename })(exports);
  return exports;
}
const { buildPrimaryProseCitationCatalog } = load("../src/prompting/prompts/novel/volume/evidence/primaryProseCitationCatalog.ts");
const { buildChapterEvidenceIndex, matchesChapterEvidence } = load("../src/prompting/prompts/novel/volume/evidence/chapterEvidence.ts");
const prose = "She opened her hand. A small silver coin lay on her palm.\n\nHe said, ‘Keep it.’";
function input(contents = [prose]) {
  return { writtenEvidence: { authority: "written_prose_not_planning", chapters: contents.map((content, i) => ({ chapterId: `ch${i}`, order: i + 1, contentHash: `hash${i}`, content })),
    compressedFacts: { authority: "secondary_not_proof", items: [{ text: "The courier received a small silver coin." }] } },
    guidance: "Do not confuse plans with prose", readonlyNext: { summary: "A future trip" } };
}

test("catalog reconstructs every original character across multiple chapters without splitting surrogate pairs", () => {
  const context = input(["中".repeat(239) + "😀\r\n" + "文".repeat(400) + "\n ", prose, ""]);
  const before = structuredClone(context);
  const json = JSON.stringify(context);
  const result = buildPrimaryProseCitationCatalog(json);
  assert.deepEqual(context, before);
  assert.equal(JSON.stringify(context), json);
  assert.equal(result.sources.length, 2);
  const displayed = JSON.parse(result.reviewContextDisplayJson);
  for (const [i, source] of result.sources.entries()) {
    assert.equal(source.sourcePath, `writtenEvidence.chapters[${i}].content`);
    assert.equal(source.authority, "written_prose_not_planning");
    assert.equal(source.contentHash, `hash${i}`);
    assert.equal(source.excerpts.map(x => x.quote).join(""), context.writtenEvidence.chapters[i].content);
    for (const excerpt of source.excerpts) {
      assert.ok(excerpt.quote.length <= 240);
      assert.equal(excerpt.quote, context.writtenEvidence.chapters[i].content.slice(excerpt.start, excerpt.start + excerpt.quote.length));
      assert.ok(!/[\uD800-\uDBFF]$/.test(excerpt.quote));
      assert.ok(!/^[\uDC00-\uDFFF]/.test(excerpt.quote));
    }
    assert.match(displayed.writtenEvidence.chapters[i].content, /DISPLAY REFERENCE/);
  }
  assert.deepEqual(displayed.writtenEvidence.compressedFacts, context.writtenEvidence.compressedFacts);
  assert.deepEqual(displayed.readonlyNext, context.readonlyNext);
  assert.equal(displayed.writtenEvidence.chapters[2].content, "");
});

test("canonical prose quotes validate while compressed facts, display paths and markers cannot impersonate prose", () => {
  const context = input();
  const catalog = buildPrimaryProseCitationCatalog(JSON.stringify(context));
  const index = buildChapterEvidenceIndex(context);
  const source = catalog.sources[0];
  assert.equal(matchesChapterEvidence(index, { sourcePath: source.sourcePath, quote: source.excerpts[0].quote }), true);
  assert.equal(matchesChapterEvidence(index, { sourcePath: source.sourcePath, quote: context.writtenEvidence.compressedFacts.items[0].text }), false);
  assert.equal(matchesChapterEvidence(index, { sourcePath: "primaryProseCitationCatalog[0].excerpts[0].quote", quote: prose }), false);
  assert.equal(matchesChapterEvidence(index, { sourcePath: source.sourcePath, quote: JSON.parse(catalog.reviewContextDisplayJson).writtenEvidence.chapters[0].content }), false);
  assert.equal(matchesChapterEvidence(index, { sourcePath: "writtenEvidence.chapters[1].content", quote: prose }), false);
});

test("missing, empty or malformed contexts preserve the supplied display without inventing prose", () => {
  for (const json of ["not json", "null", "[]", "{}", JSON.stringify(input([])), JSON.stringify(input([""]))]) {
    const result = buildPrimaryProseCitationCatalog(json);
    assert.deepEqual(result.sources, []);
    assert.equal(result.reviewContextDisplayJson, json);
  }
  assert.deepEqual(buildPrimaryProseCitationCatalog().sources, []);
});
