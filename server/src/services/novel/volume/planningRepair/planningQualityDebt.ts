/**
 * B-strategy planning quality debt.
 *
 * Planning is not a straight line. When the repair round budget is exhausted (and automatic
 * carry-over chapters are no longer available), the book may accept the last saved candidate as a
 * visible planning quality debt and continue writing the current chapter. This is explicitly NOT a
 * fake review pass: the failed findings stay recorded in the task seed, the chapter audit history,
 * the run log and the task projection; later chapters/volume planning can still see them.
 *
 * Hard boundaries are never converted into debt: unknown external calls, changed written prose,
 * active execution leases, ownership conflicts and written/locked chapter edits still pause.
 */

export interface PlanningQualityDebtIssue {
  id: string;
  severity?: string;
  target?: string;
  summary?: string;
}

export type PlanningQualityDebtSource = "planning_repair_exhausted" | "review_response_invalid";

export interface PlanningQualityDebtRecord {
  version: 1;
  kind: "planning_quality_debt";
  repairKey: string;
  candidateVersionId?: string | null;
  chapterId: string;
  chapterOrder: number;
  reasons: string[];
  issues: PlanningQualityDebtIssue[];
  capacityDebt: unknown[];
  acceptedAt: string;
  source: PlanningQualityDebtSource;
  /** This debt is accepted under the user-confirmed completion-first policy. */
  acceptedByPolicy: true;
}

const HARD_ISSUE_PATTERN = /unknown|external|lease|fingerprint|ownership|data_integrity|written_prose|prose_changed|租约|指纹|所有权|外部调用|调用未知/i;

function normalizedIssue(raw: unknown): PlanningQualityDebtIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return null;
  return {
    id,
    ...(typeof value.severity === "string" ? { severity: value.severity } : {}),
    ...(typeof value.target === "string" ? { target: value.target } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary.slice(0, 300) } : {}),
  };
}

function issueIsContinuable(issue: PlanningQualityDebtIssue): boolean {
  if (HARD_ISSUE_PATTERN.test(`${issue.id} ${issue.summary ?? ""}`)) return false;
  const id = issue.id.toLowerCase();
  if (id.startsWith("capacity_") || id === "selected_direction_drift") return true;
  const severity = (issue.severity ?? "").toLowerCase();
  if (severity === "critical") return false;
  const target = (issue.target ?? "").toLowerCase();
  // Medium/high narrative, scene-evidence or reader-contract gaps are non-fatal planning debt.
  // Hard boundaries above (prose/lease/ownership/unknown calls/data integrity) never qualify.
  return ["semantic", "scene_cards", "reader_experience", "content", "consistency"].includes(target);
}

/**
 * Automatic carry-over extension can only resolve debt whose source chapter is at the writable
 * window's end (`suggestedChapterId` null). When a debt already names a later chapter as carrier,
 * the window has later chapters that are merely over capacity; appending another chapter is not the
 * remedy, and B-strategy debt acceptance is allowed once repair rounds are exhausted.
 */
export function capacityExtensionCouldResolveDebt(input: {
  capacityDebt: readonly unknown[];
  extensionCount: number;
  maxExtensions: number;
  budgetAllowed: boolean;
}): boolean {
  const items = input.capacityDebt.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  if (items.length === 0 || !input.budgetAllowed || input.extensionCount >= input.maxExtensions) return false;
  return items.every((item) => item.suggestedChapterId == null);
}

export interface PlanningQualityDebtClassificationInput {
  rounds: number;
  maxRounds: number;
  /** False only when another automatic carry-over chapter is still available. */
  autoExtensionExhausted: boolean;
  reviewInvalid: boolean;
  issues: readonly unknown[];
  windowRequiresUserDecision?: boolean;
}

export interface PlanningQualityDebtClassification {
  allowed: boolean;
  reasons: string[];
  issues: PlanningQualityDebtIssue[];
  source: PlanningQualityDebtSource;
}

export function classifyPlanningQualityDebtAcceptance(
  input: PlanningQualityDebtClassificationInput,
): PlanningQualityDebtClassification {
  const issues = input.issues.map(normalizedIssue).filter((issue): issue is PlanningQualityDebtIssue => Boolean(issue));
  const reasons: string[] = [];
  if (input.rounds < input.maxRounds) return { allowed: false, reasons: ["repair_rounds_remaining"], issues, source: "planning_repair_exhausted" };
  reasons.push("planning_repair_rounds_exhausted");
  if (!input.autoExtensionExhausted) return { allowed: false, reasons: [...reasons, "auto_extension_available"], issues, source: "planning_repair_exhausted" };
  reasons.push("auto_extension_exhausted");
  if (input.windowRequiresUserDecision) return { allowed: false, reasons: [...reasons, "window_requires_user_decision"], issues, source: "planning_repair_exhausted" };
  if (input.reviewInvalid) {
    return { allowed: true, reasons: [...reasons, "review_response_invalid"], issues, source: "review_response_invalid" };
  }
  const blocked = issues.filter((issue) => !issueIsContinuable(issue));
  if (blocked.length > 0) {
    return { allowed: false, reasons: [...reasons, ...blocked.map((issue) => `hard_defect:${issue.id}`)], issues, source: "planning_repair_exhausted" };
  }
  return { allowed: true, reasons, issues, source: "planning_repair_exhausted" };
}

export function buildPlanningQualityDebtRecord(input: {
  repairKey: string;
  candidateVersionId?: string | null;
  chapterId: string;
  chapterOrder: number;
  classification: PlanningQualityDebtClassification;
  capacityDebt: unknown[];
  acceptedAt?: string;
}): PlanningQualityDebtRecord {
  return {
    version: 1,
    kind: "planning_quality_debt",
    repairKey: input.repairKey,
    candidateVersionId: input.candidateVersionId ?? null,
    chapterId: input.chapterId,
    chapterOrder: input.chapterOrder,
    reasons: input.classification.reasons,
    issues: input.classification.issues,
    capacityDebt: input.capacityDebt,
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
    source: input.classification.source,
    acceptedByPolicy: true,
  };
}
