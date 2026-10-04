const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Every DB/event boundary is replaced before evaluating source. These tests cannot open a DB.
function load(filename, imports) {
  const sourcePath = path.resolve(__dirname, "../src/services/novel/volume", filename);
  const source = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require, exports) { ${source}\n})`, { filename: sourcePath })((id) => {
    if (!Object.hasOwn(imports, id)) throw new Error(`Unmocked dependency: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

const utils = load("volumePlanUtils.ts", {
  "node:crypto": require("node:crypto"), zod: require("zod"),
  "./volumePlanChangeDetection": load("volumePlanChangeDetection.ts", {}),
});
const workspace = load("volumeWorkspaceDocument.ts", {
  "@ai-novel/shared/types/volumeBeatSlots": require("../../shared/dist/types/volumeBeatSlots.js"),
  "./volumePlanUtils": utils,
});
const volumeStatus = load("volumeGenerationHelpers.ts", {
  "./volumeWorkspaceDocument": workspace,
  "./volumeChapterBudgetAllocation": {},
  "./chapterDetail": {},
});
const copy = (value) => structuredClone(value);
const epoch = new Date(0).toISOString();

function fixture({ active = true, materialized = true, realPersistence = false } = {}) {
  const document = workspace.buildVolumeWorkspaceDocument({
    novelId: "n", source: "volume", activeVersionId: active ? "v1" : null,
    volumes: [1, 2].map((v) => ({
      id: `vol${v}`, novelId: "n", sortOrder: v, title: `Volume ${v}`, status: "active",
      sourceVersionId: active ? "v1" : null, openPayoffs: [], createdAt: epoch, updatedAt: epoch,
      chapters: Array.from({ length: v === 1 ? 5 : 1 }, (_, i) => {
        const order = v === 1 ? i + 1 : 6;
        return {
          id: `p${order}`, volumeId: `vol${v}`, chapterId: materialized ? `c${order}` : null,
          chapterOrder: order, title: `Chapter ${order}`, summary: `Summary ${order}`, purpose: "Purpose",
          taskSheet: "Original contract", sceneCards: null, targetWordCount: 2000,
          conflictLevel: 2, conflictLevelSource: "ai", payoffRefs: [], createdAt: epoch, updatedAt: epoch,
        };
      }),
    })),
  });
  const rowsFrom = (doc, sourceVersionId) => doc.volumes.map((volume) => ({
    ...copy(volume), sourceVersionId,
    chapters: volume.chapters.map((chapter) => ({ ...copy(chapter), payoffRefsJson: JSON.stringify(chapter.payoffRefs) })),
  }));
  let db = {
    novel: { id: "n", title: "Novel", outline: document.derivedOutline, structuredOutline: document.derivedStructuredOutline, updatedAt: epoch },
    task: { id: "t", novelId: "n", lane: "auto_director", status: "running", attemptCount: 1, startedAt: epoch,
      cancelRequestedAt: null, seedPayloadJson: JSON.stringify({ untouched: { setting: 42 } }) },
    volumes: rowsFrom(document, active ? "v1" : null),
    versions: active ? [{ id: "v1", novelId: "n", version: 1, status: "active", contentJson: JSON.stringify(document), updatedAt: epoch }] : [],
    chapters: materialized ? document.volumes.flatMap((v) => v.chapters).map((c) => ({
      id: c.chapterId, novelId: "n", order: c.chapterOrder, title: c.title,
      content: "", generationState: "planned", chapterStatus: "unplanned", updatedAt: epoch,
      expectation: c.summary, taskSheet: c.taskSheet, sceneCards: null, targetWordCount: 2000, conflictLevel: 2,
    })) : [],
    macro: { novelId: "n", lockedFieldsJson: "{}", updatedAt: epoch },
    stale: [], arcs: [],
  };
  let failure;
  let casFailure = false;
  let invalidShape = false;
  // Simulates a concurrent writer (the auto-execution progress sync) committing between the
  // repair's session read and its CAS write. It fires on the Nth novelWorkflowTask.findUnique
  // of the transaction: the store reads the row once for the session guard, once for casSeed.
  let taskReadRace = null;
  let counter = 10;
  const events = [];
  const chapterWrites = [];
  const options = [];
  const otherTasks = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (value && typeof value === "object" && "not" in value) return row[key] !== value.not;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const tx = {
    generationJob: { findFirst: async () => db.activeJob ?? null },
    directorRunCommand: { findFirst: async () => db.activeCommand ?? null },
    novelWorkflowTask: {
      findUnique: async ({ where }) => {
        if (taskReadRace && db.task.id === where.id) {
          taskReadRace.remaining -= 1;
          if (taskReadRace.remaining <= 0) {
            const mutate = taskReadRace.mutate;
            taskReadRace = null;
            mutate(db.task);
          }
        }
        return db.task.id === where.id ? copy(db.task) : null;
      },
      findMany: async ({ where }) => copy(otherTasks.filter((row) => matches(row, where))),
      updateMany: async ({ where, data }) => {
        if (casFailure || !matches(db.task, where)) return { count: 0 };
        Object.assign(db.task, data); return { count: 1 };
      },
    },
    novel: {
      findUnique: async () => copy(db.novel),
      update: async ({ data }) => { Object.assign(db.novel, copy(data)); return copy(db.novel); },
    },
    volumePlan: {
      findMany: async () => copy(db.volumes),
      update: async ({ where, data }) => {
        const row = db.volumes.find((v) => v.id === where.id);
        assert.ok(row); Object.assign(row, copy(data)); return copy(row);
      },
      create: async ({ data }) => { db.volumes.push({ ...copy(data), chapters: [] }); return copy(data); },
      deleteMany: async ({ where }) => {
        db.volumes = db.volumes.filter((v) => !matches(v, where)); return { count: 0 };
      },
    },
    volumeChapterPlan: {
      update: async ({ where, data }) => {
        const row = db.volumes.flatMap((v) => v.chapters).find((c) => c.id === where.id);
        assert.ok(row); Object.assign(row, copy(data)); return copy(row);
      },
      create: async ({ data }) => {
        db.volumes.find((v) => v.id === data.volumeId).chapters.push(copy(data)); return copy(data);
      },
      deleteMany: async ({ where }) => {
        db.volumes.forEach((v) => { v.chapters = v.chapters.filter((c) => !matches(c, where)); }); return { count: 0 };
      },
    },
    volumePlanVersion: {
      findMany: async ({ where }) => copy(db.versions.filter((v) => matches(v, where))),
      findFirst: async ({ where, orderBy }) => {
        const rows = db.versions.filter((v) => matches(v, where));
        if (orderBy?.version === "desc") rows.sort((a, b) => b.version - a.version);
        return copy(rows[0] ?? null);
      },
      create: async ({ data }) => {
        const version = { id: `v${++counter}`, updatedAt: epoch, ...copy(data) };
        db.versions.push(version); return copy(version);
      },
      update: async ({ where, data }) => {
        const version = db.versions.find((v) => matches(v, where));
        assert.ok(version); Object.assign(version, copy(data)); return copy(version);
      },
      updateMany: async ({ where, data }) => {
        const versions = db.versions.filter((v) => matches(v, where));
        versions.forEach((v) => Object.assign(v, copy(data))); return { count: versions.length };
      },
    },
    chapter: {
      findMany: async () => copy(db.chapters),
      updateMany: async ({ where, data }) => {
        const rows = db.chapters.filter((r) => matches(r, where));
        rows.forEach((r) => { Object.assign(r, copy(data)); chapterWrites.push(r.id); });
        return { count: rows.length };
      },
    },
    storyMacroPlan: { findUnique: async () => copy(db.macro) },
    storyPlan: {
      findFirst: async ({ where }) => copy(db.arcs.find((row) => matches(row, where)) ?? null),
      create: async ({ data }) => { const row = { id: `arc${db.arcs.length}`, ...copy(data) }; db.arcs.push(row); return copy(row); },
      update: async ({ where, data }) => { Object.assign(db.arcs.find((row) => matches(row, where)), copy(data)); },
      deleteMany: async () => ({ count: 0 }),
      updateMany: async ({ where }) => {
      if (failure === "invalidation") throw new Error("invalidation failed");
      db.stale.push(...where.chapterId.in); return { count: where.chapterId.in.length };
    } },
  };
  const prisma = { $transaction: async (runner, settings) => {
    options.push(settings);
    const before = copy(db);
    const writesBefore = chapterWrites.length;
    try { return await runner(tx); } catch (error) {
      db = before; chapterWrites.length = writesBefore; throw error;
    }
  } };
  Object.assign(prisma, tx);
  const persistence = load("volumeWorkspacePersistence.ts", {
    "../../../db/prisma": { prisma },
    "../../../db/sqliteRetry": { withSqliteRetry: (runner) => runner() },
    "./volumePlanUtils": utils,
    "./volumeModels": { mapVolumeRow: (row) => copy(row) },
    "./volumeWorkspaceDocument": workspace,
  });
  const imports = {
    "node:crypto": require("node:crypto"),
    "@ai-novel/shared/types/chapterTaskSheetQuality": { assessChapterExecutionContractShape: () => ({ canEnterExecution: !invalidShape }) },
    "../../../../db/prisma": { prisma },
    "../../../../db/sqliteRetry": { withSqliteRetry: (runner) => runner() },
    "../../../../events/EventBus": { novelEventBus: { emit: async (event) => events.push(event) } },
    "../../runtime/BatchContextCache": { batchContextCache: { invalidate: (novelId) => events.push({ invalidated: novelId }) } },
    "../volumeWorkspaceDocument": workspace,
    "../volumeModels": { mapVolumeRow: (row) => copy(row) },
    "../writtenEvidence": load("writtenEvidence/evidencePolicy.ts", { "node:crypto": require("node:crypto") }),
    "@ai-novel/shared/types/novel/planningPromises": { selectedPlanningCandidateSchema: require("zod").z.object({ id: require("zod").z.string() }).passthrough() },
    "../volumeGenerationHelpers": volumeStatus,
    "../volumeWorkspacePersistence": {
      VOLUME_WORKSPACE_TRANSACTION_TIMEOUT_MS: 60000,
      persistActiveVolumeWorkspace: async (_tx, _novelId, value, versionId) => {
        db.volumes = rowsFrom(value, versionId);
        db.novel.outline = value.derivedOutline;
        db.novel.structuredOutline = value.derivedStructuredOutline;
        if (failure === "workspace") throw new Error("workspace failed");
      },
    },
  };
  if (realPersistence) imports["../volumeWorkspacePersistence"] = persistence;
  const { PlanningRepairStore } = load("planningRepair/PlanningRepairStore.ts", imports);
  const store = new PlanningRepairStore();
  const input = { novelId: "n", taskId: "t", volumeId: "vol1", chapterId: "p2", document };
  const candidate = () => {
    const value = copy(document);
    value.volumes[0].chapters[1].taskSheet = "Repaired contract";
    value.volumes[0].chapters[1].summary = "Repaired summary";
    return value;
  };
  return {
    store, input, candidate, events, chapterWrites, options, otherTasks, get db() { return db; },
    invalidateShape: () => { invalidShape = true; },
    ensureWorkspace: () => persistence.ensureVolumeWorkspaceDocument({ novelId: "n", getLegacySource: async () => { throw new Error("Unexpected legacy migration"); } }),
    fail: (at) => { failure = at; }, failCAS: () => { casFailure = true; },
    raceTaskRead: (nth, mutate) => { taskReadRace = { remaining: nth, mutate }; },
    state: () => JSON.parse(db.task.seedPayloadJson).planningRepair,
    ready: async (session, value = candidate()) => store.save(session, { ...session.state, phase: "ready", quality: passedQuality() }, value),
  };
}

