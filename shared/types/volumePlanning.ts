import type {
  VolumeChapterTargetRange,
  VolumeCountGuidance,
  VolumeCountRange,
  VolumeScaleProfile,
} from "./novel";
import {
  buildVolumeChapterBudget,
  formatVolumeChapterBudgetLines,
} from "./planningScale.js";

export const MIN_TOTAL_CHAPTER_BUDGET = 12;
export const MAX_VOLUME_COUNT = 24;
export const DEFAULT_VOLUME_CHAPTER_TARGET_RANGE: VolumeChapterTargetRange = {
  min: 40,
  ideal: 50,
  max: 70,
};

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export function buildHardPlannedVolumeRange(recommendedVolumeCount: number): VolumeCountRange {
  const normalizedCount = Math.max(1, Math.round(recommendedVolumeCount));
  if (normalizedCount <= 3) {
    return {
      min: normalizedCount,
      max: normalizedCount,
    };
  }
  if (normalizedCount <= 6) {
    return {
      min: 3,
      max: Math.min(4, normalizedCount),
    };
  }
  return {
    min: 3,
    max: Math.min(6, normalizedCount),
  };
}

function resolveVolumeScaleProfile(chapterBudget: number): {
  profile: VolumeScaleProfile;
  rationale: string;
} {
  if (chapterBudget < 30) {
    return {
      profile: "short",
      rationale: "短篇或短中篇可以保留一到两段结构，优先保证开局承诺和结尾兑现不被拆散。",
    };
  }
  if (chapterBudget < 60) {
    return {
      profile: "compact",
      rationale: "紧凑全书按约 50 章一卷拆卷，让开局、转向和终局各有独立篇幅，避免结尾被前期推进挤占。",
    };
  }
  if (chapterBudget < 120) {
    return {
      profile: "compact",
      rationale: "60 章以上按约 50 章一卷拆卷，避免压成开局卷和结局卷后中段失焦。",
    };
  }
  if (chapterBudget < 250) {
    return {
      profile: "standard",
      rationale: "中篇体量按约 50 章一卷拆卷，给开局、中段转向和后段兑现留出独立空间。",
    };
  }
  if (chapterBudget < 500) {
    return {
      profile: "long",
      rationale: "长篇需要按卖点切换、压力升级和阶段兑现拆出清晰的卷级节奏。",
    };
  }
  if (chapterBudget < 900) {
    return {
      profile: "epic",
      rationale: "大长篇需要更多卷级回报节点，避免单卷过粗导致阶段感和追读动力变弱。",
    };
  }
  if (chapterBudget < 1500) {
    return {
      profile: "epic",
      rationale: "超长篇需要保持卷级颗粒度，让地图、势力、能力和关系阶段逐步展开。",
    };
  }
  return {
    profile: "mega",
    rationale: "超长篇默认接近最大卷数，优先保障长期连载的阶段兑现密度和后续可调度空间。",
  };
}

/**
 * 分卷规划的唯一权威口径。
 *
 * 卷数不再由“题材经验区间”决定，而是由确定性预算决定：约 50 章一卷，
 * 卷数 = ceil(章节预算 / 50)，再按服务端最大卷数收敛。这样默认 100 章长篇
 * 会得到 2 卷 × 50 章，拆章阶段就能直接按预算分配，不会把章节全挤进第一卷。
 * 用户明确指定卷数或已有草稿结构时仍优先沿用用户选择。
 */
export function buildVolumeCountGuidance(params: {
  chapterBudget: number;
  existingVolumeCount?: number | null;
  respectExistingVolumeCount?: boolean;
  userPreferredVolumeCount?: number | null;
  maxVolumeCount?: number;
  targetChapterRange?: VolumeChapterTargetRange;
}): VolumeCountGuidance {
  const maxVolumeCount = Math.max(1, Math.round(params.maxVolumeCount ?? MAX_VOLUME_COUNT));
  const targetChapterRange = params.targetChapterRange ?? DEFAULT_VOLUME_CHAPTER_TARGET_RANGE;
  const chapterBudget = Math.max(
    MIN_TOTAL_CHAPTER_BUDGET,
    Math.round(Number.isFinite(params.chapterBudget) ? params.chapterBudget : MIN_TOTAL_CHAPTER_BUDGET),
  );

  const allowedVolumeCountRange: VolumeCountRange = {
    min: 1,
    max: maxVolumeCount,
  };
  if (allowedVolumeCountRange.max < allowedVolumeCountRange.min) {
    allowedVolumeCountRange.max = allowedVolumeCountRange.min;
  }

  const volumeChapterBudget = buildVolumeChapterBudget(chapterBudget, { maxVolumeCount });
  const systemRecommendedVolumeCount = clampInteger(
    volumeChapterBudget.volumeCount,
    allowedVolumeCountRange.min,
    allowedVolumeCountRange.max,
  );
  // 系统推荐卷数就是唯一决策范围：允许用户显式改卷数，但不允许 AI 自行偏离 50 章/卷预算。
  const decisionVolumeCountRange: VolumeCountRange = {
    min: systemRecommendedVolumeCount,
    max: systemRecommendedVolumeCount,
  };

  const scale = resolveVolumeScaleProfile(chapterBudget);
  const normalizedUserPreferredVolumeCount = normalizePositiveInteger(params.userPreferredVolumeCount);
  const userPreferredVolumeCount = normalizedUserPreferredVolumeCount == null
    ? null
    : clampInteger(
      normalizedUserPreferredVolumeCount,
      allowedVolumeCountRange.min,
      allowedVolumeCountRange.max,
    );

  const normalizedExistingVolumeCount = normalizePositiveInteger(params.existingVolumeCount);
  const respectedExistingVolumeCount = (
    params.respectExistingVolumeCount === true
    && userPreferredVolumeCount == null
    && normalizedExistingVolumeCount != null
  )
    ? clampInteger(
      normalizedExistingVolumeCount,
      allowedVolumeCountRange.min,
      allowedVolumeCountRange.max,
    )
    : null;

  const recommendedVolumeCount = userPreferredVolumeCount
    ?? respectedExistingVolumeCount
    ?? systemRecommendedVolumeCount;

  return {
    chapterBudget,
    targetChapterRange,
    allowedVolumeCountRange,
    decisionVolumeCountRange,
    volumeScaleProfile: scale.profile,
    volumeCountRationale: [
      scale.rationale,
      ...formatVolumeChapterBudgetLines(volumeChapterBudget),
    ].join(" "),
    recommendedVolumeCount,
    systemRecommendedVolumeCount,
    hardPlannedVolumeRange: buildHardPlannedVolumeRange(recommendedVolumeCount),
    userPreferredVolumeCount,
    respectedExistingVolumeCount,
    volumeChapterBudget,
  };
}
