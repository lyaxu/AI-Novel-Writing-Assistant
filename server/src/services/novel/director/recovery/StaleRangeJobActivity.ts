/**
 * Classification for range `GenerationJob` rows that still read as queued/running although nothing
 * can be executing them any more.
 *
 * A planning-repair failure can leave the job row in `queued` (the artificial pause projection used
 * by the director) with `pendingManualRecovery`, no `currentItemKey`, no owner/lease and a long-dead
 * heartbeat. The generic convergence must be able to retire that shell instead of treating it as an
 * active task forever. Classification is deliberately strict and evidence-based:
 *
 * - only `queued`/`running` rows with no chapter anchor, no owner and no lease timestamp at all;
 * - no heartbeat (or a heartbeat older than the idle window) and an `updatedAt` older than the
 *   idle window, so a freshly scheduled job is never mistaken for a dead one;
 * - no completed work;
 * - the recorded error is a structured "definitive no-output" failure (truncated output / output
 *   limit), i.e. the external call cannot have produced a usable result;
 * - payload parent and novel identity match the director task.
 *
 * Genuine active work (owner/lease, fresh heartbeat, fresh update) and any unknown/failed call
 * without that definitive code are never classified as stale.
 */

export const STALE_RANGE_JOB_IDLE_MS = 5 * 60_000;

/** Structured failures that prove the model produced no usable output at all. */
export const DEFINITIVE_NO_OUTPUT_FAILURE_CODES = [
  "STRUCTURED_OUTPUT:output_limit",
  "STRUCTURED_OUTPUT:incomplete_json",
  "STRUCTURED_OUTPUT:malformed_json",
  "LLM_OUTPUT_LIMIT",
] as const;

export type RangeJobLike = {
  id?: string;
  novelId: string;
  status: string;
  pendingManualRecovery: boolean;
  currentItemKey: string | null;
  executionOwner: string | null;
  executionLeaseExpiresAt: Date | string | number | null;
  heartbeatAt: Date | string | number | null;
  updatedAt: Date | string | number;
  startedAt?: Date | string | number | null;
  payloadWorkflowTaskId: string | null;
  completedCount: number;
  error: string | null;
};

export interface StaleRangeJobContext {
  novelId: string;
  taskId: string;
  now: number;
  staleAfterMs?: number;
}

function toMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const STRUCTURED_CODE_PATTERN = /^\s*\[([A-Z][A-Z0-9_]*:[a-z0-9_]+|LLM_OUTPUT_LIMIT)\]/;

/** Extract the structured failure code from the conventional `[CODE]` error prefix, if any. */
export function extractStructuredFailureCode(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const match = STRUCTURED_CODE_PATTERN.exec(text);
  return match ? match[1] : null;
}

/**
 * Returns the shared definitive no-output code when every non-empty error text is that same
 * structured failure. Mixed/unknown texts return null so callers keep the strict safety pause.
 */
export function readDefinitiveNoOutputCode(
  texts: ReadonlyArray<string | null | undefined>,
): string | null {
  let shared: string | null = null;
  for (const text of texts) {
    if (typeof text !== "string" || !text.trim()) continue;
    const code = extractStructuredFailureCode(text);
    if (!code || !(DEFINITIVE_NO_OUTPUT_FAILURE_CODES as readonly string[]).includes(code)) return null;
    if (shared === null) shared = code;
    else if (shared !== code) return null;
  }
  return shared;
}

export function hasEffectiveRangeJobActivity(job: RangeJobLike, context: {
  now: number;
  staleAfterMs?: number;
}): boolean {
  if (job.status !== "queued" && job.status !== "running") return false;
  const staleAfterMs = context.staleAfterMs ?? STALE_RANGE_JOB_IDLE_MS;
  if (job.executionOwner) return true;
  if (job.executionLeaseExpiresAt) return true;
  const heartbeat = toMs(job.heartbeatAt);
  if (heartbeat !== null && context.now - heartbeat < staleAfterMs) return true;
  const updated = toMs(job.updatedAt);
  if (updated !== null && context.now - updated < staleAfterMs) return true;
  return false;
}

export function isStaleRangeJobWithoutAnchor(job: RangeJobLike, context: StaleRangeJobContext): boolean {
  if (job.status !== "queued" && job.status !== "running") return false;
  if (job.currentItemKey) return false;
  if (job.executionOwner || job.executionLeaseExpiresAt) return false;
  if (job.novelId !== context.novelId) return false;
  if (!job.payloadWorkflowTaskId || job.payloadWorkflowTaskId !== context.taskId) return false;
  if (job.completedCount !== 0) return false;
  if (!readDefinitiveNoOutputCode([job.error])) return false;
  const staleAfterMs = context.staleAfterMs ?? STALE_RANGE_JOB_IDLE_MS;
  const updated = toMs(job.updatedAt);
  if (updated === null || context.now - updated < staleAfterMs) return false;
  const heartbeat = toMs(job.heartbeatAt);
  if (heartbeat !== null && context.now - heartbeat < staleAfterMs) return false;
  const started = toMs(job.startedAt ?? null);
  if (started !== null && context.now - started < staleAfterMs) return false;
  return true;
}
