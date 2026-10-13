import type { Prisma } from "@prisma/client";
import { AppError } from "../../../../../middleware/errorHandler";
import { assertUnchangedPipelineRecoveryScope } from "../../../production/recovery";
import { resolveIncompleteCompletedRange, type CompletedRangeTask } from "./index";

/** Only an explicit source-workspace command may reopen the same completed task, atomically. */
export async function acceptIncompleteCompletedRangeCommand(input: {
  tx: Prisma.TransactionClient;
  task: CompletedRangeTask & { id: string; novelId: string | null; updatedAt: Date };
  forceResume?: boolean;
  commandData: Prisma.DirectorRunCommandUncheckedCreateInput;
}) {
  const { tx, task } = input;
  if (input.forceResume !== true || !task.novelId || task.cancelRequestedAt) {
    throw new AppError("请从本书工作区明确继续原任务，已取消的任务不能继续。", 409);
  }
  const chapters = await tx.chapter.findMany({ where: { novelId: task.novelId }, select: {
    id: true, order: true, content: true, chapterStatus: true, generationState: true,
  } });
  const range = resolveIncompleteCompletedRange({ task, chapters: chapters as Parameters<typeof resolveIncompleteCompletedRange>[0]["chapters"] });
  if (!range) throw new AppError("原任务范围已完成或状态已变化，请刷新工作区后核对。", 409);
  const seed = JSON.parse(task.seedPayloadJson!);
  assertUnchangedPipelineRecoveryScope(seed);
  if (range.completedPipelineJobId) {
    const previousJob = await tx.generationJob.findFirst({ where: {
      id: range.completedPipelineJobId, novelId: task.novelId, status: "succeeded",
      pendingManualRecovery: false, cancelRequestedAt: null,
    }, select: { id: true, payload: true } });
    let payload: { workflowTaskId?: string } = {};
    try { payload = JSON.parse(previousJob?.payload || "{}"); } catch { /* Reject unknown job provenance below. */ }
    if (!previousJob || payload.workflowTaskId !== task.id) {
      throw new AppError("原章节任务尚未确认完成或关联已变化，请在本书工作区核对。", 409);
    }
  }
  const activeJob = await tx.generationJob.findFirst({ where: {
    novelId: task.novelId, status: { in: ["queued", "running"] },
  }, select: { id: true } });
  const activeCommand = await tx.directorRunCommand.findFirst({ where: {
    novelId: task.novelId, status: { in: ["queued", "leased", "running"] },
  }, select: { id: true } });
  if (activeJob || activeCommand) throw new AppError("本书仍有任务执行中，请等待完成后刷新工作区。", 409);
  const accepted = await tx.novelWorkflowTask.updateMany({ where: {
    id: task.id, novelId: task.novelId, status: "succeeded", checkpointType: "workflow_completed",
    updatedAt: task.updatedAt, seedPayloadJson: task.seedPayloadJson, cancelRequestedAt: null,
  }, data: {
    status: "queued", pendingManualRecovery: false, checkpointType: "chapter_batch_ready",
    currentStage: "章节执行", currentItemKey: "chapter_execution", currentItemLabel: "等待继续剩余章节",
    checkpointSummary: `原任务范围内还有第 ${range.missingChapterOrders.join("、")} 章待规划。`,
    progress: Math.min(0.99, range.completedChapters / range.totalChapters),
    finishedAt: null, heartbeatAt: new Date(), lastError: null,
    seedPayloadJson: JSON.stringify({ ...seed,
      autoExecution: { ...seed.autoExecution, pipelineJobId: null, pipelineStatus: null,
        completedChapterCount: range.completedChapters, totalChapterCount: range.totalChapters,
        remainingChapterCount: range.remainingChapterOrders.length, remainingChapterOrders: range.remainingChapterOrders,
        nextChapterOrder: range.nextChapterOrder, nextChapterId: chapters.find(chapter => chapter.order === range.nextChapterOrder)?.id ?? null },
      rangeCompletionRecovery: { ...range, requestedAt: new Date().toISOString() },
    }),
  } });
  if (accepted.count !== 1) throw new AppError("导演任务已被取消、恢复或修改，请刷新工作区。", 409);
  return tx.directorRunCommand.create({ data: input.commandData });
}
