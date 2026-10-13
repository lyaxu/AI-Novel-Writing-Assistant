const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const load = () => loadRuntimeSource("../../../prompting/prompts/novel/acceptance/evidenceCatalog.ts", {
  "node:crypto": require("node:crypto"),
});
const { buildEvidenceCatalog, resolveEvidenceReference } = load();
const input = (content, establishedProse = []) => ({ chapterId: "chapter-3", chapterOrder: 3, content, establishedProse });

test("catalog retains all original punctuation, quotes and whitespace with exact offsets", () => {
  const content = '  他说：“我上个月丢过手机，后来补了卡。”\r\n她问：“真的？”\nYes! Really? End.再走；停;\n';
  const catalog = buildEvidenceCatalog(input(content));
  assert.equal(catalog.entries.map(entry => entry.quote).join(""), content);
  assert.equal(catalog.entries[0].quote, '  他说：“我上个月丢过手机，后来补了卡。”\r\n');
  let end = 0;
  for (const entry of catalog.entries) {
    assert.equal(entry.start, end);
    assert.equal(entry.quote, content.slice(entry.start, entry.end));
    assert.ok(entry.quote.length <= 180);
    assert.ok(catalog.rendered.includes(`[${entry.id}]`));
    assert.ok(catalog.rendered.includes(entry.quote));
    end = entry.end;
  }
  assert.equal(end, content.length);
});

test("hard limits preserve supplementary Unicode and every code unit", () => {
  const content = "甲".repeat(179) + "😀" + "乙".repeat(400) + "🌌".repeat(190);
  const entries = buildEvidenceCatalog(input(content)).entries;
  assert.equal(entries.map(entry => entry.quote).join(""), content);
  for (const entry of entries) {
    assert.ok(entry.quote.length <= 180);
    assert.ok(!/[\uD800-\uDBFF]$/u.test(entry.quote));
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(entry.quote));
  }
  assert.equal(entries[0].quote.length, 179);
});

test("identical quotations in different locations or chapters have distinct references", () => {
  const catalog = buildEvidenceCatalog(input("重复。重复。", [{ chapterId: "prior", order: 1, content: "重复。" }]));
  assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, 3);
  assert.deepEqual(catalog.entries.map(entry => entry.start), [0, 3, 0]);
  assert.deepEqual(catalog.entries.map(entry => entry.source), ["current_prose", "current_prose", "established_context"]);
  assert.equal(resolveEvidenceReference(catalog, { evidenceId: catalog.entries[1].id }).start, 3);
});

test("only unambiguous previously written chapters are eligible", () => {
  const catalog = buildEvidenceCatalog(input("当前。", [
    { chapterId: "prior", order: 1, content: "前章。" },
    { chapterId: "prior", order: 1, content: "前章。" },
    { chapterId: "future", order: 4, content: "未来。" },
    { chapterId: "same-order", order: 3, content: "同章。" },
    { chapterId: "chapter-3", order: 1, content: "冒充前章。" },
    { chapterId: "conflict", order: 2, content: "甲。" },
    { chapterId: "conflict", order: 2, content: "乙。" },
    { chapterId: "order-conflict", order: 1, content: "丙。" },
    { chapterId: "order-conflict", order: 2, content: "丙。" },
    { chapterId: "", order: 1, content: "无编号。" },
  ]));
  assert.deepEqual(catalog.entries.map(entry => entry.sourceId), ["chapter-3", "prior"]);
  assert.equal(catalog.entries[1].quote, "前章。");
});

test("fresh process module and reordered source inputs produce the same stable snapshot", () => {
  const chapters = [
    { chapterId: "second", order: 2, content: "二。" },
    { chapterId: "first", order: 1, content: "一。" },
  ];
  const first = buildEvidenceCatalog(input("现在。", chapters));
  const restarted = load().buildEvidenceCatalog(input("现在。", [...chapters].reverse()));
  assert.equal(restarted.snapshotId, first.snapshotId);
  assert.deepEqual(restarted.entries, first.entries);
  assert.equal(restarted.rendered, first.rendered);
});

test("any included prose, chapter identity or order change invalidates old references", () => {
  const original = input("当前。", [{ chapterId: "prior", order: 1, content: "前章。" }]);
  const first = buildEvidenceCatalog(original);
  const variants = [
    { ...original, content: "当前！" },
    { ...original, chapterId: "other-current" },
    { ...original, chapterOrder: 4 },
    { ...original, establishedProse: [{ ...original.establishedProse[0], content: "前章！" }] },
    { ...original, establishedProse: [{ ...original.establishedProse[0], order: 2 }] },
    { ...original, establishedProse: [{ ...original.establishedProse[0], chapterId: "other-prior" }] },
  ];
  for (const variant of variants) {
    const changed = buildEvidenceCatalog(variant);
    assert.notEqual(changed.snapshotId, first.snapshotId);
    assert.throws(() => resolveEvidenceReference(changed, { evidenceId: first.entries[0].id }), /本次正文证据目录/);
  }
});

test("reference resolution supplies exact canonical text and ignores invented quotation fields", () => {
  const catalog = buildEvidenceCatalog(input('他问：“谁？”'));
  const entry = catalog.entries[0];
  const canonical = resolveEvidenceReference(catalog, { evidenceId: entry.id, quote: '他问："谁？"', sourceId: "fake" });
  assert.deepEqual(canonical, { source: "current_prose", sourceId: "chapter-3", quote: '他问：“谁？”', evidenceId: entry.id, evidenceSnapshotId: catalog.snapshotId, start: 0, end: 7 });
  assert.throws(() => resolveEvidenceReference(catalog, { evidenceId: "invented" }), /请选择|请从本次目录/);
});

test("empty and whitespace manuscripts retain exact source semantics", () => {
  assert.equal(buildEvidenceCatalog(input("")).entries.length, 0);
  const whitespace = buildEvidenceCatalog(input("  \n "));
  assert.equal(whitespace.entries.length, 0);
  assert.ok(whitespace.rendered.includes("  \n "));
  assert.equal(buildEvidenceCatalog({ chapterOrder: 1, content: "正文。" }).entries[0].sourceId, "current");
  assert.throws(() => buildEvidenceCatalog({ chapterOrder: NaN, content: "正文。" }), /有效的章节序号/);
});

test("long blank spans remain visible but cannot be selected as evidence", () => {
  const content = " ".repeat(400) + "事实。";
  const catalog = buildEvidenceCatalog(input(content));
  assert.equal(catalog.entries.length, 1);
  assert.ok(catalog.entries.every(entry => entry.quote.trim().length > 0));
  assert.equal(catalog.entries[0].quote, content.slice(catalog.entries[0].start, catalog.entries[0].end));
  assert.ok(catalog.rendered.includes(" ".repeat(180)));
});
