import type { DirectorRuntimeProjection, DirectorChapterExecutionProgressSummary } from "@ai-novel/shared/types/directorRuntime";
import type { DirectorAutoExecutionState } from "@ai-novel/shared/types/novelDirector";
import { prisma } from "../../../../../db/prisma";
import { buildNovelEditResumeTarget } from "../../../workflow/novelWorkflow.shared";
import { buildDirectorAutoExecutionState, isDirectorAutoExecutionRangeComplete, type DirectorAutoExecutionChapterRef } from "../../automation/novelDirectorAutoExecution";
import { resolveIncompleteCompletedRange } from "../../recovery/rangeCompletion";

export interface RangeCompletionTask {
  id: string; novelId?: string | null; lane?: string; status: string;
  checkpointType?: string | null; seedPayloadJson?: string | null; cancelRequestedAt?: Date | string | null;
  pendingManualRecovery?: boolean | null; currentItemKey?: string | null;
  checkpointSummary?: string | null; progress?: number | null;
  rangeCompletionVerified?: boolean;
}

const MARKER = "chapter_range_incomplete";
function seedOf(task: RangeCompletionTask): Record<string, unknown> {
  try { return JSON.parse(task.seedPayloadJson || "{}"); } catch { return {}; }
}
function isRangeRecoveryView(task: RangeCompletionTask): boolean {
  return task.status === "waiting_approval" && task.pendingManualRecovery === true
    && task.checkpointType === "chapter_batch_ready" && task.currentItemKey === MARKER;
}

/** Read model only: never write this projected row back or use it for command CAS. */
export function projectIncompleteCompletedRange<T extends RangeCompletionTask>(
  task: T, chapters: DirectorAutoExecutionChapterRef[], command?: { status: string } | null,
): T {
  if (!task.novelId || command && ["queued", "leased", "running"].includes(command.status)) return task;
  const gap = resolveIncompleteCompletedRange({ task: { ...task, lane: task.lane ?? "",
    checkpointType: task.checkpointType ?? null, seedPayloadJson: task.seedPayloadJson ?? null }, chapters });
  if (!gap) {
    // This marker belongs only to the read model and is rebuilt from current chapter rows.
    // Saved counters and a historical workflow_completed event are not completion evidence.
    const auto = seedOf(task)?.autoExecution as DirectorAutoExecutionState | undefined;
    if (task.lane !== "auto_director" || task.status !== "succeeded" || task.checkpointType !== "workflow_completed"
      || task.cancelRequestedAt || auto?.enabled !== true || !Number.isSafeInteger(auto.startOrder)
      || !Number.isSafeInteger(auto.endOrder) || auto.startOrder! < 1 || auto.endOrder! < auto.startOrder!) return task;
    const range = { startOrder: auto.startOrder!, endOrder: auto.endOrder!,
      totalChapterCount: auto.endOrder! - auto.startOrder! + 1, firstChapterId: auto.firstChapterId ?? null };
    const verified = isDirectorAutoExecutionRangeComplete(range, buildDirectorAutoExecutionState({ range, chapters, plan: auto }));
    return verified ? { ...task, rangeCompletionVerified: true } : task;
  }
  const seed = seedOf(task);
  const auto = seed.autoExecution as DirectorAutoExecutionState;
  const rebuilt = buildDirectorAutoExecutionState({
    range: { startOrder: gap.startOrder, endOrder: gap.endOrder,
      totalChapterCount: gap.endOrder - gap.startOrder + 1, firstChapterId: auto.firstChapterId ?? null },
    chapters, plan: auto, scopeLabel: auto.scopeLabel,
    pipelineJobId: auto.pipelineJobId, pipelineStatus: auto.pipelineStatus,
  });
  const missingLabel = gap.missingChapterOrders.slice(0, 8).join("、")
    + (gap.missingChapterOrders.length > 8 ? "等" : "");
  const summary = `原定第 ${gap.startOrder}—${gap.endOrder} 章已完成 ${rebuilt.completedChapterCount}/${rebuilt.totalChapterCount} 章，第 ${missingLabel} 章待规划和执行。请回到章节工作区继续原任务。`;
  const resumeTarget = buildNovelEditResumeTarget({ novelId: task.novelId, taskId: task.id, stage: "chapter" });
  return { ...task, status: "waiting_approval", pendingManualRecovery: true,
    checkpointType: "chapter_batch_ready", currentStage: "章节执行", currentItemKey: MARKER,
    currentItemLabel: summary, checkpointSummary: summary, lastError: null,
    progress: Math.min(0.99, (rebuilt.completedChapterCount ?? 0) / rebuilt.totalChapterCount!),
    resumeTargetJson: JSON.stringify(resumeTarget),
    seedPayloadJson: JSON.stringify({ ...seed, resumeTarget, autoExecution: { ...auto, ...rebuilt },
      directorSession: { ...(seed.directorSession as object ?? {}), isBackgroundRunning: false } }),
  };
}