function passedQuality() {
  return {
    chapters: Object.fromEntries(["p2", "p3", "p4"].map((id) => [id, { status: "passed", verdict: "usable", safeToSync: true }])),
    window: { usable: true, safeToSync: true, requiresUserDecision: false, issues: [] },
  };
}

function partialVolumeFixture(status = "chapter_list_partial:active") {
  const h = fixture();
  h.input.document.volumes[0].status = status;
  h.db.volumes[0].status = status;
  h.db.versions[0].contentJson = JSON.stringify(h.input.document);
  return h;
}

async function legacyPartialFailure() {
  const h = partialVolumeFixture();
  await h.store.begin(h.input);
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  seed.planningRepair.phase = "waiting_confirmation";
  seed.planningRepair.summary = "Planning source is stale or the chapter is protected.";
  seed.planningRepairSnapshot.eligibleChapterIds = [];
  h.db.task.seedPayloadJson = JSON.stringify(seed);
  h.db.task.status = "cancelled";
  h.db.task.cancelRequestedAt = epoch;
  return h;
}

async function cancelledInitialGenerationFixture() {
  const h = partialVolumeFixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state,
    pendingOperation: { kind: "initial_generation", startedAt: epoch },
  });
  h.db.task.status = "cancelled";
  h.db.task.cancelRequestedAt = epoch;
  return h;
}

test("completed initial response recovery preserves cancellation and budget, saving only a draft for review", async () => {
  const h = await cancelledInitialGenerationFixture();
  const before = copy(h.db);
  const next = await h.store.recoverCompletedInitialGeneration({
    novelId: "n", taskId: "t", expectedSeedPayloadJson: h.db.task.seedPayloadJson,
    operationStartedAt: epoch, candidate: h.candidate(),
  });
  assert.equal(next.phase, "reviewing");
  assert.equal(next.rounds, 0);
  assert.equal(next.maxRounds, 2);
  assert.deepEqual(next.history, []);
  assert.equal(next.pendingOperation, undefined);
  assert.ok(next.candidateVersionId);
  assert.deepEqual(next.affectedChapterIds, ["p2"]);
  assert.equal(h.db.task.status, "cancelled");
  assert.equal(h.db.task.cancelRequestedAt, epoch);
  assert.deepEqual(h.db.chapters, before.chapters);
  assert.deepEqual(h.db.volumes, before.volumes);
  assert.equal(h.db.versions.find(v => v.id === next.candidateVersionId).status, "draft");
  assert.equal(h.db.versions.find(v => v.id === "v1").status, "active");
  assert.deepEqual(h.chapterWrites, []);
});

for (const reason of ["source changed", "other chapter", "CAS conflict", "pending kind", "operation mismatch", "active job", "active command", "stale seed"]) {
  test(`completed initial response recovery rejects ${reason} atomically`, async () => {
    const h = await cancelledInitialGenerationFixture();
    const candidate = h.candidate();
    if (reason === "source changed") h.db.novel.defaultChapterLength = 3200;
    if (reason === "other chapter") candidate.volumes[0].chapters[2].summary = "unrelated chapter change";
    if (reason === "CAS conflict") h.failCAS();
    if (reason === "pending kind") {
      const seed = JSON.parse(h.db.task.seedPayloadJson);
      seed.planningRepair.pendingOperation.kind = "review";
      h.db.task.seedPayloadJson = JSON.stringify(seed);
    }
    if (reason === "active job") h.db.activeJob = { id: "job" };
    if (reason === "active command") h.db.activeCommand = { id: "command" };
    const before = copy(h.db);
    await assert.rejects(h.store.recoverCompletedInitialGeneration({
      novelId: "n", taskId: "t",
      expectedSeedPayloadJson: reason === "stale seed" ? "{}" : h.db.task.seedPayloadJson,
      operationStartedAt: reason === "operation mismatch" ? "different" : epoch, candidate,
    }), { code: "PLANNING_REPAIR_CONFLICT" });
    assert.deepEqual(h.db, before);
    assert.deepEqual(h.chapterWrites, []);
  });
}

test("partial chapter-list progress keeps active volumes writable but never unlocks frozen volumes", async () => {
  const active = partialVolumeFixture();
  assert.equal((await active.store.begin(active.input)).state.phase, "assessing");
  const frozen = partialVolumeFixture("chapter_list_partial:frozen");
  assert.equal((await frozen.store.begin(frozen.input)).state.phase, "waiting_confirmation");
});

test("technical correction restores an untouched partial-volume session without changing cancellation or quota", async () => {
  const h = await legacyPartialFailure();
  const before = copy(h.db);
  const state = await h.store.recoverInitialPartialVolumeProtection({ novelId: "n", taskId: "t" });
  assert.equal(state.phase, "assessing");
  assert.equal(state.rounds, 0);
  assert.equal(state.maxRounds, 2);
  assert.deepEqual(state.history, []);
  assert.equal(h.db.task.status, "cancelled");
  assert.equal(h.db.task.cancelRequestedAt, epoch);
  assert.deepEqual(JSON.parse(h.db.task.seedPayloadJson).planningRepairSnapshot.eligibleChapterIds, ["p2", "p3", "p4"]);
  assert.deepEqual(h.db.chapters, before.chapters);
  assert.deepEqual(h.db.volumes, before.volumes);
  await assert.rejects(h.store.recoverInitialPartialVolumeProtection({ novelId: "n", taskId: "t" }), /untouched initial/);
});

for (const reason of ["draft", "changed source", "round", "pending", "active job", "active command", "cas"]) {
  test(`technical correction refuses ${reason}`, async () => {
    const h = await legacyPartialFailure();
    if (reason === "draft") h.db.chapters[1].content = "protected prose";
    if (reason === "changed source") {
      const doc = JSON.parse(h.db.versions[0].contentJson);
      doc.volumes[0].chapters[1].summary = "manual edit";
      h.db.versions[0].contentJson = JSON.stringify(doc);
    }
    if (reason === "round" || reason === "pending") {
      const seed = JSON.parse(h.db.task.seedPayloadJson);
      if (reason === "round") seed.planningRepair.rounds = 1;
      else seed.planningRepair.pendingOperation = { kind: "review", startedAt: epoch };
      h.db.task.seedPayloadJson = JSON.stringify(seed);
    }
    if (reason === "active job") h.db.activeJob = { id: "job" };
    if (reason === "active command") h.db.activeCommand = { id: "command" };
    if (reason === "cas") h.failCAS();
    const before = h.db.task.seedPayloadJson;
    await assert.rejects(h.store.recoverInitialPartialVolumeProtection({ novelId: "n", taskId: "t" }), { code: "PLANNING_REPAIR_CONFLICT" });
    assert.equal(h.db.task.seedPayloadJson, before);
  });
}

