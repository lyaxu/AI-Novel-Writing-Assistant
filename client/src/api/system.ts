import type { ApiResponse } from "@ai-novel/shared/types/api";
import type { HealthPayload } from "@ai-novel/shared/types/runtimeIdentity";
import { apiClient } from "./client";

/**
 * Health plus the identity of the process that answered.
 *
 * The runtime block is what makes "the fix is on disk but the running server has not reloaded it"
 * visible: `stale` and `newerSources` say so directly.
 */
export async function getServerHealth() {
  const { data } = await apiClient.get<ApiResponse<HealthPayload>>("/health");
  return data;
}
