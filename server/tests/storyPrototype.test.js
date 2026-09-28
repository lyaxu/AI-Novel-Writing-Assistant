const test = require("node:test");
const assert = require("node:assert/strict");
const { storyPrototypeSchema, directorCandidateSchema, directorCandidateResponseSchema } = require("../dist/services/novel/director/runtime/novelDirectorSchemas");
const { normalizeCandidate, buildStoryInput, toBookSpec } = require("../dist/services/novel/director/runtime/novelDirectorHelpers");
const { buildDirectorBookContractContextBlocks } = require("../dist/prompting/prompts/novel/planningContextBlocks");
const { getRegisteredPromptAsset } = require("../dist/prompting/registry");
const { promptAssetLoaderEntries } = require("../dist/prompting/registry/promptAssetLoaderEntries");

const prototype = {
  protagonistWant: "Keep the shop", opposition: "A creditor needs the site", difficultChoice: "Expose a friend or lose the lease",
  distinctiveEngine: "Each deal changes who owes whom", earlyPayoff: "Save the first tenant", appealRisk: "Avoid repetitive debt collection",
  openingChain: [1, 2, 3].map(chapterOrder => ({ chapterOrder, action: "Negotiate", resistance: "Refusal", choice: "Risk collateral",
    consequence: "Lose a guarantee", payoff: "Gain a witness", nextQuestion: "Who bought the debt?" })),
};
const legacy = { workingTitle: "Shop", logline: "Save a shop", positioning: "Neighborhood drama", sellingPoint: "Debt deals", coreConflict: "Debt versus loyalty",
  protagonistPath: "Negotiate", endingDirection: "Save the street", hookStrategy: "Expose debt", progressionLoop: "Trade and consequences",
  whyItFits: "Ordinary people", toneKeywords: ["Warm", "Tense"], targetChapterCount: 80, recommendedWritingPlatform: "fanqie_free", writingPlatformReason: "Broad readership" };

test("prompt loader keys match declared versions throughout the creation chain", () => {
  for (const entry of promptAssetLoaderEntries) {
    const asset = entry.load();
    assert.equal(entry.key, `${asset.id}@${asset.version}`);
  }
});

test("legacy saved candidates remain readable, new generation requires a causal prototype", () => {
  assert.equal(directorCandidateSchema.safeParse(legacy).success, true);
  assert.equal(directorCandidateResponseSchema.safeParse({ candidates: [legacy, legacy] }).success, false);
  assert.equal(directorCandidateResponseSchema.safeParse({ candidates: [{ ...legacy, storyPrototype: prototype }, { ...legacy, storyPrototype: prototype }] }).success, true);
  assert.equal(storyPrototypeSchema.safeParse({ ...prototype, openingChain: prototype.openingChain.slice(0, 2) }).success, false);
  assert.equal(storyPrototypeSchema.safeParse({ ...prototype, openingChain: prototype.openingChain.map(c => ({ ...c, chapterOrder: 1 })) }).success, false);
});

test("normalization and downstream story inputs retain the chosen opening chain", () => {
  const candidate = normalizeCandidate({ ...legacy, storyPrototype: prototype }, 0);
  assert.deepEqual(candidate.storyPrototype, prototype);
  const input = { idea: "Shop idea", candidate };
  assert.match(buildStoryInput(input, toBookSpec(candidate, input.idea)), /Lose a guarantee/);
  const blocks = buildDirectorBookContractContextBlocks({ ...input, context: {}, storyMacroPlan: null, targetChapterCount: 80 });
  assert.match(JSON.stringify(blocks), /Who bought the debt/);
});

test("updated assets resolve through registry and reader remains advisory", () => {
  for (const key of ["novel.director.candidates@v4", "novel.director.candidate_patch@v3", "novel.volume.beat_sheet@v6", "novel.volume.chapter_list@v12", "novel.chapter.writer@v9", "novel.second_reader@v2"]) assert.ok(getRegisteredPromptAsset(...key.split("@")), key);
  const prompt = getRegisteredPromptAsset("novel.second_reader", "v2");
  const text = prompt.render({ title: "Title", description: "", chapters: "Body" }).map(m => m.content).join("\n");
  assert.match(text, /不是工作流通过条件/);
  assert.match(text, /连续阅读而非逐章打勾/);
  const writer = getRegisteredPromptAsset("novel.chapter.writer", "v9");
  const proseInstructions = writer.render({ novelTitle: "Title", chapterOrder: 1, chapterTitle: "Opening", revealLevel: 2 }, {
    blocks: [], selectedBlockIds: [], droppedBlockIds: [], summarizedBlockIds: [], estimatedInputTokens: 0,
  }).map(m => m.content).join("\n");
  assert.match(proseInstructions, /不是需要逐句扩写的操作清单/);
  assert.match(proseInstructions, /不能把低分理解为只许设问、不许回答/);
});
