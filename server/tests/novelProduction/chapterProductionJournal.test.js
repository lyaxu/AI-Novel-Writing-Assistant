const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const types = () => loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": require("node:crypto") });
function fixture() {
  const contracts = types();
  const { createChapterProductionJournal } = loadRuntimeSource("../production/reliability/session.ts", {
    "node:crypto": require("node:crypto"), "./types": contracts,
  });
  let now = 1000;
  let chapter = { id: "c", novelId: "n", title: "chapter", content: "original", taskSheet: "contract", sceneCards: null, expectation: null, targetWordCount: 2800 };
  let record = null;
  const archives = [];
  let failSave = false;
  let failJournal = false;
  let tail = Promise.resolve();
  const repository = { transaction(fn) {
    const operation = tail.then(async () => {
      const saved = structuredClone({ chapter, record });
      try {
        return await fn({
          readChapter: async () => structuredClone(chapter),
          readJournal: async () => record && { ...record },
          writeJournal: async (_n, _c, expected, next) => {
            if (failJournal) { failJournal = false; throw new Error("journal disk failure"); }
            assert.equal(record?.metadataJson ?? null, expected);
            record = { metadataJson: next, status: JSON.parse(next).status };
          },
          archiveJournal: async (_n, _c, value) => { archives.push(structuredClone(value)); },
          writeContent: async (_n, _c, expected, data) => {
            if (failSave) { failSave = false; throw new Error("disk failure"); }
            assert.equal(contracts.chapterFingerprint(chapter), contracts.chapterFingerprint(expected));
            chapter = { ...chapter, ...data };
          },
          writeState: async (_n, _c, expected, data) => {
            assert.equal(contracts.chapterFingerprint(chapter), contracts.chapterFingerprint(expected));
            chapter = { ...chapter, ...data };
          },
        });
      } catch (error) { ({ chapter, record } = saved); throw error; }
    });
    tail = operation.catch(() => {});
    return operation;
  } };
  const journal = createChapterProductionJournal({ repository, now: () => now, leaseMs: 900 });
  return {
    open: (operationId, request = { entry: "stream", model: "offline" }) => journal.open({ novelId: "n", chapterId: "c", request, operationId }),
    chapter: () => chapter, record: () => JSON.parse(record.metadataJson),
    edit: (data) => { chapter = { ...chapter, ...data }; },
    expire: () => { now += 901; }, failSave: () => { failSave = true; },
    failJournal: () => { failJournal = true; },
    archives: () => archives,
    inspect: () => journal.inspect({ novelId: "n", chapterId: "c" }),
    resumeRequest: operationId => journal.readResumeRequest({ novelId: "n", chapterId: "c", operationId }),
  };
}
test("review failure resumes saved writer result without writing again", async () => {
  const f = fixture(); let calls = 0;
  let s = await f.open();
  await s.runStep("writer", async () => { calls++; return "draft"; }, { external: true });
  await s.saveContent({ content: "draft" });
  await assert.rejects(s.runStep("review", async () => { throw new Error("review failure"); }));
  await s.close(); s = await f.open();
  assert.equal(await s.runStep("writer", async () => { calls++; return "wrong"; }, { external: true }), "draft");
  await s.runStep("review", async () => "reviewed");
  assert.equal(calls, 1); assert.equal(f.chapter().content, "draft");
});
test("duplicate ownership is refused and stale owner cannot save", async () => {
  const f = fixture(); const first = await f.open();
  await assert.rejects(f.open(), { code: "CHAPTER_PRODUCTION_BUSY" });
  f.expire(); const second = await f.open();
  await assert.rejects(first.saveContent({ content: "stale" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await second.saveContent({ content: "current" });
});
test("manual content and execution contract edits prevent save", async () => {
  for (const data of [{ content: "human" }, { taskSheet: "human plan" }, { title: "changed" }, { targetWordCount: 4000 },
    { mustAvoid: "new restriction" }, { conflictLevel: 3 }, { revealLevel: 2 }, { hook: "new hook" }]) {
    const f = fixture(); const s = await f.open(); f.edit(data);
    await assert.rejects(s.saveContent({ content: "generated" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
    assert.notEqual(f.chapter().content, "generated");
  }
});
test("partial stream remains recoverable and unknown external result is not resent", async () => {
  const f = fixture(); let s = await f.open();
  await assert.rejects(s.runStep("writer", async () => { await s.checkpoint("partial"); throw new Error("connection lost"); }, { external: true }));
  await s.close(); s = await f.open(); let calls = 0;
  await assert.rejects(s.runStep("writer", async () => { calls++; }, { external: true }), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  assert.equal(calls, 0); assert.equal(f.record().partialText, "partial"); assert.equal(f.chapter().content, "original");
});
test("completed step is reusable after process loss; running external step blocks retry", async () => {
  const f = fixture(); const first = await f.open();
  await first.runStep("prepare", async () => ({ plan: "ready" }));
  let release; let started; const ready = new Promise(r => { started = r; });
  const running = first.runStep("writer", async () => { started(); return new Promise(r => { release = r; }); }, { external: true });
  await ready; f.expire(); const second = await f.open();
  assert.deepEqual(await second.runStep("prepare", async () => assert.fail("must reuse")), { plan: "ready" });
  await assert.rejects(second.runStep("writer", async () => assert.fail("must not send")), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  release("late"); await assert.rejects(running, { code: "CHAPTER_PRODUCTION_CONFLICT" });
});
test("failed save preserves generated result for a later save without duplicate writer", async () => {
  const f = fixture(); let s = await f.open();
  await s.runStep("writer", async () => "complete draft", { external: true }); f.failSave();
  await assert.rejects(s.saveContent({ content: "complete draft" }), /disk failure/);
  await s.close(); s = await f.open();
  const draft = await s.runStep("writer", async () => assert.fail("writer duplicated"));
  await s.saveContent({ content: draft }); assert.equal(f.chapter().content, "complete draft");
});
test("prepared contract can be bound but content changes cannot", async () => {
  const f = fixture(); const s = await f.open(); f.edit({ taskSheet: "prepared" });
  await s.bindPrepared({ planId: "p" }); await s.saveContent({ content: "draft" });
  f.edit({ content: "human" }); await assert.rejects(s.bindPrepared({}), { code: "CHAPTER_PRODUCTION_CONFLICT" });
});
test("nested steps persist their independent results", async () => {
  const f = fixture(); const s = await f.open();
  assert.equal(await s.runStep("outer", async () => s.runStep("inner", async () => "ok")), "ok");
  assert.equal(f.record().steps.inner.status, "done"); assert.equal(f.record().steps.outer.status, "done");
});
test("state sync resumes after saved prose and completed review", async () => {
  const f = fixture(); let s = await f.open();
  await s.saveContent({ content: "approved original" });
  await s.runStep("review", async () => ({ pass: true }));
  await assert.rejects(s.runStep("sync", async () => { throw new Error("sync failure"); }));
  await s.close(); s = await f.open();
  assert.deepEqual(await s.runStep("review", async () => assert.fail("review repeated")), { pass: true });
  await s.runStep("sync", async () => "synced"); await s.close({ completed: true });
  assert.equal(f.record().status, "completed"); assert.equal(f.chapter().content, "approved original");
});
test("content and expected fingerprint commit or rollback together", async () => {
  const f = fixture(); const s = await f.open(); f.failJournal();
  await assert.rejects(s.saveContent({ content: "draft" }), { code: "CHAPTER_PRODUCTION_STORAGE" });
  assert.equal(f.chapter().content, "original");
  await s.saveContent({ content: "draft" }); await s.assertCurrent();
});
test("completed marker and state writes reject manually changed prose", async () => {
  const f = fixture(); const s = await f.open();
  await s.updateState({ generationState: "reviewed", chapterStatus: "needs_repair" });
  assert.equal(f.chapter().content, "original"); f.edit({ content: "human" });
  await assert.rejects(s.updateState({ generationState: "approved" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await assert.rejects(s.close({ completed: true }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await s.close({ error: new Error("manual edit") }); assert.equal(f.record().status, "paused");
});
test("typed definitive external failure can retry after close", async () => {
  const f = fixture(); let s = await f.open();
  await assert.rejects(s.runStep("review", async () => { throw Object.assign(new Error("known rejection"), { name: "StructuredOutputError", category: "schema_mismatch" }); }, { external: true }), /known rejection/);
  await s.close(); s = await f.open();
  assert.equal(await s.runStep("review", async () => "reviewed", { external: true }), "reviewed");
});
test("output limit retains its safety code and never resends the unknown step", async () => {
  const f = fixture(); let s = await f.open();
  const error = Object.assign(new Error("limit"), { code: "LLM_OUTPUT_LIMIT" });
  await assert.rejects(s.runStep("writer", async () => { throw error; }, { external: true }), value => value === error);
  assert.equal(f.record().steps.writer.status, "unknown"); await s.close(); s = await f.open();
  await assert.rejects(s.runStep("writer", async () => assert.fail("resent")), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
});
test("definitive typed protocols classify without message matching", async () => {
  const categories = ["unsupported_native_json", "thinking_pollution", "incomplete_json", "malformed_json", "schema_mismatch"];
  const errors = categories.map(category => Object.assign(new Error("opaque"), { name: "StructuredOutputError", category }));
  errors.push(Object.assign(new Error("opaque"), { name: "ChapterPatchRepairFailedError" }));
  errors.push(Object.assign(new Error("opaque"), { code: "CHAPTER_EMPTY_CONTENT" }));
  for (const error of errors) {
    const f = fixture(); const s = await f.open();
    await assert.rejects(s.runStep("external", async () => { throw error; }, { external: true }), value => value === error);
    assert.equal(f.record().steps.external.status, "failed");
  }
  for (const category of ["transport_error", "output_limit", "future_unknown"]) {
    const f = fixture(); const s = await f.open();
    const error = Object.assign(new Error("opaque"), { name: "StructuredOutputError", category });
    await assert.rejects(s.runStep("external", async () => { throw error; }, { external: true }));
    assert.equal(f.record().steps.external.status, "unknown");
  }
});
test("nested production safety errors keep identity while external step remains unknown", async () => {
  const f = fixture(); const s = await f.open();
  const error = Object.assign(new Error("safety"), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await assert.rejects(s.runStep("external", async () => { throw error; }, { external: true }), value => value === error);
  assert.equal(f.record().steps.external.status, "unknown");
});
test("network codes become uncertain instead of bypassing production recovery pause", async () => {
  for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
    const f = fixture(); const s = await f.open(); const error = Object.assign(new Error("network"), { code });
    await assert.rejects(s.runStep("writer", async () => { throw error; }, { external: true }), value => value.code === "CHAPTER_PRODUCTION_UNCERTAIN" && value.cause === error);
    assert.equal(f.record().steps.writer.status, "unknown");
  }
});
test("planning terminal codes remain visible to their recovery owner", async () => {
  for (const code of ["PLANNING_REPAIR_CONFLICT", "PLANNING_REPAIR_CONFIRMATION_REQUIRED", "CONFIRMATION_REQUIRED"]) {
    const f = fixture(); const s = await f.open(); const error = Object.assign(new Error("planning"), { code });
    await assert.rejects(s.runStep("prepare", async () => { throw error; }, { external: true }), value => value === error);
  }
});
test("inspection reads safe recovery projection without claiming, renewing or writing", async () => {
  const f = fixture(); assert.equal(await f.inspect(), null); const s = await f.open();
  await s.bindPrepared({ secret: "hidden prepared context" }); await s.put("private", { apiKey: "hidden value" });
  await s.checkpoint("partial draft"); await s.runStep("review", async () => ({ private: "hidden result" }));
  await assert.rejects(s.runStep("writer", async () => { throw new Error("connection lost: hidden provider apiKey"); }, { external: true }));
  await s.close(); f.expire(); const before = structuredClone(f.record());
  const projection = await f.inspect();
  assert.deepEqual(f.record(), before);
  assert.deepEqual(Object.keys(projection).sort(), ["resumeBlockedReason", "entry", "leaseActive", "inputChanged", "canResume", "error", "operationId", "partialText", "savedDraft", "status", "steps"].sort());
  assert.equal(projection.partialText, "partial draft"); assert.equal(projection.savedDraft, "original");
  assert.equal(projection.steps.find(step => step.key === "writer").status, "unknown");
  assert.equal(JSON.stringify(projection).includes("hidden"), false);
});
test("getStepOutput exposes only durable completed output across reopen", async () => {
  const f = fixture(); let s = await f.open();
  assert.equal(s.getStepOutput("writer"), undefined);
  await s.runStep("writer", async () => ({ content: "raw draft" }), { external: true });
  assert.deepEqual(s.getStepOutput("writer"), { content: "raw draft" }); await s.close(); s = await f.open();
  assert.deepEqual(s.getStepOutput("writer"), { content: "raw draft" });
});
test("explicit new operation archives unknown output and binds current human draft", async () => {
  const f = fixture(); const first = await f.open("first");
  await assert.rejects(first.runStep("writer", async () => { await first.checkpoint("partial"); throw new Error("lost"); }, { external: true }));
  await first.close(); f.edit({ content: "human draft" });
  await assert.rejects(f.open(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await assert.rejects(f.open("first"), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  const second = await f.open("explicit-second");
  assert.equal(second.operationId, "explicit-second"); assert.equal(second.getStepOutput("writer"), undefined);
  assert.equal(f.chapter().content, "human draft"); assert.equal(f.archives().length, 1);
  assert.equal(f.archives()[0].steps.writer.status, "unknown"); assert.equal(f.archives()[0].partialText, "partial");
  await assert.rejects(f.open("third"), { code: "CHAPTER_PRODUCTION_BUSY" });
});
test("storage failure after external output never marks it retryable", async () => {
  const f = fixture(); let s = await f.open();
  await assert.rejects(s.runStep("writer", async () => { f.failJournal(); return "lost response"; }, { external: true }), { code: "CHAPTER_PRODUCTION_STORAGE" });
  await s.close(); s = await f.open();
  await assert.rejects(s.runStep("writer", async () => assert.fail("duplicated call")), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
});

// Actual SQLite transactions, behind an explicit Prisma-shaped facade; never import db/prisma.
function sqliteFixture(t) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE Chapter (id TEXT PRIMARY KEY, novelId TEXT, content TEXT, title TEXT, taskSheet TEXT, sceneCards TEXT, expectation TEXT, targetWordCount INTEGER, generationState TEXT, chapterStatus TEXT, mustAvoid TEXT, conflictLevel INTEGER, revealLevel INTEGER, hook TEXT);
    CREATE TABLE Checkpoint (novelId TEXT, chapterId TEXT, contentHash TEXT, artifactType TEXT, syncMode TEXT, metadataJson TEXT, status TEXT, UNIQUE(novelId,chapterId,contentHash,artifactType,syncMode));
    INSERT INTO Chapter VALUES ('c','n','original','chapter','contract',NULL,NULL,2800,'planned','pending_generation',NULL,NULL,NULL,NULL);`);
  let failJournal = false; let now = 1000; let tail = Promise.resolve();
  const whereSql = (where) => Object.keys(where).map(key => `"${key}" IS ?`).join(" AND ");
  const find = (table, where) => db.prepare(`SELECT * FROM ${table} WHERE ${whereSql(where)}`).get(...Object.values(where)) ?? null;
  const insert = (table, data) => db.prepare(`INSERT INTO ${table} (${Object.keys(data).map(key => `"${key}"`).join(",")}) VALUES (${Object.keys(data).map(() => "?").join(",")})`).run(...Object.values(data));
  function update(table, where, data) {
    if (table === "Checkpoint" && failJournal) { failJournal = false; throw new Error("SQLite checkpoint fault"); }
    const result = db.prepare(`UPDATE ${table} SET ${Object.keys(data).map(key => `"${key}"=?`).join(",")} WHERE ${whereSql(where)}`).run(...Object.values(data), ...Object.values(where));
    return { count: Number(result.changes) };
  }
  const transaction = {
    chapter: { findFirst: async ({ where }) => find("Chapter", where), updateMany: async ({ where, data }) => update("Chapter", where, data) },
    chapterArtifactSyncCheckpoint: {
      findUnique: async ({ where }) => find("Checkpoint", where.novelId_chapterId_contentHash_artifactType_syncMode),
      create: async ({ data }) => {
        try { insert("Checkpoint", data); } catch (error) { if (error.message.includes("UNIQUE")) error.code = "P2002"; throw error; }
      },
      updateMany: async ({ where, data }) => update("Checkpoint", where, data),
      upsert: async ({ where, create }) => { if (!find("Checkpoint", where.novelId_chapterId_contentHash_artifactType_syncMode)) insert("Checkpoint", create); },
    },
  };
  const prismaFacade = { $transaction(fn) {
    const pending = tail.then(async () => {
      db.exec("BEGIN IMMEDIATE");
      try { const result = await fn(transaction); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    });
    tail = pending.catch(() => {}); return pending;
  } };
  const contracts = types();
  const { createPrismaChapterProductionRepository } = loadRuntimeSource("../production/reliability/repository.ts", { "./types": contracts });
  const repository = createPrismaChapterProductionRepository(prismaFacade);
  const { createChapterProductionJournal } = loadRuntimeSource("../production/reliability/session.ts", { "node:crypto": require("node:crypto"), "./types": contracts });
  const journal = createChapterProductionJournal({ repository, now: () => now, leaseMs: 900 });
  return {
    open: () => journal.open({ novelId: "n", chapterId: "c", request: { model: "offline" } }),
    chapter: () => find("Chapter", { id: "c" }),
    edit: (data) => update("Chapter", { id: "c" }, data),
    expire: () => { now += 901; }, failJournal: () => { failJournal = true; },
    repository, contracts,
  };
}
test("SQLite: concurrent opens have one owner; stale token cannot write", async t => {
  const f = sqliteFixture(t); const results = await Promise.allSettled([f.open(), f.open()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "CHAPTER_PRODUCTION_BUSY");
  const stale = results.find(result => result.status === "fulfilled").value;
  f.expire(); const current = await f.open();
  await assert.rejects(stale.saveContent({ content: "late" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await current.saveContent({ content: "current" }); assert.equal(f.chapter().content, "current");
});
test("SQLite: checkpoint failure rolls back prose and permits same draft save", async t => {
  const f = sqliteFixture(t); const s = await f.open();
  await s.runStep("writer", async () => "draft", { external: true }); f.failJournal();
  await assert.rejects(s.saveContent({ content: "draft" }), { code: "CHAPTER_PRODUCTION_STORAGE" });
  assert.equal(f.chapter().content, "original");
  await s.saveContent({ content: "draft" }); await s.assertCurrent(); assert.equal(f.chapter().content, "draft");
});
test("SQLite: manual contract/content updates and stale raw metadata fail CAS", async t => {
  const f = sqliteFixture(t); const s = await f.open(); const expected = f.chapter();
  f.edit({ taskSheet: "human contract", content: "human draft" });
  await assert.rejects(s.saveContent({ content: "overwrite" }), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await assert.rejects(f.repository.transaction(tx => tx.writeContent("n", "c", expected, { content: "direct overwrite" })), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await assert.rejects(f.repository.transaction(tx => tx.writeJournal("n", "c", "stale metadata", JSON.stringify({ status: "completed" }))), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(f.chapter().content, "human draft");
});

test('resume uses private original request and never projects its values', async () => {
  const f = fixture(); const s = await f.open('op', { entry: 'repair', model: 'chosen-model', userInstruction: 'private' });
  await assert.rejects(f.resumeRequest('op'), { code: 'CHAPTER_PRODUCTION_BUSY' });
  await s.close();
  assert.equal((await f.inspect()).canResume, true);
  assert.equal(JSON.stringify(await f.inspect()).includes('private'), false);
  assert.deepEqual(await f.resumeRequest('op'), { entry: 'repair', model: 'chosen-model', userInstruction: 'private' });
  await assert.rejects(f.resumeRequest('wrong'), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
  f.edit({ content: 'human edit' });
  assert.equal((await f.inspect()).inputChanged, true);
  await assert.rejects(f.resumeRequest('op'), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
});

test('unfinished stream and parent pipeline require source review instead of chapter resend', async () => {
  const f = fixture(); const s = await f.open('op'); await s.put('stream.started', true); await s.close();
  assert.equal((await f.inspect()).canResume, false);
  await assert.rejects(f.resumeRequest('op'), { code: 'CHAPTER_PRODUCTION_UNCERTAIN' });
  const g = fixture(); const parent = await g.open('op', { entry: 'pipeline', workflowTaskId: 'director-task' }); await parent.close();
  assert.equal((await g.inspect()).workflowTaskId, 'director-task');
  assert.equal((await g.inspect()).canResume, false);
});

test('SQLite: asset and completion marker roll back together, then replay without rewriting', async t => {
  const f = sqliteFixture(t); let s = await f.open(); let writes = 0;
  const write = async tx => { writes++; await tx.chapter.updateMany({ where: { id: 'c' }, data: { generationState: 'reviewed' } }); return { committed: true }; };
  f.failJournal();
  await assert.rejects(s.commitState('actual-state', write), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  assert.equal(f.chapter().generationState, 'planned');
  assert.deepEqual(await s.commitState('actual-state', write), { committed: true });
  await s.close(); s = await f.open();
  assert.deepEqual(await s.commitState('actual-state', () => assert.fail('duplicate write')), { committed: true });
  assert.equal(writes, 2);
  f.edit({ content: 'human' });
  await assert.rejects(s.commitState('late-assets', write), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
});
