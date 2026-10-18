import type { ApiResponse } from "@ai-novel/shared/types/api";
import type { PlanningRepairAdviceStatus } from "@ai-novel/shared/types/planningRepair/advice";
import type { PlanningRepairRecoveryMode } from "@ai-novel/shared/types/planningRepair/recovery";
export type { PlanningRepairAdviceStatus, PlanningRepairAdviceOption } from "@ai-novel/shared/types/planningRepair/advice";
import { apiClient } from "../client";

export interface PlanningRepairStatus {
  taskId: string;
  novelId: string | null;
  status: string;
  pendingManualRecovery: boolean;
  cancelRequestedAt?: string | null;
  recoveryRequest?: { idempotencyKey: string; guidance: string; executionMode?: PlanningRepairRecoveryMode; affectedChapterIds?: string[]; candidateRecoveryToken?: string; initialContractToken?: string } | null;
  planningRepair: {
    version: 1;
    key: string;
    novelId: string;
    volumeId: string;
    chapterId: string;
    chapterOrder: number;
    rounds: number;
    maxRounds?: number;
    phase: "assessing" | "repairing" | "reviewing" | "ready" | "committed" | "waiting_confirmation" | "uncertain" | "technical_failed" | "abandoned";
    summary: string;
    quality?: unknown;
    history: unknown[];
    guidance?: string;
    candidateVersionId?: string;
    initialGenerationAttempts?: number;
    affectedChapterIds?: string[];
    technicalError?: string;
    pendingOperation?: { kind: string; startedAt: string };
  } | null;
}

export const planningRepairQueryKey = (taskId: string) => ["planning-repair", "task", taskId] as const;
export const novelPlanningRepairQueryKey = (novelId: string) => ["planning-repair", "novel", novelId] as const;
export const planningRepairAdviceQueryKey = (taskId: string) => ["planning-repair", "advice", taskId] as const;
export const planningReviewExistingQueryKey = (taskId: string) => ["planning-repair", "review-existing", taskId] as const;
export const planningResumePolicyQueryKey = (taskId: string) => ["planning-repair", "resume-policy", taskId] as const;
export const planningInitialContractQueryKey = (taskId: string) => ["planning-repair", "initial-contract", taskId] as const;
export type PlanningInitialContractStatus = { available: false; reason?: string } | {
  available: true; token: string; initialGenerationAttempts: number | null; correctionAttempts: number;
  chapterOrder: number; startOrder: number; endOrder: number; remainingRounds: number; correctionCalls: 1;
};
export async function getPlanningInitialContract(taskId: string) {
  const { data } = await apiClient.get<ApiResponse<PlanningInitialContractStatus>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/initial-contract`);
  return data.data;
}
export async function correctInitialPlanningContract(taskId: string, payload: { repairKey: string; token: string; idempotencyKey: string }) {
  const { data } = await apiClient.post<ApiResponse<unknown>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/initial-contract`, payload);
  return data.data;
}
export type PlanningReviewExistingStatus = { available: false } | {
  available: true; token: string; candidateVersionId: string; chapterOrder: number; startOrder: number; endOrder: number; remainingRounds: number;
  requiresUnknownAcknowledgement: boolean;
};
export async function getPlanningResumePolicy(taskId: string) {
  const { data } = await apiClient.get<ApiResponse<PlanningReviewExistingStatus>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/resume-policy`);
  return data.data;
}
export async function resumeOriginalPlanningPolicy(taskId: string, payload: { repairKey: string; token: string; idempotencyKey: string }) {
  const { data } = await apiClient.post<ApiResponse<unknown>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/resume-policy`, payload);
  return data.data;
}
export async function getPlanningReviewExisting(taskId: string) {
  const { data } = await apiClient.get<ApiResponse<PlanningReviewExistingStatus>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/review-existing`);
  return data.data;
}
export async function reviewExistingPlanningCandidate(taskId: string, payload: { repairKey: string; token: string; idempotencyKey: string }) {
  const { data } = await apiClient.post<ApiResponse<unknown>>(`/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/review-existing`, payload);
  return data.data;
}

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

/**
 * Give up on this task's repair session.
 *
 * Not part of `actOnPlanningRepair`: the actions there ask the same stuck session for another
 * attempt, which is exactly what the user has already tried several times by this point.
 */
export async function abandonPlanningRepair(taskId: string, reason?: string) {
  const { data } = await apiClient.post<ApiResponse<{ phase: string; abandonedAt?: string; abandonedRounds?: number }>>(
    `/novel-workflows/${encodeURIComponent(taskId)}/planning-repair/abandon`,
    reason?.trim() ? { reason: reason.trim() } : {},
  );
  return data.data;
}
