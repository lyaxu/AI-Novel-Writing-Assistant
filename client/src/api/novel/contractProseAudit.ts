import type { ApiResponse } from "@ai-novel/shared/types/api";
import { apiClient } from "../client";

/**
 * Contract-vs-prose audit for a novel.
 *
 * The reading judgment runs on the server through a registered prompt asset (one model call per
 * chapter that has prose), so this can take a while on a long book. Chapters without prose cost
 * nothing and are reported as not checked.
 */
export interface ContractProseAuditResult {
  report: {
    novelId: string;
    novelTitle: string;
    generatedAt: string;
    chapters: Array<{ chapterOrder: number; chapterTitle: string; skippedReason?: string; deterministic: string[] }>;
    findings: Array<{ chapterOrder: number; severity: string; message: string; detail?: string }>;
  };
  markdown: string;
}

export async function auditNovelContractProse(novelId: string, chapterOrders?: number[]) {
  const { data } = await apiClient.post<ApiResponse<ContractProseAuditResult>>(
    `/novels/${encodeURIComponent(novelId)}/contract-prose-audit`,
    chapterOrders?.length ? { chapterOrders } : {},
  );
  return data.data;
}
