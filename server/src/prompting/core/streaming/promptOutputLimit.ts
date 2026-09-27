import type { LlmTokenUsageSnapshot } from "../../../llm/usageTracking";
import { reachedOutputLimit } from "../../../platform/llm/streaming/responseDiagnostics";

export class LlmOutputLimitError extends Error {
  readonly code = "LLM_OUTPUT_LIMIT";
  readonly category = "output_limit";
  constructor(readonly details: {
    finishReason: string | null;
    maxTokens?: number;
    tokenUsage: LlmTokenUsageSnapshot | null;
    reasoningTokens: number | null;
  }) {
    super("模型输出额度耗尽，已停止自动重试；请调整输出预算或模型思考设置后重试。");
    this.name = "LlmOutputLimitError";
  }
}

export function assertPromptOutputWithinLimit(input: {
  finishReason: string | null;
  maxTokens?: number;
  tokenUsage: LlmTokenUsageSnapshot | null;
}): void {
  if (reachedOutputLimit({ ...input, completionTokens: input.tokenUsage?.completionTokens })) {
    throw new LlmOutputLimitError({ ...input, reasoningTokens: input.tokenUsage?.reasoningTokens ?? null });
  }
}
