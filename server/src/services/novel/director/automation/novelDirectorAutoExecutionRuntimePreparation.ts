import type { PipelineJobStatus, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import type {
  DirectorAutoExecutionState,
  DirectorConfirmRequest,
} from "@ai-novel/shared/types/novelDirector";
import { isFullBookAutopilotRunMode } from "@ai-novel/shared/types/novelDirector";
import {
  applyReviewSkipOverride,
  buildRequestedAutoExecutionState,
  resolveAutoExecutionRangeAndState,
  resolveAutoExecutionBookProfile,
} from "./novelDirectorAutoExecutionScopeRuntime";
import { isSkippableAutoExecutionReviewFailure } from "./novelDirectorAutoExecutionFailure";
import type { DirectorAutoExecutionRange } from "./novelDirectorAutoExecution";
import type { AutoExecutionTaskIdentityRow, NovelDirectorAutoExecutionRuntimeDeps } from "./novelDirectorAutoExecutionRuntimePorts";
import { ChapterProductionError } from "../../production/reliability";

/** Repair historical batch-derived profiles from the original task's book intent. */
export function restoreAutoExecutionBookRequest(
  request: DirectorConfirmRequest,
  seed: {
    completionProfile?: DirectorAutoExecutionState["completionProfile"];
    estimatedChapterCount?: number | null;
    directorInput?: Partial<DirectorConfirmRequest>;
  },
  existingState?: DirectorAutoExecutionState | null,
): DirectorConfirmRequest {
  const savedProfile = seed.completionProfile ?? seed.directorInput?.completionProfile;
  const savedBookTarget = seed.estimatedChapterCount
    ?? seed.directorInput?.estimatedChapterCount
    ?? seed.directorInput?.candidate?.targetChapterCount;
  return {
    ...request,
    completionProfile: resolveAutoExecutionBookProfile({
      ...(savedProfile && Number.isFinite(savedProfile.targetChapterCount) && savedProfile.targetChapterCount > 0
        ? { completionProfile: savedProfile }
        : typeof savedBookTarget === "number" && Number.isFinite(savedBookTarget) && savedBookTarget > 0
        ? { estimatedChapterCount: savedBookTarget }
        : { completionProfile: request.completionProfile, estimatedChapterCount: request.estimatedChapterCount,
          candidateTargetChapterCount: request.candidate?.targetChapterCount }),
      existingState,
    }),
  };
}

export async function readAutoExecutionIdentity(deps: NovelDirectorAutoExecutionRuntimeDeps, taskId: string) {
  return deps.workflowService.getTaskByIdWithoutHealing
    ? deps.workflowService.getTaskByIdWithoutHealing(taskId)
    : deps.workflowService.getTaskById(taskId);
}

function executionSeed(row: AutoExecutionTaskIdentityRow) {
  try { return JSON.parse(row.seedPayloadJson || "{}") as {
    autoExecution?: { pipelineJobId?: string | null };
    planningRepairRecovery?: { repairKey?: string; idempotencyKey?: string };
  }; } catch { return null; }
}

export async function resolveAutoExecutionRuntimeRangeAndState(
  deps: NovelDirectorAutoExecutionRuntimeDeps,
  input: {
    novelId: string;
    existingState?: DirectorAutoExecutionState | null;
    pipelineJobId?: string | null;
    pipelineStatus?: PipelineJobStatus | null;
    allowLazyChapterPlanning?: boolean;
  },
): Promise<{
  range: DirectorAutoExecutionRange;
  autoExecution: DirectorAutoExecutionState;
}> {
  return resolveAutoExecutionRangeAndState({
    novelId: input.novelId,
    deps: {
      listChapters: (novelId) => deps.novelContextService.listChapters(novelId),
      getVolumes: deps.volumeWorkspaceService
        ? (novelId) => deps.volumeWorkspaceService?.getVolumes(novelId) as Promise<VolumePlanDocument>
        : undefined,
    },
    existingState: input.existingState,
    pipelineJobId: input.pipelineJobId,
    pipelineStatus: input.pipelineStatus,
    allowLazyChapterPlanning: input.allowLazyChapterPlanning,
  });
}

export async function prepareRequestedAutoExecution(
  deps: NovelDirectorAutoExecutionRuntimeDeps,
  input: {
    novelId: string;
    request: DirectorConfirmRequest;
    existingState?: DirectorAutoExecutionState | null;
    existingPipelineJobId?: string | null;
    previousFailureMessage?: string | null;
    allowSkipReviewBlockedChapter?: boolean;
  },
): Promise<{
  range: DirectorAutoExecutionRange;
  autoExecution: DirectorAutoExecutionState;
  pipelineJobId: string;
}> {
  const shouldSkipReviewBlockedChapter = Boolean(
    input.allowSkipReviewBlockedChapter
    && isSkippableAutoExecutionReviewFailure(input.previousFailureMessage),
  );
  if (!shouldSkipReviewBlockedChapter && input.existingState?.pipelineJobId
    && input.existingState.pipelineStatus !== "succeeded"
    && input.existingState.pipelineJobId !== input.existingPipelineJobId?.trim()) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "原章节任务关联不完整，请回到本书工作区核对后继续。");
  }
  const pipelineJobId = shouldSkipReviewBlockedChapter
    ? ""
    : (input.existingPipelineJobId?.trim() || "");
  const existingState = applyReviewSkipOverride({
    existingState: input.existingState,
    previousFailureMessage: input.previousFailureMessage,
    allowSkipReviewBlockedChapter: input.allowSkipReviewBlockedChapter,
  });
  const requestedExecutionState = buildRequestedAutoExecutionState({
    request: input.request,
    existingState,
    existingPipelineJobId: pipelineJobId || null,
  });
  const { range, autoExecution } = await resolveAutoExecutionRuntimeRangeAndState(deps, {
    novelId: input.novelId,
    existingState: requestedExecutionState,
    pipelineJobId: pipelineJobId || null,
    pipelineStatus: pipelineJobId ? "running" : "queued",
    allowLazyChapterPlanning: isFullBookAutopilotRunMode(input.request.runMode),
  });
  return {
    range,
    autoExecution,
    pipelineJobId,
  };
}

