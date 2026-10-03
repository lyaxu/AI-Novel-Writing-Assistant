import type { PayoffLedgerItem } from "@ai-novel/shared/types/payoffLedger";

/** A promise whose own declared cadence says it must move forward at or before this chapter. */
export interface DuePromise {
  ledgerKey: string;
  title: string;
  summary: string;
  currentStatus: PayoffLedgerItem["currentStatus"];
  /** The chapter order this promise was expected to move forward by. */
  dueChapterOrder: number;
  /** How many chapters past its due point the current chapter already is (0 = due exactly now). */
  overdueChapters: number;
  payoffIntensity: PayoffLedgerItem["payoffIntensity"];
  lastTouchedChapterOrder: number | null;
  targetEndChapterOrder: number | null;
  /** Why it is due: its own cadence, or a hard payoff deadline. */
  reason: "cadence" | "deadline";
}

/** Only terminal states are excluded: an already-flagged `overdue` promise is exactly what a
 *  chapter contract most needs to address. */
const OPEN_STATUSES = new Set<PayoffLedgerItem["currentStatus"]>(["setup", "hinted", "pending_payoff", "overdue"]);

const asOrder = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

/**
 * Select the promises a chapter contract is expected to move forward.
 *
 * A promise is due when either its declared `nextProgressChapter` has arrived, or its
 * `progressEvery` cadence has elapsed since it was last touched, or its hard
 * `targetEndChapterOrder` deadline has been reached. Finished promises are never due.
 *
 * When both `nextProgressChapter` and `progressEvery` are absent the promise has no declared
 * cadence and is not returned: an undeclared promise must not be turned into a fabricated deadline.
 */
export function selectDuePromises(
  items: readonly PayoffLedgerItem[],
  chapterOrder: number,
): DuePromise[] {
  const order = asOrder(chapterOrder);
  if (order === null) return [];
  const due: DuePromise[] = [];
  for (const item of items) {
    if (!OPEN_STATUSES.has(item.currentStatus)) continue;
    const next = asOrder(item.nextProgressChapter);
    const every = asOrder(item.progressEvery);
    const lastTouched = asOrder(item.lastTouchedChapterOrder);
    const deadline = asOrder(item.targetEndChapterOrder);

    const cadencePoint = next ?? (every !== null && lastTouched !== null ? lastTouched + every : null);
    const fromCadence = cadencePoint !== null && cadencePoint <= order;
    const fromDeadline = deadline !== null && deadline <= order;
    if (!fromCadence && !fromDeadline) continue;

    const points = [fromCadence ? cadencePoint : null, fromDeadline ? deadline : null]
      .filter((value): value is number => value !== null);
    const dueChapterOrder = Math.min(...points);
    due.push({
      ledgerKey: item.ledgerKey,
      title: item.title,
      summary: item.summary,
      currentStatus: item.currentStatus,
      dueChapterOrder,
      overdueChapters: Math.max(0, order - dueChapterOrder),
      payoffIntensity: item.payoffIntensity ?? null,
      lastTouchedChapterOrder: lastTouched,
      targetEndChapterOrder: deadline,
      reason: fromCadence ? "cadence" : "deadline",
    });
  }
  // Most overdue first, then strongest intended payoff, then stable by key.
  const weight = { major: 3, medium: 2, small: 1, tiny: 0 } as const;
  return due.sort((left, right) => right.overdueChapters - left.overdueChapters
    || (weight[right.payoffIntensity ?? "tiny"] ?? 0) - (weight[left.payoffIntensity ?? "tiny"] ?? 0)
    || left.ledgerKey.localeCompare(right.ledgerKey));
}

/**
 * Render the due promises for a chapter planning prompt.
 *
 * The contract must map each returned promise explicitly. The wording deliberately says the
 * chapter has to move the promise forward, not that it has to finish it: promising a full payoff
 * here is what turns a cadence reminder into a forced ending.
 */
export function renderPayoffCadenceContext(due: readonly DuePromise[], chapterOrder: number): string {
  if (!due.length) {
    return `本章（第 ${chapterOrder} 章）没有到期的账本承诺。不要为了填满这个清单而新造承诺或提前兑现远期安排。`;
  }
  const lines = due.map((item) => {
    const timing = item.overdueChapters > 0
      ? `已逾期 ${item.overdueChapters} 章（原定第 ${item.dueChapterOrder} 章）`
      : `本章到期（第 ${item.dueChapterOrder} 章）`;
    const deadline = item.targetEndChapterOrder !== null ? `；硬截止第 ${item.targetEndChapterOrder} 章` : "";
    const touched = item.lastTouchedChapterOrder !== null ? `；上次推进第 ${item.lastTouchedChapterOrder} 章` : "；尚无推进记录";
    const intensity = item.payoffIntensity ? `；预定兑现强度 ${item.payoffIntensity}` : "";
    return `- [${item.ledgerKey}] ${item.title}（${item.currentStatus}，${timing}${deadline}${touched}${intensity}）\n  ${item.summary}`;
  });
  return [
    `本章（第 ${chapterOrder} 章）到期的账本承诺，共 ${due.length} 条：`,
    ...lines,
    "",
    "每一条都必须在本章合同里有明确落点：写出它这一章向前动了哪一步、由谁在什么处境下推动、以及这一步带来什么可见后果。只写「记得这件事」「准备去办」不算推进。",
    "推进不等于兑现：允许只完成其中一步、付出代价、受阻改道或得到新的理解，但必须让读者看到相对上一章的实际变化。长期承诺不要求本章全部兑现。",
    "如果本章确实无法推进某条到期承诺，必须说明是什么具体阻力或取舍挡住了它，并给出它下一次应当推进的章号；不得用「以后再说」带过，也不得为了满足清单而临时新造能力、道具或人物。",
  ].join("\n");
}
