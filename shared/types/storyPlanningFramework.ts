import { z } from "zod";
import { normalizeEstimatedChapterCount } from "./planningScale.js";

/**
 * 全书框架（大底五阶段 + 结局）与核心伏笔/谜团表的共享类型与校验。
 *
 * 背景：长篇规划不能只有一句故事想法和卷级节奏，还需要能回答三个问题：
 * 1. 全书分为开局 / 发展 / 升级 / 高潮 / 结局哪些阶段，每个阶段大致落在哪些章；
 * 2. 结局最后给出什么结果、付出什么代价、哪些支线必须收束；
 * 3. 3-8 条核心伏笔/谜团分别在哪一章埋设、推进、回收，作者真相是什么。
 *
 * 这些内容保存在 StoryMacroPlan 已有 JSON 列中（不新增数据库迁移），老书没有这些
 * 字段时按“未提供”处理，行为保持不变。伏笔动作通过结构化字段在章纲/规划/复核
 * 之间传递，规划标记统一使用 `[伏笔:F01]` 形式，不做正文关键词扫描。
 */

export const STORY_BLUEPRINT_STAGES = [
  "opening",
  "development",
  "escalation",
  "climax",
  "ending",
] as const;

export type StoryBlueprintStage = typeof STORY_BLUEPRINT_STAGES[number];

export const STORY_BLUEPRINT_STAGE_LABELS: Record<StoryBlueprintStage, string> = {
  opening: "开局",
  development: "发展",
  escalation: "升级",
  climax: "高潮",
  ending: "结局",
};

export const STORY_BLUEPRINT_STAGE_COUNT = STORY_BLUEPRINT_STAGES.length;

export const FORESHADOW_PROMPT_MIN_COUNT = 3;
export const FORESHADOW_PROMPT_MAX_COUNT = 8;
export const FORESHADOW_MAX_COUNT = 20;
export const FORESHADOW_MAX_PROGRESS_CHAPTERS = 12;

const STAGE_ALIASES: Record<string, StoryBlueprintStage> = {
  opening: "opening",
  open: "opening",
  开局: "opening",
  开篇: "opening",
  开端: "opening",
  development: "development",
  develop: "development",
  发展: "development",
  成长: "development",
  推进: "development",
  escalation: "escalation",
  escalate: "escalation",
  升级: "escalation",
  中段升级: "escalation",
  高潮前: "escalation",
  climax: "climax",
  高潮: "climax",
  决战: "climax",
  ending: "ending",
  end: "ending",
  结局: "ending",
  收束: "ending",
  终局: "ending",
};

function normalizeStageValue(value: unknown): StoryBlueprintStage | unknown {
  if (typeof value !== "string") {
    return value;
  }
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return STAGE_ALIASES[key] ?? STAGE_ALIASES[value.trim()];
}

function normalizeChapterNumber(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.round(parsed));
    }
  }
  return value;
}

function normalizeChapterNumberArray(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeChapterNumber);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，、;；\s]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .map(normalizeChapterNumber);
  }
  return value;
}

function normalizeTextValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join("；");
  }
  return value;
}

function normalizeObjectAlias(
  raw: unknown,
  aliasMap: Record<string, string[]>,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const record = { ...(raw as Record<string, unknown>) };
  for (const [canonicalKey, aliases] of Object.entries(aliasMap)) {
    if (record[canonicalKey] !== undefined && record[canonicalKey] !== null) {
      continue;
    }
    for (const alias of aliases) {
      if (record[alias] !== undefined && record[alias] !== null) {
        record[canonicalKey] = record[alias];
        break;
      }
    }
  }
  return record;
}

const normalizedText = z.preprocess(
  normalizeTextValue,
  z.string().trim().min(1),
);

