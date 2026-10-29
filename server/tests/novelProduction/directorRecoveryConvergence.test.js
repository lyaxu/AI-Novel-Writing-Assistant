const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

const {
  planStalePlanningRepairConvergence,
  planTerminalRepairBindingCleanup,
  planDisplacedPipelineBindingConvergence,
} = loadRuntimeSource("../director/recovery/DirectorRecoveryConvergence.ts", {
  "@ai-novel/shared/types/planningRepair/recovery": require("@ai-novel/shared/types/planningRepair/recovery"),
});

function repair(patch = {}) {
  return { phase: "reviewing", pendingOperation: undefined, repairOutputPending: undefined, pendingGrant: undefined, ...patch };
}

test("a stale reviewing session with no in-flight marker is abandoned on explicit continue", () => {
  assert.deepEqual(planStalePlanningRepairConvergence({ repair: repair(), taskPaused: true, activeCommand: false }), { action: "abandon" });
});

for (const [reason, input] of Object.entries({
  "not paused": { repair: repair(), taskPaused: false, activeCommand: false },
  "active command": { repair: repair(), taskPaused: true, activeCommand: true },
  "pending operation": { repair: repair({ pendingOperation: { kind: "review" } }), taskPaused: true, activeCommand: false },
  "unapplied output": { repair: repair({ repairOutputPending: { round: 1 } }), taskPaused: true, activeCommand: false },
  "pending grant": { repair: repair({ pendingGrant: true }), taskPaused: true, activeCommand: false },
  "confirmation phase": { repair: repair({ phase: "waiting_confirmation" }), taskPaused: true, activeCommand: false },
  "uncertain phase": { repair: repair({ phase: "uncertain" }), taskPaused: true, activeCommand: false },
  "already abandoned": { repair: repair({ phase: "abandoned" }), taskPaused: true, activeCommand: false },
  "already committed": { repair: repair({ phase: "committed" }), taskPaused: true, activeCommand: false },
  "assessing is not auto-converged": { repair: repair({ phase: "assessing" }), taskPaused: true, activeCommand: false },
  "repairing is not auto-converged": { repair: repair({ phase: "repairing" }), taskPaused: true, activeCommand: false },
  "no repair": { repair: null, taskPaused: true, activeCommand: false },
})) {
  test(`stale reviewing convergence does not fire for ${reason}`, () => {
    assert.deepEqual(planStalePlanningRepairConvergence(input), { action: "none" });
  });
}

test("terminal repair sessions drop stale execution bindings, but never a pending grant", () => {
  assert.deepEqual(planTerminalRepairBindingCleanup({
    repair: { phase: "abandoned" }, hasRecoveryBinding: true, hasPipelineBinding: true, hasPendingGrant: false,
  }), { clear: true });
  assert.deepEqual(planTerminalRepairBindingCleanup({
    repair: { phase: "committed" }, hasRecoveryBinding: false, hasPipelineBinding: true, hasPendingGrant: false,
  }), { clear: true });
  assert.deepEqual(planTerminalRepairBindingCleanup({
    repair: { phase: "abandoned" }, hasRecoveryBinding: true, hasPipelineBinding: false, hasPendingGrant: true,
  }), { clear: false });
  assert.deepEqual(planTerminalRepairBindingCleanup({
    repair: { phase: "reviewing" }, hasRecoveryBinding: true, hasPipelineBinding: true, hasPendingGrant: false,
  }), { clear: false });
  assert.deepEqual(planTerminalRepairBindingCleanup({
    repair: null, hasRecoveryBinding: true, hasPipelineBinding: true, hasPendingGrant: false,
  }), { clear: false });
  assert.deepEqual(planTerminalRepairBindingCleanup({
    repair: { phase: "abandoned" }, hasRecoveryBinding: false, hasPipelineBinding: false, hasPendingGrant: false,
  }), { clear: false });
});

