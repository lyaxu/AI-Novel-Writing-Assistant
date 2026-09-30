import { AppError } from "../../../../../middleware/errorHandler";
import { isPlanningRepairConfirmationPhase } from "@ai-novel/shared/types/planningRepair/recovery";

export interface PlanningRepairState extends Record<string, unknown> {
  version: 1;
  key: string;
  novelId: string;
  volumeId: string;
  chapterId: string;
  chapterOrder: number;
  rounds: number;
  maxRounds?: number;
  phase: "assessing" | "repairing" | "reviewing" | "ready" | "committed" | "waiting_confirmation" | "uncertain" | "technical_failed";
  summary?: string;
  history: unknown[];
  guidance?: string;
  recoveryAction?: { requestId: string; mode: "repair_then_review" | "review_existing"; paidRound?: number; affectedChapterIds?: string[] };
  candidateVersionId?: string;
}

export interface PlanningRepairRecovery {
  executionMode?: "repair_then_review" | "review_existing";
  affectedChapterIds?: string[];
  repairKey: string;
  resumePhase: "structured_outline" | "chapter_execution";
  idempotencyKey?: string;
  guidance?: string;
  grantedAtRound?: number;
  pendingGrant?: boolean;
  expectedMaxRounds?: number;
  expectedRound?: number;
  expectedSourceToken?: string;
  previousRecovery?: PlanningRepairRecovery | null;
}

export function readPlanningRepairSeed(json: string | null | undefined): {
  seed: Record<string, unknown>;
  repair: PlanningRepairState | null;
  recovery: PlanningRepairRecovery | null;
} {
  let seed: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) seed = parsed as Record<string, unknown>;
  } catch { throw new AppError("任务状态无法读取，请先检查保存的规划修复记录。", 409); }
  const value = seed.planningRepair as PlanningRepairState | undefined;
  const repair = value?.version === 1 && typeof value.key === "string" ? value : null;
  if (value !== undefined && !repair) throw new AppError("规划修复状态无效，不能自动继续。", 409);
  const recovery = seed.planningRepairRecovery as PlanningRepairRecovery | undefined;
  return { seed, repair, recovery: recovery?.repairKey === repair?.key ? recovery ?? null : null };
}

export function isPlanningRepairConfirmationError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error
    && ["PLANNING_REPAIR_CONFIRMATION_REQUIRED", "PLANNING_REPAIR_CONFLICT"].includes(String(error.code)));
}

export function assertPlanningRepairResumeAllowed(json: string | null | undefined, recoveryKey?: string): void {
  const { repair, recovery } = readPlanningRepairSeed(json);
  if (!repair || repair.phase === "committed") return;
  const blocked = isPlanningRepairConfirmationPhase(repair.phase)
    || Boolean(repair.pendingOperation) || recovery?.pendingGrant;
  if (!blocked && ["assessing", "repairing", "reviewing", "ready"].includes(repair.phase)
    && (!recoveryKey || recovery?.idempotencyKey === recoveryKey)) return;
  throw new AppError("请回到节奏 / 拆章工作区补充修复方向，并确认追加一轮规划修复。", 409);
}

export function resolvePlanningRepairResumePhase(input: {
  seedPayloadJson?: string | null;
  currentItemKey?: string | null;
}): PlanningRepairRecovery["resumePhase"] {
  const { seed, recovery } = readPlanningRepairSeed(input.seedPayloadJson);
  if (recovery) return recovery.resumePhase;
  const session = seed.directorSession as { phase?: string } | undefined;
  return session?.phase === "chapter_execution" || input.currentItemKey === "chapter_execution"
    ? "chapter_execution" : "structured_outline";
}
