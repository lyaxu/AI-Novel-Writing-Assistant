import { ChapterProductionError, isDefinitiveProductionFailure } from "../production/reliability";
import { isChapterEmptyContentError } from "./chapterEmptyContentError";

/**
 * Bounded automatic retry for a chapter writer call that was interrupted by a transient transport
 * failure before it produced any usable output.
 *
 * The chapter journal normally treats an interrupted external call as `unknown` and refuses to
 * resend it automatically. That safety boundary exists because a call may have completed at the
 * provider without a confirmed response. A provider stream that failed with a connection/socket
 * transport error and delivered **no text at all** is different: the writer never produced an
 * output, so a single retry of the identical prompt cannot duplicate saved prose. This module owns
 * only that narrow decision and the one-retry loop; the caller still records the attempt in the
 * journal and keeps the normal unknown pause when the retry also fails.
 */

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CLOSED",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
]);

const TRANSIENT_ERROR_TEXT = [
  "terminated",
  "fetch failed",
  "connection error",
  "connection reset",
  "connection refused",
  "connection closed",
  "socket hang up",
  "other side closed",
  "premature close",
  "network error",
  "upstream connect error",
  "transport_error",
  "econnreset",
  "etimedout",
  "und_err_socket",
  "und_err_headers_timeout",
  "und_err_body_timeout",
];

/** Errors that must never be retried automatically even when their text looks connection-like. */
const NON_TRANSIENT_ERROR_CODES = new Set([
  "LLM_OUTPUT_LIMIT",
  "PROMPT_POST_VALIDATION_FAILED",
  "CHAPTER_EMPTY_CONTENT",
  "CHAPTER_PRODUCTION_BUSY",
  "CHAPTER_PRODUCTION_CONFLICT",
  "CHAPTER_PRODUCTION_UNCERTAIN",
  "CHAPTER_PRODUCTION_STORAGE",
  "CHAPTER_REVIEW_INCOMPLETE",
]);

export interface WriterTransportRetryInput {
  error: unknown;
  /** Text this writer attempt actually produced (stream chunks or a completed writer output). */
  producedText: string;
  /** A completed/normalized writer output exists; never retry over it. */
  completed?: boolean;
  /** This attempt is already the one automatic retry. */
  retried?: boolean;
  /**
   * The user explicitly acknowledged the previous unknown call for this operation from the source
   * page. Only then may a transport interruption with retained partial output retry once from
   * scratch; the partial is archived as evidence and never written to the chapter.
   */
  acknowledgedUnknownRecovery?: boolean;
}

export type WriterTransportRetryDecision =
  | { retry: true; reason: "transient_transport_without_output" | "transient_transport_after_acknowledged_unknown" }
  | { retry: false; reason: string };

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return typeof error === "string" ? error : "";
  return `${error.name} ${error.message}`.toLowerCase();
}

/**
 * True only for a transport/connection interruption. Cancellation, definitive validation failures,
 * journal ownership errors and structured-output failures are not retried.
 */
export function isTransientWriterTransportFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof ChapterProductionError) return false;
    if (isChapterEmptyContentError(current)) return false;
    if (isDefinitiveProductionFailure(current)) return false;
    const typed = current as {
      name?: unknown;
      code?: unknown;
      category?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof typed.name === "string" && typed.name === "AbortError") return false;
    if (typeof typed.code === "string" && NON_TRANSIENT_ERROR_CODES.has(typed.code)) return false;
    if (typeof typed.code === "string" && typed.code.startsWith("CHAPTER_PRODUCTION_")) return false;
    if (typeof typed.name === "string" && typed.name === "StructuredOutputError") {
      return typed.category === "transport_error";
    }
    if (typeof typed.code === "string" && TRANSIENT_ERROR_CODES.has(typed.code)) return true;
    const text = (typeof typed.message === "string" ? `${String(typed.name ?? "")} ${typed.message}` : errorText(current)).toLowerCase();
    if (text.trim() && TRANSIENT_ERROR_TEXT.some(fragment => text.includes(fragment))) return true;
    current = typed.cause;
  }
  return false;
}

/**
 * The automatic retry is only legal when the failed attempt had no usable output at all, or when the
 * user explicitly acknowledged the previous unknown call for this operation and the retry starts
 * from scratch (archived partial stays evidence, never chapter prose). Any other produced text keeps
 * the existing pause; the caller records the evidence instead of resending.
 */
export function planWriterTransportRetry(input: WriterTransportRetryInput): WriterTransportRetryDecision {
  if (input.retried) return { retry: false, reason: "automatic_retry_already_used" };
  if (input.completed) return { retry: false, reason: "writer_output_completed" };
  const hasOutput = input.producedText.trim().length > 0;
  if (hasOutput && !input.acknowledgedUnknownRecovery) return { retry: false, reason: "partial_output_retained" };
  if (!isTransientWriterTransportFailure(input.error)) return { retry: false, reason: "not_transient_transport" };
  return {
    retry: true,
    reason: hasOutput ? "transient_transport_after_acknowledged_unknown" : "transient_transport_without_output",
  };
}

export type WriterAttemptOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; producedText: string; completed?: boolean };

export interface WriterTransportRetryInfo {
  attempt: number;
  error: unknown;
  decision: Extract<WriterTransportRetryDecision, { retry: true }>;
  producedTextLength: number;
}

/**
 * Run one writer attempt; if it failed with a transient transport error the identical attempt runs
 * exactly once more when the retry policy allows it (no output, or an explicit user acknowledgement
 * of the previous unknown call). A second failure keeps the original pause semantics (the caller
 * records the journal evidence through `onRetry` and the normal failure path).
 */
export async function runWriterAttemptWithTransportRetry<T>(input: {
  runAttempt: (attempt: number) => Promise<WriterAttemptOutcome<T>>;
  onRetry?: (info: WriterTransportRetryInfo) => void | Promise<void>;
  acknowledgedUnknownRecovery?: boolean;
}): Promise<{ value: T; transportRetries: number }> {
  const first = await input.runAttempt(0);
  if (first.ok) return { value: first.value, transportRetries: 0 };
  const decision = planWriterTransportRetry({
    error: first.error,
    producedText: first.producedText,
    completed: first.completed,
    retried: false,
    acknowledgedUnknownRecovery: input.acknowledgedUnknownRecovery === true,
  });
  if (!decision.retry) throw first.error;
  await input.onRetry?.({
    attempt: 0,
    error: first.error,
    decision,
    producedTextLength: first.producedText.trim().length,
  });
  const second = await input.runAttempt(1);
  if (second.ok) return { value: second.value, transportRetries: 1 };
  // The retry is already spent; the second failure is the one the normal unknown/pause path sees.
  throw second.error;
}
