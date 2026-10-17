/** A legacy worker may retain running/queued while its explicit manual pause is set. */
export type PlanningRepairRecoveryMode = "repair_then_review" | "review_existing" | "resume_existing_policy";
export type PlanningCandidateRecoveryMode = Exclude<PlanningRepairRecoveryMode, "repair_then_review">;

/** Uses saved authorization and counters, never infers intent from free-text errors. */
export function canResumeOriginalPlanningPolicy(input: {
  runMode?: unknown; autoExecution?: { enabled?: unknown; autoReview?: unknown; autoRepair?: unknown };
  directorInput?: { runMode?: unknown; autoExecutionPlan?: { autoReview?: unknown; autoRepair?: unknown } };
  rounds: number; maxRounds: number;
}): boolean {
  return (input.directorInput?.runMode ?? input.runMode) === "full_book_autopilot"
    && input.autoExecution?.enabled === true && input.autoExecution.autoReview === true && input.autoExecution.autoRepair === true
    && input.directorInput?.autoExecutionPlan?.autoReview !== false && input.directorInput?.autoExecutionPlan?.autoRepair !== false
    && Number.isSafeInteger(input.rounds) && input.rounds >= 0 && Number.isSafeInteger(input.maxRounds) && input.rounds < input.maxRounds;
}

/** Normal execution and original-policy recovery consume the same persisted budget. */
export function nextPlanningRepairAction(input: {
  mode?: PlanningRepairRecoveryMode; rounds: number; maxRounds: number; requiresUserDecision: boolean;
}): "repair" | "pause_review_only" | "pause_user_decision" | "pause_budget" {
  if (input.mode === "review_existing") return "pause_review_only";
  if (input.requiresUserDecision) return "pause_user_decision";
  if (!Number.isSafeInteger(input.rounds) || input.rounds < 0 || !Number.isSafeInteger(input.maxRounds)
    || input.rounds >= input.maxRounds) return "pause_budget";
  return "repair";
}

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
