const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHardPlannedVolumeRange,
  buildVolumeCountGuidance,
  MAX_VOLUME_COUNT,
} = require("../../shared/dist/types/volumePlanning.js");
const {
  buildVolumeChapterBudget,
} = require("../../shared/dist/types/planningScale.js");

test("volume count guidance derives deterministic budgets from the ~50-chapters-per-volume rule", () => {
  const shortProject = buildVolumeCountGuidance({ chapterBudget: 20 });
  assert.deepEqual(shortProject.allowedVolumeCountRange, { min: 1, max: MAX_VOLUME_COUNT });
  assert.deepEqual(shortProject.decisionVolumeCountRange, { min: 1, max: 1 });
  assert.equal(shortProject.volumeScaleProfile, "short");
  assert.equal(shortProject.systemRecommendedVolumeCount, 1);
  assert.equal(shortProject.recommendedVolumeCount, 1);
  assert.deepEqual(shortProject.hardPlannedVolumeRange, { min: 1, max: 1 });
  assert.deepEqual(shortProject.volumeChapterBudget.chapterCounts, [20]);

  const shortBoundaryProject = buildVolumeCountGuidance({ chapterBudget: 29 });
  assert.deepEqual(shortBoundaryProject.decisionVolumeCountRange, { min: 1, max: 1 });

  const compactBookProject = buildVolumeCountGuidance({ chapterBudget: 30 });
  assert.equal(compactBookProject.volumeScaleProfile, "compact");
  assert.equal(compactBookProject.systemRecommendedVolumeCount, 1);
  assert.equal(compactBookProject.recommendedVolumeCount, 1);

  const compactBookBoundaryProject = buildVolumeCountGuidance({ chapterBudget: 59 });
  assert.deepEqual(compactBookBoundaryProject.decisionVolumeCountRange, { min: 2, max: 2 });
  assert.equal(compactBookBoundaryProject.recommendedVolumeCount, 2);

  const mediumProject = buildVolumeCountGuidance({ chapterBudget: 60 });
  assert.deepEqual(mediumProject.decisionVolumeCountRange, { min: 2, max: 2 });
  assert.equal(mediumProject.systemRecommendedVolumeCount, 2);

  const compactProject = buildVolumeCountGuidance({ chapterBudget: 80 });
  assert.deepEqual(compactProject.decisionVolumeCountRange, { min: 2, max: 2 });
  assert.equal(compactProject.systemRecommendedVolumeCount, 2);
  assert.equal(compactProject.recommendedVolumeCount, 2);
  assert.deepEqual(compactProject.volumeChapterBudget.chapterCounts, [40, 40]);
  assert.deepEqual(compactProject.hardPlannedVolumeRange, { min: 2, max: 2 });

  const longProject = buildVolumeCountGuidance({ chapterBudget: 100 });
  assert.deepEqual(longProject.decisionVolumeCountRange, { min: 2, max: 2 });
  assert.equal(longProject.systemRecommendedVolumeCount, 2);
  assert.equal(longProject.recommendedVolumeCount, 2);
  assert.deepEqual(longProject.volumeChapterBudget.chapterCounts, [50, 50]);
  assert.deepEqual(longProject.volumeChapterBudget.volumes, [
    { volumeOrder: 1, chapterCount: 50, startChapter: 1, endChapter: 50 },
    { volumeOrder: 2, chapterCount: 50, startChapter: 51, endChapter: 100 },
  ]);
  assert.match(longProject.volumeCountRationale, /第 1 卷：50 章/);
  assert.match(longProject.volumeCountRationale, /不得把所有章节挤进第一卷/);

  const medium130 = buildVolumeCountGuidance({ chapterBudget: 130 });
  assert.equal(medium130.systemRecommendedVolumeCount, 3);
  assert.deepEqual(medium130.volumeChapterBudget.chapterCounts, [44, 43, 43]);

  const ultraLongProject = buildVolumeCountGuidance({ chapterBudget: 500 });
  assert.deepEqual(ultraLongProject.decisionVolumeCountRange, { min: 10, max: 10 });
  assert.equal(ultraLongProject.recommendedVolumeCount, 10);
  assert.deepEqual(ultraLongProject.hardPlannedVolumeRange, { min: 3, max: 6 });

  const megaProject = buildVolumeCountGuidance({ chapterBudget: 1000 });
  assert.deepEqual(megaProject.decisionVolumeCountRange, { min: 20, max: 20 });
  assert.ok(megaProject.systemRecommendedVolumeCount === 20);

  const hugeProject = buildVolumeCountGuidance({ chapterBudget: 2000 });
  assert.deepEqual(hugeProject.decisionVolumeCountRange, { min: MAX_VOLUME_COUNT, max: MAX_VOLUME_COUNT });
  assert.equal(hugeProject.systemRecommendedVolumeCount, MAX_VOLUME_COUNT);
});