export const storyBlueprintPhaseSchema = z.preprocess(
  (raw) => normalizeObjectAlias(raw, {
    stage: ["phase", "name", "label", "type"],
    chapterStart: ["startChapter", "start", "fromChapter", "chapterFrom"],
    chapterEnd: ["endChapter", "end", "toChapter", "chapterTo"],
    goal: ["objective", "purpose", "stageGoal"],
    summary: ["description", "content", "stageSummary"],
  }),
  z.object({
    stage: z.preprocess(normalizeStageValue, z.enum(STORY_BLUEPRINT_STAGES)),
    chapterStart: z.preprocess(normalizeChapterNumber, z.number().int().min(1)),
    chapterEnd: z.preprocess(normalizeChapterNumber, z.number().int().min(1)),
    goal: normalizedText,
    summary: normalizedText,
  }),
);

export type StoryBlueprintPhase = z.infer<typeof storyBlueprintPhaseSchema>;

export const storyEndingPlanSchema = z.preprocess(
  (raw) => normalizeObjectAlias(raw, {
    outcome: ["result", "endingOutcome", "finalResult"],
    cost: ["endingCost", "price", "sacrifice"],
    subplotClosures: ["subplots", "subplotResolution", "closedSubplots", "branchClosures"],
  }),
  z.object({
    outcome: normalizedText,
    cost: normalizedText,
    subplotClosures: z.array(normalizedText).min(1).max(8),
  }),
);

export type StoryEndingPlan = z.infer<typeof storyEndingPlanSchema>;

export const storyBookBlueprintSchema = z.preprocess(
  (raw) => normalizeObjectAlias(raw, {
    phases: ["stagePlan", "stages", "fiveStages"],
    ending: ["endingPlan", "finale", "endingContract"],
  }),
  z.object({
    phases: z.array(storyBlueprintPhaseSchema).min(STORY_BLUEPRINT_STAGE_COUNT).max(STORY_BLUEPRINT_STAGE_COUNT),
    ending: storyEndingPlanSchema,
  }),
);

export type StoryBookBlueprint = z.infer<typeof storyBookBlueprintSchema>;

export const foreshadowScheduleEntryWireSchema = z.preprocess(
  (raw) => normalizeObjectAlias(raw, {
    id: ["key", "foreshadowId", "code"],
    question: ["readerQuestion", "reader_question", "mystery"],
    truth: ["answer", "authorTruth", "author_truth", "reveal"],
    content: ["visibleClue", "visible_clue", "clue", "plantContent"],
    plannedPayoff: ["payoff", "payoffPlan", "payoff_plan", "planned_payoff"],
    plantChapter: ["plant", "plantChapterOrder", "plant_chapter", "setupChapter"],
    progressChapters: ["progress", "progressChapterOrders", "progress_chapters", "advanceChapters"],
    revealChapter: ["reveal", "revealChapterOrder", "reveal_chapter", "payoffChapter"],
  }),
  z.object({
    id: z.string().trim().min(1).max(24).optional(),
    question: normalizedText,
    truth: normalizedText,
    content: normalizedText,
    plannedPayoff: normalizedText,
    plantChapter: z.preprocess(normalizeChapterNumber, z.number().int().min(1)),
    progressChapters: z.preprocess(normalizeChapterNumberArray, z.array(z.number().int().min(1)).max(FORESHADOW_MAX_PROGRESS_CHAPTERS).default([])),
    revealChapter: z.preprocess(normalizeChapterNumber, z.number().int().min(1)),
  }),
);

export interface ForeshadowScheduleEntry {
  id: string;
  question: string;
  truth: string;
  content: string;
  plannedPayoff: string;
  plantChapter: number;
  progressChapters: number[];
  revealChapter: number;
}

export const foreshadowScheduleSchema = z.array(foreshadowScheduleEntryWireSchema);

export type ForeshadowActionKind = "plant" | "progress" | "reveal";

export interface ChapterForeshadowAction {
  entry: ForeshadowScheduleEntry;
  actions: ForeshadowActionKind[];
}

export const FORESHADOW_ACTION_LABELS: Record<ForeshadowActionKind, string> = {
  plant: "埋设",
  progress: "推进",
  reveal: "回收",
};

export function formatForeshadowToken(entryId: string): string {
  return `[伏笔:${entryId.trim()}]`;
}

