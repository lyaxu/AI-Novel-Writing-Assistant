/**
 * Identity of the process that is answering requests.
 *
 * `stale` answers one specific question that is otherwise invisible from the UI: were the sources
 * changed after this process started, so it is still running the previous code? A fix can be
 * committed, reviewed and compiled while the running server has not reloaded it, and the symptom
 * is indistinguishable from "the fix does not work".
 */
export interface RuntimeIdentity {
  pid: number;
  startedAt: string;
  nodeVersion: string;
  /** `source` when the process compiles TypeScript at runtime, `compiled` when it runs from dist. */
  executionMode: "source" | "compiled";
  /** Newest mtime across watched sources, or null when none could be read. */
  newestSourceMtime: string | null;
  /** Source files modified after this process started. Non-empty means a restart is required. */
  newerSources: string[];
  stale: boolean;
  /**
   * The commit this process started from. This is the one that describes the running code; reading
   * it at request time would report whatever was committed since, which is exactly the confusion
   * this type exists to remove.
   */
  gitHead: string | null;
  /** The commit on disk right now, for comparison. Informational only. */
  currentGitHead: string | null;
}

export interface HealthPayload {
  status: string;
  timestamp: string;
  runtime: RuntimeIdentity;
}