test("volume count guidance respects preferred and existing counts while clamping to valid ranges", () => {
  const preferred = buildVolumeCountGuidance({
    chapterBudget: 80,
    userPreferredVolumeCount: 2,
  });
  assert.equal(preferred.userPreferredVolumeCount, 2);
  assert.equal(preferred.recommendedVolumeCount, 2);
  assert.deepEqual(preferred.hardPlannedVolumeRange, { min: 2, max: 2 });

  const respectedExisting = buildVolumeCountGuidance({
    chapterBudget: 120,
    existingVolumeCount: 5,
    respectExistingVolumeCount: true,
  });
  assert.equal(respectedExisting.respectedExistingVolumeCount, 5);
  assert.equal(respectedExisting.recommendedVolumeCount, 5);

  const ignoredExisting = buildVolumeCountGuidance({
    chapterBudget: 80,
    existingVolumeCount: 2,
    respectExistingVolumeCount: false,
  });
  assert.equal(ignoredExisting.respectedExistingVolumeCount, null);
  assert.equal(ignoredExisting.recommendedVolumeCount, ignoredExisting.systemRecommendedVolumeCount);

  const implicitExisting = buildVolumeCountGuidance({
    chapterBudget: 32,
    existingVolumeCount: 1,
  });
  assert.equal(implicitExisting.respectedExistingVolumeCount, null);
  assert.equal(implicitExisting.recommendedVolumeCount, 1);
});

test("volume count guidance clamps huge budgets to the configured maximum", () => {
  const hugeProject = buildVolumeCountGuidance({
    chapterBudget: 5000,
    maxVolumeCount: MAX_VOLUME_COUNT,
  });

  assert.deepEqual(hugeProject.allowedVolumeCountRange, {
    min: 1,
    max: MAX_VOLUME_COUNT,
  });
  assert.deepEqual(hugeProject.decisionVolumeCountRange, {
    min: MAX_VOLUME_COUNT,
    max: MAX_VOLUME_COUNT,
  });
  assert.equal(hugeProject.systemRecommendedVolumeCount, MAX_VOLUME_COUNT);
  assert.equal(hugeProject.recommendedVolumeCount, MAX_VOLUME_COUNT);
  assert.equal(hugeProject.volumeChapterBudget.volumeCount, MAX_VOLUME_COUNT);
  assert.equal(
    hugeProject.volumeChapterBudget.chapterCounts.reduce((sum, count) => sum + count, 0),
    5000,
  );
  assert.deepEqual(hugeProject.hardPlannedVolumeRange, { min: 3, max: 6 });
});

test("deterministic budget helper covers default long-form scale", () => {
  const hundred = buildVolumeChapterBudget(100);
  assert.equal(hundred.volumeCount, 2);
  assert.deepEqual(hundred.chapterCounts, [50, 50]);

  const eighty = buildVolumeChapterBudget(80);
  assert.equal(eighty.volumeCount, 2);
  assert.deepEqual(eighty.chapterCounts, [40, 40]);

  const oneHundredThirty = buildVolumeChapterBudget(130);
  assert.equal(oneHundredThirty.volumeCount, 3);
  assert.deepEqual(oneHundredThirty.chapterCounts, [44, 43, 43]);
  assert.deepEqual(oneHundredThirty.volumes.map((volume) => [volume.startChapter, volume.endChapter]), [
    [1, 44],
    [45, 87],
    [88, 130],
  ]);
});

test("hard planned volume ranges stay constrained to early volumes", () => {
  assert.deepEqual(buildHardPlannedVolumeRange(1), { min: 1, max: 1 });
  assert.deepEqual(buildHardPlannedVolumeRange(2), { min: 2, max: 2 });
  assert.deepEqual(buildHardPlannedVolumeRange(3), { min: 3, max: 3 });
  assert.deepEqual(buildHardPlannedVolumeRange(4), { min: 3, max: 4 });
  assert.deepEqual(buildHardPlannedVolumeRange(6), { min: 3, max: 4 });
  assert.deepEqual(buildHardPlannedVolumeRange(9), { min: 3, max: 6 });
  assert.deepEqual(buildHardPlannedVolumeRange(24), { min: 3, max: 6 });
});
