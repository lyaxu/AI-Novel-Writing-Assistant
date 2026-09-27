import type { UnifiedTaskDetail } from "@ai-novel/shared/types/task";

type TaskSnapshot = Pick<UnifiedTaskDetail, "status">;

export function directorTaskPollInterval(task: TaskSnapshot | null | undefined): number | false {
  // Only an explicit not-found response stops observation. A failed read or a
  // failed task can recover without remounting this workspace.
  if (task === null) return false;
  if (!task || ["queued", "running", "waiting_approval"].includes(task.status)) return 2000;
  return 5000;
}

export const directorTaskPollingOptions = {
  retry: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: true,
  refetchInterval: (query: { state: { data?: { data?: TaskSnapshot | null } } }) =>
    directorTaskPollInterval(query.state.data?.data),
} as const;
