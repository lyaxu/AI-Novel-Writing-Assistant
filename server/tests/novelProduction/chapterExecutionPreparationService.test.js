const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ChapterExecutionPreparationService,
} = require("../../dist/services/novel/production/preparation/ChapterExecutionPreparationService.js");

test("chapter preparation finishes planning writes before it reports ready", async () => {
  const calls = [];
  const service = new ChapterExecutionPreparationService({
    chapterPlanJITService: {
      ensureExecutionReady: async (_novelId, _chapterId, options) => {
        calls.push(["execution_contract", options]);
      },
    },
    planner: {
      ensureChapterPlan: async () => {
        calls.push(["chapter_plan"]);
        return { id: "plan-1" };
      },
    },
    loadEstimatedChapterCount: async () => 48,
  });

  const result = await service.prepare("novel-1", "chapter-1", {
    provider: "deepseek",
    model: "deepseek-chat",
    controlPolicy: {
      kickoffMode: "director_start",
      advanceMode: "full_book_autopilot",
      reviewCheckpoints: [],
      autoExecutionRange: { mode: "book" },
    },
  });

  assert.deepEqual(calls.map(([name]) => name), ["execution_contract", "chapter_plan"]);
  assert.equal(calls[0][1].completionProfile.targetChapterCount, 48);
  assert.equal(calls[0][1].prepareRouteWindow, true);
  assert.deepEqual(result, {
    status: "ready",
    mode: "full_book_autopilot",
    planId: "plan-1",
    preparedArtifacts: ["chapter_execution_contract", "chapter_plan"],
  });
});

for (const advanceMode of ["auto_to_execution", "stage_review", "auto_to_ready"]) {
  test(`${advanceMode} rechecks the saved contract before planning without extending routes`, async () => {
    const calls = [];
    const service = new ChapterExecutionPreparationService({
      chapterPlanJITService: {
        ensureExecutionReady: async (novelId, chapterId, options) => {
          calls.push(["contract", novelId, chapterId, options]);
        },
      },
      planner: { ensureChapterPlan: async () => { calls.push(["plan"]); return { id: "plan-3" }; } },
      loadEstimatedChapterCount: async () => { throw new Error("Contract review must not prepare the book route"); },
    });
    const result = await service.prepare("novel-1", "chapter-3", {
      workflowTaskId: "director-existing-budget",
      provider: "deepseek", model: "test-model",
      controlPolicy: { kickoffMode: "director_start", advanceMode, reviewCheckpoints: ["chapter_batch"] },
    });
    assert.deepEqual(calls.map(([name]) => name), ["contract", "plan"]);
    assert.equal(calls[0][3].prepareRouteWindow, false);
    assert.equal(calls[0][3].completionProfile, undefined);
    assert.equal(calls[0][3].taskId, "director-existing-budget");
    assert.equal(result.mode, advanceMode);
    assert.deepEqual(result.preparedArtifacts, ["chapter_execution_contract", "chapter_plan"]);
  });
}

test("a stale contract requiring confirmation blocks automatic preparation before chapter planning", async () => {
  const reviewError = Object.assign(new Error("Written facts conflict with the saved contract"), {
    code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED",
  });
  let planCalls = 0;
  const service = new ChapterExecutionPreparationService({
    chapterPlanJITService: { ensureExecutionReady: async () => { throw reviewError; } },
    planner: { ensureChapterPlan: async () => { planCalls += 1; return { id: "must-not-run" }; } },
    loadEstimatedChapterCount: async () => 80,
  });
  await assert.rejects(service.prepare("novel-1", "chapter-3", {
    workflowTaskId: "task-1",
    controlPolicy: { kickoffMode: "director_start", advanceMode: "auto_to_execution", reviewCheckpoints: [] },
  }), (error) => error === reviewError);
  assert.equal(planCalls, 0);
});

test("manual chapter preparation does not create an autopilot route window", async () => {
  let jitCalls = 0;
  const service = new ChapterExecutionPreparationService({
    chapterPlanJITService: {
      ensureExecutionReady: async () => {
        jitCalls += 1;
      },
    },
    planner: {
      ensureChapterPlan: async () => ({ id: "plan-manual" }),
    },
    loadEstimatedChapterCount: async () => 80,
  });

  const result = await service.prepare("novel-1", "chapter-1", {});

  assert.equal(jitCalls, 0);
  assert.equal(result.mode, "manual");
  assert.deepEqual(result.preparedArtifacts, ["chapter_plan"]);
});

test("sample preparation caps route prefetch without treating the sample as a complete book", async () => {
  let received;
  const service = new ChapterExecutionPreparationService({
    chapterPlanJITService: { ensureExecutionReady: async (_novelId, _chapterId, options) => { received = options; } },
    planner: { ensureChapterPlan: async () => ({ id: "sample-plan" }) },
    loadEstimatedChapterCount: async () => 80,
  });
  await service.prepare("novel-1", "chapter-2", {
    controlPolicy: {
      kickoffMode: "director_start", advanceMode: "full_book_autopilot", reviewCheckpoints: [],
      autoExecutionRange: { mode: "chapter_range", start: 1, end: 3 },
    },
  });
  assert.equal(received.endOrder, 3);
  assert.equal(received.completionProfile.targetChapterCount, 80);
  assert.equal(received.completionProfile.mode, "serial_book");
});
