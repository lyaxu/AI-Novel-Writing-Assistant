import type {
  DirectorAutoExecutionState,
  DirectorCircuitBreakerState,
  DirectorConfirmRequest,
} from "@ai-novel/shared/types/novelDirector";
import type { PipelineJobStatus } from "@ai-novel/shared/types/novel";
import {
  buildDirectorAutoExecutionPausedLabel,
  buildDirectorAutoExecutionPausedSummary,
  buildDirectorAutoExecutionScopeLabelFromState,
  type DirectorAutoExecutionRange,
} from "./novelDirectorAutoExecution";
import {
  syncAutoExecutionTaskState,
  type AutoExecutionCheckpointRuntimeDeps,
  type AutoExecutionResumeStage,
} from "./novelDirectorAutoExecutionCheckpointRuntime";
import {
  buildClosedDirectorCircuitBreakerState,
  DIRECTOR_CIRCUIT_BREAKER_THRESHOLDS,
  openDirectorCircuitBreaker,
  isDirectorCircuitBreakerOpen,
  recordChapterUsageBudgetExceededSignal,
  recordModelFailureSignal,
  recordUsageAnomalySignal,
  withCircuitBreakerState,
} from "../runtime/DirectorCircuitBreakerService";
import { directorAutomationLedgerEventService } from "../runtime/DirectorAutomationLedgerEventService";
import { directorUsageTelemetryQueryService } from "../runtime/DirectorUsageTelemetryQueryService";
import { directorIssueService } from "../issues";
import { loadDirectorIssueTaskContext } from "../issues/DirectorIssueTaskContext";
import {
  directorIssuePolicySchema,
  type DirectorIssueAction,
  type DirectorIssueCode,
} from "@ai-novel/shared/types/directorIssue";
import { prisma } from "../../../../db/prisma";

type AutomationLedgerEventPort = Pick<
  typeof directorAutomationLedgerEventService,
  "recordCircuitBreakerOpened" | "recordEvent"
>;

interface CircuitBreakerWorkflowPort extends AutoExecutionCheckpointRuntimeDeps {
  workflowService: AutoExecutionCheckpointRuntimeDeps["workflowService"] & {
    markTaskFailed(taskId: string, message: string, patch?: {
      stage?: "quality_repair";
      itemKey?: string | null;
      itemLabel?: string;
      checkpointType?: "chapter_batch_ready" | "replan_required";
      checkpointSummary?: string | null;
      chapterId?: string | null;
      progress?: number;
    }): Promise<unknown>;
    requeueTaskForRecovery(taskId: string, message: string): Promise<unknown>;
  };
  automationLedgerEventService?: AutomationLedgerEventPort;
}

async function applyCircuitBreakerDecision(
  deps: CircuitBreakerWorkflowPort,
  input: Parameters<typeof applyCircuitBreakerStop>[1],
  action: DirectorIssueAction,
): Promise<void> {
  if (action === "auto_retry" || action === "continue_with_warning") {
    await syncAutoExecutionTaskState(deps, {
      ...input,
      autoExecution: withCircuitBreakerState(
        input.autoExecution,
        buildClosedDirectorCircuitBreakerState(input.circuitBreaker),
      ),
      isBackgroundRunning: true,
      resumeStage: input.resumeStage ?? "pipeline",
    });
    return;
  }
  if (action === "pause_for_manual") {
    await deps.workflowService.requeueTaskForRecovery(
      input.taskId,
      input.circuitBreaker.message ?? "自动导演已在安全节点暂停，处理后可继续。",
    );
    await syncAutoExecutionTaskState(deps, {
      ...input,
      autoExecution: withCircuitBreakerState(input.autoExecution, input.circuitBreaker),
      isBackgroundRunning: false,
      resumeStage: input.resumeStage ?? "pipeline",
    });
    return;
  }
  await applyCircuitBreakerStop(deps, input);
}