export function extractForeshadowTokenIds(text: string | null | undefined): string[] {
  if (typeof text !== "string" || !text) {
    return [];
  }
  const found: string[] = [];
  const prefix = "[伏笔:";
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(prefix, cursor);
    if (start < 0) break;
    const end = text.indexOf("]", start + prefix.length);
    if (end < 0) break;
    const key = text.slice(start + prefix.length, end).trim();
    if (key) found.push(key);
    cursor = end + 1;
  }
  return [...new Set(found)];
}

function sortProgressChapters(chapters: number[]): number[] {
  return [...new Set(chapters)].sort((left, right) => left - right);
}

function normalizeEntryId(rawId: string | undefined, index: number): string {
  const trimmed = rawId?.trim();
  if (trimmed) {
    const fMatch = /^[Ff](\d+)$/.exec(trimmed);
    if (fMatch) {
      return `F${fMatch[1].padStart(2, "0")}`;
    }
    return /^\d+$/.test(trimmed) ? `F${trimmed.padStart(2, "0")}` : trimmed.toUpperCase();
  }
  return `F${String(index + 1).padStart(2, "0")}`;
}

/** 把 AI 输出/旧存档中的伏笔表规范化成稳定结构，并补全缺失的条目 id。 */
export function normalizeForeshadowSchedule(raw: unknown): ForeshadowScheduleEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: ForeshadowScheduleEntry[] = [];
  for (const [index, item] of raw.entries()) {
    const result = foreshadowScheduleEntryWireSchema.safeParse(item);
    if (!result.success) {
      continue;
    }
    parsed.push({
      id: normalizeEntryId(result.data.id, index),
      question: result.data.question,
      truth: result.data.truth,
      content: result.data.content,
      plannedPayoff: result.data.plannedPayoff,
      plantChapter: result.data.plantChapter,
      progressChapters: sortProgressChapters(result.data.progressChapters),
      revealChapter: result.data.revealChapter,
    });
  }
  if (parsed.length === 0) {
    return [];
  }
  const usedIds = new Set<string>();
  return parsed.map((entry, index) => {
    let candidate = entry.id;
    let attempt = index + 1;
    while (usedIds.has(candidate)) {
      candidate = `F${String(attempt).padStart(2, "0")}`;
      attempt += 1;
    }
    usedIds.add(candidate);
    return candidate === entry.id ? entry : { ...entry, id: candidate };
  });
}

export function normalizeStoryBookBlueprint(raw: unknown): StoryBookBlueprint | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const result = storyBookBlueprintSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export interface StoryFrameworkValidationIssue {
  code: string;
  field: "blueprint" | "foreshadowSchedule" | "ending";
  severity: "error" | "warning";
  message: string;
}

function isValidChapterOrder(chapter: number, targetChapterCount: number): boolean {
  return Number.isInteger(chapter) && chapter >= 1 && chapter <= targetChapterCount;
}

/**
 * 校验全书框架与伏笔表是否自洽。返回问题列表而不是抛异常，方便：
 * - 生成后把错误交给模型修复；
 * - 测试与开发时断言；
 * - 老书字段缺失时不产生噪声。
 */
