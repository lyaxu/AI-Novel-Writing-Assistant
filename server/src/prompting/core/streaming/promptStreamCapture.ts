import type { BaseMessageChunk } from "@langchain/core/messages";
import { ReasoningStreamCollector } from "../../../llm/reasoning";
import {
  extractLlmTokenUsage,
  mergeStreamTokenUsage,
  type LlmTokenUsageSnapshot,
} from "../../../llm/usageTracking";
import { toText } from "../../../services/novel/novelP0Utils";
import { extractFinishReason } from "../../../platform/llm/streaming/responseDiagnostics";

// Consumers often await completion only after reading the stream. Observe early
// failures immediately, but return the original promise so await still rejects.
export function observeStreamCompletion<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

export function captureStreamOutput(
  rawStream: AsyncIterable<BaseMessageChunk>,
  onChunk?: (content: string) => void,
  onReasoning?: (content: string) => void,
): {
  stream: AsyncIterable<BaseMessageChunk>;
  completedText: Promise<string>;
  completedUsage: Promise<LlmTokenUsageSnapshot | null>;
  getFinishReason: () => string | null;
} {
  let finishReason: string | null = null;
  let resolveText!: (value: string) => void;
  let rejectText!: (reason?: unknown) => void;
  let resolveUsage!: (value: LlmTokenUsageSnapshot | null) => void;
  let rejectUsage!: (reason?: unknown) => void;
  const completedText = observeStreamCompletion(new Promise<string>((resolve, reject) => {
    resolveText = resolve;
    rejectText = reject;
  }));
  const completedUsage = observeStreamCompletion(new Promise<LlmTokenUsageSnapshot | null>((resolve, reject) => {
    resolveUsage = resolve;
    rejectUsage = reject;
  }));

  const stream = {
    async *[Symbol.asyncIterator]() {
      const chunks: string[] = [];
      let usage: LlmTokenUsageSnapshot | null = null;
      let settled = false;
      const reasoningCollector = new ReasoningStreamCollector();
      try {
        for await (const chunk of rawStream) {
          const content = toText(chunk.content);
          chunks.push(content);
          onChunk?.(content);
          onReasoning?.(reasoningCollector.push(chunk, content));
          usage = mergeStreamTokenUsage(usage, extractLlmTokenUsage(chunk));
          finishReason = extractFinishReason(chunk) ?? finishReason;
          yield chunk;
        }
        onReasoning?.(reasoningCollector.flush());
        settled = true;
        resolveText(chunks.join(""));
        resolveUsage(usage);
      } catch (error) {
        settled = true;
        rejectText(error);
        rejectUsage(error);
        throw error;
      } finally {
        if (!settled) {
          const error = new Error("Model stream consumption was cancelled before completion.");
          error.name = "AbortError";
          rejectText(error);
          rejectUsage(error);
        }
      }
    },
  };

  return { stream, completedText, completedUsage, getFinishReason: () => finishReason };
}