async function applyCircuitBreakerStop(
  deps: CircuitBreakerWorkflowPort,
  input: {
    taskId: string;
    novelId: string;
    request: DirectorConfirmRequest;
    range: DirectorAutoExecutionRange;
    autoExecution: DirectorAutoExecutionState;
    circuitBreaker: DirectorCircuitBreakerState;
    resumeStage?: AutoExecutionResumeStage;
  },
): Promise<void> {
  const ledgerEventService = deps.automationLedgerEventService ?? directorAutomationLedgerEventService;
  const autoExecution = withCircuitBreakerState(input.autoExecution, input.circuitBreaker);
  const scopeLabel = buildDirectorAutoExecutionScopeLabelFromState(autoExecution, input.range.totalChapterCount);
  const message = input.circuitBreaker.message?.trim()
    || `${scopeLabel}已暂停，等待处理后再继续。`;
  await ledgerEventService.recordCircuitBreakerOpened({
    taskId: input.taskId,
    novelId: input.novelId,
    state: input.circuitBreaker,
  }).catch(() => null);
  await deps.workflowService.markTaskFailed(input.taskId, message, {
    stage: "quality_repair",
    itemKey: "quality_repair",
    itemLabel: buildDirectorAutoExecutionPausedLabel(autoExecution),
    checkpointType: input.circuitBreaker.reason === "replan_loop" ? "replan_required" : "chapter_batch_ready",
    checkpointSummary: buildDirectorAutoExecutionPausedSummary({
      scopeLabel,
      remainingChapterCount: autoExecution.remainingChapterCount ?? 0,
      nextChapterOrder: autoExecution.nextChapterOrder ?? null,
      failureMessage: message,
    }),
    chapterId: autoExecution.nextChapterId ?? input.range.firstChapterId,
    progress: 0.98,
  });
  await syncAutoExecutionTaskState(deps, {
    taskId: input.taskId,
    novelId: input.novelId,
    request: input.request,
    range: input.range,
    autoExecution,
    isBackgroundRunning: false,
    resumeStage: input.resumeStage ?? "pipeline",
  });
}

function issueCodeForCircuitBreaker(
  reason: DirectorCircuitBreakerState["reason"],
): DirectorIssueCode {
  switch (reason) {
    case "auto_repair_exhausted": return "quality.local_repair_failed";
    case "replan_loop": return "quality.replan_loop";
    case "model_unavailable": return "runtime.model_unavailable";
    case "service_unavailable": return "runtime.service_unavailable";
    case "protected_user_content": return "runtime.protected_content";
    case "unrecoverable_data_risk": return "runtime.data_integrity";
    case "usage_anomaly": return "runtime.token_budget_exceeded";
    default: return "runtime.unclassified";
  }
}

export async function stopAutoExecutionForCircuitBreaker(
  deps: CircuitBreakerWorkflowPort,
  input: Parameters<typeof applyCircuitBreakerStop>[1],
): Promise<void> {
  const requestPolicy = input.request.issueGovernanceVersion === 1
    ? directorIssuePolicySchema.safeParse(input.request.issuePolicy)
    : null;
  const governance = requestPolicy?.success
    ? {
      issueGovernanceVersion: 1 as const,
      policy: requestPolicy.data,
      policySource: input.request.issuePolicySource ?? "task_snapshot" as const,
    }
    : await loadDirectorIssueTaskContext(input.taskId).catch(() => null);
  if (!governance) {
    await applyCircuitBreakerStop(deps, input);
    return;
  }
  const failureCount = Math.max(
    input.circuitBreaker.failureCount ?? 0,
    input.circuitBreaker.patchFailureCount ?? 0,
    input.circuitBreaker.replanLoopCount ?? 0,
    input.circuitBreaker.modelFailureCount ?? 0,
    input.circuitBreaker.usageAnomalyCount ?? 0,
    1,
  );
  const issueCode = issueCodeForCircuitBreaker(input.circuitBreaker.reason);
  await directorIssueService.reportIssue({
    issueGovernanceVersion: governance.issueGovernanceVersion,
    taskId: input.taskId,
    novelId: input.novelId,
    issueCode,
    stage: input.circuitBreaker.nodeKey ?? "chapter_execution",
    summary: input.circuitBreaker.message ?? "自动导演安全熔断已触发。",
    evidence: input.circuitBreaker.reason ?? undefined,
    affectedScope: input.circuitBreaker.chapterId
      ? `chapter:${input.circuitBreaker.chapterId}`
      : "book",
    chapterId: input.circuitBreaker.chapterId ?? undefined,
    chapterOrder: input.circuitBreaker.chapterOrder ?? undefined,
    attempt: failureCount,
    hasUsableOutput: issueCode.startsWith("quality."),
    runMode: input.request.runMode,
    fingerprint: [
      "circuit_breaker",
      input.circuitBreaker.reason ?? "unknown",
      input.circuitBreaker.chapterId ?? "book",
      failureCount,
    ].join(":"),
    policy: governance.policy,
    policySource: governance.policySource,
    provider: input.request.provider,
    model: input.request.model,
    temperature: input.request.temperature,
    applyAction: (decision) => applyCircuitBreakerDecision(deps, input, decision.action),
  });
}

