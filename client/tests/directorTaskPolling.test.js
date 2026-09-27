import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { directorTaskPollInterval, directorTaskPollingOptions } from "../src/pages/novels/autoDirector/directorTaskPolling.ts";

// QueryObserver disables timers in server environments. Use its browser timer
// path without a DOM or a real server/model call.
globalThis.window = {};
const { QueryClient, QueryObserver, focusManager } = await import("@tanstack/react-query");
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("missing data and terminal snapshots remain observable; explicit 404 stops polling", () => {
  assert.equal(directorTaskPollInterval(undefined), 2000);
  assert.equal(directorTaskPollInterval(null), false);
  for (const status of ["queued", "running", "waiting_approval"]) {
    assert.equal(directorTaskPollInterval({ status }), 2000);
  }
  for (const status of ["failed", "cancelled", "succeeded"]) {
    assert.equal(directorTaskPollInterval({ status }), 5000);
  }
});

test("a failed first read recovers in a background tab and receives saved candidates", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const client = new QueryClient();
  focusManager.setFocused(false);
  let calls = 0;
  const observer = new QueryObserver(client, {
    ...directorTaskPollingOptions,
    queryKey: ["candidate-task"],
    queryFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary backend restart");
      if (calls === 2) return { data: { status: "failed" } };
      return { data: {
        status: "waiting_approval",
        checkpointType: "candidate_selection_required",
        meta: { seedPayload: { batches: [{ candidates: [{ id: "a" }, { id: "b" }] }] } },
      } };
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await flush();
    assert.equal(observer.getCurrentResult().status, "error");
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(observer.getCurrentResult().data.data.status, "failed");
    t.mock.timers.tick(5000);
    await flush();
    const task = observer.getCurrentResult().data.data;
    assert.equal(task.checkpointType, "candidate_selection_required");
    assert.equal(task.meta.seedPayload.batches[0].candidates.length, 2);
    assert.equal(calls, 3);
  } finally {
    unsubscribe();
    client.clear();
    focusManager.setFocused(undefined);
  }
});

test("retry applies optimistic progress before, not after, refreshing persisted state", () => {
  const source = fs.readFileSync(new URL("../src/pages/novels/autoDirector/useAutoDirectorCreateController.ts", import.meta.url), "utf8");
  const retry = source.slice(source.indexOf("const continueMutation = useMutation"));
  const completed = retry.slice(0, retry.indexOf("toast.success"));
  assert.match(source, /\.\.\.directorTaskPollingOptions/);
  assert.match(completed, /setExecutionRequested\(false\)/);
  assert.ok(completed.indexOf('setDialogMode("execution_progress")') < completed.indexOf("await Promise.allSettled(invalidations)"));
  assert.equal(directorTaskPollingOptions.refetchOnWindowFocus, true);
  assert.equal(directorTaskPollingOptions.refetchOnReconnect, true);
});