function job(patch = {}) {
  return {
    id: "displaced-job", novelId: "novel", status: "failed", pendingManualRecovery: true,
    startOrder: 5, endOrder: 5, payloadWorkflowTaskId: "director",
    payload: JSON.stringify({ workflowTaskId: "director" }),
    llmCallCount: 0, totalTokens: 0, completedCount: 0,
    cancelRequestedAt: null, leaseActive: false, ...patch,
  };
}

function evidence(patch = {}) {
  const original = job({ id: "original-job" });
  return {
    seedPipelineJobId: "displaced-job",
    seedPipelineStatus: "failed",
    displacedJob: job(),
    originalJob: original,
    activeJobInNovel: false,
    activeCommand: false,
    repairTerminalOrAbsent: true,
    chapter: { id: "chapter-5", order: 5, hasProse: false, fingerprintMatchesJournal: true },
    journal: {
      operationId: "pipeline:original-job:chapter-5", status: "paused", entry: "pipeline",
      workflowTaskId: "director", expiresAt: 1000, chapterId: "chapter-5", hasUncertainStep: false,
    },
    now: 2000,
    ...patch,
  };
}

test("a zero-effect displaced failed job re-points at the journal-owning original job", () => {
  assert.deepEqual(planDisplacedPipelineBindingConvergence(evidence()), {
    displacedJobId: "displaced-job", originalJobId: "original-job", originalJobStatus: "failed",
  });
});

for (const [reason, patch] of Object.entries({
  "another active job": { activeJobInNovel: true },
  "an active command": { activeCommand: true },
  "a live planning repair": { repairTerminalOrAbsent: false },
  "already succeeded binding": { seedPipelineStatus: "succeeded" },
  "same job identity": { seedPipelineJobId: "original-job" },
  "missing displaced job": { displacedJob: null },
  "missing original job": { originalJob: null },
  "original completed instead of paused": { originalJob: job({ id: "original-job", status: "succeeded" }) },
  "displaced job with model calls": { displacedJob: job({ llmCallCount: 2 }) },
  "displaced job with tokens": { displacedJob: job({ totalTokens: 100 }) },
  "displaced job with completed work": { displacedJob: job({ completedCount: 1 }) },
  "displaced job cancelled": { displacedJob: job({ cancelRequestedAt: new Date(1) }) },
  "displaced job lease active": { displacedJob: job({ leaseActive: true }) },
  "different request payload": { displacedJob: job({ payload: JSON.stringify({ workflowTaskId: "director", model: "x" }) }) },
  "different parent task": { displacedJob: job({ payloadWorkflowTaskId: "other" }) },
  "different range": { displacedJob: job({ endOrder: 6 }) },
  "journal owned by displaced job": { journal: { ...evidence().journal, operationId: "pipeline:displaced-job:chapter-5" } },
  "journal owned by another chapter": { journal: { ...evidence().journal, chapterId: "chapter-6" } },
  "journal not paused": { journal: { ...evidence().journal, status: "completed" } },
  "journal lease still active": { journal: { ...evidence().journal, expiresAt: 3000 } },
  "journal with unknown call": { journal: { ...evidence().journal, hasUncertainStep: true } },
  "journal with wrong parent": { journal: { ...evidence().journal, workflowTaskId: "other" } },
  "journal with wrong entry": { journal: { ...evidence().journal, entry: "stream" } },
  "changed manuscript": { chapter: { ...evidence().chapter, fingerprintMatchesJournal: false } },
  "chapter outside job range": { chapter: { ...evidence().chapter, order: 9 } },
  "chapter already has prose": { chapter: { ...evidence().chapter, hasProse: true } },
  "missing chapter": { chapter: null },
  "missing journal": { journal: null },
})) {
  test(`displaced binding convergence refuses ${reason}`, () => {
    assert.equal(planDisplacedPipelineBindingConvergence(evidence(patch)), null);
  });
}
