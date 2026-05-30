import type { DirectorQualityRepairRisk } from "@ai-novel/shared/types/novelDirector";
import {
  PIPELINE_QUALITY_NOTICE_CODE,
  PIPELINE_REPLAN_NOTICE_CODE,
  parsePipelinePayload,
} from "../../pipelineJobState";

type PipelineRepairMode = NonNullable<ReturnType<typeof parsePipelinePayload>["repairMode"]>;

export interface DirectorQualityRepairRiskInput {
  noticeCode?: string | null;
  noticeSummary?: string | null;
  payload?: string | null;
  remainingChapterCount: number;
  totalChapterCount: number;
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function buildReason(input: {
  noticeCode?: string | null;
  repairMode?: PipelineRepairMode | null;
  affectedChapterCount: number;
  remainingChapterCount: number;
}): string {
  if (input.noticeCode === PIPELINE_REPLAN_NOTICE_CODE) {
    return "质量检查要求先处理重规划，后续章节需要人工确认后再继续。";
  }
  if (input.repairMode === "heavy_repair") {
    return "本次修复属于大范围返工，建议人工确认修复结果后再继续章节执行。";
  }
  if (input.affectedChapterCount > 0) {
    return `本次质量修复影响 ${input.affectedChapterCount} 章，仍有 ${input.remainingChapterCount} 章待继续。`;
  }
  return `本次质量修复未标记大范围返工，仍有 ${input.remainingChapterCount} 章待继续。`;
}

function buildDeferredQualityDebtReason(input: {
  affectedChapterCount: number;
  remainingChapterCount: number;
}): string {
  const affectedSummary = input.affectedChapterCount > 0
    ? `本次已记录 ${input.affectedChapterCount} 章质量债务`
    : "本次已记录质量债务";
  const remainingSummary = input.remainingChapterCount > 0
    ? `，仍有 ${input.remainingChapterCount} 章可继续推进`
    : "";
  return `${affectedSummary}${remainingSummary}。`;
}

function buildSoftReplanReason(input: {
  affectedChapterCount: number;
  remainingChapterCount: number;
}): string {
  const affectedSummary = input.affectedChapterCount > 0
    ? `本次已记录 ${input.affectedChapterCount} 条重规划提醒`
    : "本次已记录重规划提醒";
  const remainingSummary = input.remainingChapterCount > 0
    ? `，正文可继续推进，仍有 ${input.remainingChapterCount} 章待继续`
    : "，正文可继续推进";
  return `${affectedSummary}${remainingSummary}。`;
}

function isSoftReplanNotice(input: {
  noticeSummary?: string | null;
  replanAlertDetails?: string[] | null;
}): boolean {
  const text = [
    input.noticeSummary,
    ...(Array.isArray(input.replanAlertDetails) ? input.replanAlertDetails : []),
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n");
  if (!text.trim()) {
    return false;
  }

  const softHints = [
    "计划义务配置风险",
    "任务合同中混入后续阶段目标",
    "与本章禁止提前展开的边界冲突",
    "正文不宜为此改写",
    "不构成暂停人工确认的必要条件",
    "非正文必须返工",
    "正文叙事任务和角色状态基本达成",
    "正文已完成本章核心剧情",
    "正文对本章核心剧情和收尾钩子兑现充分",
    "没有严重连续性断裂",
    "没有严重越界",
  ];

  return softHints.some((hint) => text.includes(hint));
}

export function buildDirectorQualityRepairRisk(
  input: DirectorQualityRepairRiskInput,
): DirectorQualityRepairRisk {
  const payload = parsePipelinePayload(input.payload);
  const noticeCode = input.noticeCode?.trim() || null;
  const repairMode = payload.repairMode ?? null;
  const replanCount = normalizeCount(payload.replanAlertDetails?.length);
  const qualityCount = normalizeCount(payload.qualityAlertDetails?.length);
  const recoverableRepairCount = normalizeCount(payload.recoverableRepairDetails?.length);
  const affectedChapterCount = noticeCode === PIPELINE_REPLAN_NOTICE_CODE
    ? replanCount
    : Math.max(qualityCount, recoverableRepairCount);
  const remainingChapterCount = normalizeCount(input.remainingChapterCount);
  const totalChapterCount = Math.max(1, normalizeCount(input.totalChapterCount) || remainingChapterCount || 1);
  const largeScopeThreshold = Math.max(3, Math.ceil(totalChapterCount * 0.25));
  const hasDeferredQualityDebt = noticeCode === PIPELINE_QUALITY_NOTICE_CODE
    || qualityCount > 0
    || recoverableRepairCount > 0;

  if (noticeCode === PIPELINE_REPLAN_NOTICE_CODE || replanCount > 0) {
    const softReplan = isSoftReplanNotice({
      noticeSummary: input.noticeSummary,
      replanAlertDetails: payload.replanAlertDetails,
    });
    return {
      riskLevel: "replan",
      autoContinuable: softReplan,
      reason: softReplan
        ? buildSoftReplanReason({
          affectedChapterCount: replanCount,
          remainingChapterCount,
        })
        : buildReason({
          noticeCode: PIPELINE_REPLAN_NOTICE_CODE,
          repairMode,
          affectedChapterCount: replanCount,
          remainingChapterCount,
        }),
      noticeCode: PIPELINE_REPLAN_NOTICE_CODE,
      repairMode,
      affectedChapterCount: replanCount,
      remainingChapterCount,
    };
  }

  if (hasDeferredQualityDebt) {
    return {
      riskLevel: "low",
      autoContinuable: true,
      reason: buildDeferredQualityDebtReason({
        affectedChapterCount,
        remainingChapterCount,
      }),
      noticeCode: noticeCode ?? PIPELINE_QUALITY_NOTICE_CODE,
      repairMode,
      affectedChapterCount,
      remainingChapterCount,
    };
  }

  const isLargeScope = repairMode === "heavy_repair" || affectedChapterCount >= largeScopeThreshold;
  if (isLargeScope) {
    return {
      riskLevel: "large_scope",
      autoContinuable: false,
      reason: buildReason({
        noticeCode: noticeCode ?? PIPELINE_QUALITY_NOTICE_CODE,
        repairMode,
        affectedChapterCount,
        remainingChapterCount,
      }),
      noticeCode: noticeCode ?? PIPELINE_QUALITY_NOTICE_CODE,
      repairMode,
      affectedChapterCount,
      remainingChapterCount,
    };
  }

  return {
    riskLevel: "low",
    autoContinuable: true,
    reason: buildReason({
      noticeCode: noticeCode ?? PIPELINE_QUALITY_NOTICE_CODE,
      repairMode,
      affectedChapterCount,
      remainingChapterCount,
    }),
    noticeCode: noticeCode ?? PIPELINE_QUALITY_NOTICE_CODE,
    repairMode,
    affectedChapterCount,
    remainingChapterCount,
  };
}
