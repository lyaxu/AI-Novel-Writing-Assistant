import type { PayoffLedgerItem } from "@ai-novel/shared/types/payoffLedger";

/**
 * Phase C — making foreshadowing land in a chapter's `requiredElements`.
 *
 * A promise that is due to be revealed inside the current volume must be written into some
 * chapter's minimum event list, otherwise it only exists in the ledger and never reaches the
 * writer. The planner marks that obligation with an internal token so the link is checkable
 * without guessing from prose:
 *
 *   `[伏笔:L001] 回收：黄蓉点破餐盒夹层来源`
 *
 * The token is planning-only. It must never reach the prose, which is why the same module also
 * exposes a leak check for finished chapter text.
 */

const TOKEN_PREFIX = "[伏笔:";
const TOKEN_SUFFIX = "]";

/** The one place the token shape is defined, so the planner, the checker and the leak guard agree. */
export function formatForeshadowToken(ledgerKey: string): string {
  return `${TOKEN_PREFIX}${ledgerKey.trim()}${TOKEN_SUFFIX}`;
}

/** Extract every foreshadow token in a text, preserving order and dropping duplicates. */
export function extractForeshadowTokens(text: string | null | undefined): string[] {
  if (typeof text !== "string" || !text) return [];
  const found: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(TOKEN_PREFIX, cursor);
    if (start < 0) break;
    const end = text.indexOf(TOKEN_SUFFIX, start + TOKEN_PREFIX.length);
    if (end < 0) break;
    const key = text.slice(start + TOKEN_PREFIX.length, end).trim();
    if (key) found.push(key);
    cursor = end + TOKEN_SUFFIX.length;
  }
  return [...new Set(found)];
}

export interface VolumeRevealObligation {
  ledgerKey: string;
  title: string;
  summary: string;
  /** The last chapter order inside this volume by which the reveal is expected. */
  revealByChapterOrder: number;
  payoffIntensity: PayoffLedgerItem["payoffIntensity"];
  currentStatus: PayoffLedgerItem["currentStatus"];
}

const OPEN_STATUSES = new Set<PayoffLedgerItem["currentStatus"]>(["setup", "hinted", "pending_payoff", "overdue"]);

const asOrder = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

/**
 * Promises that this volume is expected to reveal.
 *
 * Uses the existing window fields rather than a new column: a promise belongs to this volume when
 * its window ends inside the volume's chapter range and it has not already been paid off or
 * abandoned. A promise whose window ends later is a later volume's business.
 */
export function selectVolumeRevealObligations(
  items: readonly PayoffLedgerItem[],
  volumeRange: { startOrder: number; endOrder: number },
): VolumeRevealObligation[] {
  const start = asOrder(volumeRange.startOrder);
  const end = asOrder(volumeRange.endOrder);
  if (start === null || end === null || end < start) return [];
  const obligations: VolumeRevealObligation[] = [];
  for (const item of items) {
    if (!OPEN_STATUSES.has(item.currentStatus)) continue;
    const revealBy = asOrder(item.targetEndChapterOrder) ?? asOrder(item.targetStartChapterOrder);
    if (revealBy === null || revealBy < start || revealBy > end) continue;
    obligations.push({
      ledgerKey: item.ledgerKey,
      title: item.title,
      summary: item.summary,
      revealByChapterOrder: revealBy,
      payoffIntensity: item.payoffIntensity ?? null,
      currentStatus: item.currentStatus,
    });
  }
  return obligations.sort((left, right) => left.revealByChapterOrder - right.revealByChapterOrder
    || left.ledgerKey.localeCompare(right.ledgerKey));
}

export interface RevealCoverageChapter {
  chapterOrder: number;
  requiredElements: readonly string[];
}

export interface RevealCoverage {
  mapped: Array<{ ledgerKey: string; chapterOrder: number }>;
  /** Obligations no chapter's minimum event list carries. These are the real gaps. */
  unmapped: VolumeRevealObligation[];
  /** A chapter whose event list cites a promise outside this volume's obligations. */
  unexpectedTokens: Array<{ chapterOrder: number; ledgerKey: string }>;
}

/**
 * Whether each volume obligation is carried by some chapter's minimum event list.
 *
 * Matching is by token, never by prose similarity: a promise counts as planned only when a chapter
 * explicitly cites it, so a passing check means the link was authored, not inferred.
 */
export function checkRevealCoverage(
  obligations: readonly VolumeRevealObligation[],
  chapters: readonly RevealCoverageChapter[],
): RevealCoverage {
  const expected = new Map(obligations.map((item) => [item.ledgerKey, item]));
  const mapped: Array<{ ledgerKey: string; chapterOrder: number }> = [];
  const unexpectedTokens: Array<{ chapterOrder: number; ledgerKey: string }> = [];
  const seen = new Set<string>();
  for (const chapter of [...chapters].sort((a, b) => a.chapterOrder - b.chapterOrder)) {
    for (const element of chapter.requiredElements ?? []) {
      for (const key of extractForeshadowTokens(element)) {
        if (!expected.has(key)) {
          unexpectedTokens.push({ chapterOrder: chapter.chapterOrder, ledgerKey: key });
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        mapped.push({ ledgerKey: key, chapterOrder: chapter.chapterOrder });
      }
    }
  }
  return {
    mapped,
    unmapped: obligations.filter((item) => !seen.has(item.ledgerKey)),
    unexpectedTokens,
  };
}

/**
 * Whether a token leaked into finished prose.
 *
 * The planner is allowed to carry tokens; the prose is not. A leak means the reader would see the
 * bookkeeping, so it is reported as a defect rather than tolerated.
 */
export function findForeshadowTokenLeaks(prose: string | null | undefined): string[] {
  return extractForeshadowTokens(prose);
}

export interface VolumeRevealLedger {
  /** Share of this volume's obligations carried by some chapter's event list, 0..1. */
  plannedRate: number;
  unmappedCount: number;
  /** The bar the competitor applies from the second volume onward. */
  requiredRate: number;
  meetsRequiredRate: boolean;
}

/**
 * Volume-end recovery rate.
 *
 * The first volume is allowed to only seed and advance; from the second volume on, most of the
 * obligations the volume inherited must actually be scheduled. The bar is explicit so the check
 * can report a number instead of an opinion.
 */
export function evaluateVolumeRevealRate(
  coverage: RevealCoverage,
  obligations: readonly VolumeRevealObligation[],
  options: { volumeSortOrder: number; requiredRate?: number },
): VolumeRevealLedger {
  const total = obligations.length;
  const planned = coverage.mapped.length;
  const plannedRate = total === 0 ? 1 : planned / total;
  const requiredRate = options.volumeSortOrder <= 1 ? 0 : (options.requiredRate ?? 0.6);
  return {
    plannedRate,
    unmappedCount: coverage.unmapped.length,
    requiredRate,
    meetsRequiredRate: plannedRate >= requiredRate,
  };
}
