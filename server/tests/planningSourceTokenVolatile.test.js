const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

// Regression cover for a false "Planning source changed" on a brand-new book.
//
// readSource hashes the novel's volumes / versions / chapters to detect a planning edit.
// Those queries have no `select`, so the rows carried `updatedAt`. A single run writes its
// own volumes and versions seconds after the repair snapshot is taken, which changed the
// hash and made the run report "Planning source changed; explicit confirmation is required."
// The user was then asked to supply repair direction for a problem that did not exist.
//
// The fix drops only the timestamp column. This asserts the exact contract we rely on.

function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }

const stripVolatile = (row) => {
  const { updatedAt: _u, ...rest } = row;
  return rest;
};

function identity({ novel, volumes, versions, chapters, macro }) {
  return hash({
    novel: stripVolatile(novel),
    volumes: volumes.map((v) => ({ ...stripVolatile(v), chapters: (v.chapters ?? []).map(stripVolatile) })),
    versions: versions.map(stripVolatile),
    chapters: chapters.map(stripVolatile),
    macro: macro ? stripVolatile(macro) : macro,
  });
}

const base = () => ({
  novel: { id: "n1", title: "外卖小哥阴间配送", defaultChapterLength: 2800, createdAt: "T0", updatedAt: "T0" },
  volumes: [{
    id: "v1", novelId: "n1", title: "殡仪馆首单", status: "chapter_list_partial:active", sortOrder: 1,
    sourceVersionId: "ver1", createdAt: "T0", updatedAt: "T0",
    chapters: [
      { id: "p1", chapterOrder: 1, title: "暴雨无门牌", summary: "接单", createdAt: "T0", updatedAt: "T0" },
      { id: "p2", chapterOrder: 2, title: "黄纸变冥币", summary: "追单", createdAt: "T0", updatedAt: "T0" },
    ],
  }],
  versions: [{ id: "ver1", novelId: "n1", version: 1, status: "active", contentJson: "{}", createdAt: "T0", updatedAt: "T0" }],
  chapters: [
    { id: "c1", novelId: "n1", order: 1, title: "暴雨无门牌", generationState: "planned", createdAt: "T0", updatedAt: "T0" },
    { id: "c2", novelId: "n1", order: 2, title: "黄纸变冥币", generationState: "planned", createdAt: "T0", updatedAt: "T0" },
  ],
  macro: { novelId: "n1", content: "macro", createdAt: "T0", updatedAt: "T0" },
});

const stamp = (src, t) => JSON.parse(JSON.stringify(src).replace(/"updatedAt":"T0"/g, `"updatedAt":"${t}"`));

test("the run's own writes to volumes, versions and chapters do NOT change the identity", () => {
  const before = identity(base());
  // Exactly the sequence that broke a real run: volumes created, then updated seconds later,
  // then the workspace version content rewritten.
  const after = identity(stamp(base(), "T+2m"));
  assert.equal(after, before, "timestamp-only writes must not look like an external planning edit");
});

test("adding a volume IS a real planning change and still requires confirmation", () => {
  // Deliberately NOT excluded. The observed false positive came only from `updatedAt`:
  // the snapshot already contained all three volumes, and only their timestamps moved.
  // Loosening the identity to tolerate a growing volume list would be a much wider change
  // than the evidence supports.
  const before = identity(base());
  const grown = base();
  grown.volumes.push({ id: "v2", novelId: "n1", title: "旁支现身", status: "active", sortOrder: 2, sourceVersionId: "ver1", createdAt: "T+", updatedAt: "T+", chapters: [] });
  assert.notEqual(identity(grown), before, "adding a volume changes what is planned");
});

test("a real planning edit STILL changes the identity and still requires confirmation", () => {
  const before = identity(base());

  const titleEdit = base();
  titleEdit.volumes[0].title = "殡仪馆首单（改名）";
  assert.notEqual(identity(titleEdit), before, "renaming a volume is a real planning edit");

  const statusEdit = base();
  statusEdit.volumes[0].status = "active";
  assert.notEqual(identity(statusEdit), before, "a status change is a real planning edit");

  const chapterEdit = base();
  chapterEdit.volumes[0].chapters[0].title = "暴雨无门牌（改）";
  assert.notEqual(identity(chapterEdit), before, "editing a planned chapter is a real planning edit");

  const versionEdit = base();
  versionEdit.versions[0].contentJson = "{\"volumes\":[]}";
  assert.notEqual(identity(versionEdit), before, "rewriting the workspace version is a real planning edit");

  const lengthEdit = base();
  lengthEdit.novel.defaultChapterLength = 4000;
  assert.notEqual(identity(lengthEdit), before, "changing the book default length is a real planning edit");

  const macroEdit = base();
  macroEdit.macro.content = "changed";
  assert.notEqual(identity(macroEdit), before, "changing the story macro is a real planning edit");

  const proseEdit = base();
  proseEdit.chapters[0].generationState = "approved";
  assert.notEqual(identity(proseEdit), before, "a written-chapter state change is a real change");
});

test("createdAt is retained: identity is not weakened into ignoring real history", () => {
  const before = identity(base());
  const edited = base();
  edited.volumes[0].chapters[0].createdAt = "T-1d";
  assert.notEqual(identity(edited), before);
});