test("switching production experience does not invalidate repair but changed novel input does", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  h.db.novel.creationExperience = "simple";
  h.db.novel.updatedAt = "ui-only update";
  const continued = await h.store.begin(h.input);
  assert.equal(continued.state.phase, "assessing");
  assert.equal(continued.snapshotToken, session.snapshotToken);
  h.db.novel.defaultChapterLength = 3200;
  assert.equal((await h.store.begin(h.input)).state.phase, "waiting_confirmation");
});

test("begin snapshots task quota and current+next-two plan IDs without touching the workspace", async () => {
  const h = fixture();
  const before = copy(h.db);
  const session = await h.store.begin(h.input);
  assert.equal(session.state.maxRounds, 2);
  assert.equal(session.state.rounds, 0);
  assert.equal(session.state.phase, "assessing");
  assert.deepEqual(session.eligibleChapterIds, ["p2", "p3", "p4"]);
  assert.equal(session.snapshotToken.length, 64);
  assert.deepEqual(h.db.volumes, before.volumes);
  assert.deepEqual(h.db.chapters, before.chapters);
  assert.equal(h.options[0].isolationLevel, "Serializable");
  assert.equal(h.options[0].timeout, 60000);
  assert.deepEqual(JSON.parse(h.db.task.seedPayloadJson).untouched, { setting: 42 });
});

test("persisting a candidate retains the declared review window even if a neighbor is unchanged", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, affectedChapterIds: ["p2", "p3", "p4"] }, h.candidate());
  assert.deepEqual(session.state.affectedChapterIds, ["p2", "p3", "p4"]);
  const resumed = await h.store.begin(h.input);
  assert.deepEqual(resumed.state.affectedChapterIds, ["p2", "p3", "p4"]);
  await h.store.save(resumed, { ...resumed.state, phase: "reviewing" }, resumed.candidate);
  assert.deepEqual(resumed.state.affectedChapterIds, ["p2", "p3", "p4"]);
});

test("resume preserves pending operations, quota, history and an unresolved different chapter", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  const state = { ...session.state, rounds: 1, phase: "repairing", pendingOperation: { kind: "repair", startedAt: epoch }, history: [{ round: 1 }] };
  await h.store.save(session, state, h.candidate());
  const resumed = await h.store.begin({ ...h.input, chapterId: "p4" });
  assert.deepEqual(resumed.state, session.state);
  assert.deepEqual(resumed.candidate, session.candidate);
  assert.equal(resumed.state.chapterId, "p2");
});

test("source changes wait without resetting rounds or pending operations", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, rounds: 1 });
  await h.store.save(session, { ...session.state, rounds: 2, pendingOperation: { kind: "review", startedAt: epoch } });
  h.db.novel.title = "changed business input";
  const resumed = await h.store.begin(h.input);
  assert.equal(resumed.state.phase, "waiting_confirmation");
  assert.equal(resumed.state.rounds, 2);
  assert.equal(resumed.state.pendingOperation.kind, "review");
});

test("draft save is atomic with seed CAS; stale sessions cannot clobber unrelated task fields", async () => {
  const h = fixture();
  const a = await h.store.begin(h.input);
  const b = await h.store.begin(h.input);
  await h.ready(a);
  await assert.rejects(h.ready(b), { code: "PLANNING_REPAIR_CONFLICT" });
  assert.equal(h.db.versions.length, 2);
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  seed.unrelated = "worker write";
  h.db.task.seedPayloadJson = JSON.stringify(seed);
  await h.store.save(a, { ...a.state, summary: "Progress-safe write" });
  assert.equal(JSON.parse(h.db.task.seedPayloadJson).unrelated, "worker write");
});

test("heartbeat seed changes during a paid call allow save and commit while preserving latest progress", async () => {
  const h = fixture();
  const initialSeed = JSON.parse(h.db.task.seedPayloadJson);
  initialSeed.directorInput = { provider: "deepseek", model: "model-a", guidance: "Keep the original plan" };
  h.db.task.seedPayloadJson = JSON.stringify(initialSeed);
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, pendingOperation: { kind: "initial_generation", startedAt: epoch } });
  const heartbeat = (progress) => {
    const seed = JSON.parse(h.db.task.seedPayloadJson);
    seed.autoExecution = { pipelineStatus: "running", completedChapterCount: progress };
    seed.directorSession = { phase: "chapter_execution", isBackgroundRunning: true, updatedAt: `heartbeat-${progress}` };
    seed.resumeTarget = { stage: "pipeline", chapterId: "c2", progress };
    h.db.task.seedPayloadJson = JSON.stringify(seed);
    h.db.task.heartbeatAt = `heartbeat-${progress}`;
    h.db.task.updatedAt = `heartbeat-${progress}`;
    return seed;
  };
  const firstProgress = heartbeat(1);
  await h.store.save(session, { ...session.state, phase: "reviewing", pendingOperation: undefined }, h.candidate());
  let saved = JSON.parse(h.db.task.seedPayloadJson);
  for (const key of ["autoExecution", "directorSession", "resumeTarget", "directorInput"]) {
    assert.deepEqual(saved[key], firstProgress[key]);
  }
  await h.store.save(session, { ...session.state, phase: "ready", quality: passedQuality() });
  const latestProgress = heartbeat(2);
  await h.store.commit(session, session.candidate);
  saved = JSON.parse(h.db.task.seedPayloadJson);
  for (const key of ["autoExecution", "directorSession", "resumeTarget", "directorInput"]) {
    assert.deepEqual(saved[key], latestProgress[key]);
  }
  assert.equal(saved.planningRepair.phase, "committed");
  assert.equal(h.db.task.heartbeatAt, "heartbeat-2");
});

for (const field of ["planningRepair", "planningRepairSnapshot", "planningRepairRecovery", "planningRepairRecoveryRequests",
  "directorInput", "provider", "model", "temperature", "guidance", "taskStyleProfileId", "issuePolicy"]) {
  test(`scoped seed authority rejects concurrent ${field} changes`, async () => {
    const h = fixture();
    const session = await h.store.begin(h.input);
    await h.ready(session);
    const seed = JSON.parse(h.db.task.seedPayloadJson);
    if (field === "planningRepair") seed.planningRepair.maxRounds++;
    else if (field === "planningRepairSnapshot") seed.planningRepairSnapshot.inputFingerprint = "changed";
    else if (field === "directorInput") seed.directorInput = { model: "new-model", guidance: "New instruction" };
    else if (field === "temperature") seed.temperature = 0.9;
    else seed[field] = "changed";
    seed.autoExecution = { progress: "new heartbeat" };
    h.db.task.seedPayloadJson = JSON.stringify(seed);
    const before = copy(h.db);
    await assert.rejects(h.store.save(session, { ...session.state, summary: "Must not overwrite" }), /changed concurrently/);
    await assert.rejects(h.store.commit(session, session.candidate), /changed concurrently/);
    assert.deepEqual(h.db, before);
  });
}

test("failed final CAS rolls back the candidate version", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  const before = copy(h.db);
  h.failCAS();
  await assert.rejects(h.ready(session), /changed concurrently/);
  assert.deepEqual(h.db, before);
  assert.equal(session.candidate, undefined);
});

for (const protection of ["body", "generating", "approved"]) {
  test(`eligible window stops at ${protection} and never skips over it`, async () => {
    const h = fixture();
    if (protection === "body") h.db.chapters[2].content = "Existing prose";
    if (protection === "generating") h.db.chapters[2].chapterStatus = "generating";
    if (protection === "approved") h.db.chapters[2].generationState = "approved";
    const session = await h.store.begin(h.input);
    assert.deepEqual(session.eligibleChapterIds, ["p2"]);
    const bad = h.candidate(); bad.volumes[0].chapters[3].summary = "Beyond lock";
    await assert.rejects(h.ready(session, bad), (error) => {
      assert.match(error.message, /protected workspace/);
      // The rejection must name what changed. A generic sentence leaves nothing to diagnose, and
      // the candidate itself is never persisted, so this message is the only surviving evidence.
      assert.match(error.message, /Differences:/);
      assert.match(error.message, /volumes\[0\]\.chapters\[3\]\.summary/);
      return true;
    });
  });
}

