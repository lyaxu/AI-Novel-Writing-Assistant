import type { DirectorCommandAcceptedResponse } from "@ai-novel/shared/types/directorRuntime";
import type { DirectorContinuationMode } from "@ai-novel/shared/types/novelDirector";
import type { UnifiedTaskDetail } from "@ai-novel/shared/types/task";

export function resolveWorkflowContinuationFeedback(
  task: UnifiedTaskDetail | DirectorCommandAcceptedResponse | null | undefined,
  options?: {
    mode?: DirectorContinuationMode;
    scopeLabel?: string | null;
  },
): {
  tone: "success" | "error";
  message: string;
} {
  const requestedScopeLabel = options?.scopeLabel?.trim();
  const taskScopeLabel = task && "executionScopeLabel" in task ? task.executionScopeLabel?.trim() : undefined;
  const scopeLabel = requestedScopeLabel || taskScopeLabel || "当前章节范围";

  if (task && "kind" in task && task.status === "failed") {
    return {
      tone: "error",
      message: task.failureSummary?.trim()
        || task.blockingReason?.trim()
        || task.lastError?.trim()
        || (options?.mode === "auto_execute_range"
          ? `继续自动执行${scopeLabel}失败。`
          : "继续自动导演失败。"),
    };
  }

  return {
    tone: "success",
    message: options?.mode === "skip_quality_repair"
      ? `已跳过本次质量建议，自动导演会继续执行${scopeLabel}。`
      : options?.mode === "auto_execute_range"
          ? `已继续自动执行${scopeLabel}。`
          : "自动导演已继续推进。",
  };
}

export function resolveDirectorContinueMode(task: Pick<
  UnifiedTaskDetail,
  "checkpointType" | "currentItemKey" | "currentStage" | "pendingManualRecovery"
> | null | undefined): DirectorContinuationMode {
  if (task?.pendingManualRecovery) {
    return "resume";
  }
  if (task?.checkpointType === "replan_required") {
    return "auto_execute_range";
  }
  if (
    task?.currentItemKey === "quality_repair"
    || task?.currentStage?.includes("质量")
  ) {
    return "skip_quality_repair";
  }
  if (task?.checkpointType === "chapter_batch_ready") {
    return "auto_execute_range";
  }
  return "resume";
}

export interface PendingRecoveryGuidance {
  actionLabel: string;
  description: string;
}

/**
 * One explicit next step for a paused auto-director task. Review pauses only lose the review;
 * the saved chapter prose is kept, so the guidance must say what resume does and does not touch.
 */
export function resolvePendingRecoveryGuidance(task: Pick<
  UnifiedTaskDetail,
  "checkpointType" | "currentItemKey" | "pendingManualRecovery"
> | null | undefined): PendingRecoveryGuidance | null {
  if (!task?.pendingManualRecovery) {
    return null;
  }
  if (task.checkpointType === "chapter_batch_ready" && task.currentItemKey === "quality_repair") {
    return {
      actionLabel: "从最近检查点恢复审查",
      description: "会从已保存的本章正文继续，重新完成章节检查与审查；不会重写已保存的正文。",
    };
  }
  if (task.checkpointType === "chapter_batch_ready") {
    return {
      actionLabel: "从最近检查点恢复",
      description: "会从最近保存的进度继续；已经保存的章节正文不会重写。",
    };
  }
  return {
    actionLabel: "继续自动导演",
    description: "任务已停在当前进度，可从最近检查点继续。",
  };
}
