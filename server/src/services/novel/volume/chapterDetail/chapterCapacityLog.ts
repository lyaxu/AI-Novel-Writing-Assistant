/**
 * Capacity observability primitives.
 *
 * This module stays dependency-free (no database import) so prompt/generation unit tests can load
 * the contract generator without mocking the persistence layer. Durable audit writes are loaded
 * lazily and must never fail planning.
 */

export function logChapterCapacityEvent(
  event: "passed" | "rejected" | "redistributed" | "repair_committed",
  detail: Record<string, unknown>,
): void {
  try {
    console.info(`[chapter.capacity] event=${event} ${JSON.stringify(detail)}`);
  } catch {
    // Logging must never fail planning.
  }
}

export interface ChapterCapacityAuditInput {
  novelId: string;
  chapterOrder: number;
  chapterId?: string | null;
  event: string;
  summary: string;
  decision?: unknown;
  extra?: string | null;
}

/** Lazy durable write: unavailable/stubbed persistence must not break planning or tests. */
export async function recordChapterCapacityAuditSafely(input: ChapterCapacityAuditInput): Promise<void> {
  try {
    const module = await import("./chapterCapacityAudit");
    await module.recordChapterCapacityAudit(input as never);
  } catch {
    // Audit persistence is best-effort.
  }
}
