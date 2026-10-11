import { AsyncLocalStorage } from "node:async_hooks";
import type { BaseMessageChunk } from "@langchain/core/messages";
import type { ChapterProductionSession } from "./session";
import { withUnknownOutcomeProtection } from "../../../../llm/invocation/executionPolicy";

const execution = new AsyncLocalStorage<ChapterProductionSession>();

export function currentProductionSession(): ChapterProductionSession | undefined {
  return execution.getStore();
}

export function withProductionSession<T>(session: ChapterProductionSession, action: () => T): T {
  return execution.run(session, () => withUnknownOutcomeProtection(action));
}

export function productionStep<T>(key: string, action: () => Promise<T>, external = false): Promise<T> {
  return currentProductionSession()?.runStep(key, action, { external }) ?? action();
}

// Persist before yielding: even an SSE disconnect retains all delivered text.
// This is deliberately separate from Chapter.content and never certifies a draft.
export async function* captureProductionStream(
  stream: AsyncIterable<BaseMessageChunk>,
): AsyncIterable<BaseMessageChunk> {
  const session = currentProductionSession();
  let partial = "";
  for await (const chunk of stream) {
    await session?.assertCurrent();
    const text = typeof chunk.content === "string" ? chunk.content : chunk.content.map(part => (
      typeof part === "string" ? part : part.type === "text" && typeof part.text === "string" ? part.text : ""
    )).join("");
    if (text) {
      partial += text;
      await session?.checkpoint(partial);
    }
    yield chunk;
  }
}
