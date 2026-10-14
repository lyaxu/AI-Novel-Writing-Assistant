import { createHash } from "node:crypto";
import type { ChapterProductionJournalRecord } from "../../../../production/reliability";
import type { PlanningRepairRecovery, PlanningRepairState } from "../planningRepairRecovery";

export interface SettledPlanningPreparationProof {
  kind: "settled_planning_preparation";
  source: "receipt" | "history";
  repairKey: string;
  chapterId: string;
  round: number;
  requestId: string;
  operationId: string;
  candidateVersionId: string;
  historyFingerprint: string;
  assessmentIndex?: number;
  repairIndex?: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function refuse(reason: string): never {
  throw Object.assign(new Error(`规划暂停证据不足，不能重发原调用：${reason}`), { code: "PLANNING_REPAIR_CONFLICT" });
}

/** A complete saved assessment proves a gate decision, never a partially returned model call. */
function failedAssessment(value: unknown, repair: PlanningRepairState): boolean {
  const result = object(value);
  const chapters = object(result?.chapters);
  if (!chapters) return false;
  const affected = Array.isArray(repair.affectedChapterIds) ? repair.affectedChapterIds : [repair.chapterId];
  if (!affected.length || !affected.includes(repair.chapterId)) return false;
  const reviews = affected.map(id => typeof id === "string" ? object(chapters[id]) : null);
  if (reviews.some(review => !review || typeof review.safeToSync !== "boolean"
    || typeof review.canEnterExecution !== "boolean" || typeof review.status !== "string"
    || typeof review.verdict !== "string")) return false;
  if (reviews.some(review => review!.safeToSync === false && review!.canEnterExecution === false)) return true;
  const window = object(result?.window);
  return reviews.every(review => review!.status === "passed" && review!.verdict === "usable"
    && review!.safeToSync === true) && Boolean(window
      && typeof window.usable === "boolean" && typeof window.safeToSync === "boolean"
      && typeof window.requiresUserDecision === "boolean" && Array.isArray(window.issues)
      && (window.safeToSync === false || window.usable === false || window.requiresUserDecision === true));
}

/**
 * Pure evidence gate. The caller still checks source/candidate hashes, owner, lease and CAS.
 * Only the execution-contract wrapper may be reclassified; this never clears an actual unknown call.
 */
export function assertSettledPlanningPreparation(input: {
  repair: PlanningRepairState;
  recovery: PlanningRepairRecovery;
  journal: ChapterProductionJournalRecord;
}): SettledPlanningPreparationProof {
  const { repair, recovery, journal } = input;
  const action = repair.recoveryAction;
  if (!recovery.idempotencyKey || recovery.pendingGrant || recovery.repairKey !== repair.key
    || recovery.resumePhase !== "chapter_execution" || recovery.grantedAtRound !== repair.rounds
    || !action || action.requestId !== recovery.idempotencyKey || action.paidRound !== undefined
    || action.mode !== recovery.executionMode || repair.pendingOperation || repair.repairOutputPending
    || !["reviewing", "assessing"].includes(repair.phase) || !repair.candidateVersionId
    || !Number.isInteger(repair.rounds) || repair.rounds < 0 || !Array.isArray(repair.history)) {
    return refuse("授权、候选或已消耗轮次不匹配。");
  }
  if (journal.status !== "paused" || journal.partialText || journal.prepared
    || (journal.expectedChapter.content ?? "").trim()) return refuse("章节不在空稿的准备暂停边界。");
  const step = journal.steps["prepare.execution_contract"];
  if (!step || !step.external || !["unknown", "failed"].includes(step.status)) {
    return refuse("没有可核对的执行合同暂停步骤。");
  }
  for (const [key, item] of Object.entries(journal.steps)) {
    if (key !== "prepare.execution_contract" && (item.status === "unknown" || item.status === "running")) {
      return refuse("其他步骤仍有未确认执行。");
    }
    if (!["prepare", "prepare.contract", "prepare.execution_contract"].includes(key)) {
      return refuse("执行已越过合同准备，不能按规划暂停恢复。");
    }
  }
  const base = {
    kind: "settled_planning_preparation" as const, repairKey: repair.key, chapterId: repair.chapterId,
    round: repair.rounds, requestId: recovery.idempotencyKey, operationId: journal.operationId,
    candidateVersionId: repair.candidateVersionId,
    historyFingerprint: createHash("sha256").update(JSON.stringify(repair.history)).digest("hex"),
  };
  const receipt = step.planningPause;
  if (receipt !== undefined) {
    if (receipt.version !== 1 || receipt.outcome !== "settled" || receipt.repairKey !== repair.key
      || receipt.round !== repair.rounds || receipt.candidateVersionId !== repair.candidateVersionId) {
      return refuse("持久化暂停回执不匹配或仍为未知。");
    }
    return { ...base, source: "receipt" };
  }
  // Legacy inference is deliberately limited to a completed, exhausted-round review followed by a grant.
  if (repair.rounds < 1 || repair.maxRounds !== repair.rounds + 1
    || action.mode !== "repair_then_review") return refuse("历史记录不能证明本轮确定结束。");
  // Exact persisted correlation, not message classification: unrelated transport errors must stay unknown.
  if (!repair.summary || step.error !== repair.summary || journal.error !== repair.summary
    || ["prepare", "prepare.contract"].some(key => journal.steps[key]?.status !== "failed"
      || journal.steps[key]?.error !== repair.summary)) return refuse("执行日志与规划停点不是同一次结果。");
  const assessmentIndex = repair.history.length - 1;
  const last = object(repair.history[assessmentIndex]);
  if (last?.kind !== "assessment" || last.round !== repair.rounds || !failedAssessment(last.result, repair)) {
    return refuse("缺少最后一轮完整且未通过的规划复核。");
  }
  let repairIndex = -1;
  for (let index = assessmentIndex - 1; index >= 0; index -= 1) {
    const entry = object(repair.history[index]);
    if (entry?.kind === "evidence_refresh") break;
    if (entry?.kind === "repair" && entry.round === repair.rounds) { repairIndex = index; break; }
    if (entry?.kind !== "review" || entry.round !== repair.rounds) return refuse("最终复核之前存在未解释的调用记录。");
  }
  const paidOutput = object(object(repair.history[repairIndex])?.output);
  if (repairIndex < 0 || paidOutput?.requiresUserDecision !== false
    || !Array.isArray(paidOutput.changes) || !paidOutput.changes.length
    || !paidOutput.changes.some(change => object(change)?.chapterId === repair.chapterId)) {
    return refuse("缺少对应轮次已保存的修复回答。");
  }
  return { ...base, source: "history", assessmentIndex, repairIndex };
}