export function validateStoryFramework(input: {
  bookBlueprint?: StoryBookBlueprint | null;
  foreshadowSchedule?: ForeshadowScheduleEntry[] | null;
  targetChapterCount: number;
}): StoryFrameworkValidationIssue[] {
  const targetChapterCount = normalizeEstimatedChapterCount(input.targetChapterCount);
  const issues: StoryFrameworkValidationIssue[] = [];
  const blueprint = input.bookBlueprint ?? null;
  if (blueprint) {
    const seenStages = new Set<StoryBlueprintStage>();
    let previousEnd = 0;
    for (const phase of blueprint.phases) {
      seenStages.add(phase.stage);
      if (phase.chapterEnd < phase.chapterStart) {
        issues.push({
          code: "blueprint_phase_range_invalid",
          field: "blueprint",
          severity: "error",
          message: `${STORY_BLUEPRINT_STAGE_LABELS[phase.stage]}阶段的章节范围无效（${phase.chapterStart}-${phase.chapterEnd}）。`,
        });
      }
      if (!isValidChapterOrder(phase.chapterStart, targetChapterCount)
        || !isValidChapterOrder(phase.chapterEnd, targetChapterCount)) {
        issues.push({
          code: "blueprint_phase_out_of_bounds",
          field: "blueprint",
          severity: "error",
          message: `${STORY_BLUEPRINT_STAGE_LABELS[phase.stage]}阶段超出全书章节范围（应在 1-${targetChapterCount} 章内）。`,
        });
      }
      if (phase.chapterStart <= previousEnd) {
        issues.push({
          code: "blueprint_phase_overlap",
          field: "blueprint",
          severity: "warning",
          message: `${STORY_BLUEPRINT_STAGE_LABELS[phase.stage]}阶段与前一阶段章范围重叠或顺序颠倒。`,
        });
      }
      previousEnd = Math.max(previousEnd, phase.chapterEnd);
    }
    for (const stage of STORY_BLUEPRINT_STAGES) {
      if (!seenStages.has(stage)) {
        issues.push({
          code: "blueprint_phase_missing",
          field: "blueprint",
          severity: "error",
          message: `全书框架缺少${STORY_BLUEPRINT_STAGE_LABELS[stage]}阶段。`,
        });
      }
    }
    if (blueprint.phases.length > 0 && previousEnd !== targetChapterCount) {
      issues.push({
        code: "blueprint_phase_coverage_gap",
        field: "blueprint",
        severity: "warning",
        message: `全书框架的阶段章范围合计应覆盖到第 ${targetChapterCount} 章，实际覆盖到第 ${previousEnd} 章。`,
      });
    }
    if (!blueprint.ending.subplotClosures.length) {
      issues.push({
        code: "ending_subplot_missing",
        field: "ending",
        severity: "error",
        message: "结局缺少需要收束的支线清单。",
      });
    }
  }

  const schedule = input.foreshadowSchedule ?? [];
  if (schedule.length > 0 && schedule.length < FORESHADOW_PROMPT_MIN_COUNT) {
    issues.push({
      code: "foreshadow_too_few",
      field: "foreshadowSchedule",
      severity: "warning",
      message: `核心伏笔/谜团建议保留 ${FORESHADOW_PROMPT_MIN_COUNT}-${FORESHADOW_PROMPT_MAX_COUNT} 条，当前只有 ${schedule.length} 条。`,
    });
  }
  if (schedule.length > FORESHADOW_MAX_COUNT) {
    issues.push({
      code: "foreshadow_too_many",
      field: "foreshadowSchedule",
      severity: "error",
      message: `核心伏笔/谜团最多 ${FORESHADOW_MAX_COUNT} 条，当前有 ${schedule.length} 条。`,
    });
  }
  const seenIds = new Set<string>();
  for (const entry of schedule) {
    if (seenIds.has(entry.id)) {
      issues.push({
        code: "foreshadow_duplicate_id",
        field: "foreshadowSchedule",
        severity: "error",
        message: `伏笔条目 id「${entry.id}」重复。`,
      });
    }
    seenIds.add(entry.id);
    if (!isValidChapterOrder(entry.plantChapter, targetChapterCount)) {
      issues.push({
        code: "foreshadow_plant_out_of_bounds",
        field: "foreshadowSchedule",
        severity: "error",
        message: `伏笔「${entry.id}」的埋设章 ${entry.plantChapter} 超出 1-${targetChapterCount} 章范围。`,
      });
    }
    if (!isValidChapterOrder(entry.revealChapter, targetChapterCount)) {
      issues.push({
        code: "foreshadow_reveal_out_of_bounds",
        field: "foreshadowSchedule",
        severity: "error",
        message: `伏笔「${entry.id}」的回收章 ${entry.revealChapter} 超出 1-${targetChapterCount} 章范围。`,
      });
    }
    for (const progressChapter of entry.progressChapters) {
      if (!isValidChapterOrder(progressChapter, targetChapterCount)) {
        issues.push({
          code: "foreshadow_progress_out_of_bounds",
          field: "foreshadowSchedule",
          severity: "error",
          message: `伏笔「${entry.id}」的推进章 ${progressChapter} 超出 1-${targetChapterCount} 章范围。`,
        });
        continue;
      }
      if (progressChapter <= entry.plantChapter) {
        issues.push({
          code: "foreshadow_progress_before_plant",
          field: "foreshadowSchedule",
          severity: "error",
          message: `伏笔「${entry.id}」的推进章 ${progressChapter} 必须晚于埋设章 ${entry.plantChapter}。`,
        });
      }
      if (progressChapter >= entry.revealChapter) {
        issues.push({
          code: "foreshadow_progress_after_reveal",
          field: "foreshadowSchedule",
          severity: "error",
          message: `伏笔「${entry.id}」的推进章 ${progressChapter} 必须早于回收章 ${entry.revealChapter}。`,
        });
      }
    }
    if (entry.plantChapter >= entry.revealChapter) {
      issues.push({
        code: "foreshadow_plant_not_before_reveal",
        field: "foreshadowSchedule",
        severity: "error",
        message: `伏笔「${entry.id}」的埋设章 ${entry.plantChapter} 必须早于回收章 ${entry.revealChapter}。`,
      });
    }
  }
  return issues;
}