test("a rejected candidate reports the protected field it touched, not just a generic refusal", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  const bad = h.candidate();
  // Touch a protected document-level field and an out-of-window chapter at once.
  bad.activeVersionId = "a-different-version";
  bad.volumes[0].chapters[3].openPayoffs = ["smuggled"];

  await assert.rejects(h.ready(session, bad), (error) => {
    assert.match(error.message, /Differences:/);
    assert.match(error.message, /activeVersionId/);
    assert.match(error.message, /chapters\[3\]\.openPayoffs/);
    // The message stays readable: it is shown to a user and stored as the run's technicalError.
    assert.ok(error.message.length < 900, `message too long: ${error.message.length}`);
    return true;
  });
});

test("every field the chapter generator writes is allowed on an eligible chapter", async () => {
  // The fields `generateChapterTaskSheetDetail` writes onto the chapter document. The planning
  // repair guard must allow all of them on a chapter inside the window.
  //
  // This test exists because it did not, once: `requiredElements` was added to the generated
  // contract without being added to MUTABLE_CHAPTER_FIELDS, so the guard classified a legitimate
  // generation as a protected-field change and every auto-director book stopped at chapter 1 with
  // "Candidate changes protected workspace fields or chapters outside the repair window."
  const contractFields = {
    purpose: "Purpose", exclusiveEvent: "Exclusive event", endingState: "Ending state",
    nextChapterEntryState: "Entry state", conflictLevel: 3, revealLevel: 4, targetWordCount: 2000,
    mustAvoid: "Avoid this", payoffRefs: [], taskSheet: "Generated contract",
    sceneCards: null, requiredElements: ["具体事件一", "具体事件二", "具体事件三"],
  };

  for (const [field, value] of Object.entries(contractFields)) {
    const h = fixture();
    const session = await h.store.begin(h.input);
    // The fixture's current chapter is p2, so the window is chapters[1..3]; write to the current
    // chapter, which is where generation actually lands.
    assert.ok(session.eligibleChapterIds.includes("p2"));
    const candidate = h.candidate();
    candidate.volumes[0].chapters[1][field] = value;
    try {
      await h.ready(session, candidate);
    } catch (error) {
      assert.fail(`generator-written field "${field}" was rejected: ${error.message}`);
    }
  }
});

test("a rejected candidate never leaves the stored document changed", async () => {
  const h = fixture();
  // Same setup as the window-lock cases: prose in chapter index 2 makes index 3 out of window,
  // which is what turns its fields into protected ones.
  h.db.chapters[2].content = "Existing prose";
  const session = await h.store.begin(h.input);
  const before = JSON.parse(JSON.stringify(h.db));
  const bad = h.candidate();
  bad.volumes[0].chapters[3].summary = "Beyond lock";
  await assert.rejects(h.ready(session, bad), /protected workspace/);
  assert.deepEqual(h.db, before, "a refused candidate must not be written");
});

test("window stops at the end of its volume", async () => {
  const h = fixture();
  const session = await h.store.begin({ ...h.input, chapterId: "p5" });
  assert.deepEqual(session.eligibleChapterIds, ["p5"]);
});

test("unmaterialized chapters can commit plans without creating body rows", async () => {
  const h = fixture({ materialized: false });
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const document = await h.store.commit(session, session.candidate);
  assert.equal(h.db.chapters.length, 0);
  assert.equal(document.volumes[0].chapters[1].taskSheet, "Repaired contract");
  assert.equal(session.state.phase, "committed");
});

test("explicit chapter ID and unique order fallback resolve the same materialized row", async () => {
  const h = fixture();
  h.input.document.volumes[0].chapters[1].chapterId = null;
  h.db.versions[0].contentJson = JSON.stringify(h.input.document);
  h.db.volumes[0].chapters[1].chapterId = null;
  const session = await h.store.begin({ ...h.input, chapterId: "c2" });
  assert.equal(session.state.chapterId, "p2");
  await h.ready(session);
  await h.store.commit(session, session.candidate);
  assert.deepEqual(h.chapterWrites, ["c2"]);
});

test("ambiguous chapter mappings fail closed before seeding", async () => {
  const h = fixture();
  h.db.chapters.push({ ...h.db.chapters[1], id: "duplicate" });
  await assert.rejects(h.store.begin(h.input), /Ambiguous materialized/);
  assert.equal(h.state(), undefined);
});

test("candidate cannot change protected volume fields, identities, or another chapter", async () => {
  for (const edit of [
    (d) => { d.volumes[0].title = "Changed volume"; },
    (d) => { d.volumes[0].chapters[1].chapterId = "c6"; },
    (d) => { d.volumes[0].chapters[0].summary = "Previous chapter"; },
    (d) => { d.volumes[1].chapters[0].summary = "Other volume"; },
  ]) {
    const h = fixture();
    const session = await h.store.begin(h.input);
    const candidate = h.candidate(); edit(candidate);
    await assert.rejects(h.ready(session, candidate), /protected workspace/);
    assert.equal(h.db.versions.length, 1);
  }
});

test("user-set conflict levels are preserved", async () => {
  const h = fixture();
  h.input.document.volumes[0].chapters[1].conflictLevelSource = "user";
  h.db.versions[0].contentJson = JSON.stringify(h.input.document);
  const session = await h.store.begin(h.input);
  const candidate = h.candidate(); candidate.volumes[0].chapters[1].conflictLevel = 5;
  await assert.rejects(h.ready(session, candidate), /user-set conflict level/);
});

test("commit atomically activates the candidate, updates only affected contracts and invalidates plans", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  const original = copy(h.db.chapters);
  await h.ready(session);
  assert.equal(h.db.chapters[1].taskSheet, "Original contract");
  const result = await h.store.commit(session, session.candidate);
  assert.equal(result.activeVersionId, session.state.candidateVersionId);
  assert.equal(h.db.versions.find((v) => v.id === result.activeVersionId).status, "active");
  assert.equal(h.db.versions[0].status, "frozen");
  assert.deepEqual(h.chapterWrites, ["c2"]);
  assert.deepEqual(h.db.stale, ["c2"]);
  assert.equal(h.db.chapters[1].content, "");
  assert.equal(h.db.chapters[1].taskSheet, "Repaired contract");
  assert.deepEqual(h.db.chapters[2], original[2]);
  assert.ok(result.derivedStructuredOutline.includes("Repaired summary"));
  assert.equal(h.events.length, 2);
  assert.equal(h.events[0].invalidated, "n");
  assert.equal(h.events[1].type, "volume:updated");
  assert.equal(h.state().phase, "committed");
  const resumed = await h.store.begin(h.input);
  assert.equal(resumed.state.phase, "committed");
  assert.deepEqual(resumed.candidate, result);
});

test("initial passing candidate commits and syncs target even with unchanged plan fields", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, phase: "ready", quality: passedQuality() });
  const result = await h.store.commit(session, h.input.document);
  assert.equal(session.state.rounds, 0);
  assert.deepEqual(h.chapterWrites, ["c2"]);
  assert.notEqual(result.activeVersionId, "v1");
});

for (const failure of ["workspace", "invalidation"]) {
  test(`commit rollback after ${failure} failure leaves no partial activation, contracts or invalidation`, async () => {
    const h = fixture();
    const session = await h.store.begin(h.input);
    await h.ready(session);
    const before = copy(h.db);
    h.fail(failure);
    await assert.rejects(h.store.commit(session, session.candidate), /failed/);
    assert.deepEqual(h.db, before);
    assert.equal(h.events.length, 0);
    assert.equal(session.state.phase, "ready");
  });
}

for (const change of ["body", "lock", "workspace", "macro"]) {
  test(`commit rejects concurrent ${change} changes and persists waiting confirmation`, async () => {
    const h = fixture();
    const session = await h.store.begin(h.input);
    await h.ready(session);
    if (change === "body") h.db.chapters[4].content = "Protected chapter changed";
    if (change === "lock") h.db.chapters[1].chapterStatus = "generating";
    if (change === "workspace") h.db.volumes[1].title = "Other writer";
    if (change === "macro") h.db.macro.lockedFieldsJson = '{"promise":true}';
    await assert.rejects(h.store.commit(session, session.candidate), /waiting for confirmation/);
    assert.equal(h.state().phase, "waiting_confirmation");
    assert.equal(session.state.phase, "waiting_confirmation");
    assert.equal(h.db.versions[0].status, "active");
    assert.equal(h.events.length, 0);
  });
}

test("stale save throws after persisting wait, preventing another paid call", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  h.db.novel.title = "new business input";
  await assert.rejects(h.store.save(session, { ...session.state, pendingOperation: { kind: "repair", startedAt: epoch } }), /waiting for confirmation/);
  assert.equal(session.state.phase, "waiting_confirmation");
  assert.equal(h.state().pendingOperation, undefined);
});

