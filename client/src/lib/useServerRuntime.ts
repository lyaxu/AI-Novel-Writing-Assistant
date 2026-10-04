import { useEffect, useState } from "react";
import type { RuntimeIdentity } from "@ai-novel/shared/types/runtimeIdentity";
import { getServerHealth } from "@/api/system";

const POLL_INTERVAL_MS = 30_000;

/**
 * The runtime identity of the server that is answering requests.
 *
 * Polled rather than fetched once: a source edit during a session is exactly when this matters, and
 * it is cheap (the server caches the directory walk).
 */
export function useServerRuntime(): RuntimeIdentity | null {
  const [runtime, setRuntime] = useState<RuntimeIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await getServerHealth();
        if (!cancelled) setRuntime(payload.data?.runtime ?? null);
      } catch {
        // A failed probe is not worth surfacing here; connectivity has its own surfaces.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return runtime;
}
