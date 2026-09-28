import type { ApiResponse } from "@ai-novel/shared/types/api";
import type { PlanningRepairAdviceStatus } from "@ai-novel/shared/types/planningRepair/advice";
export type { PlanningRepairAdviceStatus, PlanningRepairAdviceOption } from "@ai-novel/shared/types/planningRepair/advice";
import { apiClient } from "../client";

export interface PlanningRepairStatus {
  taskId: string;
  novelId: string | null;
  status: string;
  pendingManualRecovery: boolean;
  recoveryRequest?: { idempotencyKey: string; guidance: string; executionMode?: "repair_then_review" | "review_existing"; affectedChapterIds?: string[] } | null;
  planningRepair: {
    version: 1;
    key: string;
    novelId: string;
    volumeId: string;
    chapterId: string;
    chapterOrder: number;
    rounds: number;
    maxRounds?: number;
    phase: "assessing" | "repairing" | "reviewing" | "ready" | "committed" | "waiting_confirmation" | "uncertain" | "technical_failed";
    summary: string;
    quality?: unknown;
    history: unknown[];
    guidance?: string;
    candidateVersionId?: string;
    affectedChapterIds?: string[];
    technicalError?: string;
    pendingOperation?: { kind: string; startedAt: string };
  } | null;
}

export const planningRepairQueryKey = (taskId: string) => ["planning-repair", "task", taskId] as const;
export const novelPlanningRepairQueryKey = (novelId: string) => ["planning-repair", "novel", novelId] as const;
export const planningRepairAdviceQueryKey = (taskId: string) => ["planning-repair", "advice", taskId] as const;

export async function getPlanningRepairAdvice(taskId: string) {
  const { data } = await apiClient.get<ApiResponse<PlanningRepairAdviceStatus>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/advice`);
  return data.data;
}

export async function requestPlanningRepairAdvice(taskId: string, payload: { repairKey: string; idempotencyKey: string }) {
  const { data } = await apiClient.post<ApiResponse<PlanningRepairAdviceStatus>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/advice`, payload);
  return data.data;
}

export async function selectPlanningRepairAdvice(taskId: string, payload: { repairKey: string; adviceId: string; optionId: string; idempotencyKey: string }) {
  const { data } = await apiClient.post<ApiResponse<unknown>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/advice/select`, payload);
  return data.data;
}

export async function getPlanningRepairStatus(taskId: string) {
  const { data } = await apiClient.get<ApiResponse<PlanningRepairStatus>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair`);
  return data.data;
}

export async function getNovelPlanningRepairStatus(novelId: string) {
  const { data } = await apiClient.get<ApiResponse<PlanningRepairStatus | null>>(`/novel-workflows/novels/${encodeURIComponent(novelId)}/planning-repair`);
  return data.data;
}

export async function actOnPlanningRepair(taskId: string, payload:
  | { action: "pause"; repairKey: string }
  | { action: "retry"; repairKey: string; guidance: string; idempotencyKey: string; executionMode?: "repair_then_review" | "review_existing"; affectedChapterIds?: string[] },
) {
  const { data } = await apiClient.post<ApiResponse<unknown>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/actions`, payload);
  return data.data;
}
