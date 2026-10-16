import type { Prisma, NovelWorkflowTask } from "@prisma/client";
import { AppError } from "../../../../../middleware/errorHandler";
import type { DirectorWorkflowSeedPayload } from "../../runtime/novelDirectorHelpers";
import { buildDirectorAutoExecutionState } from "../../automation/novelDirectorAutoExecution";

const blocked = () => new AppError("任务的执行记录发生变化，请刷新原工作区核对后继续。", 409);

/** A saved interface choice is a boundary, not authority to retry unknown production. */
export async function recoverPreparedChoice(
  tx: Prisma.TransactionClient,
  task: NovelWorkflowTask,
  seed: DirectorWorkflowSeedPayload,
): Promise<{ seed: DirectorWorkflowSeedPayload; failedStepIds: string[] }> {
  if (task.status !== "failed") return { seed, failedStepIds: [] };
  if (task.cancelRequestedAt || task.pendingManualRecovery || !task.novelId
    || seed.autoExecution?.pipelineJobId || seed.productionExperience
    || seed.planningRepair || seed.planningRepairRecovery) throw blocked();
  const milestones = JSON.parse(task.milestonesJson ?? "[]") as Array<{ checkpointType?: string; createdAt?: string }>;
  const boundary = [...milestones].reverse().find(item => item.checkpointType === "production_experience_required");
  const preparedAt = boundary?.createdAt ? new Date(boundary.createdAt) : null;
  if (!preparedAt || !Number.isFinite(preparedAt.getTime()) || !task.lastError) throw blocked();
  const [command, execution, jobs, sideEffect, laterCall, steps, otherTask, journal] = await Promise.all([
    tx.directorRunCommand.findFirst({ where: { novelId: task.novelId, status: { in: ["queued", "leased", "running"] } } }),
    tx.directorRuntimeExecution.findFirst({ where: { novelId: task.novelId,
      status: { in: ["queued", "leased", "running", "unknown"] } } }),
    tx.generationJob.findMany({ where: { novelId: task.novelId }, select: { id: true, status: true, payload: true, createdAt: true } }),
    tx.novelSideEffectJob.findFirst({ where: { novelId: task.novelId, status: { in: ["queued", "pending", "running", "unknown"] } } }),
    tx.directorLlmUsageRecord.findFirst({ where: { taskId: task.id, recordedAt: { gt: preparedAt } } }),
    tx.directorStepRun.findMany({ where: { taskId: task.id } }),
    tx.novelWorkflowTask.findFirst({ where: { novelId: task.novelId, lane: "auto_director",
      id: { not: task.id }, status: { in: ["queued", "running"] } } }),
    tx.chapterArtifactSyncCheckpoint.findFirst({ where: { novelId: task.novelId,
      artifactType: "production_execution", syncMode: "journal", contentHash: "active",
      status: { not: "completed" } } }),
  ]);
  if (command || execution || sideEffect || laterCall || otherTask || journal || jobs.some(job => {
    if (["queued", "running"].includes(job.status)) return true;
    const payload = JSON.parse(job.payload ?? "{}") as { workflowTaskId?: string };
    return payload.workflowTaskId === task.id || job.createdAt >= preparedAt;
  })) throw blocked();
  const allowedFailureNodes = new Set(["chapter_execution_node", "structured_outline.chapter_list",
    "structured_outline.chapter_detail_bundle", "structured_outline.chapter_sync"]);
  const failures = steps.filter(step => step.status === "failed");
  if (!failures.some(step => step.nodeKey === "chapter_execution_node" && step.startedAt >= preparedAt)
    || failures.some(step => !allowedFailureNodes.has(step.nodeKey) || step.error !== task.lastError)
    || steps.some(step => !["failed", "succeeded", "skipped"].includes(step.status))) throw blocked();
  const plan = seed.directorInput?.autoExecutionPlan;
  let nextSeed = seed;
  if (seed.takeover && plan?.mode === "chapter_range") {
    if (!Number.isSafeInteger(plan.startOrder) || !Number.isSafeInteger(plan.endOrder)
      || plan.startOrder! < 1 || plan.endOrder! < plan.startOrder!) throw blocked();
    const chapters = await tx.chapter.findMany({ where: { novelId: task.novelId }, orderBy: { order: "asc" } });
    nextSeed = { ...seed, autoExecution: buildDirectorAutoExecutionState({
      range: { startOrder: plan.startOrder!, endOrder: plan.endOrder!,
        totalChapterCount: plan.endOrder! - plan.startOrder! + 1,
        firstChapterId: seed.autoExecution?.firstChapterId ?? null },
      chapters, plan: { ...seed.autoExecution, ...plan },
      preparedVolumeIds: seed.autoExecution?.preparedVolumeIds,
      beatChapterListReady: seed.autoExecution?.beatChapterListReady,
      volumeChapterListComplete: seed.autoExecution?.volumeChapterListComplete,
    }) };
  }
  return { seed: nextSeed, failedStepIds: failures.map(step => step.id) };
}
