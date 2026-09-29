import type { PlanningRepairAdviceOutput } from "@ai-novel/shared/types/planningRepair/advice";
import type { VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { projectPlanningHorizon } from "../../../../volume/planningPromises";

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const array = (value: unknown): Data[] => Array.isArray(value) ? value.map(object) : [];
const pick = (value: Data, keys: string[]) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
function document(value: unknown): Data {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return { missing: "无法读取版本文档" }; } }
  return object(value);
}

/** Inventory contains paths only: exact authoritative text remains in candidateWindow. */
function candidateEvidencePaths(volumes: Data[]): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (!value.trim()) return;
      try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === "object") { visit(parsed, path); return; } } catch { /* Plain source text. */ }
      paths.push(path);
    } else if (Array.isArray(value)) value.forEach((child, i) => visit(child, `${path}[${i}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };
  volumes.forEach((v, i) => array(v.chapters).forEach((c, j) => {
    if (!c.writable) return;
    for (const key of ["summary", "purpose", "exclusiveEvent", "endingState", "nextChapterEntryState", "mustAvoid", "taskSheet", "sceneCards", "payoffRefs", "payoffRefsJson", "causalContract"]) {
      visit(c[key], `candidateWindow[${i}].chapters[${j}].${key}`);
    }
  }));
  return paths;
}

function historyForDiagnosis(entry: unknown): Data {
  const item = object(entry);
  if (item.kind !== "repair") return item;
  const output = object(item.output);
  // Preserve obligations verbatim, including proposed references; omit repetitive executable
  // chapter drafts so they cannot visually masquerade as persisted candidate content.
  return { ...item, output: { ...pick(output, ["requiresUserDecision", "reason", "obligationMoves", "reviewTargets", "remainingRisks"]),
    proposedChapterObligations: array(output.changes).map(change => pick(change, ["chapterId", "payoffRefs", "payoffRefsJson"])),
    projection: { role: "unverified_historical_proposal", omittedFields: "changes中的章节正文执行安排（summary/taskSheet/sceneCards等）；原始记录保留在运行历史，未在建议上下文重复。", rule: "reason和提出的义务均是历史模型主张，不证明当前候选已改动；请逐项对照candidateWindow。" } } };
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
  const horizon = (source: Data) => projectPlanningHorizon({
    volumes: array(source.volumes) as unknown as VolumePlanDocument["volumes"],
    beatSheets: array(source.beatSheets) as unknown as VolumePlanDocument["beatSheets"],
  }, String(repair.volumeId ?? ""), input.eligibleChapterIds);
  return {
    candidateAuthority: { versionId: candidate.id ?? null, source: "persisted_candidate_version",
      currentContentPath: "candidateWindow", planningHorizonPath: "candidatePlanningHorizon",
      rule: "只有此独立保存版本是当前待复核候选；历史模型返回、修复建议与审查描述不能替代当前内容。返回修复文本不证明已应用或已通过审查。" },
    candidateWindow,
    candidateEvidencePaths: candidateEvidencePaths(candidateWindow),
    novel: pick(input.novel, ["id", "title", "description", "genreId", "targetAudience", "writingMode", "defaultChapterLength",
      "bookSellingPoint", "competingFeel", "first30ChapterPromise", "commercialTagsJson", "narrativeForm", "writingPlatform",
      "narrativePov", "pacePreference", "styleTone", "emotionIntensity", "aiFreedom", "storyWorldSliceJson",
      "storyWorldSliceOverridesJson", "targetWordCount"]),
    macro: input.macro,
    userIntent: { directorInput: input.seed.directorInput ?? null, selectedCandidate: input.seed.candidate ?? null,
      autoExecutionPlan: input.seed.autoExecutionPlan ?? null, startupPreparation: input.seed.startupPreparation ?? null },
    eligibleChapterIds: input.eligibleChapterIds,
    baselineWindow, currentWindow,
    baselinePlanningHorizon: horizon(baseline),
    candidatePlanningHorizon: horizon(candidateDocument),
    chapterEvidence: input.chapters.map(object).filter((c) => materialized.has(String(c.id)) || relevant.has(String(c.id)))
      .map((c) => pick(c, ["id", "order", "title", "expectation", "summary", "content", "taskSheet", "sceneCards", "chapterStatus"])),
    repair: { ...pick(repair, ["key", "chapterId", "affectedChapterIds", "rounds", "maxRounds", "phase", "summary", "guidance", "quality", "candidateVersionId", "obligationMoves", "technicalError", "reviewTargets", "remainingRisks"]),
      recentHistory: Array.isArray(repair.history) ? repair.history.slice(-6).map((entry) => {
        const item = historyForDiagnosis(entry);
        return { ...item, provenance: { authoritativeForCurrentCandidate: false,
          role: item.kind === "repair" ? "model_repair_proposal_not_current_candidate"
            : item.kind === "rejected_response" ? "rejected_model_response_not_applied" : "historical_record_not_current_candidate",
          rule: "保留原文仅供诊断；不能依据本条声称当前候选已改好。必须对照candidateWindow实际保存文本。" } };
      }) : [],
      omittedEarlierHistoryCount: Array.isArray(repair.history) ? Math.max(0, repair.history.length - 6) : 0 },
    missingEvidence: [!input.seed.directorInput && "缺少用户原始导演输入", !candidate.contentJson && "缺少独立修复候选版本",
      !baselineWindow.length && "缺少窗口基线", !input.macro && "缺少书级宏观规划"].filter(Boolean),
    scopeNotice: "eligibleChapterIds 是修改权限，不是阅读权限。candidatePlanningHorizon 是当前候选中实际已存同卷后续路线与节奏板，baselinePlanningHorizon 是基线，二者不可混用。只读后续安排可证明承接，不需在本章重复抄写；阅读不扩大可修改窗口，也不将计划变为已发生事实。遵守 coverage 的容量边界，未提供全书正文，缺失不得推断为不存在。",
  };
}


export function adviceCandidateSourceText(context: unknown, path: string): { chapterId: string; text: string } | null {
  const source = object(context);
  const match = /^candidateWindow\[(\d+)\]\.chapters\[(\d+)\]\.(summary|purpose|exclusiveEvent|endingState|nextChapterEntryState|mustAvoid|taskSheet|sceneCards|payoffRefs|payoffRefsJson|causalContract)(.*)$/.exec(path);
  if (!match || !/^(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/.test(match[4])) return null;
  const chapter = array(array(source.candidateWindow)[Number(match[1])]?.chapters)[Number(match[2])];
  if (!chapter) return null;
  let leaf: unknown = chapter[match[3]];
  const segments = match[4].match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? [];
  for (const segment of segments) {
    if (typeof leaf === "string") { try { leaf = JSON.parse(leaf); } catch { leaf = undefined; } }
    if (!leaf || typeof leaf !== "object" || !Object.hasOwn(leaf, segment)) { leaf = undefined; break; }
    leaf = (leaf as Data)[segment];
  }
  return typeof leaf === "string" ? { chapterId: String(chapter.id), text: leaf } : null;
}

/** Structural provenance guard only; AI must still judge whether cited content resolves the issue. */
export function adviceCandidateEvidenceError(option: PlanningRepairAdviceOutput["options"][number], context: unknown): string | null {
  if (option.executionMode !== "review_existing") return null;
  const source = object(context);
  const versionId = object(source.candidateAuthority).versionId;
  if (typeof versionId !== "string" || option.candidateVersionId !== versionId || !option.candidateEvidence?.length) {
    return "此复核建议缺少当前候选的版本与原文依据，请重新获取建议。";
  }
  const witnessed = new Set<string>();
  for (const evidence of option.candidateEvidence) {
    const path = evidence.sourcePath;
    const resolved = adviceCandidateSourceText(context, path);
    if (!resolved || !option.affectedChapterIds.includes(resolved.chapterId)) return "复核依据未对应本方案的候选章节，请重新获取建议。";
    const leaf = resolved.text;
    if (typeof leaf !== "string" || !evidence.quote.trim() || !leaf.includes(evidence.quote)) {
      return "复核建议引用的内容不在当前已保存候选中，请重新获取建议。";
    }
    witnessed.add(resolved.chapterId);
  }
  if (!option.affectedChapterIds.every(id => witnessed.has(id))) return "复核依据未覆盖本方案的全部候选章节，请重新获取建议。";
  return null;
}
