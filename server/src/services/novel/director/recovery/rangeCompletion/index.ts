import type { DirectorAutoExecutionState } from "@ai-novel/shared/types/novelDirector";
import { buildDirectorAutoExecutionState, type DirectorAutoExecutionChapterRef } from "../../automation/novelDirectorAutoExecution";

/** Read-only compatibility check for a completed director whose saved range still has missing rows. */
export interface CompletedRangeTask {
  lane: string;
  status: string;
  checkpointType: string | null;
  cancelRequestedAt?: Date | string | null;
  seedPayloadJson: string | null;
}

export interface IncompleteCompletedRange {
  startOrder: number;
  endOrder: number;
  missingChapterOrders: number[];
  completedPipelineJobId: string | null;
  completedChapters: number;
  totalChapters: number;
  nextChapterOrder: number | null;
  remainingChapterOrders: number[];
}

export function resolveIncompleteCompletedRange(input: {
  task: CompletedRangeTask;
  chapters: ReadonlyArray<DirectorAutoExecutionChapterRef>;
}): IncompleteCompletedRange | null {
  const { task, chapters } = input;
  if (task.lane !== "auto_director" || task.status !== "succeeded"
    || task.checkpointType !== "workflow_completed" || task.cancelRequestedAt) return null;
  let state: Record<string, unknown> | undefined;
  try { state = JSON.parse(task.seedPayloadJson || "{}")?.autoExecution; } catch { return null; }
  if (!state || state.enabled !== true) return null;
  const startOrder = state.startOrder;
  const endOrder = state.endOrder;
  if (typeof startOrder !== "number" || typeof endOrder !== "number"
    || !Number.isSafeInteger(startOrder) || !Number.isSafeInteger(endOrder)
    || startOrder < 1 || endOrder < startOrder) return null;
  const present = new Set(chapters.map(chapter => chapter.order));
  const missingChapterOrders: number[] = [];
  for (let order = startOrder; order <= endOrder; order += 1) if (!present.has(order)) missingChapterOrders.push(order);
  if (!missingChapterOrders.length) return null;
  const execution = buildDirectorAutoExecutionState({ chapters: [...chapters], plan: state as unknown as DirectorAutoExecutionState,
    range: { startOrder, endOrder, totalChapterCount: endOrder - startOrder + 1, firstChapterId: null } });
  return { startOrder, endOrder, missingChapterOrders,
    completedChapters: execution.completedChapterCount ?? 0, totalChapters: execution.totalChapterCount ?? 0,
    nextChapterOrder: execution.nextChapterOrder ?? null, remainingChapterOrders: execution.remainingChapterOrders ?? [],
    completedPipelineJobId: typeof state.pipelineJobId === "string" && state.pipelineJobId.trim() ? state.pipelineJobId : null };
}

export { acceptIncompleteCompletedRangeCommand } from "./acceptCommand";