test("persisted quota and audit history cannot be silently reset", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, rounds: 1, history: [{ accepted: true }] });
  await assert.rejects(h.store.save(session, { ...session.state, rounds: 0 }), /monotonic/);
  await assert.rejects(h.store.save(session, { ...session.state, maxRounds: 5 }), /maxRounds/);
  await assert.rejects(h.store.save(session, { ...session.state, history: [] }), /append-only/);
  session.state.history[0].accepted = false;
  await assert.rejects(h.store.save(session, session.state), /append-only/);
});

test("pending operation blocks commit and saved candidate cannot be swapped", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  await h.store.save(session, { ...session.state, pendingOperation: { kind: "review", startedAt: epoch } });
  await assert.rejects(h.store.commit(session, session.candidate), /pending operation/);
  await h.store.save(session, { ...session.state, pendingOperation: undefined });
  const bad = copy(session.candidate); bad.volumes[0].chapters[1].taskSheet = "Not reviewed";
  await assert.rejects(h.store.commit(session, bad), /saved and reviewed/);
});

test("first draft creates an active baseline so latest-version fallback cannot promote the candidate", async () => {
  const h = fixture({ active: false });
  const session = await h.store.begin(h.input);
  assert.equal(session.state.phase, "assessing");
  await h.ready(session);
  const baseline = h.db.versions.find((v) => v.status === "active");
  const draft = h.db.versions.find((v) => v.status === "draft");
  assert.ok(baseline);
  assert.ok(draft);
  assert.ok(draft.version > baseline.version);
  assert.equal(JSON.parse(baseline.contentJson).volumes[0].chapters[1].taskSheet, "Original contract");
  assert.equal(h.db.chapters[1].taskSheet, "Original contract");
  // Match ensureVolumeWorkspaceDocument's active-first/latest-fallback selection.
  const selected = h.db.versions.find((v) => v.status === "active")
    ?? [...h.db.versions].sort((a, b) => b.version - a.version)[0];
  assert.equal(selected.id, baseline.id);
  const resumed = await h.store.begin(h.input);
  assert.equal(resumed.state.phase, "ready");
  await h.store.commit(resumed, resumed.candidate);
  assert.equal(h.state().phase, "committed");
});

test("baseline and draft creation roll back together on CAS failure", async () => {
  const h = fixture({ active: false });
  const session = await h.store.begin(h.input);
  const before = copy(h.db);
  h.failCAS();
  await assert.rejects(h.ready(session), /concurrently/);
  assert.deepEqual(h.db, before);
});

test("malformed task seed and wrong novel ownership never reset state", async () => {
  const h = fixture();
  h.db.task.seedPayloadJson = "invalid";
  await assert.rejects(h.store.begin(h.input), /seed is invalid/);
  assert.equal(h.db.task.seedPayloadJson, "invalid");
  h.db.task.novelId = "other";
  await assert.rejects(h.store.begin(h.input), /does not own/);
});

test("existing session rejects execution-owner changes but begin resumes the same creative snapshot", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  h.db.task.attemptCount++;
  h.db.task.startedAt = "resumed";
  h.db.task.status = "waiting_approval";
  await assert.rejects(h.store.commit(session, session.candidate), /ownership changed/);
  const resumed = await h.store.begin(h.input);
  assert.equal(resumed.state.phase, "ready");
  assert.equal(resumed.snapshotToken, session.snapshotToken);
  await h.store.commit(resumed, resumed.candidate);
});

test("queued and running progress transitions preserve the same repair execution and budget", async () => {
  for (const initialStatus of ["queued", "running"]) {
    const h = fixture(); h.db.task.status = initialStatus;
    h.db.chapters[0].content = "Protected prose";
    const session = await h.store.begin(h.input);
    const { rounds, maxRounds } = session.state;
    h.db.task.status = initialStatus === "queued" ? "running" : "queued";
    await h.ready(session);
    h.db.task.status = initialStatus;
    await h.store.commit(session, session.candidate);
    assert.equal(h.state().phase, "committed");
    assert.equal(h.state().rounds, rounds);
    assert.equal(h.state().maxRounds, maxRounds);
    assert.equal(h.db.chapters[0].content, "Protected prose");
  }
});

test("active display compatibility does not permit another execution, manual pause or terminal state to write", async () => {
  for (const mutate of [
    task => { task.attemptCount++; }, task => { task.startedAt = "new-execution"; },
    task => { task.lane = "manual"; }, task => { task.novelId = "another"; },
    task => { task.pendingManualRecovery = true; }, task => { task.cancelRequestedAt = "cancelled"; },
    ...["waiting_approval", "failed", "succeeded", "cancelled"].map(status => task => { task.status = status; }),
  ]) {
    const h = fixture(); const session = await h.store.begin(h.input); await h.ready(session);
    mutate(h.db.task); const before = copy(h.db);
    await assert.rejects(h.store.commit(session, session.candidate), /ownership changed|does not own|inactive|cancelled|completed/);
    assert.deepEqual(h.db, before);
  }
});

test("another live unresolved repair blocks a second task for the same novel", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  h.otherTasks.push({ id: "other", novelId: "n", status: "running", seedPayloadJson: JSON.stringify({ planningRepair: session.state }) });
  await assert.rejects(h.store.begin(h.input), /Another live task/);
  await assert.rejects(h.ready(session), /Another live task/);
});

test("ready phase alone cannot bypass saved chapter, window and structural checks", async () => {
  for (const kind of ["missing", "chapter", "window", "shape"]) {
    const h = fixture();
    const session = await h.store.begin(h.input);
    const quality = passedQuality();
    if (kind === "chapter") quality.chapters.p2.safeToSync = false;
    if (kind === "window") quality.window.requiresUserDecision = true;
    if (kind === "shape") h.invalidateShape();
    await h.store.save(session, { ...session.state, phase: "ready", quality: kind === "missing" ? null : quality }, h.candidate());
    await assert.rejects(h.store.commit(session, session.candidate), /review|invalid execution contract/);
    assert.equal(h.db.versions[0].status, "active");
  }
});

test("normalization of real row timestamps does not expand affected chapter scope", async () => {
  const h = fixture();
  for (const volume of h.input.document.volumes) {
    volume.updatedAt = "2026-09-25T00:00:00.000Z";
    for (const chapter of volume.chapters) chapter.updatedAt = volume.updatedAt;
  }
  const session = await h.store.begin(h.input);
  await h.ready(session, workspace.buildVolumeWorkspaceDocument(h.candidate()));
  assert.deepEqual(session.state.affectedChapterIds, ["p2"]);
  await h.store.commit(session, session.candidate);
});

test("explicit rebase refreshes changed sources, preserves approved quota/history and discards only stale candidate", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, rounds: 1, history: [{ accepted: 1 }], quality: passedQuality(),
    repairOutputPending: { inputFingerprint: session.inputFingerprint, round: 1 } }, h.candidate());
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  seed.planningRepair.maxRounds = 3;
  h.db.task.seedPayloadJson = JSON.stringify(seed);
  h.db.novel.title = "changed business input";
  const rebased = await h.store.rebase(h.input);
  assert.equal(rebased.state.maxRounds, 3);
  assert.equal(rebased.state.rounds, 1);
  assert.deepEqual(rebased.state.history, [{ accepted: 1 }]);
  assert.equal(rebased.candidate, undefined);
  assert.equal(rebased.state.candidateVersionId, undefined);
  assert.equal(rebased.state.quality, undefined);
  assert.equal(rebased.state.repairOutputPending, undefined);
  assert.equal(h.state().repairOutputPending, undefined);
  assert.equal(rebased.state.phase, "assessing");
  assert.notEqual(rebased.snapshotToken, session.snapshotToken);
  assert.equal(h.db.versions.length, 2);
});

test("explicit rebase with unchanged creative data retains candidate and quota", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const repairOutputPending = { inputFingerprint: session.inputFingerprint, round: session.state.rounds };
  await h.store.save(session, { ...session.state, repairOutputPending, history: [{ kind: "repair", output: { saved: true } }] });
  h.db.task.status = "waiting_approval";
  const rebased = await h.store.rebase(h.input);
  assert.deepEqual(rebased.candidate, session.candidate);
  assert.equal(rebased.state.candidateVersionId, session.state.candidateVersionId);
  assert.equal(rebased.state.quality, undefined);
  assert.deepEqual(rebased.state.repairOutputPending, repairOutputPending);
  assert.deepEqual(h.state().repairOutputPending, repairOutputPending);
  assert.deepEqual(rebased.state.history, session.state.history);
  assert.equal(rebased.state.phase, "reviewing");
});

test("advice selection rebase rejects a source changed after selection validation", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  h.db.task.status = "waiting_approval";
  const seed = h.db.task.seedPayloadJson;
  h.db.novel.title = "Changed after recommendation was selected";
  await assert.rejects(h.store.rebase({ ...h.input, expectedSourceToken: session.snapshotToken }), {
    code: "PLANNING_REPAIR_CONFLICT", reason: "advice_source_changed",
  });
  assert.equal(h.db.task.seedPayloadJson, seed);
  assert.equal(h.db.versions.length, 2);
});

