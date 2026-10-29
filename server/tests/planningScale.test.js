const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CHAPTER_LENGTH_PRESETS,
  DEFAULT_ESTIMATED_CHAPTER_COUNT,
  MAX_ESTIMATED_CHAPTER_COUNT,
  buildVolumeChapterBudget,
  findChapterLengthPresetByCount,
  formatEstimatedTotalWords,
  normalizeEstimatedChapterCount,
  resolveChapterLengthPresetId,
} = require("../../shared/dist/types/planningScale.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("default book scale is a 100-chapter long-form plan shared by client and server", () => {
  assert.equal(DEFAULT_ESTIMATED_CHAPTER_COUNT, 100);
  assert.equal(MAX_ESTIMATED_CHAPTER_COUNT, 2000);

  const serverDefaults = require("../dist/services/novel/novelCoreShared.js");
  assert.equal(serverDefaults.DEFAULT_ESTIMATED_CHAPTER_COUNT, 100);

  const clientBasicInfoSource = read("client/src/pages/novels/novelBasicInfo.shared.ts");
  assert.match(clientBasicInfoSource, /DEFAULT_ESTIMATED_CHAPTER_COUNT\s*\}\s*from\s*"@ai-novel\/shared\/types\/planningScale"/);
  assert.doesNotMatch(clientBasicInfoSource, /DEFAULT_ESTIMATED_CHAPTER_COUNT\s*=\s*80/);
  assert.match(clientBasicInfoSource, /estimatedChapterCount:\s*DEFAULT_ESTIMATED_CHAPTER_COUNT/);

  const editInitializationSource = read("client/src/pages/novels/hooks/useNovelEditInitialization.ts");
  assert.match(editInitializationSource, /detail\.estimatedChapterCount \?\? DEFAULT_ESTIMATED_CHAPTER_COUNT/);
});

test("length presets expose short/medium/long/ultra-long with long 100 recommended", () => {
  assert.deepEqual(
    CHAPTER_LENGTH_PRESETS.map((preset) => [preset.id, preset.chapterCount]),
    [
      ["short", 20],
      ["medium", 50],
      ["long", 100],
      ["ultra_long", 200],
    ],
  );
  const recommended = CHAPTER_LENGTH_PRESETS.filter((preset) => preset.recommended);
  assert.equal(recommended.length, 1);
  assert.equal(recommended[0].chapterCount, 100);
  assert.ok(CHAPTER_LENGTH_PRESETS.every((preset) => preset.summary.trim().length > 0));

  assert.equal(resolveChapterLengthPresetId(100), "long");
  assert.equal(resolveChapterLengthPresetId(20), "short");
  assert.equal(resolveChapterLengthPresetId(50), "medium");
  assert.equal(resolveChapterLengthPresetId(200), "ultra_long");
  assert.equal(resolveChapterLengthPresetId(137), "custom");
  assert.equal(findChapterLengthPresetByCount(137), null);
});

test("estimated total word copy uses chapter count times default chapter length", () => {
  const hundred = formatEstimatedTotalWords(100, 2800);
  assert.match(hundred, /28 万字/);
  assert.match(hundred, /100 章 × 2800 字/);

  const medium = formatEstimatedTotalWords(50, 3000);
  assert.match(medium, /15 万字/);

  const custom = formatEstimatedTotalWords(137, 2800);
  assert.match(custom, /38\.4 万字/);
  assert.match(custom, /137 章 × 2800 字/);

  const fallback = formatEstimatedTotalWords(undefined, undefined);
  assert.match(fallback, /100 章 × 2800 字/);
});

test("chapter count normalization keeps custom input within supported bounds", () => {
  assert.equal(normalizeEstimatedChapterCount(undefined), 100);
  assert.equal(normalizeEstimatedChapterCount(null), 100);
  assert.equal(normalizeEstimatedChapterCount(0), 1);
  assert.equal(normalizeEstimatedChapterCount(99.6), 100);
  assert.equal(normalizeEstimatedChapterCount(5000), 2000);
  assert.equal(normalizeEstimatedChapterCount(Number.NaN), 100);
});

