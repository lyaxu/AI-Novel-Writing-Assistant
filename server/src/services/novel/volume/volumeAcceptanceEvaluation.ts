/**
 * Volume-level acceptance evaluation (phase E, part 1).
 *
 * Aggregates the per-chapter outcomes of one volume into a single verdict, so that "this volume is
 * finished" is a computed statement rather than an impression.
 *
 * IMPORTANT SCOPE BOUNDARY: this module only *evaluates*. It deliberately does not decide what
 * happens next, because that is a product decision with three defensible answers — stop and wait,
 * continue and record debt, or block only the next volume's outline. Callers receive a verdict and
 * its reasons and apply whatever policy is configured; nothing here throws, blocks, or mutates.
 *
 * The failure direction is chosen on purpose: an unevaluable volume reports `needs_attention`, never
 * `accepted`. A gate that silently passes the cases it could not judge is worse than no gate.
 */

export interface VolumeChapterOutcome {
  chapterOrder: number;
  /** The chapter passed its own acceptance. */
  accepted: boolean;
  /** Unresolved issues that could not be repaired inside the chapter. */
  blockingIssueCount: number;
  /** Known and recorded, allowed to continue, but still owed. */
  hasQualityDebt: boolean;
  /** Chapter obligations that were never discharged. */
  missingObligationCount: number;
}

export type VolumeAcceptanceVerdict = "accepted" | "accepted_with_debt" | "needs_attention";

export interface VolumeGateDecision {
  blocked: boolean;
  /** Shown to the user when blocked, and used as the warning when not. */
  message: string;
}

/**
 * The policy half of phase E, chosen by the product owner: block only the *next volume's outline*.
 *
 * Rationale for the three-way split:
 *   - `needs_attention` blocks. Something in this volume was never finished, and planning the next
 *     one on top of it would bake the gap into the book.
 *   - `accepted_with_debt` does NOT block. Debt is already recorded and visible; blocking on it
 *     would stop the chain on nearly every volume, which is the "硬停" behaviour we are avoiding.
 *   - `accepted` passes silently.
 *
 * This deliberately gates planning only. Written prose is never rolled back or rewritten here.
 */
export function decideVolumeGate(report: VolumeAcceptanceReport, label = "上一卷"): VolumeGateDecision {
  if (report.verdict !== "needs_attention") {
    return {
      blocked: false,
      message: report.verdict === "accepted_with_debt"
        ? `${label}带质量债完成，可以继续规划下一卷；债已记录：${report.reasons.join(" ")}`
        : `${label}已通过验收。`,
    };
  }
  return {
    blocked: true,
    message: `${label}还没有真正完成，暂不生成下一卷大纲。${report.reasons.join(" ")}处理方式：回到该卷补齐未完成的章节，或在确认可以带着这些问题继续时再重新生成。已写的正文不会被改动。`,
  };
}

/**
 * Derive per-chapter outcomes from what the chapter row actually stores.
 *
 * Honest limitation: the row carries `chapterStatus` but not unresolved-issue counts or missing
 * obligations — those live in acceptance reports, which this path does not load. The derived
 * outcome therefore reports zero for both and only distinguishes finished from unfinished work.
 * That is enough to stop a volume whose chapters were never completed, and is deliberately not
 * claimed to be an exhaustive acceptance review.
 */
export function deriveVolumeOutcomes(
  chapters: readonly { order: number; chapterStatus?: string | null }[],
): VolumeChapterOutcome[] {
  return chapters
    .map((chapter) => ({
      chapterOrder: chapter.order,
      accepted: chapter.chapterStatus === "completed",
      blockingIssueCount: 0,
      hasQualityDebt: chapter.chapterStatus === "needs_repair" || chapter.chapterStatus === "pending_generation",
      missingObligationCount: 0,
    }))
    .sort((left, right) => left.chapterOrder - right.chapterOrder);
}

