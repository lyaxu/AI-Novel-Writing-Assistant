const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

const sharedRecovery = require("@ai-novel/shared/types/planningRepair/recovery");

// Wiring-level test for the explicit-continue convergence: a stale repair session is ended, the
// saved candidate is adopted, and only then is the lost-anchor execution binding rebuilt. Every
// write is a stubbed factory here; the individual services keep their own transactional tests.
function fixture({ activeCommand = false, preserve = false } = {}) {
  const calls = [];
  const task = {
    id: "director",
    novelId: "novel",
    lane: "auto_director",
    status: "running",
    pendingManualRecovery: true,
    cancelRequestedAt: null,
    updatedAt: new Date(1000),
    seedPayloadJson: JSON.stringify({
      autoExecution: { enabled: true, mode: "chapter_range", startOrder: 1, endOrder: 3, pipelineJobId: "old-job", nextChapterId: "chapter-1", nextChapterOrder: 1 },
      planningRepair: { version: 1, key: "repair", phase: "reviewing", candidateVersionId: "candidate", history: [], rounds: 0, maxRounds: 2 },
    }),
  };
  const prisma = {
    novelWorkflowTask: { findUnique: async () => ({ ...task }) },
    directorRunCommand: { count: async () => (activeCommand ? 1 : 0) },
  };
  const convergence = loadRuntimeSource("../director/recovery/DirectorRecoveryConvergenceService.ts", {
    "@ai-novel/shared/types/planningRepair/recovery": sharedRecovery,
    "../../../../db/prisma": { prisma },
    "../../production/recovery": {
      createChapterPipelineRecoveryService: () => ({ reconcileStaleCompletedChapterJob: async () => null }),
    },
    "../../production/reliability": { chapterFingerprint: () => "fingerprint" },
    "../../volume/planningRepair/PlanningRepairStore": {
      planningRepairStore: {
        abandon: async () => {
          calls.push("abandon");
          const seed = JSON.parse(task.seedPayloadJson);
          task.seedPayloadJson = JSON.stringify({ ...seed, planningRepair: { ...seed.planningRepair, phase: "abandoned" } });
        },
      },
    },
    "../../novelCoreShared": { logPipelineInfo: () => {}, logPipelineWarn: () => {} },
    "./DirectorRecoveryConvergence": loadRuntimeSource("../director/recovery/DirectorRecoveryConvergence.ts", {
      "@ai-novel/shared/types/planningRepair/recovery": sharedRecovery,
    }),
    "./PlanRepairExecutionRebuildService": {
      createPlanRepairExecutionRebuildService: () => ({
        converge: async (input) => {
          calls.push(["rebuild", JSON.parse(input.seed.autoExecution ? JSON.stringify(input.seed) : "{}")]);
          return { changed: false, action: null, reason: "no_saved_pipeline_job" };
        },
      }),
    },
    "./PlanningRepairCandidateAdoptionService": {
      createPlanningRepairCandidateAdoptionService: () => ({
        adopt: async (input) => {
          calls.push(["adopt", input.task.id]);
          const seed = JSON.parse(input.task.seedPayloadJson);
          const next = { ...seed, planningRepairCandidateAdoption: { version: 1, candidateVersionId: "candidate" } };
          task.seedPayloadJson = JSON.stringify(next);
          return { changed: true, adopted: true, reason: null, versionId: "candidate", chapterId: "chapter-1", chapterOrder: 1 };
        },
      }),
    },
  });
  const service = new convergence.DirectorRecoveryConvergenceService();
  return {
    service, task, calls,
    run: () => service.converge({
      taskId: "director",
      trigger: "director_command:continue",
      preservePlanningRepairSession: preserve,
    }),
  };
}

test("plain continue converges the stale repair, then adopts the candidate, then rebuilds execution", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.changed, true);
  const ordered = f.calls.filter(entry => entry === "abandon" || Array.isArray(entry)).map(entry => (Array.isArray(entry) ? entry[0] : entry));
  assert.deepEqual(ordered, ["abandon", "adopt", "rebuild"]);
  const rebuild = f.calls.find(entry => Array.isArray(entry) && entry[0] === "rebuild");
  assert.equal(rebuild[1].planningRepair.phase, "abandoned", "the rebuild runs against the converged terminal repair");
  assert.deepEqual(rebuild[1].planningRepairCandidateAdoption, { version: 1, candidateVersionId: "candidate" });
  assert.ok(result.actions.includes("abandoned_stale_planning_repair"));
  assert.ok(result.actions.includes("adopted_planning_repair_candidate"));
});

test("an explicit repair authorization preserves the session and never adopts its candidate", async () => {
  const f = fixture({ preserve: true });
  const result = await f.run();
  assert.equal(result.changed, false);
  assert.equal(f.calls.some(entry => entry === "abandon" || (Array.isArray(entry) && entry[0] === "adopt")), false);
  assert.equal(f.calls.some(entry => Array.isArray(entry) && entry[0] === "rebuild"), true);
});

test("an active command blocks the stale-repair conversion and candidate adoption", async () => {
  const f = fixture({ activeCommand: true });
  await f.run();
  assert.equal(f.calls.some(entry => entry === "abandon" || (Array.isArray(entry) && entry[0] === "adopt")), false);
});