/** Materialize only the next missing route before a single-chapter pipeline needs its ID. */
export async function prepareNextAutoExecutionChapter(
  deps: NovelDirectorAutoExecutionRuntimeDeps,
  input: {
    taskId: string;
    novelId: string;
    request: DirectorConfirmRequest;
    range: DirectorAutoExecutionRange;
    autoExecution: DirectorAutoExecutionState;
  },
): Promise<{ range: DirectorAutoExecutionRange; autoExecution: DirectorAutoExecutionState }> {
  const autoExecution = {
    ...input.autoExecution,
    completionProfile: resolveAutoExecutionBookProfile({
      completionProfile: input.request.completionProfile,
      estimatedChapterCount: input.request.estimatedChapterCount,
      candidateTargetChapterCount: input.request.candidate?.targetChapterCount,
      existingState: input.autoExecution,
    }),
  };
  const order = input.autoExecution.nextChapterOrder;
  if (!Number.isInteger(order) || order! < input.range.startOrder || order! > input.range.endOrder) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "下一章不在已授权的自动执行范围内，无法准备章节规划。");
  }
  if (input.autoExecution.nextChapterId) return { range: input.range, autoExecution };
  if (!isFullBookAutopilotRunMode(input.request.runMode)) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "下一章不在已授权的自动执行范围内，无法准备章节规划。");
  }
  const ensureRouteWindow: NonNullable<NovelDirectorAutoExecutionRuntimeDeps["ensureRouteWindow"]> = deps.ensureRouteWindow ?? (async (...args) => {
    const { ChapterRouteWindowService } = await import("../../planning/ChapterRouteWindowService");
    return new ChapterRouteWindowService().ensureRouteWindow(...args);
  });
  await ensureRouteWindow(input.novelId, order!, {
    taskId: input.taskId, endOrder: order!, min: 1, target: 1,
    provider: input.request.provider, model: input.request.model, temperature: input.request.temperature,
    completionProfile: autoExecution.completionProfile,
  });
  const refreshed = await resolveAutoExecutionRuntimeRangeAndState(deps, {
    novelId: input.novelId, existingState: { ...autoExecution, pipelineJobId: null, pipelineStatus: null },
    allowLazyChapterPlanning: true,
  });
  if (refreshed.range.startOrder !== input.range.startOrder || refreshed.range.endOrder !== input.range.endOrder) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节规划后原执行范围发生变化，请核对原任务后继续。");
  }
  if (refreshed.autoExecution.nextChapterOrder === order && !refreshed.autoExecution.nextChapterId) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", `第 ${order} 章规划尚未同步到章节执行区，已保留完成章节，请从原任务继续。`);
  }
  return refreshed;
}

export async function shouldStopAutoExecution(
  deps: NovelDirectorAutoExecutionRuntimeDeps,
  taskId: string,
  pipelineJobId?: string | null,
  expected?: AutoExecutionTaskIdentityRow | null,
): Promise<boolean> {
  const row = await readAutoExecutionIdentity(deps, taskId);
  if (!row) return true;
  if (expected) {
    const currentSeed = executionSeed(row);
    const expectedSeed = executionSeed(expected);
    if (!currentSeed || !expectedSeed || row.id !== expected.id || row.novelId !== expected.novelId
      || row.lane !== expected.lane || row.attemptCount !== expected.attemptCount
      || row.startedAt?.getTime() !== expected.startedAt?.getTime()
      || currentSeed.planningRepairRecovery?.repairKey !== expectedSeed.planningRepairRecovery?.repairKey
      || currentSeed.planningRepairRecovery?.idempotencyKey !== expectedSeed.planningRepairRecovery?.idempotencyKey
      || (pipelineJobId && currentSeed.autoExecution?.pipelineJobId
        && currentSeed.autoExecution.pipelineJobId !== pipelineJobId)) return true;
  }
  if (row.status === "cancelled" || row.cancelRequestedAt) {
    if (pipelineJobId) await deps.novelService.cancelPipelineJob(pipelineJobId).catch(() => null);
    return true;
  }
  return Boolean(row.pendingManualRecovery || !["queued", "running"].includes(row.status));
}