export interface VolumeAcceptanceReport {
  verdict: VolumeAcceptanceVerdict;
  chapterCount: number;
  /** Chapters carrying recorded debt. */
  debtChapterCount: number;
  /** Chapters with at least one unresolved blocking issue. */
  blockingChapterCount: number;
  /** Chapters whose obligations were not fully discharged. */
  unmetObligationChapterCount: number;
  /** Human-readable basis for the verdict, most serious first. */
  reasons: string[];
}

/** Optional cross-check from the foreshadow/reveal side; omitted when that evaluation is unavailable. */
export interface VolumeRevealSignal {
  /** 0..1 share of this volume's reveal obligations that were carried by some chapter's plan. */
  plannedRate: number;
  requiredRate: number;
  meetsRequiredRate: boolean;
  unmappedCount: number;
}

export function evaluateVolumeAcceptance(
  chapters: readonly VolumeChapterOutcome[],
  reveal?: VolumeRevealSignal | null,
): VolumeAcceptanceReport {
  const ordered = [...chapters].sort((left, right) => left.chapterOrder - right.chapterOrder);
  const chapterCount = ordered.length;
  const blockingChapterCount = ordered.filter((chapter) => chapter.blockingIssueCount > 0).length;
  const debtChapterCount = ordered.filter((chapter) => chapter.hasQualityDebt).length;
  const unmetObligationChapterCount = ordered.filter((chapter) => chapter.missingObligationCount > 0).length;
  const rejectedChapterCount = ordered.filter((chapter) => !chapter.accepted).length;

  const reasons: string[] = [];
  if (chapterCount === 0) {
    // Nothing written is not the same as nothing wrong. Do not hand back a pass.
    reasons.push("本卷还没有可评估的章节，无法判断是否完成。");
    return {
      verdict: "needs_attention",
      chapterCount,
      debtChapterCount,
      blockingChapterCount,
      unmetObligationChapterCount,
      reasons,
    };
  }

  if (rejectedChapterCount > 0) {
    reasons.push(`有 ${rejectedChapterCount} 章未通过自身验收。`);
  }
  if (blockingChapterCount > 0) {
    reasons.push(`有 ${blockingChapterCount} 章存在未解决的阻塞问题。`);
  }
  if (unmetObligationChapterCount > 0) {
    reasons.push(`有 ${unmetObligationChapterCount} 章存在未兑现的章节义务。`);
  }
  if (reveal && !reveal.meetsRequiredRate) {
    reasons.push(`本卷伏笔回收安排率 ${Math.round(reveal.plannedRate * 100)}%，低于要求的 ${Math.round(reveal.requiredRate * 100)}%，还有 ${reveal.unmappedCount} 条没有落点。`);
  }

  if (rejectedChapterCount > 0 || blockingChapterCount > 0) {
    return {
      verdict: "needs_attention",
      chapterCount,
      debtChapterCount,
      blockingChapterCount,
      unmetObligationChapterCount,
      reasons,
    };
  }

  if (debtChapterCount > 0 || unmetObligationChapterCount > 0 || (reveal && !reveal.meetsRequiredRate)) {
    if (debtChapterCount > 0) {
      reasons.push(`有 ${debtChapterCount} 章带着已记录的质量债完成。`);
    }
    return {
      verdict: "accepted_with_debt",
      chapterCount,
      debtChapterCount,
      blockingChapterCount,
      unmetObligationChapterCount,
      reasons,
    };
  }

  if (reveal && reveal.plannedRate < 1) {
    // Meets the bar but not everything is scheduled; worth saying plainly, not worth blocking.
    reasons.push(`本卷伏笔回收安排率 ${Math.round(reveal.plannedRate * 100)}%，已达到要求。`);
  }
  if (reasons.length === 0) {
    reasons.push("本卷各章均已通过验收，没有未解决的阻塞问题或未兑现义务。");
  }
  return {
    verdict: "accepted",
    chapterCount,
    debtChapterCount,
    blockingChapterCount,
    unmetObligationChapterCount,
    reasons,
  };
}