test("advice selection accepts the exact source token without losing the candidate", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  h.db.task.status = "waiting_approval";
  const result = await h.store.rebase({ ...h.input, expectedSourceToken: session.snapshotToken });
  assert.deepEqual(result.candidate, session.candidate);
});

test("pending repair output survives failed candidate save and begin for replay", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const savedCandidate = copy(session.candidate);
  const repairOutputPending = { inputFingerprint: session.inputFingerprint, round: session.state.rounds };
  await h.store.save(session, {
    ...session.state, phase: "repairing", repairOutputPending,
    history: [{ kind: "repair", output: { taskSheet: "Saved model response" } }],
  });
  const candidate = copy(session.candidate);
  candidate.volumes[0].chapters[1].taskSheet = "Applied model response";
  h.failCAS();
  await assert.rejects(h.store.save(session, {
    ...session.state, phase: "reviewing", repairOutputPending: undefined,
  }, candidate), /concurrently/);
  const resumed = await h.store.begin(h.input);
  assert.deepEqual(resumed.state.repairOutputPending, repairOutputPending);
  assert.deepEqual(resumed.state.history, session.state.history);
  assert.deepEqual(resumed.candidate, savedCandidate);
});

test("pending unapplied repair output prevents commit even with a ready phase", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  await h.store.save(session, { ...session.state,
    repairOutputPending: { inputFingerprint: session.inputFingerprint, round: session.state.rounds } });
  await assert.rejects(h.store.commit(session, session.candidate), /pending operation/);
  await h.store.save(session, { ...session.state, repairOutputPending: undefined });
  await h.store.commit(session, session.candidate);
  assert.equal(session.state.phase, "committed");
});

test("rebase accepts the exact reserved seed and still uses final seed CAS", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const expectedSeedPayloadJson = h.db.task.seedPayloadJson;
  const rebased = await h.store.rebase({ ...h.input, expectedSeedPayloadJson });
  assert.equal(rebased.state.phase, "reviewing");
  assert.deepEqual(rebased.candidate, session.candidate);
  const before = copy(h.db);
  h.failCAS();
  await assert.rejects(h.store.rebase({ ...h.input, expectedSeedPayloadJson: h.db.task.seedPayloadJson }), /concurrently/);
  assert.deepEqual(h.db, before);
});

test("rebase rejects a stale recovery reservation without replacing newer state or snapshots", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const expectedSeedPayloadJson = h.db.task.seedPayloadJson;
  await h.store.save(session, { ...session.state, guidance: "Newer recovery command", rounds: 1 });
  h.db.novel.title = "changed source input";
  const before = copy(h.db);
  await assert.rejects(h.store.rebase({ ...h.input, expectedSeedPayloadJson }), {
    code: "PLANNING_REPAIR_CONFLICT", message: /seed reservation changed/,
  });
  assert.deepEqual(h.db, before);
});

test("an explicit null recovery reservation is checked rather than treated as omitted", async () => {
  const h = fixture();
  await h.store.begin(h.input);
  const before = copy(h.db);
  await assert.rejects(h.store.rebase({ ...h.input, expectedSeedPayloadJson: null }), /seed reservation changed/);
  assert.deepEqual(h.db, before);
});

test("rebase rejects stale baseline and refuses new protected content", async () => {
  const h = fixture();
  await h.store.begin(h.input);
  const newer = copy(h.input.document);
  newer.volumes[0].chapters[1].summary = "New canonical planning";
  h.db.versions[0].contentJson = JSON.stringify(newer);
  await assert.rejects(h.store.rebase(h.input), /fresh canonical/);
  h.db.chapters[1].content = "New prose";
  await assert.rejects(h.store.rebase({ ...h.input, document: newer }), /protected/);
});

test("a new chapter resets to default two rounds instead of inheriting manual extra rounds", async () => {
  const h = fixture();
  const initial = await h.store.begin(h.input);
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  seed.planningRepair.maxRounds = 4;
  h.db.task.seedPayloadJson = JSON.stringify(seed);
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const document = await h.store.commit(session, session.candidate);
  const next = await h.store.begin({ ...h.input, document, chapterId: "p3" });
  assert.equal(next.state.chapterId, "p3");
  assert.equal(next.state.maxRounds, 2);
  assert.equal(next.state.rounds, 0);
  assert.equal(initial.state.maxRounds, 2);
});

test("real workspace persistence and fallback keep active baseline until guarded commit", async () => {
  const h = fixture({ active: false, realPersistence: true });
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const baseline = await h.ensureWorkspace();
  assert.equal(baseline.volumes[0].chapters[1].taskSheet, "Original contract");
  assert.notEqual(baseline.activeVersionId, session.state.candidateVersionId);
  const protectedBefore = copy(h.db.chapters[0]);
  const result = await h.store.commit(session, session.candidate);
  const active = await h.ensureWorkspace();
  assert.equal(active.activeVersionId, result.activeVersionId);
  assert.equal(active.volumes[0].chapters[1].taskSheet, "Repaired contract");
  assert.equal(h.db.volumes[0].chapters[1].taskSheet, "Repaired contract");
  assert.equal(h.db.volumes[0].sourceVersionId, result.activeVersionId);
  assert.equal(h.db.arcs.length, 2);
  assert.deepEqual(h.db.chapters[0], protectedBefore);
  assert.equal(h.db.novel.structuredOutline, result.derivedStructuredOutline);
  const resumed = await h.store.begin({ ...h.input, document: active });
  assert.equal(resumed.state.phase, "committed");
});

test("progress summary is committed with seed CAS", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.store.save(session, { ...session.state, summary: "Reviewing chapter 2" });
  assert.equal(h.db.task.currentItemLabel, "Reviewing chapter 2");
  h.failCAS();
  await assert.rejects(h.store.save(session, { ...session.state, summary: "Must not appear" }), /concurrently/);
  assert.equal(h.db.task.currentItemLabel, "Reviewing chapter 2");
});

function clearTarget(h, order) {
  h.input.document.volumes[0].chapters[order - 1].targetWordCount = null;
  h.db.volumes[0].chapters[order - 1].targetWordCount = null;
  h.db.chapters[order - 1].targetWordCount = null;
  h.db.versions[0].contentJson = JSON.stringify(h.input.document);
}

for (const defaultChapterLength of [null, 3200]) {
  test(`null chapter budgets may inherit frozen default ${defaultChapterLength ?? 2800}, never a model-selected increase`, async () => {
    const h = fixture();
    h.db.novel.defaultChapterLength = defaultChapterLength;
    clearTarget(h, 2);
    clearTarget(h, 3);
    const session = await h.store.begin(h.input);
    const effective = defaultChapterLength ?? 2800;
    assert.equal(session.effectiveDefaultChapterLength, effective);
    assert.equal(JSON.parse(h.db.task.seedPayloadJson).planningRepairSnapshot.effectiveDefaultChapterLength, effective);
    const candidate = h.candidate();
    candidate.volumes[0].chapters[1].targetWordCount = effective;
    await h.ready(session, candidate);
    assert.equal(session.candidate.volumes[0].chapters[2].targetWordCount, null);
    const inflated = copy(candidate);
    inflated.volumes[0].chapters[2].targetWordCount = effective + 1000;
    await assert.rejects(h.ready(session, inflated), /frozen novel default/);
    const resolved = copy(candidate);
    resolved.volumes[0].chapters[2].targetWordCount = effective;
    await h.ready(session, resolved);
    assert.deepEqual(session.state.affectedChapterIds, ["p2", "p3"]);
    await h.store.commit(session, session.candidate);
    assert.equal(h.db.chapters[1].targetWordCount, effective);
    assert.equal(h.db.chapters[2].targetWordCount, effective);
  });
}

test("a frozen default cannot replace an explicit chapter target", async () => {
  const h = fixture();
  h.db.novel.defaultChapterLength = 3200;
  const session = await h.store.begin(h.input);
  const candidate = h.candidate(); candidate.volumes[0].chapters[1].targetWordCount = 3200;
  await assert.rejects(h.ready(session, candidate), /original chapter word count/);
});

test("novel default changes require explicit rebase before null budgets can use the new value", async () => {
  const h = fixture();
  h.db.novel.defaultChapterLength = 2800;
  clearTarget(h, 2);
  const session = await h.store.begin(h.input);
  h.db.novel.defaultChapterLength = 3300;
  const waiting = await h.store.begin(h.input);
  assert.equal(waiting.state.phase, "waiting_confirmation");
  assert.equal(waiting.effectiveDefaultChapterLength, 2800);
  const rebased = await h.store.rebase(h.input);
  assert.equal(rebased.effectiveDefaultChapterLength, 3300);
  const candidate = h.candidate(); candidate.volumes[0].chapters[1].targetWordCount = 3300;
  await h.ready(rebased, candidate);
  assert.equal(session.effectiveDefaultChapterLength, 2800);
});

