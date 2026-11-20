import type { PlanningRepairState } from "./PlanningRepairStore";
import type { PlanningQualityDebtIssue, PlanningQualityDebtRecord, PlanningQualityDebtSource } from "./planningQualityDebt";

/**
 * Review evidence for an already committed planning repair window.
 *
 * A committed window is later reused when the next chapter's JIT contract is prepared. The reuse
 * guard used to demand that the joint-window and per-chapter reviews were still linked into
 * `planningRepair.quality`. A window committed through the planning-quality-debt policy keeps the
 * failed review findings in history but intentionally has no passing review, so every later chapter
 * in the window was blocked forever with a misleading "commit requires a successful review".
 *
 * Two deterministic paths are handled here, and neither fabricates a review pass:
 * 1. `recoverRecordedReviewEvidence` re-links review/assessment payloads that were saved in history
 *    (append-only) but never copied into `quality`. Only fully passing payloads qualify.
 * 2. `buildCommittedWindowReviewDebtRecord` turns genuinely missing/failed reviews into a visible
 *    chapter-level planning quality debt while keeping the original findings in history.
 *
 * Hard boundaries (unknown external calls, leases, ownership, data integrity, changed written
 * prose) are never converted into debt; the store checks them before calling these helpers.
 */

type Recorded = Record<string, unknown>;

const isRecord = (value: unknown): value is Recorded => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export interface RecordedReviewEvidence {
  quality: Recorded;
  round: number | null;
  source: "history_review" | "history_assessment_with_window";
}

/** Same structural contract as `assertReviewedContracts`: only genuinely passing payloads qualify. */
export function passedJointWindowReview(quality: unknown, affected: readonly string[]): boolean {
  if (!isRecord(quality) || !isRecord(quality.chapters) || !isRecord(quality.window)) return false;
  const chapters: Recorded = quality.chapters;
  const window = quality.window;
  if (window.usable !== true || window.safeToSync !== true || window.requiresUserDecision !== false
    || !Array.isArray(window.issues) || window.issues.length !== 0) return false;
  return affected.every((id) => {
    const review = chapters[id];
    return isRecord(review) && review.status === "passed" && review.verdict === "usable" && review.safeToSync === true;
  });
}

function roundOf(entry: Recorded): number | null {
  return typeof entry.round === "number" && Number.isFinite(entry.round) ? entry.round : null;
}

/** Newest append-only history payloads. `rejected_response` is evidence only and never reused. */
function recordedReviewPayloads(history: unknown[]) {
  let review: { chapters?: Recorded; window?: Recorded; round: number | null } | undefined;
  let assessment: { chapters: Recorded; round: number | null } | undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!isRecord(entry) || !isRecord(entry.result)) continue;
    const result = entry.result;
    if (entry.kind === "review" && !review) {
      review = {
        ...(isRecord(result.chapters) ? { chapters: result.chapters } : {}),
        ...(isRecord(result.window) ? { window: result.window } : {}),
        round: roundOf(entry),
      };
    } else if (entry.kind === "assessment" && !assessment && isRecord(result.chapters)) {
      assessment = { chapters: result.chapters, round: roundOf(entry) };
    }
    if (review && assessment) break;
  }
  return { review, assessment };
}

/**
 * Re-link review evidence that exists in the append-only history but was never associated with
 * `state.quality`. Composing a window from one round with chapter reviews from another round is
 * refused: mixed rounds could certify a candidate that was never reviewed as a whole.
 */
export function recoverRecordedReviewEvidence(
  state: Pick<PlanningRepairState, "history">,
  affected: readonly string[],
): RecordedReviewEvidence | null {
  const history = Array.isArray(state.history) ? state.history : [];
  const { review, assessment } = recordedReviewPayloads(history);
  const roundsAgree = (left: number | null, right: number | null) => left === null || right === null || left === right;
  if (review?.chapters && review.window && roundsAgree(review.round, assessment?.round ?? review.round)) {
    const quality = { chapters: review.chapters, window: review.window };
    if (passedJointWindowReview(quality, affected)) {
      return { quality, round: review.round, source: "history_review" };
    }
  }
  if (review?.window && assessment && roundsAgree(review.round, assessment.round)) {
    const quality = { chapters: assessment.chapters, window: review.window };
    if (passedJointWindowReview(quality, affected)) {
      return { quality, round: assessment.round, source: "history_assessment_with_window" };
    }
  }
  return null;
}

