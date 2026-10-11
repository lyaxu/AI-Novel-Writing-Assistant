import type { ApiResponse } from "@ai-novel/shared/types/api";
import { apiClient } from "@/api/client";
import type { ChapterProductionRecovery } from "./contracts";

export const recoveryQueryKey = (novelId: string, chapterId: string) => ["chapter-production-recovery", novelId, chapterId] as const;

export async function readChapterProductionRecovery(novelId: string, chapterId: string) {
  const { data } = await apiClient.get<ApiResponse<ChapterProductionRecovery | null>>(
    `/novels/${novelId}/chapters/${chapterId}/runtime/recovery`,
  );
  return data.data ?? null;
}

export async function acknowledgeChapterProductionRecovery(novelId: string, chapterId: string, operationId: string) {
  const { data } = await apiClient.post<ApiResponse<{ acknowledged: boolean }>>(
    `/novels/${novelId}/chapters/${chapterId}/runtime/recovery/acknowledge`,
    { operationId, acceptPossibleDuplicate: true },
  );
  return data.data;
}

export async function resumeChapterPipelineRecovery(novelId: string, chapterId: string, operationId: string) {
  const { data } = await apiClient.post<ApiResponse<{ jobId: string }>>(
    `/novels/${novelId}/chapters/${chapterId}/runtime/recovery/resume-pipeline`,
    { operationId },
  );
  return data.data;
}
