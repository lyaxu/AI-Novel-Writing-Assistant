const test = require("node:test");
const assert = require("node:assert/strict");
const { guardPlanningRepairWorkflowUpdate: guard, updateWorkflowTaskWithPlanningRepairGuard: update } =
  require("../dist/services/novel/workflow/planningRepairWorkflowWriteGuard.js");

function row(phase = "repairing", extra = {}) {
  return { id: "task", status: "running", cancelRequestedAt: null,
    seedPayloadJson: JSON.stringify({ planningRepair: { version: 1, key: "repair", phase, rounds: 2, maxRounds: 2, history: [] },
      planningRepairSnapshot: { token: "new" }, planningRepairRecoveryRequests: ["grant"],
      resumeTarget: "planning" }), ...extra };
}

test("stale progress preserves repair-owned fields and accepts unrelated progress", () => {
  const current = row();
  const desired = { seedPayloadJson: JSON.stringify({ planningRepair: { rounds: 0 },
    planningRepairRecovery: { fabricated: true }, autoExecution: { progress: 70 } }) };
  const result = JSON.parse(guard(current, desired).seedPayloadJson);
  assert.equal(result.planningRepair.rounds, 2);
  assert.equal(result.planningRepairSnapshot.token, "new");
  assert.deepEqual(result.planningRepairRecoveryRequests, ["grant"]);
  assert.equal(result.planningRepairRecovery, undefined);
  assert.equal(result.autoExecution.progress, 70);
  assert.equal(JSON.parse(desired.seedPayloadJson).planningRepair.rounds, 0);
});

for (const phase of ["waiting_confirmation", "uncertain"]) {
  test(`${phase} cannot be resumed by a stale progress writer`, () => {
    const result = guard(row(phase), { status: "running", pendingManualRecovery: false,
      checkpointSummary: "stale", progress: 100, seedPayloadJson: { set: JSON.stringify({ resumeTarget: "prose" }) } });
    for (const key of ["status", "pendingManualRecovery", "checkpointSummary", "progress"]) assert.equal(key in result, false);
    assert.equal(JSON.parse(result.seedPayloadJson.set).resumeTarget, "planning");
    assert.equal(guard(row(phase), { status: "cancelled" }).status, "cancelled");
  });
}

test("cancelled repair tasks keep cancellation and cannot return to running", () => {
  const date = new Date();
  const current = row("repairing", { status: "cancelled", cancelRequestedAt: date });
  assert.equal(guard(current, { status: "running" }).status, undefined);
  assert.strictEqual(guard(current, { status: "cancelled", cancelRequestedAt: null }).cancelRequestedAt, date);
});

for (const phase of ["assessing", "repairing", "reviewing", "ready", "committed"]) {
  test(`explicit retry releases cancellation for ${phase} without changing repair budget`, () => {
    const current = row(phase, { status: "cancelled", cancelRequestedAt: new Date() });
    const desired = { status: "queued", cancelRequestedAt: null, attemptCount: 3, seedPayloadJson: "{}" };
    const result = guard(current, desired, { explicitRetry: true });
    assert.equal(result.status, "queued");
    assert.equal(result.cancelRequestedAt, null);
    assert.equal(result.attemptCount, 3);
    assert.deepEqual(JSON.parse(result.seedPayloadJson).planningRepair, JSON.parse(current.seedPayloadJson).planningRepair);
    assert.equal(guard(current, desired).status, undefined);
  });
}

for (const phase of ["waiting_confirmation", "uncertain", "technical_failed"]) {
  test(`explicit retry does not bypass ${phase}`, () => {
    assert.throws(() => guard(row(phase, { status: "cancelled" }), {
      status: "queued", cancelRequestedAt: null,
    }, { explicitRetry: true }));
  });
}

test("explicit retry rejects an uncertain paid operation even if phase is resumable", () => {
  const current = row("assessing", { status: "cancelled" });
  const seed = JSON.parse(current.seedPayloadJson);
  seed.planningRepair.pendingOperation = { kind: "review", startedAt: "old" };
  current.seedPayloadJson = JSON.stringify(seed);
  assert.throws(() => guard(current, { status: "queued", cancelRequestedAt: null }, { explicitRetry: true }));
});

test("transaction rechecks repair state changed after explicit retry was requested", async () => {
  let wrote = false;
  const client = { $transaction: async run => run({ novelWorkflowTask: {
    findUniqueOrThrow: async () => row("waiting_confirmation", { status: "cancelled" }),
    update: async () => { wrote = true; },
  } }) };
  await assert.rejects(update(client, { where: { id: "task" }, data: {
    status: "queued", cancelRequestedAt: null,
  } }, { explicitRetry: true }));
  assert.equal(wrote, false);
});

test("ordinary writer cannot invent repair state and legacy updates remain unchanged", () => {
  const current = row("repairing", { seedPayloadJson: "{}" });
  const desired = { status: "running", seedPayloadJson: JSON.stringify({ foo: 1 }) };
  assert.deepEqual(guard(current, desired), desired);
  const injected = guard(current, { seedPayloadJson: JSON.stringify({ planningRepair: { rounds: 0 }, foo: 2 }) });
  assert.deepEqual(JSON.parse(injected.seedPayloadJson), { foo: 2 });
});

test("invalid seeds fail closed, null seed writes retain repair state", () => {
  assert.throws(() => guard(row(), { seedPayloadJson: "broken" }), /invalid/);
  assert.throws(() => guard(row("repairing", { seedPayloadJson: "broken" }), { seedPayloadJson: "{}" }), /unreadable/);
  assert.equal(JSON.parse(guard(row(), { seedPayloadJson: null }).seedPayloadJson).planningRepair.rounds, 2);
});

test("transaction reads fresh state and returns fresh notification before-image", async () => {
  const fresh = row();
  const events = [];
  let written;
  const client = { $transaction: async (run, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return run({ novelWorkflowTask: {
      findUniqueOrThrow: async () => { events.push("read"); return fresh; },
      update: async args => { events.push("write"); written = args; return { ...fresh, ...args.data }; },
    } });
  } };
  const result = await update(client, { where: { id: "task" }, data: { seedPayloadJson: "{}" } });
  assert.deepEqual(events, ["read", "write"]);
  assert.strictEqual(result.before, fresh);
  assert.equal(JSON.parse(written.data.seedPayloadJson).planningRepair.rounds, 2);
});