export async function readIncompleteCompletedRangeProjection<T extends RangeCompletionTask>(task: T,
  command?: { status: string } | null): Promise<T> {
  if (task.lane !== "auto_director" || task.status !== "succeeded" || task.checkpointType !== "workflow_completed"
    || task.cancelRequestedAt || !task.novelId) return task;
  const [chapters, activeCommand] = await Promise.all([
    prisma.chapter.findMany({ where: { novelId: task.novelId }, orderBy: { order: "asc" },
      select: { id: true, order: true, content: true, chapterStatus: true, generationState: true } }),
    command && ["queued", "leased", "running"].includes(command.status) ? Promise.resolve(command)
      : prisma.directorRunCommand.findFirst({ where: { taskId: task.id, status: { in: ["queued", "leased", "running"] } },
        select: { status: true } }),
  ]);
  return projectIncompleteCompletedRange(task, chapters, activeCommand);
}

/** Historical completed events remain in the timeline; the current view follows range facts. */
export function overlayIncompleteRangeRuntime(projection: DirectorRuntimeProjection | null,
  task: RangeCompletionTask): DirectorRuntimeProjection | null {
  if (!projection || !isRangeRecoveryView(task)) return projection;
  const summary = task.checkpointSummary ?? "原定章节范围尚未完成，请回到源工作区继续原任务。";
  return { ...projection, status: "waiting_approval", requiresUserAction: true, isAutopilotRecoverable: false,
    currentNodeKey: "chapter_execution", currentAction: summary, currentLabel: summary,
    headline: "章节范围待继续", detail: summary, checkpointSummary: summary,
    blockedReason: summary, blockingReason: summary, waitingReason: summary,
    nextActionLabel: "回到章节工作区继续原任务", progressSummary: summary,
    chapterExecutionProgress: overlayIncompleteRangeChapterProgress(projection.chapterExecutionProgress ?? null, task),
    ...(projection.progressBreakdown ? { progressBreakdown: { ...projection.progressBreakdown,
      totalPercent: Math.round((task.progress ?? 0) * 100) } } : {}),
  };
}

export function overlayIncompleteRangeChapterProgress<T extends DirectorChapterExecutionProgressSummary>(progress: T | null,
  task: RangeCompletionTask): T | null {
  if (!progress || !isRangeRecoveryView(task)) return progress;
  const auto = seedOf(task).autoExecution as DirectorAutoExecutionState | undefined;
  if (!auto?.totalChapterCount || !auto.startOrder || !auto.endOrder) return progress;
  const chapters = (progress.chapters ?? []).filter(chapter => chapter.chapterOrder >= auto.startOrder!
    && chapter.chapterOrder <= auto.endOrder!);
  return { ...progress, chapters, totalChapters: auto.totalChapterCount,
    draftedChapterCount: chapters.filter(chapter => chapter.completedStages.includes("draft_saved")).length,
    approvedChapterCount: chapters.filter(chapter => chapter.status === "approved").length,
    needsRepairChapters: chapters.filter(chapter => chapter.status === "needs_repair").length,
    completedChapters: auto.completedChapterCount ?? 0,
    ratio: (auto.completedChapterCount ?? 0) / auto.totalChapterCount,
    activeChapterId: null, activeChapterOrder: null,
    currentChapterId: auto.nextChapterId ?? null, currentChapterOrder: auto.nextChapterOrder ?? null,
    currentStage: "execution_contract_ready",
    recoverableRange: { startOrder: auto.nextChapterOrder ?? null, endOrder: auto.endOrder },
  };
}
