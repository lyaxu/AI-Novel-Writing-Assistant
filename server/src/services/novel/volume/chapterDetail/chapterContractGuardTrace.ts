import { prisma } from "../../../../db/prisma";

/**
 * Durable trace of the chapter-contract guard.
 *
 * The guard itself (neighborEventUse / mustAvoidConflicts) lives in
 * chapterDetail.prompts.ts postValidate. It throws, the prompt runner retries, and if the
 * retry passes nobody can tell afterwards that anything was ever wrong: promptQualityTelemetry
 * keeps `semantic_retry_start` in an in-process Map that dies with the server and has no HTTP
 * exit. So a clean chapter was indistinguishable from a chapter the guard had to save.
 *
 * These entries close that gap without a schema migration: the chapter's existing
 * repairHistory text column is append-only and already carries other machine-readable lines
 * ([patch_receipt] / [quality_loop]). A rejected contract is exactly the kind of paid,
 * evidence-bearing attempt that column is meant to retain.
 *
 * The reason string is the validator's own message, so the record shows why it fired rather
 * than a restatement of the rule.
 */

export type ChapterContractGuardOutcome = "rejected" | "accepted";

export interface ChapterContractGuardRecord {
  novelId: string;
  chapterId: string;
  outcome: ChapterContractGuardOutcome;
  /** Validator message when rejected; absent for an accepted contract. */
  reason?: string;
  attempt: number;
  declaredConflicts?: number;
  declaredNeighborPreemptions?: number;
}

const GUARD_PREFIX = "[contract_guard] ";

export function formatChapterContractGuardRecord(record: ChapterContractGuardRecord): string {
  return GUARD_PREFIX + JSON.stringify({
    recordedAt: new Date().toISOString(),
    outcome: record.outcome,
    attempt: record.attempt,
    ...(record.reason ? { reason: record.reason } : {}),
    ...(record.declaredConflicts !== undefined ? { declaredConflicts: record.declaredConflicts } : {}),
    ...(record.declaredNeighborPreemptions !== undefined ? { declaredNeighborPreemptions: record.declaredNeighborPreemptions } : {}),
  });
}

export function isChapterContractGuardLine(line: string | null | undefined): boolean {
  return typeof line === "string" && line.startsWith(GUARD_PREFIX);
}

/**
 * Contract generation can retry, so several guard lines may land on one chapter. They are
 * appended newest-last; the accepted line closes the sequence.
 */
export async function recordChapterContractGuardEvent(record: ChapterContractGuardRecord): Promise<void> {
  const line = formatChapterContractGuardRecord(record);
  const chapter = await prisma.chapter.findFirst({
    where: { id: record.chapterId, novelId: record.novelId },
    select: { repairHistory: true },
  });
  if (!chapter) return;
  const lines = (chapter.repairHistory ?? "").split(/\r?\n/).filter(Boolean);
  if (lines.includes(line)) return;
  const next = [...lines, line].join("\n");
  // Keep every guard line even if quality lines rotate out; drop only the oldest quality lines.
  const qualityTail = lines.filter((value) => !isChapterContractGuardLine(value)).slice(-12);
  const guardLines = lines.filter(isChapterContractGuardLine);
  await prisma.chapter.update({
    where: { id: record.chapterId },
    data: { repairHistory: [...qualityTail, ...guardLines, line].join("\n") },
  });
}

/** Test/introspection helper: pull the guard trace back out of a repairHistory blob. */
export function parseChapterContractGuardRecords(repairHistory: string | null | undefined): Array<Record<string, unknown>> {
  return (repairHistory ?? "")
    .split(/\r?\n/)
    .filter(isChapterContractGuardLine)
    .map((line) => {
      try {
        return JSON.parse(line.slice(GUARD_PREFIX.length)) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);
}
