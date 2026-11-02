import { prisma } from "../../../../db/prisma";
import type { PlanningQualityDebtRecord } from "./planningQualityDebt";

/**
 * Durable audit for accepted planning quality debt.
 *
 * The candidate is unapproved planning, not produced prose. We therefore write the debt to the
 * still-unwritten chapter's repairHistory (never to written prose) so the chapter, export and later
 * diagnosis can see why the plan was accepted without a passing review.
 */

const MAX_PLANNING_DEBT_HISTORY_LINES = 40;

function buildAuditLine(record: PlanningQualityDebtRecord): string {
  return [
    `[planning_quality_debt ${new Date().toISOString()}]`,
    "event=accepted",
    `source=${record.source}`,
    `repairKey=${record.repairKey}`,
    `reasons=${record.reasons.join(",")}`,
    `issues=${record.issues.map((issue) => issue.id).join(",") || "none"}`,
    `capacityDebt=${record.capacityDebt.length}`,
  ].filter(Boolean).join(" ");
}

export async function recordPlanningQualityDebtAudit(input: {
  novelId: string;
  record: PlanningQualityDebtRecord;
}): Promise<void> {
  try {
    const row = await prisma.chapter.findFirst({
      where: {
        ...(input.record.chapterId ? { id: input.record.chapterId } : {}),
        novelId: input.novelId,
        order: input.record.chapterOrder,
      },
      select: { id: true, content: true, repairHistory: true },
    });
    if (!row || row.content?.trim()) return;
    const existing = (row.repairHistory ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const next = [...existing, buildAuditLine(input.record)].slice(-MAX_PLANNING_DEBT_HISTORY_LINES);
    await prisma.chapter.update({ where: { id: row.id }, data: { repairHistory: next.join("\n") } });
  } catch (error) {
    console.warn("[planning.quality_debt] audit_write_failed", {
      novelId: input.novelId,
      chapterOrder: input.record.chapterOrder,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function logPlanningQualityDebtAccepted(input: {
  novelId: string;
  record: PlanningQualityDebtRecord;
}): void {
  try {
    console.info(`[planning.quality_debt] event=accepted ${JSON.stringify({
      novelId: input.novelId,
      chapterId: input.record.chapterId,
      chapterOrder: input.record.chapterOrder,
      source: input.record.source,
      reasons: input.record.reasons,
      issues: input.record.issues.map((issue) => issue.id),
      capacityDebt: input.record.capacityDebt.length,
    })}`);
  } catch {
    // Logging must never fail the planning flow.
  }
}