export async function resolveUsageCircuitBreaker(input: {
  taskId: string;
  novelId: string;
  autoExecution: DirectorAutoExecutionState;
}): Promise<DirectorCircuitBreakerState | null> {
  // An open pause is a persisted workflow boundary, never cleared by polling.
  if (isDirectorCircuitBreakerOpen(input.autoExecution.circuitBreaker)) {
    return input.autoExecution.circuitBreaker;
  }
  const usage = await directorUsageTelemetryQueryService.getTaskControlUsage({
    novelId: input.novelId,
    taskId: input.taskId,
  }).catch((error) => {
    // Explicit financial limits must fail closed if their evidence is unavailable.
    if (input.autoExecution.usageBudget?.taskTokenLimit || input.autoExecution.usageBudget?.chapterTokenLimit) throw error;
    return null;
  });
  if (!usage) return null;
  const previous = input.autoExecution.circuitBreaker;
  const latest = usage.records.at(-1);
  const taskLimit = input.autoExecution.usageBudget?.taskTokenLimit;
  if (Number.isSafeInteger(taskLimit) && taskLimit! > 0 && (usage.summary?.totalTokens ?? 0) >= taskLimit!) {
    return openDirectorCircuitBreaker({
      previous, reason: "usage_anomaly",
      message: `本任务 AI 用量达到 ${usage.summary?.totalTokens} Tokens，已达到设定的 ${taskLimit} Tokens 上限，请在本书工作区核对预算。`,
      lastUsageRecordId: latest?.id,
    });
  }
  const currentChapter = usage.chapterUsage.find((chapter) =>
    input.autoExecution.nextChapterOrder != null
      ? chapter.chapterOrder === input.autoExecution.nextChapterOrder
      : Boolean(input.autoExecution.nextChapterId && (chapter.chapterId === input.autoExecution.nextChapterId
        || chapter.sourceChapterIds.includes(input.autoExecution.nextChapterId))));
  const chapterBudgetBreaker = currentChapter
    ? recordChapterUsageBudgetExceededSignal({
      previous,
      tokenLimit: input.autoExecution.usageBudget?.chapterTokenLimit,
      usageRecordId: currentChapter.latestUsageRecordId,
      totalTokens: currentChapter.totalTokens,
      chapterId: currentChapter.chapterId,
      chapterOrder: currentChapter.chapterOrder,
      nodeKey: currentChapter.nodeKey,
    })
    : null;
  if (chapterBudgetBreaker) return chapterBudgetBreaker;
  // Recovery establishes a new attempt window, not a new monetary budget.
  const resetAt = previous?.resetAt ? Date.parse(previous.resetAt) : 0;
  const attempts = usage.records.filter((record) => !resetAt || Date.parse(record.recordedAt) >= resetAt);
  const last = attempts.at(-1);
  if (!last) return null;
  const targetsCurrent = last.chapterOrder != null
    ? last.chapterOrder === input.autoExecution.nextChapterOrder
    : Boolean(last.chapterId && last.chapterId === input.autoExecution.nextChapterId);
  if (targetsCurrent && ["length", "max_tokens", "output_limit"].includes(last.finishReason ?? "")) {
    return openDirectorCircuitBreaker({
      previous, reason: "usage_anomaly", chapterId: last.chapterId, chapterOrder: last.chapterOrder,
      nodeKey: last.nodeKey, lastUsageRecordId: last.id,
      message: "模型输出额度耗尽，请在本书工作区核对输出预算后手动继续。",
    });
  }
  if (last.stepIdempotencyKey && targetsCurrent) {
    const repeated = [];
    for (const record of attempts.slice().reverse()) {
      if (record.stepIdempotencyKey !== last.stepIdempotencyKey
        || record.nodeKey !== last.nodeKey || record.promptAssetKey !== last.promptAssetKey) break;
      repeated.push(record);
    }
    if (repeated.length >= DIRECTOR_CIRCUIT_BREAKER_THRESHOLDS.noProgressCallLimit) {
      const step = await prisma.directorStepRun.findUnique({
        where: { idempotencyKey: last.stepIdempotencyKey },
        select: { taskId: true, status: true, finishedAt: true },
      });
      if (step?.taskId === input.taskId && step.status !== "succeeded") {
        return openDirectorCircuitBreaker({
          previous, reason: "usage_anomaly", chapterId: last.chapterId, chapterOrder: last.chapterOrder,
          nodeKey: last.nodeKey, lastUsageRecordId: last.id,
          message: `同一步骤已连续调用 ${repeated.length} 次且没有完成记录，请在本书工作区检查后继续。`,
        });
      }
    }
  }
  return recordUsageAnomalySignal({
    previous,
    usageRecordId: last.id,
    totalTokens: last.totalTokens,
    nodeKey: last.nodeKey,
  });
}

export function buildFailureCircuitBreaker(input: {
  autoExecution: DirectorAutoExecutionState;
  jobStatus: PipelineJobStatus;
  message: string;
}): DirectorCircuitBreakerState {
  if (input.jobStatus === "cancelled") {
    return buildClosedDirectorCircuitBreakerState(input.autoExecution.circuitBreaker);
  }
  return recordModelFailureSignal({
    previous: input.autoExecution.circuitBreaker,
    reason: input.jobStatus === "failed" ? "service_unavailable" : "model_unavailable",
    message: input.message,
    nodeKey: "chapter_execution_node",
  });
}

export { isDirectorCircuitBreakerOpen, withCircuitBreakerState, buildClosedDirectorCircuitBreakerState };
