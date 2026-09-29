const test = require("node:test");
const assert = require("node:assert/strict");
const { foundation } = require("./fixtures/bookStoryFoundation");
const { buildChapterEvidenceIndex, matchesChapterEvidence } = require("../dist/prompting/prompts/novel/volume/evidence/chapterEvidence");
const { belongsToPlanningPromiseSource } = require("../dist/prompting/prompts/novel/volume/evidence/planningPromiseEvidence");

const direction = { status: "available", sourceTaskId: "task", fingerprint: "test", candidate: {
  id: "source", bookStoryFoundation: { ...foundation, characterDynamicsExtra: foundation.characterDynamics },
  // A real adjacent field must not count as evidence for characterDynamics.
  bookStoryFoundationExtra: { characterDynamics: foundation.characterDynamics },
} };
const index = buildChapterEvidenceIndex(direction.candidate);
const sourceId = "bookStoryFoundation.characterDynamics";
const validPath = `${sourceId}[0].role`;
const validQuote = foundation.characterDynamics[0].role;
// This tests evidence path ownership only; the foundation is not a chapter promise obligation.
const validEvidence = (sourcePath, quote) => belongsToPlanningPromiseSource(sourcePath, sourceId)
  && matchesChapterEvidence(index, { sourcePath, quote });

test("array source ownership accepts a real indexed leaf", () => {
  assert.equal(belongsToPlanningPromiseSource(validPath, sourceId), true);
  assert.equal(validEvidence(validPath, validQuote), true);
});

test("source ownership rejects a real neighboring prefix and fabricated indexed paths", () => {
  for (const sourcePath of [
    "bookStoryFoundationExtra.characterDynamics[0].role",
    "bookStoryFoundation.characterDynamicsExtra[0].role",
    "bookStoryFoundation.characterDynamics[99].role",
    "bookStoryFoundation.characterDynamics[0].missing",
    "bookStoryFoundation.characterDynamics",
  ]) {
    assert.equal(validEvidence(sourcePath, validQuote), false);
  }
});

test("a valid array leaf still requires an exact quotation from that leaf", () => {
  assert.equal(validEvidence(validPath, foundation.characterDynamics[0].independentGoal), false);
});
