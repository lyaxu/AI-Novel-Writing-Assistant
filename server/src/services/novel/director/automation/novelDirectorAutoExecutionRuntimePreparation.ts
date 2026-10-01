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
} from "./novelDirectorAutoExecutionScopeRuntime";
import { isSkippableAutoExecutionReviewFailure } from "./novelDirectorAutoExecutionFailure";
import type { DirectorAutoExecutionRange } from "./novelDirectorAutoExecution";
import type { AutoExecutionTaskIdentityRow, NovelDirectorAutoExecutionRuntimeDeps } from "./novelDirectorAutoExecutionRuntimePorts";

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
