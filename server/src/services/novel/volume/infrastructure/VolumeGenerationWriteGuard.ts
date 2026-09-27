import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../db/prisma";

export type VolumeGenerationWriteGuard = (tx: Prisma.TransactionClient) => Promise<void>;

function stopped(message: string): never {
  throw Object.assign(new Error(message), { code: "PIPELINE_CANCELLED" });
}

function timestamp(value: Date | null): number | null {
  return value?.getTime() ?? null;
}

/** Capture generation ownership before the paid request; check it inside every write transaction. */
export async function createVolumeGenerationWriteGuard(
  novelId: string,
  taskId?: string,
): Promise<VolumeGenerationWriteGuard | undefined> {
  if (!taskId) return undefined;
  const workflow = await prisma.novelWorkflowTask.findUnique({ where: { id: taskId } });
  let jobId = workflow ? undefined : taskId;
  if (workflow?.seedPayloadJson) {
    try {
      const seed = JSON.parse(workflow.seedPayloadJson);
      if (typeof seed?.autoExecution?.pipelineJobId === "string") jobId = seed.autoExecution.pipelineJobId;
    } catch {
      stopped("规划任务数据无效，不能保存生成结果。");
    }
  }
  const job = jobId ? await prisma.generationJob.findUnique({ where: { id: jobId } }) : null;
  if (!workflow && !job) stopped("规划任务不存在，不能保存生成结果。");

  const guard: VolumeGenerationWriteGuard = async (tx) => {
    if (workflow) {
      const current = await tx.novelWorkflowTask.findUnique({ where: { id: workflow.id } });
      if (!current || current.novelId !== novelId || current.cancelRequestedAt
        || !["queued", "running"].includes(current.status) || current.pendingManualRecovery
        || current.attemptCount !== workflow.attemptCount
        || timestamp(current.startedAt) !== timestamp(workflow.startedAt)) {
        stopped("规划任务已停止或已开始新的执行，迟到结果未保存。");
      }
    }
    if (jobId) {
      const current = await tx.generationJob.findUnique({ where: { id: jobId } });
      if (!job || !current || current.novelId !== novelId || current.cancelRequestedAt
        || !["queued", "running"].includes(current.status) || current.pendingManualRecovery
        || current.executionOwner !== job.executionOwner
        || timestamp(current.startedAt) !== timestamp(job.startedAt)
        || (current.executionOwner && (!current.executionLeaseExpiresAt
          || current.executionLeaseExpiresAt.getTime() <= Date.now()))) {
        stopped("章节任务已停止或执行租约已转移，迟到规划结果未保存。");
      }
    }
  };
  await guard(prisma);
  return guard;
}
