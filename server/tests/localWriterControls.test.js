const test = require("node:test");
const assert = require("node:assert/strict");
const { chapterWriterPrompt } = require("../dist/prompting/prompts/novel/chapterWriter.prompts.js");
const { CHAPTER_PROSE_QUALITY_RULES } = require("@ai-novel/shared/types/chapterProseContract");

test("local writer controls preserve upstream prose rules, slots and length bounds", () => {
  const messages = chapterWriterPrompt.render({
    novelTitle: "Novel", chapterOrder: 2, chapterTitle: "Chapter",
    targetWordCount: 2800, minWordCount: 2500, maxWordCount: 3100,
    conflictLevel: 85, revealLevel: 75, pacePreference: "slow",
  }, {
    blocks: [],
    slots: {
      text: (key) => ({
        "writer.tonePreference": "CUSTOM_TONE",
        "writer.antiAiRules": "CUSTOM_ANTI_AI",
        "writer.endingHookPreference": "CUSTOM_ENDING",
      })[key],
      enabled: () => false, token: () => undefined, choiceCopy: () => undefined,
    },
  });
  const text = messages.map((message) => message.content).join("\n");
  for (const marker of ["CUSTOM_TONE", "CUSTOM_ANTI_AI", "CUSTOM_ENDING", "85/100", "75/100", "2800", "2500-3100"]) {
    assert.ok(text.includes(marker), `Missing writer control: ${marker}`);
  }
  for (const rule of CHAPTER_PROSE_QUALITY_RULES) assert.ok(text.includes(rule));
});
