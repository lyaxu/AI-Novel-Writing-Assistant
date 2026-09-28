import { prisma } from "../../../../db/prisma";
import { createHash } from "node:crypto";
import { selectedPlanningCandidateSchema, type SelectedPlanningDirection } from "@ai-novel/shared/types/novel/planningPromises";
export { projectPlanningHorizon } from "./planningHorizon";

export function candidateSourceFingerprint(rawCandidate: unknown): string {
  return createHash("sha256").update(JSON.stringify(rawCandidate ?? null)).digest("hex");
}

/** The selected director seed is the authority; generated outlines are not a substitute. */
export async function loadSelectedPlanningDirection(novelId: string, taskId?: string): Promise<SelectedPlanningDirection> {
  const row = await prisma.novelWorkflowTask.findFirst({
    where: { novelId, lane: "auto_director", ...(taskId ? { id: taskId } : {}) },
    orderBy: { createdAt: "desc" }, select: { id: true, seedPayloadJson: true },
  });
  if (!row) return { status: "missing", reason: "未找到对应导演任务的已选方向；不得从后续规划反推用户原始承诺。" };
  try {
    const seed: unknown = JSON.parse(row.seedPayloadJson ?? "{}");
    const candidate = selectedPlanningCandidateSchema.safeParse(seed && typeof seed === "object" ? (seed as Record<string, unknown>).candidate : undefined);
    return candidate.success ? { status: "available", sourceTaskId: row.id, candidate: candidate.data,
      fingerprint: createHash("sha256").update(JSON.stringify({ sourceTaskId: row.id, candidate: candidate.data })).digest("hex") }
      : { status: "missing", reason: "已选方向或开篇原型来源缺失/无法核验；不得将生成后的大纲当作原始确认方向。" };
  } catch {
    return { status: "missing", reason: "已选方向记录无法读取，原始承诺未知。" };
  }
}