/** 某一章需要执行的伏笔动作（埋设 / 推进 / 回收）。 */
export function selectForeshadowActionsForChapter(
  schedule: readonly ForeshadowScheduleEntry[] | null | undefined,
  chapterOrder: number,
): ChapterForeshadowAction[] {
  if (!Array.isArray(schedule) || !Number.isFinite(chapterOrder)) {
    return [];
  }
  const order = Math.round(chapterOrder);
  const actions: ChapterForeshadowAction[] = [];
  for (const entry of schedule) {
    const kinds: ForeshadowActionKind[] = [];
    if (entry.plantChapter === order) kinds.push("plant");
    if (entry.progressChapters.includes(order)) kinds.push("progress");
    if (entry.revealChapter === order) kinds.push("reveal");
    if (kinds.length > 0) {
      actions.push({ entry, actions: kinds });
    }
  }
  return actions.sort((left, right) => left.entry.id.localeCompare(right.entry.id));
}

/** 某一卷章范围内需要执行的伏笔动作，供卷规划/拆章按卷过滤。 */
export function selectForeshadowActionsForChapterRange(
  schedule: readonly ForeshadowScheduleEntry[] | null | undefined,
  startChapter: number,
  endChapter: number,
): ChapterForeshadowAction[] {
  if (!Array.isArray(schedule)) {
    return [];
  }
  const actions: ChapterForeshadowAction[] = [];
  for (let order = Math.round(startChapter); order <= Math.round(endChapter); order += 1) {
    actions.push(...selectForeshadowActionsForChapter(schedule, order));
  }
  return actions;
}

/**
 * 检查本章的规划文本是否用结构化标记安排了所有应做的伏笔动作。
 *
 * 只匹配 `[伏笔:F01]` 这样的规划标记，不做剧情关键词扫描。规划文本可以来自
 * 章纲 requiredElements、章节规划 mustAdvance 等结构化字段。
 */
export function findMissingForeshadowActions(input: {
  schedule: readonly ForeshadowScheduleEntry[] | null | undefined;
  chapterOrder: number;
  plannedTexts: readonly (string | null | undefined)[];
}): ChapterForeshadowAction[] {
  const dueActions = selectForeshadowActionsForChapter(input.schedule, input.chapterOrder);
  if (dueActions.length === 0) {
    return [];
  }
  const citedIds = new Set<string>();
  for (const text of input.plannedTexts) {
    for (const id of extractForeshadowTokenIds(text)) {
      citedIds.add(id);
    }
  }
  return dueActions.filter((action) => !citedIds.has(action.entry.id));
}

