const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatChapterContractGuardRecord,
  isChapterContractGuardLine,
  parseChapterContractGuardRecords,
} = require("../dist/services/novel/volume/chapterDetail/chapterContractGuardTrace.js");

const qualityLine = (i) => `[quality_loop 2026-10-06T0${i}:00:00.000Z] status=risk action=patch_repair`;

test("guard rejections and the final acceptance are both retained in order", () => {
  const rejected = formatChapterContractGuardRecord({
    novelId: "n1", chapterId: "c2", outcome: "rejected", attempt: 1,
    reason: "章节合同自相矛盾：mustAvoid 禁止「不得再次发现通道A」，但 sceneCards[2] 又要求执行同一件事。",
  });
  const accepted = formatChapterContractGuardRecord({
    novelId: "n1", chapterId: "c2", outcome: "accepted", attempt: 2,
    declaredConflicts: 0, declaredNeighborPreemptions: 0,
  });

  const parsed = parseChapterContractGuardRecords([qualityLine(1), rejected, accepted].join("\n"));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].outcome, "rejected");
  // The recorded reason is the validator's own message, so the trace says why it fired.
  assert.match(String(parsed[0].reason), /自相矛盾/);
  assert.equal(parsed[1].outcome, "accepted");
  assert.equal(parsed[1].declaredConflicts, 0);
  assert.equal(parsed[1].declaredNeighborPreemptions, 0);
});

test("a clean run is distinguishable from a saved one", () => {
  const saved = parseChapterContractGuardRecords(formatChapterContractGuardRecord({
    novelId: "n1", chapterId: "c2", outcome: "rejected", attempt: 1,
    reason: "本章占用了下一章（第3章）的独占事件",
  }));
  const clean = parseChapterContractGuardRecords(formatChapterContractGuardRecord({
    novelId: "n1", chapterId: "c2", outcome: "accepted", attempt: 1,
    declaredConflicts: 0, declaredNeighborPreemptions: 0,
  }));
  assert.equal(saved[0].outcome, "rejected");
  assert.equal(clean[0].outcome, "accepted");
  assert.equal(clean.filter((r) => r.outcome === "rejected").length, 0);
});

test("guard lines are recognised and other history lines are not", () => {
  assert.equal(isChapterContractGuardLine(formatChapterContractGuardRecord({
    novelId: "n", chapterId: "c", outcome: "accepted", attempt: 1,
  })), true);
  assert.equal(isChapterContractGuardLine(qualityLine(1)), false);
  assert.equal(isChapterContractGuardLine("[patch_receipt] {}"), false);
  assert.equal(isChapterContractGuardLine(null), false);
});

test("malformed guard lines are skipped rather than throwing", () => {
  const parsed = parseChapterContractGuardRecords(
    [formatChapterContractGuardRecord({ novelId: "n", chapterId: "c", outcome: "accepted", attempt: 1 }),
     "[contract_guard] {not json"]
      .join("\n"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].outcome, "accepted");
});

test("an empty or absent history yields no records", () => {
  assert.deepEqual(parseChapterContractGuardRecords(null), []);
  assert.deepEqual(parseChapterContractGuardRecords(""), []);
  assert.deepEqual(parseChapterContractGuardRecords(undefined), []);
});
