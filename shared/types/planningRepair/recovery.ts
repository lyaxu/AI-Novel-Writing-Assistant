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

/**
 * Phases in which a planning-repair session is over and holds nothing: `committed` applied a
 * candidate, `abandoned` means the user gave the session up.
 *
 * Shared on purpose. Several call sites tested `phase === "committed"` directly, so every new
 * terminal phase had to be remembered at each one; a single predicate makes that impossible to miss.
 */
export const TERMINAL_PLANNING_REPAIR_PHASES = ["committed", "abandoned"] as const;

export function isTerminalPlanningRepairPhase(phase: string | null | undefined): boolean {
  return typeof phase === "string"
    && (TERMINAL_PLANNING_REPAIR_PHASES as readonly string[]).includes(phase);
}
