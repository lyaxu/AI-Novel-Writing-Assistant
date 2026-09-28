import type { PlanningRepairAdviceStatus, PlanningRepairStatus } from "@/api/planningRepair";

export function selectedPlanningRepairAdvice(advice: PlanningRepairAdviceStatus | undefined, selectedId: string) {
  const options = advice?.options ?? [];
  return options.find(option => option.id === selectedId)
    ?? options.find(option => option.id === advice?.recommendedOptionId)
    ?? options[0];
}

export function canAdoptPlanningRepairAdvice(
  advice: PlanningRepairAdviceStatus | undefined,
  selectedId: string,
  hasAuthorizedRecovery: boolean,
): boolean {
  return !hasAuthorizedRecovery && advice?.status === "ready" && Boolean(advice.adviceId)
    && selectedPlanningRepairAdvice(advice, selectedId)?.canResume === true;
}

export function authorizedPlanningRepairPayload(status: PlanningRepairStatus) {
  const request = status.recoveryRequest;
  if (!request || !status.planningRepair) throw new Error("没有可继续的已授权修复。");
  return {
    action: "retry" as const,
    repairKey: status.planningRepair.key,
    guidance: request.guidance,
    idempotencyKey: request.idempotencyKey,
    ...(request.executionMode ? { executionMode: request.executionMode } : {}),
    ...(request.affectedChapterIds ? { affectedChapterIds: request.affectedChapterIds } : {}),
  };
}
