/**
 * 篇幅与分卷预算的共享口径。
 *
 * 客户端的基础信息表单、服务端的默认值、卷规划提示与拆章预算都必须使用这里的
 * 常量与算法，避免出现客户端默认 100 章、服务端仍按 80 章规划这类不一致。
 *
 * 分卷预算借鉴“约 50 章一卷”的长篇连载经验：卷数 = ceil(目标章数 / 50)，限制在
 * 1-30 卷，再把章节尽量均匀分给各卷，余数优先给前面的卷。该预算是确定性的，
 * 不依赖模型判断，因此可以直接写进提示词作为拆章硬约束。
 */

export const DEFAULT_ESTIMATED_CHAPTER_COUNT = 100;

export const MIN_ESTIMATED_CHAPTER_COUNT = 1;
export const MAX_ESTIMATED_CHAPTER_COUNT = 2000;

/** 长篇连载的单卷目标章节数：约 50 章一卷。 */
export const TARGET_CHAPTERS_PER_VOLUME = 50;

export const MIN_VOLUME_COUNT = 1;
export const MAX_VOLUME_COUNT = 30;

export interface ChapterLengthPreset {
  id: "short" | "medium" | "long" | "ultra_long";
  label: string;
  chapterCount: number;
  summary: string;
  recommended?: boolean;
}

/**
 * 基础信息里的篇幅预设。默认选中“长篇 100 章”，用户仍可手填任意章节数
 * （手填值不匹配任何预设时按“自定义”展示）。
 */
export const CHAPTER_LENGTH_PRESETS: readonly ChapterLengthPreset[] = [
  {
    id: "short",
    label: "短篇",
    chapterCount: 20,
    summary: "一个完整的小故事，开局、转折和结局都能在有限篇幅里收住。",
  },
  {
    id: "medium",
    label: "中篇",
    chapterCount: 50,
    summary: "一到两条主线加一条关系线，适合先验证故事手感再扩写。",
  },
  {
    id: "long",
    label: "长篇",
    chapterCount: 100,
    summary: "适合大多数连载计划，有足够空间展开阶段升级、人物成长和主线回收。",
    recommended: true,
  },
  {
    id: "ultra_long",
    label: "超长篇",
    chapterCount: 200,
    summary: "适合设定和势力层次较多的故事，规划时会拆成更多卷分批推进。",
  },
] as const;

export const CUSTOM_CHAPTER_LENGTH_PRESET_ID = "custom" as const;
export type ChapterLengthPresetId = ChapterLengthPreset["id"] | typeof CUSTOM_CHAPTER_LENGTH_PRESET_ID;

export function normalizeEstimatedChapterCount(value: number | null | undefined): number {
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : DEFAULT_ESTIMATED_CHAPTER_COUNT;
  return Math.min(
    MAX_ESTIMATED_CHAPTER_COUNT,
    Math.max(MIN_ESTIMATED_CHAPTER_COUNT, Math.round(numeric)),
  );
}

export function findChapterLengthPresetByCount(
  chapterCount: number | null | undefined,
): ChapterLengthPreset | null {
  if (typeof chapterCount !== "number" || !Number.isFinite(chapterCount)) {
    return null;
  }
  const rounded = Math.round(chapterCount);
  return CHAPTER_LENGTH_PRESETS.find((preset) => preset.chapterCount === rounded) ?? null;
}

export function resolveChapterLengthPresetId(
  chapterCount: number | null | undefined,
): ChapterLengthPresetId {
  return findChapterLengthPresetByCount(chapterCount)?.id ?? CUSTOM_CHAPTER_LENGTH_PRESET_ID;
}

