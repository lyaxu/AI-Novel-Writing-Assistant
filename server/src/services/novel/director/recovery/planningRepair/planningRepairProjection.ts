import type { DirectorRuntimeProjection } from "@ai-novel/shared/types/directorRuntime";
import { readPlanningRepairSeed } from "./planningRepairRecovery";

export function overlayPlanningRepairPause(
  projection: DirectorRuntimeProjection | null,
  task: {
    status: string;
    checkpointType?: string | null;
    checkpointSummary?: string | null;
    seedPayloadJson?: string | null;
  } | null,
): DirectorRuntimeProjection | null {
  if (!projection || task?.status !== "waiting_approval"
    || task.checkpointType !== "step_review_required" || !task.checkpointSummary?.trim()) return projection;
  try {
    const { repair } = readPlanningRepairSeed(task.seedPayloadJson);
    if (!repair || !["waiting_confirmation", "uncertain", "committed"].includes(repair.phase)) return projection;
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
