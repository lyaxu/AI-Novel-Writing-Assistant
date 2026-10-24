import type { NovelAutoDirectorTaskSummary } from "@ai-novel/shared/types/novel";
import type { NovelWorkflowCheckpoint } from "@ai-novel/shared/types/novelWorkflow";
import type { TaskStatus } from "@ai-novel/shared/types/task";
import {
  isDirectorAutoExecutionCompletedBatchAwaitingNextScope,
  type DirectorAutoExecutionBatchCompletionState,
} from "@ai-novel/shared/types/novelDirector";
import { buildWorkflowExplainability, buildWorkflowResumeAction } from "./novelWorkflowExplainability";
import type { DirectorWorkflowSeedPayload } from "../novel/director/runtime/novelDirectorHelpers";
import { parseSeedPayload } from "../novel/workflow/novelWorkflow.shared";

export function buildNovelWorkflowNextActionLabel(
  status: TaskStatus,
  checkpointType: NovelWorkflowCheckpoint | null,
  executionScopeLabel?: string | null,
  pendingManualRecovery?: boolean | null,
  autoExecution?: DirectorAutoExecutionBatchCompletionState,
): string | null {
  const resumeAction = buildWorkflowResumeAction(
    status,
    checkpointType,
    executionScopeLabel,
    pendingManualRecovery,
    autoExecution,
  );
  if (!resumeAction) {
    return null;
  }
  if (status === "waiting_approval" && checkpointType === "chapter_batch_ready") {
    return isDirectorAutoExecutionCompletedBatchAwaitingNextScope(autoExecution)
      ? "继续写后续章节"
      : "进入已准备章节";
  }
  return resumeAction;
}

interface NovelWorkflowListSummaryRow {
  id: string;
  status: string;
  pendingManualRecovery?: boolean | null;
  progress: number;
  currentStage: string | null;
  currentItemKey: string | null;
  currentItemLabel: string | null;
  checkpointType: string | null;
  checkpointSummary: string | null;
  lastError: string | null;
  updatedAt: Date;
  seedPayloadJson?: string | null;
}

export function mapNovelAutoDirectorTaskSummary(
  row: NovelWorkflowListSummaryRow,
): NovelAutoDirectorTaskSummary {
  const checkpointType = row.checkpointType as NovelWorkflowCheckpoint | null;
  const pendingManualRecovery = Boolean(row.pendingManualRecovery);
  const status = (pendingManualRecovery && (row.status === "queued" || row.status === "running")
    ? "queued"
    : row.status) as TaskStatus;
  const seedPayload = parseSeedPayload<DirectorWorkflowSeedPayload>(row.seedPayloadJson);
  const autoExecution = seedPayload?.autoExecution ?? null;
  const executionScopeLabel = autoExecution?.scopeLabel?.trim() || null;
  const awaitingNextChapterScope = checkpointType === "chapter_batch_ready"
    && isDirectorAutoExecutionCompletedBatchAwaitingNextScope(autoExecution);
  const explainability = buildWorkflowExplainability({
    status,
    pendingManualRecovery,
    currentStage: row.currentStage,
    currentItemKey: row.currentItemKey,
    checkpointType,
    lastError: row.lastError,
    executionScopeLabel,
    autoExecution,
  });
  return {
    id: row.id,
    status,
    productionExperience: seedPayload?.productionExperience ?? null,
    pendingManualRecovery,
    progress: row.progress,
    currentStage: row.currentStage,
    currentItemLabel: row.currentItemLabel,
    executionScopeLabel,
    displayStatus: explainability.displayStatus,
    blockingReason: explainability.blockingReason,
    resumeAction: explainability.resumeAction,
    lastHealthyStage: explainability.lastHealthyStage,
    checkpointType,
    checkpointSummary: row.checkpointSummary,
    awaitingNextChapterScope,
    nextActionLabel: buildNovelWorkflowNextActionLabel(
      status,
      checkpointType,
      executionScopeLabel,
      pendingManualRecovery,
      autoExecution,
    ),
    updatedAt: row.updatedAt.toISOString(),
  };
}