function formatWanInteger(value: number): string {
  const wan = value / 10000;
  const rounded = Math.round(wan * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * 给新手一个直观的总字数概念：预计总字数 ≈ 章数 × 每章字数。
 * 例如 100 章 × 2800 字 = 28 万字。
 */
export function formatEstimatedTotalWords(
  chapterCount: number | null | undefined,
  chapterLength: number | null | undefined,
): string {
  const chapters = normalizeEstimatedChapterCount(chapterCount);
  const perChapter = Math.max(1, Math.round(
    typeof chapterLength === "number" && Number.isFinite(chapterLength)
      ? chapterLength
      : 2800,
  ));
  return `预计总字数约 ${formatWanInteger(chapters * perChapter)} 万字（${chapters} 章 × ${perChapter} 字）`;
}

export interface VolumeChapterBudgetEntry {
  volumeOrder: number;
  chapterCount: number;
  startChapter: number;
  endChapter: number;
}

export interface VolumeChapterBudget {
  targetChapterCount: number;
  volumeCount: number;
  chapterCounts: number[];
  volumes: VolumeChapterBudgetEntry[];
}

/**
 * 按约 50 章一卷生成确定性的全书分卷预算。
 *
 * - 100 章 → 2 卷 × 50 章
 * - 80 章 → 2 卷 × 40 章（80 / 50 向上取整为 2 卷后均分）
 * - 130 章 → 3 卷 44 / 43 / 43 章（余数给前面的卷）
 * - 短篇可为 1 卷；卷数上限默认 30，调用方可传入更小的 maxVolumeCount 与服务端上限对齐。
 */
export function buildVolumeChapterBudget(
  targetChapterCount: number | null | undefined,
  options: { maxVolumeCount?: number } = {},
): VolumeChapterBudget {
  // 这里接收的是“全书章节预算”，可能来自已完成章节或上游卷预算，允许大于表单的
  // 2000 章上限，因此只做正整数归一，不复用表单的输入上限。
  const target = Math.max(
    1,
    Math.round(
      typeof targetChapterCount === "number" && Number.isFinite(targetChapterCount)
        ? targetChapterCount
        : DEFAULT_ESTIMATED_CHAPTER_COUNT,
    ),
  );
  const maxVolumeCount = Math.min(
    MAX_VOLUME_COUNT,
    Math.max(MIN_VOLUME_COUNT, Math.round(options.maxVolumeCount ?? MAX_VOLUME_COUNT)),
  );
  const volumeCount = Math.min(
    maxVolumeCount,
    Math.max(MIN_VOLUME_COUNT, Math.ceil(target / TARGET_CHAPTERS_PER_VOLUME)),
  );
  const baseChapterCount = Math.floor(target / volumeCount);
  let remainder = target - (baseChapterCount * volumeCount);
  const chapterCounts: number[] = [];
  for (let index = 0; index < volumeCount; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    chapterCounts.push(baseChapterCount + extra);
  }
  let nextStartChapter = 1;
  const volumes = chapterCounts.map((chapterCount, index) => {
    const entry: VolumeChapterBudgetEntry = {
      volumeOrder: index + 1,
      chapterCount,
      startChapter: nextStartChapter,
      endChapter: nextStartChapter + chapterCount - 1,
    };
    nextStartChapter = entry.endChapter + 1;
    return entry;
  });
  return {
    targetChapterCount: target,
    volumeCount,
    chapterCounts,
    volumes,
  };
}

/** 中文提示词用的分卷预算说明，卷规划与拆章共用。 */
export function formatVolumeChapterBudgetLines(budget: VolumeChapterBudget): string[] {
  return [
    `全书目标章节数：${budget.targetChapterCount} 章`,
    `分卷数：${budget.volumeCount} 卷（按约 ${TARGET_CHAPTERS_PER_VOLUME} 章一卷计算）`,
    ...budget.volumes.map((volume) => (
      `第 ${volume.volumeOrder} 卷：${volume.chapterCount} 章（第 ${volume.startChapter}-${volume.endChapter} 章）`
    )),
    "拆章必须按以上各卷章数预算分配，不得把所有章节挤进第一卷，也不得让单卷明显超出或少于预算（除非用户明确要求调整卷数）。",
  ];
}

/** 自动导演范围规划/章节列表里定位某一卷的预算；卷序超出预算时返回 null。 */
export function findVolumeChapterBudgetEntry(
  budget: VolumeChapterBudget,
  volumeOrder: number | null | undefined,
): VolumeChapterBudgetEntry | null {
  if (typeof volumeOrder !== "number" || !Number.isFinite(volumeOrder)) {
    return null;
  }
  return budget.volumes.find((volume) => volume.volumeOrder === Math.round(volumeOrder)) ?? null;
}
