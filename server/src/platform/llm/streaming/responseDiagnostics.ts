export function extractFinishReason(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const value = output as {
    response_metadata?: Record<string, unknown>;
    responseMetadata?: Record<string, unknown>;
  };
  const metadata = value.response_metadata ?? value.responseMetadata;
  const reason = metadata?.finish_reason ?? metadata?.stop_reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export function reachedOutputLimit(input: {
  finishReason?: string | null;
  maxTokens?: number;
  completionTokens?: number;
}): boolean {
  if (input.finishReason === "length" || input.finishReason === "max_tokens") return true;
  // A vendor-provided normal stop wins over an inferred budget hit.
  if (input.finishReason) return false;
  return typeof input.maxTokens === "number" && input.maxTokens > 0
    && typeof input.completionTokens === "number" && input.completionTokens >= input.maxTokens;
}

export function resolveRepairOutputBudget(input: {
  finishReason?: string | null;
  maxTokens?: number;
  completionTokens?: number;
}): number | undefined {
  if (!reachedOutputLimit(input) || input.maxTokens === undefined) return input.maxTokens;
  // Bounded headroom for complex contracts; do not inflate every schema repair.
  return Math.max(input.maxTokens, Math.min(8_192, input.maxTokens * 2));
}

export function extractTransportErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return null;
}
