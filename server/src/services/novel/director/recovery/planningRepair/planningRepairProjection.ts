import type { DirectorRuntimeProjection } from "@ai-novel/shared/types/directorRuntime";
import { isPlanningRepairConfirmationPhase, isPlanningRepairTaskPaused } from "@ai-novel/shared/types/planningRepair/recovery";
import { readPlanningRepairSeed, resolvePlanningRepairResumePhase } from "./planningRepairRecovery";

interface PlanningPauseTask {
  status: string;
  pendingManualRecovery?: boolean | null;
  cancelRequestedAt?: unknown;
  checkpointType?: string | null;
  checkpointSummary?: string | null;
  seedPayloadJson?: string | null;
}

function isPlanningPause(task: PlanningPauseTask, phase: string): boolean {
  if (!isPlanningRepairTaskPaused(task)) return false;
  // A given-up session is over. Without this it still reads as a planning pause — the first clause
  // matches on task status alone — so the panel keeps showing the frozen checkpoint the user just
  // dismissed, which is the exact symptom abandoning is supposed to clear.
  // Only `abandoned` is excluded here, not every terminal phase: a committed repair legitimately
  // still presents its checkpoint, and filtering the whole terminal set silently removed that.
  if (phase === "abandoned") return false;
  return (task.status === "waiting_approval" && task.checkpointType === "step_review_required")
    || Boolean(task.pendingManualRecovery && isPlanningRepairConfirmationPhase(phase));
}

export function getPlanningRepairCheckpointStage(task: PlanningPauseTask): "structured_outline" | "chapter_execution" | null {
  try {
    const { repair } = readPlanningRepairSeed(task.seedPayloadJson);
    if (!repair || !isPlanningPause(task, repair.phase)) return null;
    return repair.phase === "committed" || (repair.phase === "assessing" && !repair.pendingOperation)
      ? resolvePlanningRepairResumePhase(task) : "structured_outline";
  } catch { return null; }
}

export function overlayPlanningRepairPause(
  projection: DirectorRuntimeProjection | null,
  task: PlanningPauseTask | null,
): DirectorRuntimeProjection | null {
  if (!projection || !task || !task.checkpointSummary?.trim()) return projection;
  try {
    const { repair } = readPlanningRepairSeed(task.seedPayloadJson);
    if (!repair || !isPlanningPause(task, repair.phase)
      || (!isPlanningRepairConfirmationPhase(repair.phase) && repair.phase !== "committed"
      && !(repair.phase === "assessing" && !repair.pendingOperation))) return projection;
  } catch { return projection; }
  // The current checkpoint supersedes historical failures, without rewriting their evidence.
  const summary = task.checkpointSummary.trim();
  const next = {
    ...projection,
    status: "waiting_approval" as const,
    currentAction: summary,
    currentLabel: summary,
    headline: summary,
    checkpointSummary: summary,
    waitingReason: summary,
    detail: summary,
    blockedReason: summary,
    blockingReason: summary,
    lastErrorMessage: null,
    requiresUserAction: true,
    isAutopilotRecoverable: false,
  };
  return next;
}
