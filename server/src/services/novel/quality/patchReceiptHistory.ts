import { createHash } from "node:crypto";
import type { ChapterPatchIssueResolution } from "@ai-novel/shared/types/chapterPatchRepair";

const RECEIPT_PREFIX = "[patch_receipt] ";

export interface PatchReceiptHistoryEntry {
  attemptId: string;
  recordedAt: string;
  source: string;
  outcome: "candidate_prepared" | "application_failed" | "candidate_selected" | "original_retained" | "attempt_recorded";
  issueResolutions: ChapterPatchIssueResolution[];
}

/** Receipts describe attempts, not acceptance; retain them across later clean reviews. */
export function appendPatchReceiptHistory(previous: string | null | undefined, entry: PatchReceiptHistoryEntry): string | undefined {
  if (!entry.issueResolutions.length) return undefined;
  const lines = previous?.split(/\r?\n/) ?? [];
  const identity = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  const line = `${RECEIPT_PREFIX}${JSON.stringify({ ...entry, identity })}`;
  if (lines.includes(line)) return previous ?? undefined;
  return [...lines.filter(Boolean), line].join("\n");
}

/** Keep the existing short status trail without evicting paid repair evidence. */
export function appendQualityHistoryLine(previous: string | null | undefined, line: string): string {
  const lines = [...(previous?.split(/\r?\n/).filter(Boolean) ?? []), line];
  const regular = lines.map((value, index) => ({ value, index }))
    .filter(({ value }) => !value.startsWith(RECEIPT_PREFIX));
  const retained = new Set(regular.slice(-12).map(({ index }) => index));
  return lines.filter((value, index) => value.startsWith(RECEIPT_PREFIX) || retained.has(index)).join("\n");
}