test("legacy snapshots without a frozen default upgrade only against unchanged source", async () => {
  const h = fixture();
  h.db.novel.defaultChapterLength = 3100;
  clearTarget(h, 2);
  await h.store.begin(h.input);
  const seed = JSON.parse(h.db.task.seedPayloadJson);
  delete seed.planningRepairSnapshot.effectiveDefaultChapterLength;
  h.db.task.seedPayloadJson = JSON.stringify(seed);
  const resumed = await h.store.begin(h.input);
  assert.equal(resumed.effectiveDefaultChapterLength, 3100);
  assert.equal(JSON.parse(h.db.task.seedPayloadJson).planningRepairSnapshot.effectiveDefaultChapterLength, 3100);
});

test("committed same-chapter resume tolerates execution progress and canonical derived refresh", async () => {
  const h = fixture(); const s = await h.store.begin(h.input); await h.ready(s);
  const document = await h.store.commit(s, s.candidate);
  h.db.chapters[1].chapterStatus = "generating"; h.db.chapters[1].content = "saved prose";
  h.db.chapters[1].updatedAt = new Date().toISOString();
  h.db.versions.find(v => v.status === "active").contentJson = JSON.stringify(workspace.buildVolumeWorkspaceDocument(document));
  const resumed = await h.store.begin({ ...h.input, document });
  assert.equal(resumed.state.phase, "committed"); assert.equal(resumed.state.rounds, s.state.rounds);
});

test("new written facts invalidate committed review while preserving candidate, history and repair budget", async () => {
  const h = fixture(); const session = await h.store.begin(h.input); await h.ready(session);
  const document = await h.store.commit(session, session.candidate);
  const before = h.state(); h.db.chapters[0].content = "原文：刀具已收缴，烙印位于胸口。";
  const evidence = load("writtenEvidence/evidencePolicy.ts", { "node:crypto": require("node:crypto") });
  const resumed = await h.store.begin({ ...h.input, document,
    expectedWrittenSourceFingerprint: evidence.writtenSourceFingerprint(h.db.chapters, 2) });
  assert.equal(resumed.state.phase, "reviewing"); assert.ok(resumed.candidate);
  assert.equal(resumed.state.rounds, before.rounds); assert.equal(resumed.state.maxRounds, before.maxRounds);
  assert.deepEqual(resumed.state.history.slice(0, -1), before.history); assert.equal(resumed.state.history.at(-1).kind, "evidence_refresh");
  assert.deepEqual(resumed.state.quality, { chapters: {} });
  assert.equal(resumed.candidate.volumes[0].chapters[1].taskSheet, document.volumes[0].chapters[1].taskSheet);
  assert.equal(h.db.chapters[0].content, "原文：刀具已收缴，烙印位于胸口。");
  h.db.chapters[0].content += "并发更改";
  await assert.rejects(h.store.save(resumed, { ...resumed.state, summary: "late" }), /source changed/i);
});

test("written evidence changed before begin cannot authorize a stale review", async () => {
  const h = fixture();
  await assert.rejects(h.store.begin({ ...h.input, expectedWrittenSourceFingerprint: "stale" }), /Written chapter evidence changed/);
});

test("edited selected direction invalidates review and a stale loaded promise source is refused", async () => {
  const h = fixture(); let seed = JSON.parse(h.db.task.seedPayloadJson);
  seed.candidate = { id: "choice", sellingPoint: "original" }; h.db.task.seedPayloadJson = JSON.stringify(seed);
  const selected = { status: "available", sourceTaskId: "t", candidate: seed.candidate, fingerprint: "source" };
  const session = await h.store.begin({ ...h.input, selectedPlanningDirection: selected }); await h.ready(session);
  const document = await h.store.commit(session, session.candidate);
  seed = JSON.parse(h.db.task.seedPayloadJson); seed.candidate.sellingPoint = "updated"; h.db.task.seedPayloadJson = JSON.stringify(seed);
  await assert.rejects(h.store.begin({ ...h.input, document, selectedPlanningDirection: selected }), /Selected planning direction changed/);
  const resumed = await h.store.begin({ ...h.input, document, selectedPlanningDirection: { ...selected, candidate: seed.candidate } });
  assert.equal(resumed.state.phase, "reviewing"); assert.equal(resumed.state.rounds, session.state.rounds);
  assert.deepEqual(resumed.state.quality, { chapters: {} });
});

test("normally completed preceding chapter re-reviews an approved neighbor with no extra repair round", async () => {
  const h = fixture(); const session = await h.store.begin(h.input); const candidate = h.candidate();
  candidate.volumes[0].chapters[2].taskSheet = "Reviewed neighbor";
  await h.ready(session, candidate); const document = await h.store.commit(session, session.candidate);
  h.db.chapters[1].content = "前章完整正文"; h.db.chapters[1].chapterStatus = "completed";
  const evidence = load("writtenEvidence/evidencePolicy.ts", { "node:crypto": require("node:crypto") });
  const next = await h.store.begin({ ...h.input, chapterId: "p3", document,
    expectedWrittenSourceFingerprint: evidence.writtenSourceFingerprint(h.db.chapters, 3) });
  assert.equal(next.state.phase, "reviewing"); assert.equal(next.state.chapterId, "p3");
  assert.equal(next.state.rounds, session.state.rounds); assert.equal(next.state.maxRounds, session.state.maxRounds);
  assert.equal(next.candidate.volumes[0].chapters[2].taskSheet, "Reviewed neighbor");
});
for (const changed of ["version", "plan", "row", "contract", "budget"]) test(`committed reuse rejects changed ${changed}`, async () => {
  const h = fixture(); const s = await h.store.begin(h.input); await h.ready(s);
  const document = await h.store.commit(s, s.candidate);
  if (changed === "version") h.db.versions.find(v => v.status === "active").id = "other";
  if (changed === "plan") { const v=h.db.versions.find(v => v.status === "active");const d=JSON.parse(v.contentJson);d.volumes[0].chapters[1].taskSheet="tampered";v.contentJson=JSON.stringify(d); }
  if (changed === "row") h.db.volumes[0].chapters[1].taskSheet="tampered";
  if (changed === "contract") h.db.chapters[1].taskSheet="tampered";
  if (changed === "budget") h.db.novel.defaultChapterLength=4000;
  await assert.rejects(h.store.begin({ ...h.input, document }), /committed planning contract changed|Saved repair candidate|Saved candidate/);
});
test("legacy committed migration requires exact evidence and preserves lifecycle and budget", async () => {
  const h=fixture();const s=await h.store.begin(h.input);await h.ready(s);const document=await h.store.commit(s,s.candidate);
  const seed=JSON.parse(h.db.task.seedPayloadJson);delete seed.planningRepairSnapshot.committedPlanHash;delete seed.planningRepairSnapshot.committedSourceHash;
  h.db.task.seedPayloadJson=JSON.stringify(seed);h.db.task.status="cancelled";h.db.task.cancelRequestedAt=epoch;
  const before=copy(h.db.chapters);const state=await h.store.migrateCommittedSnapshot({novelId:"n",taskId:"t",expectedSeedPayloadJson:h.db.task.seedPayloadJson,evidenceDocument:document});
  assert.deepEqual(state,seed.planningRepair);assert.deepEqual(h.db.chapters,before);assert.equal(h.db.task.status,"cancelled");
  assert.ok(JSON.parse(h.db.task.seedPayloadJson).planningRepairSnapshot.committedPlanHash);
});
for(const changed of ["evidence","active plan","budget","contract","active job","CAS"])test(`legacy committed migration rejects ${changed}`,async()=>{
  const h=fixture();const s=await h.store.begin(h.input);await h.ready(s);const document=await h.store.commit(s,s.candidate);
  const seed=JSON.parse(h.db.task.seedPayloadJson);delete seed.planningRepairSnapshot.committedPlanHash;delete seed.planningRepairSnapshot.committedSourceHash;h.db.task.seedPayloadJson=JSON.stringify(seed);
  h.db.task.status="cancelled";h.db.task.cancelRequestedAt=epoch;
  if(changed==="evidence")document.volumes[0].chapters[1].taskSheet="tampered";
  if(changed==="active plan"){const v=h.db.versions.find(v=>v.status==="active");const d=JSON.parse(v.contentJson);d.volumes[0].chapters[1].taskSheet="tampered";v.contentJson=JSON.stringify(d);}
  if(changed==="budget")h.db.novel.defaultChapterLength=4000;
  if(changed==="contract")h.db.chapters[1].taskSheet="tampered";
  if(changed==="active job")h.db.activeJob={status:"running"};
  if(changed==="CAS")h.failCAS();
  await assert.rejects(h.store.migrateCommittedSnapshot({novelId:"n",taskId:"t",expectedSeedPayloadJson:h.db.task.seedPayloadJson,evidenceDocument:document}));
});


