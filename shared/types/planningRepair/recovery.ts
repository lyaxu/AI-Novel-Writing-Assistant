/** A legacy worker may retain running/queued while its explicit manual pause is set. */
export function isPlanningRepairTaskPaused(input: {
  status: string;
  pendingManualRecovery?: boolean | null;
  cancelRequestedAt?: unknown;
}): boolean {
  if (input.cancelRequestedAt || input.status === "cancelled") return false;
  return input.status === "waiting_approval" || input.status === "failed"
    || Boolean(input.pendingManualRecovery && (input.status === "running" || input.status === "queued"));
}

export function isPlanningRepairConfirmationPhase(phase: string): boolean {
  return ["waiting_confirmation", "uncertain", "technical_failed"].includes(phase);
}
