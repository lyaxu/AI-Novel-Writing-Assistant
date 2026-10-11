import { AsyncLocalStorage } from "node:async_hooks";

/** The caller owns recovery when a paid invocation has an unknown outcome. */
const policy = new AsyncLocalStorage<{ preserveUnknownOutcome: boolean }>();
export function withUnknownOutcomeProtection<T>(action: () => T): T {
  return policy.run({ preserveUnknownOutcome: true }, action);
}
export function preservesUnknownOutcome(): boolean {
  return policy.getStore()?.preserveUnknownOutcome === true;
}
