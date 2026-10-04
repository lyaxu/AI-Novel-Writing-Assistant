import { createHash } from "node:crypto";
import { chapterPayoffDecisionsSchema, type ChapterPayoffDecision } from "@ai-novel/shared/types/novel/payoffPlanning";
export { buildPayoffPlanningEvidenceBlock } from "./context";

type Contract = Partial<Record<"expectation" | "taskSheet" | "sceneCards" | "hook" | "mustAvoid", string | null>>;

export class PayoffPlanningReplanRequiredError extends Error {
  readonly code = "PAYOFF_PLANNING_REPLAN_REQUIRED";
  readonly recommendedAction = "replan";
  constructor(readonly decisions: ChapterPayoffDecision[]) {
    super(`当前章节规划无法承接回报，请从源工作区重建未写章节规划：${decisions.map((item) => item.reason).join("；")}`);
    this.name = "PayoffPlanningReplanRequiredError";
  }
}

function findFutureChapter(value: unknown, order: number): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => findFutureChapter(item, order));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return record.chapterOrder === order ? [record] : Object.values(record).flatMap((item) => findFutureChapter(item, order));
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

export function buildPayoffEvidenceHash(evidence: unknown): string {
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

/**
 * The searchable text of a contract field.
 *
 * Contract fields hold either plain text (`expectation`, `hook`, `mustAvoid`) or serialized JSON
 * (`sceneCards`). A verbatim quote must be findable in the *decoded* text: the raw serialization
 * escapes quotes and newlines and is formatted differently from what the model was shown, so a
 * byte-for-byte check against the raw string rejects quotes that are in fact verbatim. The
 * follow-up check below already searches decoded leaves; this keeps both halves of the same
 * function consistent.
 */
function contractFieldText(value: string | null | undefined): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object") return stringLeaves(parsed);
  } catch { /* Plain text, not JSON. */ }
  return [value];
}

export interface ChapterPayoffValidationInput {
  contract: Contract;
  candidates: Array<{ ledgerKey: string; currentStatus: string; targetEndChapterOrder?: number | null }>;
  chapterOrder: number; planningWindow: unknown;
}

export function validateChapterPayoffDecisions(
  input: ChapterPayoffValidationInput & { decisions: unknown },
  options: { allowReplan?: boolean } = {},
): ChapterPayoffDecision[] {
  const decisions = chapterPayoffDecisionsSchema.parse(input.decisions);
  const seen = new Set<string>();
  for (const decision of decisions) {
    const candidate = input.candidates.find((item) => item.ledgerKey === decision.ledgerKey);
    if (!candidate || seen.has(decision.ledgerKey)) {
      throw new Error(`Payoff decision must reference a unique supplied ledger key: ${decision.ledgerKey}`);
    }
    seen.add(decision.ledgerKey);
    const due = candidate.currentStatus === "overdue"
      || (typeof candidate.targetEndChapterOrder === "number" && candidate.targetEndChapterOrder <= input.chapterOrder);
    if (due && ["seed", "touch", "pressure"].includes(decision.operation) && !decision.followUp) {
      throw new Error(`Unpaid due payoff requires a concrete follow-up even when applying pressure: ${decision.ledgerKey}`);
    }
    if (!contractFieldText(input.contract[decision.contractEvidence.sourcePath])
      .some((leaf) => leaf.includes(decision.contractEvidence.quote))) {
      throw new Error(`Payoff decision cites absent current chapter contract evidence: ${decision.ledgerKey}. Copy one continuous verbatim quote from ${decision.contractEvidence.sourcePath}; preserve numbering and punctuation, never join separate clauses.`);
    }
    if (decision.followUp) {
      const targets = findFutureChapter(input.planningWindow, decision.followUp.chapterOrder);
      if (decision.followUp.chapterOrder <= input.chapterOrder || !targets.length) {
        throw new Error(`Payoff follow-up must cite a supplied future planning target: ${decision.ledgerKey}. Chapter ${decision.followUp.chapterOrder} is not a supplied future chapter in planningWindow. A ledger target date is not an existing chapter plan. ${due ? "This payoff is due; do not remove its required follow-up while keeping seed/touch/pressure. Choose a valid authorized decision or requires_replan." : "This payoff is not due. For seed/touch/pressure an optional followUp may be null; do not invent a future chapter. Defer and partial_reveal still require real follow-up evidence."}`);
      }
      if (!stringLeaves(targets).some((leaf) => leaf.includes(decision.followUp!.planningQuote))) {
        throw new Error(`Payoff follow-up must cite a supplied future planning target: ${decision.ledgerKey}. Chapter ${decision.followUp.chapterOrder} exists, but planningQuote is not a continuous verbatim quote from that chapter. Copy from planningWindow, not the ledger or book summary.`);
      }
    }
  }
  if (input.candidates.some((item) => !seen.has(item.ledgerKey))) {
    throw new Error("Payoff decisions must cover every supplied bounded candidate, including explicit out_of_scope decisions.");
  }
  const replan = decisions.filter((decision) => decision.operation === "requires_replan");
  if (replan.length && !options.allowReplan) throw new PayoffPlanningReplanRequiredError(replan);
  return decisions;
}

export function readCurrentPayoffDecisions(rawPlanJson: string | null | undefined, input: {
  contractHash: string; evidenceHash: string;
}): ChapterPayoffDecision[] | null {
  try {
    const plan = JSON.parse(rawPlanJson ?? "null");
    if (plan?.payoffDecisionVersion !== 1 || plan.executionContractHash !== input.contractHash
      || plan.payoffEvidenceHash !== input.evidenceHash) return null;
    const parsed = chapterPayoffDecisionsSchema.safeParse(plan.payoffDecisions);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