export interface ReviewEvidenceSummary {
  issues: PlanningQualityDebtIssue[];
  /** The last recorded review/assessment payload exists (passing or not); it stays in history. */
  recorded: boolean;
  round: number | null;
}

/** Latest recorded findings for the chapter; evidence for the debt record, never a pass claim. */
export function summarizeRecordedReviewEvidence(
  state: Pick<PlanningRepairState, "history">,
  chapterId: string,
): ReviewEvidenceSummary {
  const history = Array.isArray(state.history) ? state.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!isRecord(entry) || !isRecord(entry.result) || entry.kind !== "assessment") continue;
    const review = isRecord(entry.result.chapters) ? entry.result.chapters[chapterId] : undefined;
    if (!isRecord(review)) continue;
    const issues = Array.isArray(review.issues)
      ? review.issues.flatMap((issue) => {
        if (!isRecord(issue) || typeof issue.id !== "string" || !issue.id.trim()) return [];
        return [{
          id: issue.id.trim(),
          ...(typeof issue.severity === "string" ? { severity: issue.severity } : {}),
          ...(typeof issue.target === "string" ? { target: issue.target } : {}),
          ...(typeof issue.summary === "string" ? { summary: issue.summary.slice(0, 300) } : {}),
        }];
      })
      : [];
    return { issues, recorded: true, round: roundOf(entry) };
  }
  return { issues: [], recorded: false, round: null };
}

export const COMMITTED_WINDOW_REVIEW_DEBT_SOURCE = "committed_window_review_unavailable" as const;

/**
 * Visible chapter-level debt for a committed window whose review evidence is missing or failed.
 * The original findings are copied from history as-is; when there are none, the record says the
 * evidence is missing. It is never written as a passed review.
 */
export function buildCommittedWindowReviewDebtRecord(input: {
  state: Pick<PlanningRepairState, "key" | "chapterId" | "chapterOrder" | "candidateVersionId" | "capacityDebt" | "history">;
  /** Volume plan chapter whose execution contract is being prepared next (JIT). */
  chapterId: string;
  chapterOrder: number;
  acceptedAt?: string;
}): PlanningQualityDebtRecord {
  const evidence = summarizeRecordedReviewEvidence(input.state, input.chapterId);
  const issues: PlanningQualityDebtIssue[] = evidence.issues.length > 0
    ? evidence.issues.slice(0, 8)
    : [{
      id: COMMITTED_WINDOW_REVIEW_DEBT_SOURCE,
      severity: "medium",
      target: "consistency",
      summary: "已提交窗口的联合窗口/逐章复核记录未随会话关联保存；按章节级规划质量债继续后续章节，本次复用不作为复核通过。",
    }];
  return {
    version: 1,
    kind: "planning_quality_debt",
    repairKey: input.state.key,
    candidateVersionId: input.state.candidateVersionId ?? null,
    chapterId: input.chapterId,
    chapterOrder: input.chapterOrder,
    reasons: [COMMITTED_WINDOW_REVIEW_DEBT_SOURCE],
    issues,
    capacityDebt: Array.isArray(input.state.capacityDebt) ? input.state.capacityDebt : [],
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
    source: COMMITTED_WINDOW_REVIEW_DEBT_SOURCE,
    acceptedByPolicy: true,
  };
}

export function isCommittedWindowReviewDebt(record: unknown): record is PlanningQualityDebtRecord {
  return isRecord(record) && record.kind === "planning_quality_debt"
    && record.source === COMMITTED_WINDOW_REVIEW_DEBT_SOURCE;
}
