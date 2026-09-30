import { createHash } from "node:crypto";
import { chapterPayoffDecisionsSchema, type ChapterPayoffDecision } from "@ai-novel/shared/types/novel/payoffPlanning";

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

export function validateChapterPayoffDecisions(input: {
  decisions: unknown; contract: Contract;
  candidates: Array<{ ledgerKey: string; currentStatus: string; targetEndChapterOrder?: number | null }>;
  chapterOrder: number; planningWindow: unknown;
}): ChapterPayoffDecision[] {
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
    if (!input.contract[decision.contractEvidence.sourcePath]?.includes(decision.contractEvidence.quote)) {
      throw new Error(`Payoff decision cites absent current chapter contract evidence: ${decision.ledgerKey}`);
    }
    if (decision.followUp && (decision.followUp.chapterOrder <= input.chapterOrder
      || !stringLeaves(findFutureChapter(input.planningWindow, decision.followUp.chapterOrder))
        .some((leaf) => leaf.includes(decision.followUp!.planningQuote)))) {
      throw new Error(`Payoff follow-up must cite a supplied future planning target: ${decision.ledgerKey}`);
    }
  }
  if (input.candidates.some((item) => !seen.has(item.ledgerKey))) {
    throw new Error("Payoff decisions must cover every supplied bounded candidate, including explicit out_of_scope decisions.");
  }
  const replan = decisions.filter((decision) => decision.operation === "requires_replan");
  if (replan.length) throw new PayoffPlanningReplanRequiredError(replan);
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