test("committed reviewed window reuses approved neighbor by plan or materialized id", async () => {
  const h=fixture(); const s=await h.store.begin(h.input);const candidate=h.candidate();
  candidate.volumes[0].chapters[2].taskSheet="Reviewed neighbor";
  await h.ready(s,candidate);const document=await h.store.commit(s,s.candidate);
  for(const chapterId of ["p3","c3"]){const resumed=await h.store.begin({...h.input,document,chapterId});
    assert.equal(resumed.state.phase,"committed");assert.equal(resumed.state.chapterId,"p2");assert.equal(resumed.state.rounds,s.state.rounds);}
});
test("unapproved neighbor opens its own planning gate instead of reusing committed window",async()=>{
  const h=fixture();const s=await h.store.begin(h.input);await h.ready(s);const document=await h.store.commit(s,s.candidate);
  const next=await h.store.begin({...h.input,document,chapterId:"p3"});
  assert.equal(next.state.chapterId,"p3");assert.equal(next.state.phase,"assessing");
});

test("legacy migration compares DB projection while version hash protects extended planning fields",async()=>{
 const h=fixture();const s=await h.store.begin(h.input);const candidate=h.candidate();
 candidate.volumes[0].chapters[1].exclusiveEvent="Reviewed exclusive event";
 candidate.volumes[0].chapters[1].endingState="Reviewed ending";
 await h.ready(s,candidate);const document=await h.store.commit(s,s.candidate);
 const seed=JSON.parse(h.db.task.seedPayloadJson);delete seed.planningRepairSnapshot.committedPlanHash;delete seed.planningRepairSnapshot.committedSourceHash;h.db.task.seedPayloadJson=JSON.stringify(seed);h.db.task.status="cancelled";
 for(const v of h.db.volumes){for(const key of ["openingHook","primaryPressureSource","coreSellingPoint","midVolumeRisk","payoffType"])v[key]=null;for(const c of v.chapters)for(const key of ["beatKey","exclusiveEvent","endingState","nextChapterEntryState","styleContract"])c[key]=null;}
 await h.store.migrateCommittedSnapshot({novelId:"n",taskId:"t",expectedSeedPayloadJson:h.db.task.seedPayloadJson,evidenceDocument:document});
 h.db.task.status="running";const v=h.db.versions.find(v=>v.status==="active");const d=JSON.parse(v.contentJson);d.volumes[0].chapters[1].exclusiveEvent="Tampered extension";v.contentJson=JSON.stringify(d);
 await assert.rejects(h.store.begin({...h.input,document}),/committed planning contract changed/);
});

async function committedRouteAppendFixture() {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  const evidenceDocument = await h.store.commit(session, session.candidate);
  const active = h.db.versions.find((version) => version.status === "active");
  const document = JSON.parse(active.contentJson);
  const appended = { ...copy(document.volumes[0].chapters[4]), id: "p7", chapterId: "c7",
    chapterOrder: 7, title: "Later route", summary: "Route only", taskSheet: null, sceneCards: null };
  document.volumes[0].chapters.push(appended);
  active.contentJson = JSON.stringify(document);
  h.db.volumes[0].chapters.push({ ...copy(appended), payoffRefsJson: JSON.stringify(appended.payoffRefs) });
  h.db.chapters.push({ ...copy(h.db.chapters[4]), id: "c7", order: 7, title: appended.title,
    expectation: appended.summary, taskSheet: null, sceneCards: null });
  h.db.task.status = "cancelled";
  h.db.task.cancelRequestedAt = epoch;
  return { h, document, evidenceDocument, input: { novelId: "n", taskId: "t",
    expectedSeedPayloadJson: h.db.task.seedPayloadJson, evidenceDocument } };
}

test("strict route append recovery preserves paid review and leaves new route unapproved", async () => {
  const { h, document, input } = await committedRouteAppendFixture();
  const originalState = copy(h.state());
  const originalData = copy({ chapters: h.db.chapters, volumes: h.db.volumes, versions: h.db.versions });
  await h.store.rebaseCommittedRouteAppend(input);
  assert.deepEqual(h.state(), originalState);
  assert.equal(h.db.task.status, "cancelled");
  assert.deepEqual({ chapters: h.db.chapters, volumes: h.db.volumes, versions: h.db.versions }, originalData);
  h.db.task.status = "running";
  h.db.task.cancelRequestedAt = null;
  assert.equal((await h.store.begin({ ...h.input, document })).state.phase, "committed");
  const next = await h.store.begin({ ...h.input, document, chapterId: "p7" });
  assert.equal(next.state.phase, "assessing");
  assert.equal(next.state.chapterId, "p7");
});

for (const change of ["old contract", "old row", "new prose", "new task sheet", "version", "active task", "active job", "active command", "CAS", "evidence", "budget"]) {
  test(`route append recovery rejects ${change} without changing the seed`, async () => {
    const { h, input } = await committedRouteAppendFixture();
    if (change === "old contract") {
      const active = h.db.versions.find((v) => v.status === "active");
      const document = JSON.parse(active.contentJson);
      document.volumes[0].chapters[1].taskSheet = "Tampered";
      active.contentJson = JSON.stringify(document);
    }
    if (change === "old row") h.db.chapters[1].expectation = "Tampered";
    if (change === "new prose") h.db.chapters.at(-1).content = "Already written";
    if (change === "new task sheet") h.db.chapters.at(-1).taskSheet = "Unreviewed contract";
    if (change === "version") h.db.versions.find((v) => v.status === "active").id = "replacement";
    if (change === "active task") h.db.task.status = "running";
    if (change === "active job") h.db.activeJob = { status: "running" };
    if (change === "active command") h.db.activeCommand = { status: "leased" };
    if (change === "CAS") h.failCAS();
    if (change === "evidence") input.evidenceDocument.volumes[0].chapters[1].summary = "Tampered";
    if (change === "budget") h.db.novel.defaultChapterLength = 4000;
    await assert.rejects(h.store.rebaseCommittedRouteAppend(input));
    assert.equal(h.db.task.seedPayloadJson, input.expectedSeedPayloadJson);
  });
}

// A chapter hand-off can land while a repair window is open: the auto-execution sync rewrites
// `status` (queued <-> running) and the autoExecution / directorSession / resumeTarget heartbeat
// keys after the repair read the row but before its CAS write. That is ordinary progress, not a
// new owner. Treating it as a concurrent edit failed the whole chapter batch with
// "The task changed concurrently; reload planning repair before continuing."
test("a chapter hand-off landing before the CAS write does not fail the repair", async () => {
  const h = fixture();
  const session = await h.store.begin(h.input);
  await h.ready(session);
  assert.equal(h.db.task.status, "running");
  let raced = false;
  h.raceTaskRead(2, (task) => {
    const seed = JSON.parse(task.seedPayloadJson);
    seed.autoExecution = { pipelineStatus: "running", completedChapterCount: 2 };
    seed.directorSession = { phase: "chapter_execution", isBackgroundRunning: true, updatedAt: "race" };
    seed.resumeTarget = { stage: "pipeline", chapterId: "c2", progress: 2 };
    task.seedPayloadJson = JSON.stringify(seed);
    task.status = "queued";
    task.heartbeatAt = "heartbeat-race";
    task.updatedAt = "heartbeat-race";
    raced = true;
  });

  await h.store.save(session, { ...session.state, summary: "章节交接继续" });

  assert.ok(raced, "the concurrent progress projection must have landed mid-transaction");
  const saved = JSON.parse(h.db.task.seedPayloadJson);
  // The progress projection survives the write instead of being rejected or reverted.
  assert.deepEqual(saved.autoExecution, { pipelineStatus: "running", completedChapterCount: 2 });
  assert.deepEqual(saved.directorSession, { phase: "chapter_execution", isBackgroundRunning: true, updatedAt: "race" });
  assert.deepEqual(saved.resumeTarget, { stage: "pipeline", chapterId: "c2", progress: 2 });
  assert.equal(h.db.task.status, "queued");
  assert.equal(saved.planningRepair.summary, "章节交接继续");
});

// A tolerant CAS must still reject every real ownership change, or takeovers would be swallowed.
for (const [name, mutate] of [
  ["a pause", (task) => { task.status = "waiting_approval"; }],
  ["a cancellation", (task) => { task.status = "cancelled"; task.cancelRequestedAt = epoch; }],
  ["a new execution generation", (task) => { task.attemptCount = 2; }],
  ["a manual-recovery pause", (task) => { task.pendingManualRecovery = true; }],
  ["a protected generation input", (task) => {
    const seed = JSON.parse(task.seedPayloadJson);
    seed.model = "another-model";
    seed.autoExecution = { pipelineStatus: "running" };
    task.seedPayloadJson = JSON.stringify(seed);
  }],
]) {
  test(`a concurrent ${name} still rejects the repair write`, async () => {
    const h = fixture();
    const session = await h.store.begin(h.input);
    await h.ready(session);
    const before = copy(h.db);
    h.raceTaskRead(2, mutate);
    await assert.rejects(
      h.store.save(session, { ...session.state, summary: "Must not overwrite" }),
      /changed concurrently/,
    );
    assert.deepEqual(h.db, before);
  });
}
