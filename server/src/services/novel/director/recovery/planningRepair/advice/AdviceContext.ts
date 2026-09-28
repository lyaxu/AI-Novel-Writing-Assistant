type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const array = (value: unknown): Data[] => Array.isArray(value) ? value.map(object) : [];
const pick = (value: Data, keys: string[]) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
function document(value: unknown): Data {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return { missing: "无法读取版本文档" }; } }
  return object(value);
}

/** The fingerprint covers the whole source; paid context only contains the authorized window and its boundary. */
export function buildAdviceContext(input: {
  novel: Data; volumes: unknown[]; chapters: unknown[]; macro: unknown; candidate: unknown;
  seed: Data; eligibleChapterIds: string[];
}) {
  const repair = object(input.seed.planningRepair);
  const snapshot = object(input.seed.planningRepairSnapshot);
  const allowed = new Set(input.eligibleChapterIds);
  const relevant = new Set(allowed);
  const baseline = document(snapshot.baselineDocument);
  const candidate = object(input.candidate);
  const candidateDocument = document(candidate.contentJson);
  const plans = [...array(baseline.volumes), ...array(candidateDocument.volumes), ...input.volumes.map(object)];
  for (const volume of plans) {
    const chapters = array(volume.chapters);
    chapters.forEach((chapter, index) => {
      if (allowed.has(String(chapter.id))) {
        if (chapters[index - 1]) relevant.add(String(chapters[index - 1].id));
        if (chapters[index + 1]) relevant.add(String(chapters[index + 1].id));
      }
    });
  }
  const materialized = new Set<string>();
  const projectVolumes = (volumes: Data[]) => volumes.filter((v) => array(v.chapters).some((c) => relevant.has(String(c.id))))
    .map((v) => ({ ...pick(v, ["id", "title", "sortOrder", "summary", "openingHook", "mainPromise", "primaryPressureSource",
      "coreSellingPoint", "escalationMode", "protagonistChange", "midVolumeRisk", "climax", "payoffType",
      "nextVolumeHook", "resetPoint", "openPayoffs", "openPayoffsJson"]),
      chapters: array(v.chapters).filter((c) => relevant.has(String(c.id))).map((c) => {
        if (typeof c.materializedChapterId === "string") materialized.add(c.materializedChapterId);
        if (typeof c.chapterId === "string") materialized.add(c.chapterId);
        return { ...pick(c, ["id", "chapterId", "materializedChapterId", "chapterOrder", "beatKey", "title", "summary", "purpose", "exclusiveEvent",
          "endingState", "nextChapterEntryState", "conflictLevel", "revealLevel", "targetWordCount", "mustAvoid",
          "taskSheet", "sceneCards", "styleContract", "payoffRefs", "payoffRefsJson", "causalContract"]), writable: allowed.has(String(c.id)) };
      }) }));
  const baselineWindow = projectVolumes(array(baseline.volumes));
  const candidateWindow = projectVolumes(array(candidateDocument.volumes));
  const currentWindow = projectVolumes(input.volumes.map(object));
  return {
    novel: pick(input.novel, ["id", "title", "description", "genreId", "targetAudience", "writingMode", "defaultChapterLength",
      "bookSellingPoint", "competingFeel", "first30ChapterPromise", "commercialTagsJson", "narrativeForm", "writingPlatform",
      "narrativePov", "pacePreference", "styleTone", "emotionIntensity", "aiFreedom", "storyWorldSliceJson",
      "storyWorldSliceOverridesJson", "targetWordCount"]),
    macro: input.macro,
    userIntent: { directorInput: input.seed.directorInput ?? null, selectedCandidate: input.seed.candidate ?? null,
      autoExecutionPlan: input.seed.autoExecutionPlan ?? null, startupPreparation: input.seed.startupPreparation ?? null },
    eligibleChapterIds: input.eligibleChapterIds,
    baselineWindow, candidateWindow, currentWindow,
    chapterEvidence: input.chapters.map(object).filter((c) => materialized.has(String(c.id)) || relevant.has(String(c.id)))
      .map((c) => pick(c, ["id", "order", "title", "expectation", "summary", "content", "taskSheet", "sceneCards", "chapterStatus"])),
    repair: { ...pick(repair, ["key", "rounds", "maxRounds", "phase", "summary", "guidance", "quality", "candidateVersionId"]),
      recentHistory: Array.isArray(repair.history) ? repair.history.slice(-6) : [],
      omittedEarlierHistoryCount: Array.isArray(repair.history) ? Math.max(0, repair.history.length - 6) : 0 },
    missingEvidence: [!input.seed.directorInput && "缺少用户原始导演输入", !candidate.contentJson && "缺少独立修复候选版本",
      !baselineWindow.length && "缺少窗口基线", !input.macro && "缺少书级宏观规划"].filter(Boolean),
    scopeNotice: "仅提供可修改窗口与直接相邻只读边界；未提供全书正文。缺失信息不得推断为已知事实。",
  };
}
