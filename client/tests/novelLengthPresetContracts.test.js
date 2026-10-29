import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("length presets are defined once in shared and default to the 100-chapter long form", () => {
  const shared = read("../shared/types/planningScale.ts");
  assert.match(shared, /export const DEFAULT_ESTIMATED_CHAPTER_COUNT = 100;/);
  assert.match(shared, /label: "短篇",\s*\n\s*chapterCount: 20,/);
  assert.match(shared, /label: "中篇",\s*\n\s*chapterCount: 50,/);
  assert.match(shared, /label: "长篇",\s*\n\s*chapterCount: 100,/);
  assert.match(shared, /label: "超长篇",\s*\n\s*chapterCount: 200,/);
  assert.match(shared, /recommended: true,/);
  assert.match(shared, /formatEstimatedTotalWords/);
});

test("manual novel creation and quick auto-director start both offer the shared presets", () => {
  const form = read("src/pages/novels/components/NovelBasicInfoForm.tsx");
  assert.match(form, /ChapterLengthPresetField/);
  assert.match(form, /inputId="basic-estimated-chapters"/);

  const stageBasicSetup = read("src/pages/novels/autoDirector/StageBasicSetup.tsx");
  assert.match(stageBasicSetup, /ChapterLengthPresetField/);
  assert.match(stageBasicSetup, /inputId="director-basic-estimated"/);

  const presetField = read("src/pages/novels/components/basicInfoForm/ChapterLengthPresetField.tsx");
  assert.match(presetField, /CHAPTER_LENGTH_PRESETS/);
  assert.match(presetField, /CUSTOM_CHAPTER_LENGTH_PRESET_ID/);
  assert.match(presetField, /formatEstimatedTotalWords/);
  assert.match(presetField, /自定义/);
  assert.match(presetField, /全书章节数/);
  assert.doesNotMatch(presetField, /DEFAULT_ESTIMATED_CHAPTER_COUNT = 80/);
});

test("client basic info keeps the shared default instead of a local 80-chapter constant", () => {
  const basicInfo = read("src/pages/novels/novelBasicInfo.shared.ts");
  assert.match(basicInfo, /DEFAULT_ESTIMATED_CHAPTER_COUNT\s*\}\s*from\s*"@ai-novel\/shared\/types\/planningScale"/);
  assert.match(basicInfo, /export \{ DEFAULT_ESTIMATED_CHAPTER_COUNT \};/);
  assert.doesNotMatch(basicInfo, /DEFAULT_ESTIMATED_CHAPTER_COUNT = 80/);
  assert.match(basicInfo, /estimatedChapterCount: DEFAULT_ESTIMATED_CHAPTER_COUNT/);

  const presetField = read("src/pages/novels/components/basicInfoForm/ChapterLengthPresetField.tsx");
  assert.doesNotMatch(presetField, /\?\?\s*80\b/);
});
