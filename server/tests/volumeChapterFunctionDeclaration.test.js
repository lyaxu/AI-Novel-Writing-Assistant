const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeVolumeDraftInput } = require("../dist/services/novel/volume/volumePlanUtils.js");
const { buildVolumeWorkspaceDocument, serializeVolumeWorkspaceDocument, normalizeVolumeWorkspaceDocument }
  = require("../dist/services/novel/volume/volumeWorkspaceDocument.js");

// The chapter_list prompt requires protagonistAction/chapterPayoff for every chapter and
// refuses a list whose neighbouring chapters declare the same action or payoff
// (chapterList.prompts.ts getChapterFunctionQualityIssue). Those values were validated but
// dropped on the way into persistence, so the rule only ever held for the duration of one
// call and every stored chapter came back with an empty declaration.

test("a chapter declaration survives normalization, serialization and re-read", () => {
  const [volume] = normalizeVolumeDraftInput("n1", [{
    id: "v1", sortOrder: 1, title: "第一卷", summary: "卷摘要",
    chapters: [
      { chapterOrder: 1, title: "暴雨无门牌", summary: "接单", protagonistAction: "接下阴间订单", chapterPayoff: "被种下妖记" },
      { chapterOrder: 2, title: "黄纸变冥币", summary: "追查", protagonistAction: "翻查派发路径", chapterPayoff: "确认通道A停用" },
    ],
  }]);

  assert.equal(volume.chapters[0].protagonistAction, "接下阴间订单");
  assert.equal(volume.chapters[0].chapterPayoff, "被种下妖记");
  assert.equal(volume.chapters[1].protagonistAction, "翻查派发路径");

  const document = buildVolumeWorkspaceDocument({ novelId: "n1", volumes: [volume], source: "volume" });
  const reloaded = normalizeVolumeWorkspaceDocument("n1", serializeVolumeWorkspaceDocument(document), {
    source: "volume", activeVersionId: document.activeVersionId,
  });

  assert.equal(reloaded.volumes[0].chapters[0].protagonistAction, "接下阴间订单");
  assert.equal(reloaded.volumes[0].chapters[0].chapterPayoff, "被种下妖记");
  assert.equal(reloaded.volumes[0].chapters[1].protagonistAction, "翻查派发路径");
  assert.equal(reloaded.volumes[0].chapters[1].chapterPayoff, "确认通道A停用");
});

test("a chapter without a declaration still normalizes, as null rather than a failure", () => {
  const [volume] = normalizeVolumeDraftInput("n1", [{
    id: "v1", sortOrder: 1, title: "第一卷", summary: "卷摘要",
    chapters: [{ chapterOrder: 1, title: "旧章", summary: "没有自述的旧章节" }],
  }]);
  assert.equal(volume.chapters[0].protagonistAction, null);
  assert.equal(volume.chapters[0].chapterPayoff, null);
});

test("neighbouring chapters can be compared for a repeated declaration once persisted", () => {
  // This is the comparison getChapterFunctionQualityIssue performs. It could only ever run
  // inside one call before; now the stored rows carry what it needs.
  const [volume] = normalizeVolumeDraftInput("n1", [{
    id: "v1", sortOrder: 1, title: "第一卷", summary: "卷摘要",
    chapters: [
      { chapterOrder: 1, title: "甲", summary: "s1", protagonistAction: "回站点查记录", chapterPayoff: "拿到线索" },
      { chapterOrder: 2, title: "乙", summary: "s2", protagonistAction: "回站点查记录", chapterPayoff: "拿到线索" },
    ],
  }]);

  const same = (a, b) => (a ?? "").replace(/\s+/g, "") === (b ?? "").replace(/\s+/g, "");
  assert.equal(same(volume.chapters[0].protagonistAction, volume.chapters[1].protagonistAction), true);
  assert.equal(same(volume.chapters[0].chapterPayoff, volume.chapters[1].chapterPayoff), true);
});
