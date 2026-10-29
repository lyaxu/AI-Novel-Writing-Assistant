import type { ChapterLengthCompliance } from "../../../../prompting/prompts/novel/chapterAcceptance.prompts";

/**
 * Deterministic post-processing of an already measured chapter body.
 *
 * Length is a measurable property, not a semantic judgement: the program counts the
 * body once and compares it with the existing length contract
 * (`resolveLengthBudgetContract` -> soft min/max/hard max). No new threshold is
 * introduced here, and the AI still owns whether the prose is padded, list-like or
 * repetitive. The measured result is exposed as a structured compliance record so
 * repair and quality-debt paths can reference it without re-deriving numbers.
 */
export interface ChapterLengthRange {
  targetWordCount: number | null;
  minWordCount: number | null;
  maxWordCount: number | null;
  hardMaxWordCount?: number | null;
}

export interface ChapterLengthAuditIssue {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "plot";
  evidence: string;
  fixSuggestion: string;
}

export interface ChapterLengthComplianceAssessment {
  compliance: ChapterLengthCompliance | null;
  issue: ChapterLengthAuditIssue | null;
}

const OVER_FIX_SUGGESTION = "压缩重复解释、清单式罗列和无进展的对话，优先删减与本章任务、已核实动作和章节钩子无关的内容；保留必须兑现的义务、人物出场与必要因果，不得为压字数新增设定或把正文压成空泛概述。";
const UNDER_FIX_SUGGESTION = "补足可读的推进、冲突或场景实质，扩写已有行动过程与人物反应；不注水、不重复已写信息、不新增世界设定，也不提前透支后续章节事件。";

/** One counting rule for acceptance, repair review and audit metadata. */
export function countChapterCharacters(content: string): number {
  return content.replace(/\s+/g, "").trim().length;
}

export function assessChapterLengthCompliance(input: {
  content: string;
  range: ChapterLengthRange;
}): ChapterLengthComplianceAssessment {
  const { range } = input;
  if (range.targetWordCount == null || range.minWordCount == null || range.maxWordCount == null) {
    return { compliance: null, issue: null };
  }
  const actualWordCount = countChapterCharacters(input.content);
  const hardMaxWordCount = range.hardMaxWordCount ?? null;
  const status: ChapterLengthCompliance["status"] = hardMaxWordCount != null && actualWordCount > hardMaxWordCount
    ? "over_hard"
    : actualWordCount > range.maxWordCount
      ? "over_soft"
      : actualWordCount < range.minWordCount
        ? "under_soft"
        : "within_band";
  const compliance: ChapterLengthCompliance = {
    targetWordCount: range.targetWordCount,
    actualWordCount,
    minWordCount: range.minWordCount,
    maxWordCount: range.maxWordCount,
    hardMaxWordCount,
    status,
    excessWordCount: status === "over_soft" || status === "over_hard"
      ? actualWordCount - range.maxWordCount
      : status === "under_soft" ? range.minWordCount - actualWordCount : null,
  };
  const contract = `章目标 ${range.targetWordCount} 字，长度合同允许 ${range.minWordCount}–${range.maxWordCount} 字${hardMaxWordCount != null ? `，硬上限 ${hardMaxWordCount} 字` : ""}`;
  if (status === "over_hard" || status === "over_soft") {
    return {
      compliance,
      issue: {
        code: status === "over_hard" ? "length_over_hard" : "length_over_soft",
        severity: status === "over_hard" ? "high" : "medium",
        category: "plot",
        evidence: `正文实际 ${actualWordCount} 字。${contract}；${status === "over_hard" ? "已超过硬上限" : "已超过允许区间上限"} ${compliance.excessWordCount} 字。`,
        fixSuggestion: OVER_FIX_SUGGESTION,
      },
    };
  }
  if (status === "under_soft") {
    return {
      compliance,
      issue: {
        code: "length_under_soft",
        severity: "medium",
        category: "plot",
        evidence: `正文实际 ${actualWordCount} 字。${contract}；低于允许区间下限 ${compliance.excessWordCount} 字。`,
        fixSuggestion: UNDER_FIX_SUGGESTION,
      },
    };
  }
  return { compliance, issue: null };
}
