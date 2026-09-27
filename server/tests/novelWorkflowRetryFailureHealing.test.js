const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../dist/db/prisma.js");
const { NovelWorkflowHealingService } = require("../dist/services/novel/workflow/NovelWorkflowHealingService.js");

for (const scenario of [
  { name: "old failure cannot undo a resumed world setup after command dispatch", failedAt: "2026-09-27T14:50:32.385Z", heal: false },
  { name: "a failure after resume still terminates the running task", failedAt: "2026-09-27T15:04:00.000Z", heal: true },
  { name: "legacy failure without a finish time uses the step update time", failedAt: null, heal: false },
]) {
  test(scenario.name, async () => {
    const row = {
      id: "retry-task", lane: "auto_director", novelId: "novel-1", status: "running",
      seedPayloadJson: "{}", pendingManualRecovery: false, cancelRequestedAt: null,
      lastError: null, finishedAt: null,
    };
    const writes = [];
    const originals = {
      command: prisma.directorRunCommand.findFirst,
      step: prisma.directorStepRun.findFirst,
      event: prisma.directorEvent.findFirst,
    };
    prisma.directorRunCommand.findFirst = async () => null;
    prisma.directorStepRun.findFirst = async () => ({
      status: "failed", label: "准备本书世界", error: "timeout",
      finishedAt: scenario.failedAt ? new Date(scenario.failedAt) : null,
      updatedAt: new Date("2026-09-27T14:50:32.385Z"),
    });
    prisma.directorEvent.findFirst = async ({ where }) => {
      assert.deepEqual(where, { taskId: row.id, type: "run_resumed" });
      return { occurredAt: new Date("2026-09-27T14:58:13.700Z") };
    };
    const service = new NovelWorkflowHealingService({
      updateTaskWithRetry: async (input) => { writes.push(input); return row; },
    });
    try {
      assert.equal(await service.healRuntimeFailedState(row.id, row), scenario.heal);
      assert.equal(writes.length, scenario.heal ? 1 : 0);
      if (scenario.heal) assert.equal(writes[0].data.status, "failed");
    } finally {
      prisma.directorRunCommand.findFirst = originals.command;
      prisma.directorStepRun.findFirst = originals.step;
      prisma.directorEvent.findFirst = originals.event;
    }
  });
}