/** 本章伏笔动作的中文提示文本（章纲/章节规划/复核共用）。 */
export function renderChapterForeshadowActionsContext(input: {
  chapterOrder: number;
  actions: readonly ChapterForeshadowAction[];
}): string {
  const { chapterOrder, actions } = input;
  if (actions.length === 0) {
    return `本章（第 ${chapterOrder} 章）没有安排伏笔埋设、推进或回收动作。不要为了凑动作而提前揭晓留待后卷的真相。`;
  }
  const lines = actions.map((action) => {
    const token = formatForeshadowToken(action.entry.id);
    const labels = action.actions.map((kind) => FORESHADOW_ACTION_LABELS[kind]).join("、");
    return [
      `- ${token} 本章动作：${labels}`,
      `  读者问题：${action.entry.question}`,
      `  埋设章：第 ${action.entry.plantChapter} 章；推进章：${action.entry.progressChapters.length > 0 ? action.entry.progressChapters.map((chapter) => `第 ${chapter} 章`).join("、") : "无"}；回收章：第 ${action.entry.revealChapter} 章`,
      `  正文可见线索：${action.entry.content}`,
      `  计划兑现：${action.entry.plannedPayoff}`,
      `  作者真相（仅作者可见，未到回收章不得提前说破）：${action.entry.truth}`,
    ].join("\n");
  });
  return [
    `本章（第 ${chapterOrder} 章）安排了 ${actions.length} 条伏笔动作，必须全部落实：`,
    ...lines,
    "",
    "落位要求：每条动作都必须在章纲 requiredElements 或章节规划 mustAdvance 中有一条对应的结构化条目，并以该条动作自己的标记开头，例如「[伏笔:F01] 埋设：……」。",
    "标记只用于规划、复核与链路校验，正文中绝对不能出现。未到回收章时不得把作者真相直接说破，只能给出约定的可见线索或推进信息。",
  ].join("\n");
}

/** 写作上下文用的精简伏笔动作行（不展开全部作者真相，避免提前说破）。 */
export function renderChapterForeshadowActionsForWriter(
  actions: readonly ChapterForeshadowAction[],
): string[] {
  return actions.map((action) => {
    const token = formatForeshadowToken(action.entry.id);
    const labels = action.actions.map((kind) => FORESHADOW_ACTION_LABELS[kind]).join("、");
    const shouldReveal = action.actions.includes("reveal");
    const detail = shouldReveal
      ? `计划兑现：${action.entry.plannedPayoff}；作者真相：${action.entry.truth}`
      : `正文可见线索：${action.entry.content}`;
    return `${token}${labels}：${detail}`;
  });
}

/** 分卷规划用的伏笔表摘要（最多 20 条，逐条压缩成一行）。 */
export function renderForeshadowScheduleSummary(
  schedule: readonly ForeshadowScheduleEntry[] | null | undefined,
): string {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return "none";
  }
  return schedule.slice(0, FORESHADOW_MAX_COUNT).map((entry) => {
    const progress = entry.progressChapters.length > 0
      ? entry.progressChapters.join("、")
      : "无";
    return `${formatForeshadowToken(entry.id)} ${entry.question} | 埋设第 ${entry.plantChapter} 章；推进第 ${progress} 章；回收第 ${entry.revealChapter} 章 | 线索：${entry.content} | 兑现：${entry.plannedPayoff}`;
  }).join("\n");
}

/** 全书五阶段框架摘要。 */
export function renderStoryBookBlueprintSummary(
  blueprint: StoryBookBlueprint | null | undefined,
): string {
  if (!blueprint) {
    return "none";
  }
  return [
    ...blueprint.phases.map((phase) => (
      `- ${STORY_BLUEPRINT_STAGE_LABELS[phase.stage]}（第 ${phase.chapterStart}-${phase.chapterEnd} 章）：${phase.goal}｜${phase.summary}`
    )),
    `结局结果：${blueprint.ending.outcome}`,
    `结局代价：${blueprint.ending.cost}`,
    `支线收束：${blueprint.ending.subplotClosures.join("；")}`,
  ].join("\n");
}
