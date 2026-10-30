import { isDirectorAutoExecutionRunMode, isFullBookAutopilotRunMode, normalizeDirectorContinuationMode } from "@ai-novel/shared/types/novelDirector";

/**
 * Pure policy for the automatic chapter-title recovery path.
 *
 * The healing layer decides *whether* a chapter-title diversity warning must be
 * repaired automatically. It must never generate titles itself: the existing
 * `repairDirectorChapterTitles` runtime owns that behaviour. This module only
 * classifies the situation so both the workflow layer and the director runtime
 * reach the same conclusion without importing each other.
 */

/** Persisted marker proving at most one automatic repair attempt per volume. */
export interface ChapterTitleAutoRepairState {
  version: 1;
  status: "scheduled" | "running" | "completed" | "completed_with_warning" | "failed";
  attempts: number;
  volumeId: string | null;
  issue: string;
  attemptedAt: string;
  warningSummary?: string | null;
  error?: string | null;
}

export type ChapterTitleAutoRepairDecision =
  | { action: "auto_repair" }
  | { action: "already_attempted"; attempt: ChapterTitleAutoRepairState }
  | { action: "manual_only" };

export function readChapterTitleAutoRepairState(seed: unknown): ChapterTitleAutoRepairState | null {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    return null;
  }
  const raw = (seed as { chapterTitleAutoRepair?: unknown }).chapterTitleAutoRepair;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1 || typeof record.issue !== "string"
    || typeof record.attempts !== "number" || !Number.isFinite(record.attempts)
    || typeof record.attemptedAt !== "string" || !record.attemptedAt.trim()) {
    return null;
  }
  const status = typeof record.status === "string" ? record.status : "";
  if (!["scheduled", "running", "completed", "completed_with_warning", "failed"].includes(status)) {
    return null;
  }
  return {
    version: 1,
    status: status as ChapterTitleAutoRepairState["status"],
    attempts: record.attempts,
    volumeId: typeof record.volumeId === "string" && record.volumeId.trim() ? record.volumeId.trim() : null,
    issue: record.issue,
    attemptedAt: record.attemptedAt,
    warningSummary: typeof record.warningSummary === "string" ? record.warningSummary : null,
    error: typeof record.error === "string" ? record.error : null,
  };
}

/**
 * Automatic repair is only a full-autopilot behaviour: a stored auto execution
 * plan alone is not enough because the task may still be waiting for its first
 * manual confirmation. `full_book_autopilot` or an auto-execution run mode with
 * an enabled auto execution state both mean "the director already owns the
 * continuation".
 */
export function isChapterTitleAutoRepairEnabledByMode(input: {
  runMode?: unknown;
  autoExecutionEnabled?: unknown;
}): boolean {
  const runMode = typeof input.runMode === "string" ? input.runMode : null;
  if (isFullBookAutopilotRunMode(runMode)) {
    return true;
  }
  return isDirectorAutoExecutionRunMode(runMode) && input.autoExecutionEnabled === true;
}

/**
 * One automatic attempt per volume. A later title-diversity warning in a
 * different volume is a new episode and may be repaired automatically again.
 * This keeps retries bounded without permanently disabling the mechanism.
 */
export function planChapterTitleAutoRepair(input: {
  issue: string | null | undefined;
  runMode?: unknown;
  autoExecutionEnabled?: unknown;
  volumeId?: string | null;
  state: ChapterTitleAutoRepairState | null;
}): ChapterTitleAutoRepairDecision {
  const issue = input.issue?.trim();
  if (!issue || !isChapterTitleAutoRepairEnabledByMode(input)) {
    return { action: "manual_only" };
  }
  const state = input.state;
  if (!state) {
    return { action: "auto_repair" };
  }
  const sameEpisode = !state.volumeId || !input.volumeId || state.volumeId === input.volumeId;
  if (state.attempts >= 1 && sameEpisode) {
    return { action: "already_attempted", attempt: state };
  }
  return { action: "auto_repair" };
}

/** Build the bounded marker written before the single automatic attempt starts. */
export function buildChapterTitleAutoRepairState(input: {
  issue: string;
  volumeId?: string | null;
  attemptedAt?: string;
}): ChapterTitleAutoRepairState {
  return {
    version: 1,
    status: "scheduled",
    attempts: 1,
    volumeId: input.volumeId?.trim() || null,
    issue: input.issue.trim(),
    attemptedAt: input.attemptedAt ?? new Date().toISOString(),
  };
}

export const CHAPTER_TITLE_AUTO_REPAIR_SCHEDULED_LABEL = "正在自动修复章节标题";
export const CHAPTER_TITLE_AUTO_REPAIR_FALLBACK_MESSAGE = "章节标题自动修复未能完成，可继续任务或手动快速修复章节标题。";
export const CHAPTER_TITLE_AUTO_REPAIR_WARNING_LABEL = "章节标题仍有结构提醒，继续写作";

/** Normalize the continuation mode used after a successful repair. */
export function resolveChapterTitleAutoContinueMode(_value: unknown): ReturnType<typeof normalizeDirectorContinuationMode> {
  return normalizeDirectorContinuationMode("resume");
}
