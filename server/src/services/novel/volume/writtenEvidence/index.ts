import { prisma } from "../../../../db/prisma";
import { buildPlanningWrittenEvidence } from "./evidencePolicy";
export { buildPlanningWrittenEvidence, writtenSourceFingerprint, writtenContentHash } from "./evidencePolicy";
export type { WrittenChapterSource, CompressedFactSource } from "./evidencePolicy";
export type { PlanningWrittenEvidence } from "@ai-novel/shared/types/novel/writtenEvidence";

/** Read-only transaction: prose and secondary summaries belong to the same source snapshot. */
export async function loadPlanningWrittenEvidence(novelId: string, targetChapterOrder: number) {
  return prisma.$transaction(async (tx) => {
    const chapters = await tx.chapter.findMany({ where: { novelId, order: { lt: targetChapterOrder } },
      select: { id: true, order: true, title: true, content: true }, orderBy: [{ order: "desc" }, { id: "asc" }] });
    const facts = await tx.novelFactEntry.findMany({ where: { novelId, chapterOrder: { lt: targetChapterOrder } },
      select: { chapterOrder: true, text: true, category: true }, orderBy: [{ chapterOrder: "desc" }, { id: "asc" }] });
    return buildPlanningWrittenEvidence({ chapters, facts, targetChapterOrder });
  });
}
