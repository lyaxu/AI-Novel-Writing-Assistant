/**
 * Planning-token vocabulary for the payoff domain.
 *
 * A chapter's `requiredElements` may cite which ledger promise an entry is discharging. That link
 * has to be machine-checkable without guessing from prose, so it is written as an explicit token:
 *
 *   `[承诺:L001] 黄蓉点破餐盒夹层来源`
 *   `[伏笔:L007] 交代那半张图的来历`
 *
 * The token is planning-only and must never reach the prose. The shape lives here and nowhere else:
 * the planner that writes it, the coverage checks that read it, and the prose leak guard that
 * rejects it all go through this module, so a change of shape cannot silently desynchronise them.
 */

export type PlanningTokenKind = "promise" | "foreshadow";

const KIND_LABEL: Record<PlanningTokenKind, string> = {
  promise: "承诺",
  foreshadow: "伏笔",
};

/** The one place the token shape is defined. */
export function formatPlanningToken(kind: PlanningTokenKind, ledgerKey: string): string {
  return `[${KIND_LABEL[kind]}:${ledgerKey.trim()}]`;
}

/**
 * Extract every token key of one kind, in order, de-duplicated.
 *
 * An unterminated token is ignored rather than guessed at, and a different kind's token is left
 * alone so a promise citation can never be mistaken for a foreshadow one.
 */
export function extractPlanningTokens(text: string | null | undefined, kind: PlanningTokenKind): string[] {
  if (typeof text !== "string" || !text) return [];
  const prefix = `[${KIND_LABEL[kind]}:`;
  const found: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(prefix, cursor);
    if (start < 0) break;
    const end = text.indexOf("]", start + prefix.length);
    if (end < 0) break;
    const key = text.slice(start + prefix.length, end).trim();
    if (key) found.push(key);
    cursor = end + 1;
  }
  return [...new Set(found)];
}

/** Backwards-compatible convenience wrappers so callers read naturally. */
export const formatPromiseToken = (ledgerKey: string) => formatPlanningToken("promise", ledgerKey);
export const formatForeshadowToken = (ledgerKey: string) => formatPlanningToken("foreshadow", ledgerKey);
export const extractPromiseTokens = (text: string | null | undefined) => extractPlanningTokens(text, "promise");
export const extractForeshadowTokens = (text: string | null | undefined) => extractPlanningTokens(text, "foreshadow");

/** Keys of the given kind that appear in finished prose: any hit is bookkeeping leaking to a reader. */
export function findPlanningTokenLeaks(prose: string | null | undefined, kind: PlanningTokenKind): string[] {
  return extractPlanningTokens(prose, kind);
}
