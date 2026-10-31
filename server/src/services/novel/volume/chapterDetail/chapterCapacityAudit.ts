import { prisma } from "../../../../db/prisma";
import type { ChapterCapacityDecision } from "@ai-novel/shared/types/chapterCapacity";
import { formatChapterCapacityDecision } from "@ai-novel/shared/types/chapterCapacity";

/**
 * 容量门禁的持久化审计。
 *
 * 规划阶段还没有正文，不能用正文质量债字段冒充；这里把“为什么这章被拒、被拆到哪”
 * 追加到目标章节 repairHistory（仅在已物化且未写正文时），导出与排查可见。
 * 写失败不得影响规划本身。
 */

const MAX_CAPACITY_HISTORY_LINES = 40;

function buildAuditLine(input: {
  event: string;
  summary: string;
  decision?: ChapterCapacityDecision | null;
  extra?: string | null;
}): string {
  const decisionText = input.decision ? formatChapterCapacityDecision(input.decision) : "";
  return [
    `[chapter_capacity ${new Date().toISOString()}]`,
    `event=${input.event}`,
    decisionText,
    input.extra?.trim() || "",
    `summary=${input.summary.slice(0, 500)}`,
  ].filter(Boolean).join(" ");
}

export async function recordChapterCapacityAudit(input: {
  novelId: string;
  chapterOrder: number;
  chapterId?: string | null;
  event: string;
  summary: string;
  decision?: ChapterCapacityDecision | null;
  extra?: string | null;
}): Promise<void> {
  try {
    const row = input.chapterId
      ? await prisma.chapter.findFirst({
        where: { id: input.chapterId, novelId: input.novelId },
        select: { id: true, content: true, repairHistory: true },
      })
      : await prisma.chapter.findFirst({
        where: { novelId: input.novelId, order: input.chapterOrder },
        select: { id: true, content: true, repairHistory: true },
      });
    // Written prose is never rewritten by a planning audit.
    if (!row || row.content?.trim()) return;
    const existing = (row.repairHistory ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const next = [...existing, buildAuditLine(input)].slice(-MAX_CAPACITY_HISTORY_LINES);
    await prisma.chapter.update({ where: { id: row.id }, data: { repairHistory: next.join("\n") } });
  } catch (error) {
    console.warn("[chapter.capacity] audit_write_failed", {
      novelId: input.novelId,
      chapterOrder: input.chapterOrder,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