test("volume budget maps target chapter counts to even per-volume chapter budgets", () => {
  assert.deepEqual(buildVolumeChapterBudget(100).chapterCounts, [50, 50]);
  assert.deepEqual(buildVolumeChapterBudget(80).chapterCounts, [40, 40]);
  assert.deepEqual(buildVolumeChapterBudget(130).chapterCounts, [44, 43, 43]);
  assert.deepEqual(buildVolumeChapterBudget(20).chapterCounts, [20]);
  assert.deepEqual(buildVolumeChapterBudget(50).chapterCounts, [50]);
  assert.deepEqual(buildVolumeChapterBudget(51).chapterCounts, [26, 25]);
  assert.deepEqual(buildVolumeChapterBudget(200).chapterCounts, [50, 50, 50, 50]);
  assert.deepEqual(buildVolumeChapterBudget(1500).chapterCounts, Array.from({ length: 30 }, () => 50));

  const large = buildVolumeChapterBudget(2000);
  assert.equal(large.volumeCount, 30);
  assert.equal(large.chapterCounts.reduce((sum, count) => sum + count, 0), 2000);
  assert.ok(Math.max(...large.chapterCounts) - Math.min(...large.chapterCounts) <= 1);
  assert.deepEqual(
    large.volumes.map((volume) => volume.endChapter - volume.startChapter + 1),
    large.chapterCounts,
  );

  const capped = buildVolumeChapterBudget(2000, { maxVolumeCount: 24 });
  assert.equal(capped.volumeCount, 24);
  assert.equal(capped.chapterCounts.reduce((sum, count) => sum + count, 0), 2000);
  assert.equal(capped.volumes[capped.volumes.length - 1].endChapter, 2000);

  const tiny = buildVolumeChapterBudget(1);
  assert.equal(tiny.volumeCount, 1);
  assert.deepEqual(tiny.chapterCounts, [1]);
});

test("no hardcoded 80-chapter default remains in the previous default sites", () => {
  const files = [
    "client/src/pages/novels/novelBasicInfo.shared.ts",
    "client/src/pages/novels/hooks/useNovelEditInitialization.ts",
    "server/src/services/novel/novelCoreShared.ts",
    "server/src/services/novel/novelCoreGenerationService.ts",
    "server/src/services/novel/director/runtime/novelDirectorHelpers.ts",
    "server/src/services/novel/runtime/GenerationContextAssembler.ts",
    "server/src/services/novel/production/preparation/ChapterExecutionPreparationService.ts",
    "server/src/services/novel/volume/volumeGenerationOrchestrator.ts",
    "server/src/services/novel/director/automation/novelDirectorAutoExecutionScopeRuntime.ts",
  ].filter((file) => fs.existsSync(path.join(repoRoot, file)));

  const hardcoded80Pattern = /(\?\?\s*80\b|=\s*80\s*;|fallback\s*=\s*80\b|DEFAULT_ESTIMATED_CHAPTER_COUNT\s*=\s*80)/;
  for (const file of files) {
    assert.doesNotMatch(read(file), hardcoded80Pattern, `${file} still contains a hardcoded 80-chapter default`);
  }

  // The default is defined once in shared and re-exported by the server facade.
  const sharedPlanningScale = read("shared/types/planningScale.ts");
  assert.match(sharedPlanningScale, /export const DEFAULT_ESTIMATED_CHAPTER_COUNT = 100;/);
  assert.doesNotMatch(sharedPlanningScale, /DEFAULT_ESTIMATED_CHAPTER_COUNT\s*=\s*80/);
  const serverCoreShared = read("server/src/services/novel/novelCoreShared.ts");
  assert.match(serverCoreShared, /DEFAULT_ESTIMATED_CHAPTER_COUNT[\s\S]*from "@ai-novel\/shared\/types\/planningScale"/);
});
