const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const crypto = require("node:crypto");
const proposalDecision = loadRuntimeSource("../production/actualState/proposalDecision.ts", {});
const contracts = loadRuntimeSource("../production/reliability/types.ts", { "node:crypto": crypto });
const { createChapterProductionJournal } = loadRuntimeSource("../production/reliability/session.ts", { "node:crypto": crypto, "./types": contracts });
const execution = loadRuntimeSource("../production/reliability/executionContext.ts", { "node:async_hooks": require("node:async_hooks"), "../../../../llm/invocation/executionPolicy": { withUnknownOutcomeProtection: fn => fn() } });

function fixture() {
  let chapter = { id: "c", novelId: "n", title: "retained", content: "retained original", taskSheet: "plan", sceneCards: null, expectation: null, targetWordCount: 2000 };
  let record = null; let assets = []; let boundaries = []; const versionWrites = []; const queued = []; let fail = null; let extractions = 0; let reconciles = 0;
  const tx = { chapter: { findFirst: async () => ({ order: 1, title: "retained" }) }, character: { findMany: async () => [] },
    characterTimeline: { updateMany: async () => {}, createMany: async () => {}, findMany: async () => [] },
    consistencyFact: { findMany: async () => [] }, storyTimelineEvent: { updateMany: async value => { versionWrites.push(["event", value]); } }, timelineHook: { updateMany: async value => { versionWrites.push(["hook", value]); } },
    stateChangeProposal: { findMany: async () => fail === "pending" ? [{ payloadJson: JSON.stringify({ syncContentHash: chapter.content, syncOperationId: JSON.parse(record.metadataJson).operationId }), status: "pending_review", validationNotesJson: "[]" }] : [] }, chapterArtifactSyncCheckpoint: { upsert: async value => { if (fail === "boundary") throw new Error("disk boundary"); boundaries.push(value); } } };
  const journal = createChapterProductionJournal({ repository: { async transaction(fn) {
    const before = structuredClone({ chapter, record, assets, boundaries });
    try { return await fn({ assetClient: tx, readChapter: async () => structuredClone(chapter), readJournal: async () => record,
      archiveJournal: async () => {}, writeJournal: async (_n, _c, _e, next) => { record = { metadataJson: next }; },
      writeContent: async (_n, _c, _e, data) => { chapter = { ...chapter, ...data }; }, writeState: async () => {} }); }
    catch (error) { ({ chapter, record, assets, boundaries } = before); throw error; }
  } } });
  const delta = { async extractChapterArtifacts(input) { extractions++; if (fail === "extract") throw new Error("network lost"); return { contentHash: input.content, output: { retained: input.content, stateDeltas: { characterStates: [] } } }; },
    async applyChapterArtifactConsumer(input) { assert.equal(input.output.retained, chapter.content); assets.push(input.consumer); if (fail === input.consumer) throw new Error("consumer disk failure"); return { concreteFactCount: 1 }; },
    toSyncResult() { return { requiresFullReconcile: fail === "reconcile" }; } };
  const { ChapterActualStateService } = loadRuntimeSource("../production/actualState/ChapterActualStateService.ts", {
    "./proposalDecision": proposalDecision,
    "../../../rag": { ragServices: { ragIndexService: { enqueueUpsert: async (...value) => { queued.push(value); }, enqueueDelete: async (...value) => { queued.push(value); } } } },
    "../reliability": { ...execution, ...contracts }, "./transactionContext": { runInActualStateTransaction: (_tx, fn) => fn() },
    "../../runtime/ChapterArtifactDeltaService": { ChapterArtifactDeltaService: class {}, buildContentHash: value => value, CHAPTER_ARTIFACT_CONSUMERS: ["facts", "snapshot", "resources"] },
    "../../runtime/artifactSync/ChapterArtifactSyncBoundary": { CHAPTER_ARTIFACT_BOUNDARY_TYPE: "boundary" },
    "../../../payoff/PayoffLedgerSyncService": { payoffLedgerSyncService: { async syncLedger() { reconciles++; throw Object.assign(new Error("reconcile failed"), { code: "CHAPTER_PRODUCTION_STORAGE" }); } } },
  });
  const service = new ChapterActualStateService(delta);
  return { open: operationId => journal.open({ novelId: "n", chapterId: "c", operationId, request: { entry: "pipeline" } }),
    run: session => execution.withProductionSession(session, () => service.sync({ novelId: "n", chapterId: "c", content: "retained original", contentProvenance: "debt" })),
    fail: value => { fail = value; }, edit: () => { chapter.content = "human"; },
    state: () => ({ assets, boundaries, record: JSON.parse(record.metadataJson), extractions, reconciles, chapter, versionWrites, queued }) };
}

test("quality-debt retained original commits real state; repeat uses same durable output", async () => {
  const f = fixture(); const s = await f.open(); const result = await f.run(s); await f.run(s);
  assert.equal(result.status, "completed"); assert.equal(f.state().extractions, 1);
  assert.deepEqual(f.state().assets, ["facts", "snapshot", "resources"]);
  assert.equal(JSON.parse(f.state().boundaries[0].create.metadataJson).outcome, "completed");
});
test("consumer failure rolls all asset writes back; resume reuses extraction", async () => {
  const f = fixture(); let s = await f.open(); f.fail("snapshot"); await assert.rejects(f.run(s));
  assert.deepEqual(f.state().assets, []); assert.equal(f.state().boundaries.length, 0);
  await s.close(); f.fail(null); s = await f.open(); await f.run(s);
  assert.equal(f.state().extractions, 1); assert.equal(f.state().assets.length, 3);
});
test("boundary disk failure does not redo extraction or committed consumers", async () => {
  const f = fixture(); let s = await f.open(); f.fail("boundary"); await assert.rejects(f.run(s));
  assert.equal(f.state().boundaries.length, 0); await s.close(); f.fail(null); s = await f.open(); await f.run(s);
  assert.equal(f.state().extractions, 1); assert.equal(f.state().assets.length, 3); assert.equal(f.state().boundaries.length, 1);
});
test("unknown extraction result never degrades to successful boundary or resends", async () => {
  const f = fixture(); let s = await f.open(); f.fail("extract"); await assert.rejects(f.run(s), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  await s.close(); f.fail(null); s = await f.open(); await assert.rejects(f.run(s), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  assert.equal(f.state().extractions, 1); assert.equal(f.state().boundaries.length, 0);
});
test("manual edit prevents old execution state writes", async () => {
  const f = fixture(); const s = await f.open(); f.edit(); await assert.rejects(f.run(s), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.deepEqual(f.state().assets, []);
});
test("required reconcile failure leaves no next-chapter completion boundary", async () => {
  const f = fixture(); const s = await f.open(); f.fail("reconcile"); await assert.rejects(f.run(s), /reconcile failed/);
  assert.equal(f.state().boundaries.length, 0); assert.equal(f.state().reconciles, 1);
});
test("scoped transaction adapter joins nested local transactions and never uses default client", async () => {
  let globalCalls = 0;
  const adapter = loadRuntimeSource("../production/actualState/transactionContext.ts", {
    "node:async_hooks": require("node:async_hooks"), "../../../../db/prisma": { prisma: { chapter: { findFirst: async () => { globalCalls++; } } } },
  });
  const tx = { chapter: { findFirst: async () => "transaction row" } };
  const value = await adapter.runInActualStateTransaction(tx, () => adapter.actualStateDb.$transaction(async nested => {
    assert.equal(nested, tx); return adapter.actualStateDb.chapter.findFirst();
  }));
  assert.equal(value, "transaction row"); assert.equal(globalCalls, 0); assert.equal(adapter.currentActualStateTransaction(), undefined);
});

function timelineFixture(failure) {
  let calls = 0; let commits = 0; let marks = 0; const events = [{ title: "the retained character left", occurred: true }];
  const context = { currentTime: { label: "day 1" }, openHooks: [], plannedEventsThisChapter: [], forbiddenEvents: [] };
  const { ChapterTimelineFinalizationService } = loadRuntimeSource("ChapterTimelineFinalizationService.ts", {
    "node:crypto": crypto,
    "../production/reliability": { ...execution, ...contracts },
    "../production/actualState": { actualStateDb: { chapterArtifactSyncCheckpoint: { upsert: async () => { marks++; } } }, runInActualStateTransaction: (_tx, fn) => fn() },
    "../../../modules/timeline": {
      storyTimelineService: { commitChapterTimeline: async input => { commits++; assert.deepEqual(input.extractedEvents, events); }, saveCheckReport: async () => {} },
      timelineContextService: { buildForChapter: async () => context },
      timelineExtractorService: { extractFromChapter: async input => { calls++; assert.equal(input.chapterContent, "retained original"); if (failure) throw new Error("extract disconnected"); return {}; }, normalizeEvents: () => events, normalizeHooks: () => [] },
      timelineCheckerService: { checkChapter: () => ({ status: "failed", score: 0.4, issues: [] }) }, timelineRepository: {},
    },
  });
  return { service: new ChapterTimelineFinalizationService(), state: () => ({ calls, commits, marks }), context };
}
test("quality-debt timeline records actual retained events even when story check is failed", async () => {
  const f = fixture(); const s = await f.open(); const t = timelineFixture(false);
  const input = { novelId: "n", chapterId: "c", content: "retained original", mode: "degraded", qualityDebt: true, sourceStage: "defer_and_continue",
    contextPackage: { chapter: { order: 1, title: "retained" }, timelineContext: t.context } };
  const first = await execution.withProductionSession(s, () => t.service.finalizeCurrentContent(input));
  await execution.withProductionSession(s, () => t.service.finalizeCurrentContent(input));
  assert.equal(first.syncMode, "stable"); assert.equal(first.extractorSucceeded, true);
  assert.deepEqual(t.state(), { calls: 1, commits: 1, marks: 1 });
});
test("failed timeline extraction preserves uncertainty and cannot create a degraded completion", async () => {
  const f = fixture(); let s = await f.open(); const t = timelineFixture(true);
  const input = { novelId: "n", chapterId: "c", content: "retained original", mode: "degraded", sourceStage: "defer_and_continue",
    contextPackage: { chapter: { order: 1 }, timelineContext: t.context } };
  await assert.rejects(execution.withProductionSession(s, () => t.service.finalizeCurrentContent(input)), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  await s.close(); s = await f.open();
  await assert.rejects(execution.withProductionSession(s, () => t.service.finalizeCurrentContent(input)), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
  assert.deepEqual(t.state(), { calls: 1, commits: 0, marks: 0 });
});

test("pending resource proposal stays saved and resumes after explicit confirmation without extraction", async () => {
  const f = fixture(); let s = await f.open(); f.fail("pending"); await assert.rejects(f.run(s), { code: "CHAPTER_PRODUCTION_STORAGE" });
  assert.equal(f.state().assets.length, 3); assert.equal(f.state().boundaries.length, 0);
  await s.close(); f.fail(null); s = await f.open(); await f.run(s);
  assert.equal(f.state().extractions, 1); assert.equal(f.state().assets.length, 3); assert.equal(f.state().boundaries.length, 1);
});

test("retained-version fact replacement preserves historical rows and empty result invalidates old auto facts", async () => {
  const rows = [{ id: "old", novelId: "n", chapterOrder: 1, text: "discarded draft fact", category: "completed", source: "auto" },
    { id: "manual", novelId: "n", chapterOrder: 1, text: "manual truth", category: "completed", source: "manual" }];
  const db = { chapter: { findFirst: async () => ({ id: "c" }) }, novelFactEntry: {
    updateMany: async ({ where, data }) => { for (const row of rows) if (row.source === where.source) Object.assign(row, data); },
    createMany: async ({ data }) => { rows.push(...data); },
    findMany: async ({ where }) => rows.filter(row => where.source.in.includes(row.source) && (typeof where.category === "string" ? where.category === row.category : where.category.in.includes(row.category))),
  }, $transaction: fn => fn(db) };
  const { NovelFactService } = loadRuntimeSource("../fact/NovelFactService.ts", {
    "../production/actualState": { actualStateDb: db, currentActualStateTransaction: () => db, assertLegacyChapterNotManaged: async () => {} },
    "../runtime/artifactSync/ChapterArtifactSyncResult": { ChapterArtifactContentVersionError: class extends Error {} },
  });
  const service = new NovelFactService();
  await service.replaceChapterFacts("n", 1, [{ text: "retained fact", category: "revealed" }], { chapterId: "c", expectedChapterContent: "retained" });
  assert.equal(rows.find(row => row.id === "old").source, "superseded");
  assert.deepEqual((await service.listForChapter({ novelId: "n", beforeChapterOrder: 2 })).map(row => row.text), ["manual truth", "retained fact"]);
  await service.replaceChapterFacts("n", 1, [], { chapterId: "c", expectedChapterContent: "empty facts" });
  assert.equal(rows.length, 3); assert.deepEqual((await service.listForChapter({ novelId: "n", beforeChapterOrder: 2 })).map(row => row.text), ["manual truth"]);
});
test("legacy asset write checks chapter ownership inside its transaction", async () => {
  const adapter = loadRuntimeSource("../production/actualState/transactionContext.ts", {
    "node:async_hooks": require("node:async_hooks"), "../../../../db/prisma": { prisma: {} },
  });
  const tx = { chapterArtifactSyncCheckpoint: { findFirst: async () => ({ id: "managed" }) } };
  await assert.rejects(adapter.assertLegacyChapterNotManaged(tx, "n", "c"), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  await adapter.runInActualStateTransaction(tx, () => adapter.assertLegacyChapterNotManaged(tx, "n", "c"));
});

test("new explicit operation retires previous timeline observations without deleting history", async () => {
  const f = fixture(); let s = await f.open(); const t = timelineFixture(false);
  const input = { novelId: "n", chapterId: "c", content: "retained original", sourceStage: "retained",
    contextPackage: { chapter: { order: 1 }, timelineContext: t.context } };
  await execution.withProductionSession(s, () => t.service.finalizeCurrentContent(input));
  await s.close({ completed: true }); s = await f.open("explicit-new-operation");
  await execution.withProductionSession(s, () => t.service.finalizeCurrentContent(input));
  assert.equal(f.state().versionWrites.filter(([kind, value]) => kind === "event" && value.data.status === "superseded").length, 2);
  assert.equal(f.state().versionWrites.filter(([kind, value]) => kind === "hook" && value.data.status === "dropped").length, 2);
  assert.equal(t.state().commits, 2);
});
test("successful actual-state commit queues chapter, summary and novel projections once", async () => {
  const f = fixture(); const s = await f.open(); await f.run(s); await f.run(s);
  assert.deepEqual(f.state().queued, [["chapter", "c"], ["chapter_summary", "c"], ["novel", "n"]]);
});

test("retained quality-debt resource observations keep provenance without forcing safe updates to manual review", () => {
  let active = true;
  const quality = loadRuntimeSource("../state/stateProposalSourceQuality.ts", {});
  const { CharacterResourceValidationService } = loadRuntimeSource("../characterResource/CharacterResourceValidationService.ts", {
    "../production/actualState": { currentActualStateTransaction: () => active ? {} : undefined },
    "@ai-novel/shared/types/characterResource": { characterResourceUpdatePayloadSchema: { safeParse: data => ({ success: true, data }) } },
    "./characterResourceShared": { compactText: value => String(value ?? "").trim() },
    "../state/stateProposalSourceQuality": quality,
  });
  const service = new CharacterResourceValidationService();
  const proposal = { sourceQuality: "debt", evidence: ["retained prose quote"], validationNotes: [], sourceType: "chapter_artifact_delta", riskLevel: "medium",
    payload: { resourceName: "key", narrativeImpact: "can enter room", updateType: "acquired", narrativeFunction: "tool", statusAfter: "available", confidence: 0.9 } };
  assert.equal(service.validateProposal(proposal).status, "committed");
  assert.equal(service.validateProposal({ ...proposal, riskLevel: "high" }).status, "pending_review");
  active = false; assert.equal(service.validateProposal(proposal).status, "pending_review");
});

test("invalid extraction is retained for explicit review, automated rejection cannot complete actual state", () => {
  const rejected = { status: "rejected", validationNotes: ["missing evidence"], payload: { syncOperationId: "op", syncContentHash: "hash" } };
  const next = proposalDecision.retainInvalidProposalsForReview({ accepted: [], pendingReview: [], rejected: [rejected] });
  assert.equal(next.rejected.length, 0); assert.equal(next.pendingReview[0].status, "pending_review");
  assert.ok(next.pendingReview[0].validationNotes.includes("missing evidence"));
  assert.ok(next.pendingReview[0].validationNotes.includes(proposalDecision.ACTUAL_STATE_INVALID_PROPOSAL));
  const row = { payloadJson: JSON.stringify(rejected.payload), status: "rejected", validationNotesJson: JSON.stringify(["auto_director_state_resolution:defer"]) };
  assert.equal(proposalDecision.hasUnresolvedActualStateProposal([row], "op", "hash"), true);
  row.validationNotesJson = JSON.stringify([proposalDecision.ACTUAL_STATE_MANUAL_IGNORE]);
  assert.equal(proposalDecision.hasUnresolvedActualStateProposal([row], "op", "hash"), false);
  assert.equal(proposalDecision.hasUnresolvedActualStateProposal([{ ...row, status: "pending_review" }], "different-op", "hash"), false);
});
test("legacy state extractor rejects journal-managed chapter before reading or calling external model", async () => {
  let reads = 0; let external = 0;
  const db = new Proxy({}, { get: () => { reads++; throw new Error("must not read before managed guard"); } });
  const { StateService } = loadRuntimeSource("../../state/StateService.ts", {
    "../novel/production/reliability": contracts,
    "../novel/production/actualState": { actualStateDb: db, currentActualStateTransaction: () => undefined, assertLegacyChapterNotManaged: async () => { throw new contracts.ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "managed"); } },
    "../novel/runtime/artifactSync/ChapterArtifactSyncResult": {}, "../novel/novelP0Utils": {},
    "../payoff/PayoffLedgerSyncService": {}, "./OpenConflictService": {}, "./stateConflictDetection": {},
    "./stateSnapshotExtraction": { extractSnapshotWithAI: async () => { external++; } },
  });
  await assert.rejects(new StateService().syncChapterState("n", "c", "draft"), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.equal(reads, 0); assert.equal(external, 0);
});

test("existing resource routes refuse invalid confirm and record explicit ignore for resumable boundary", async () => {
  const z = require("zod").z; const handlers = new Map(); let committed = 0; let update;
  const row = { validationNotesJson: JSON.stringify([proposalDecision.ACTUAL_STATE_INVALID_PROPOSAL]), payloadJson: "{}" };
  const { registerNovelCharacterResourceRoutes } = loadRuntimeSource("../../../modules/novel/characters/http/novelCharacterResourceRoutes.ts", {
    "../../../../services/novel/production/actualState": proposalDecision,
    "@ai-novel/shared/types/characterResource": { characterResourceUpdatePayloadSchema: { parse: () => { throw new Error("invalid parse must not run"); } } },
    "zod": { z }, "../../../../llm/providerSchema": { llmProviderSchema: z.string() },
    "../../../../db/prisma": { prisma: { stateChangeProposal: { findFirst: async () => row, findMany: async () => [], updateMany: async value => { update = value; return { count: 1 }; } } } },
    "../../../../middleware/errorHandler": { AppError: class extends Error { constructor(message, status) { super(message); this.status = status; } } },
    "../../../../middleware/validate": { validate: () => () => {} },
    "../../../../services/novel/characterResource/CharacterResourceExtractionService": {},
    "../../../../services/novel/characterResource/CharacterResourceLedgerService": { characterResourceLedgerService: { listResources: async () => [] } },
    "../../../../services/novel/state/StateCommitService": { stateCommitService: { commitExistingProposals: async () => { committed++; } } },
  });
  registerNovelCharacterResourceRoutes({ router: { get() {}, post(path, ...args) { handlers.set(path, args.at(-1)); } }, idParamsSchema: z.object({ id: z.string() }) });
  const req = { params: { id: "n", proposalId: "p" } }; const res = { status: () => res, json() {} }; let error;
  await handlers.get("/:id/character-resource-proposals/:proposalId/confirm")(req, res, value => { error = value; });
  assert.equal(error.status, 409); assert.equal(committed, 0);
  await handlers.get("/:id/character-resource-proposals/:proposalId/reject")(req, res, value => { throw value; });
  assert.equal(update.data.status, "rejected");
  assert.ok(JSON.parse(update.data.validationNotesJson).includes(proposalDecision.ACTUAL_STATE_MANUAL_IGNORE));
});

function legacyCharacterTimelineFixture({ race = false } = {}) {
  const writes = []; const extracted = []; let transaction = false;
  const adapter = loadRuntimeSource("../production/actualState/transactionContext.ts", {
    "node:async_hooks": require("node:async_hooks"), "../../../../db/prisma": { prisma: {} },
  });
  const db = {
    character: { findFirst: async () => ({ id: "person", name: "A" }) },
    chapter: { findMany: async () => ["managed", "legacy"].map((id, index) => ({ id, order: index + 1, title: id, content: id })) },
    chapterArtifactSyncCheckpoint: {
      findMany: async () => race && !transaction ? [] : [{ chapterId: "managed" }],
      findFirst: async ({ where }) => where.chapterId === "managed" ? { id: "journal" } : null,
    },
    characterTimeline: { deleteMany: async value => { writes.push(["delete", value]); }, createMany: async value => { writes.push(["create", value]); }, count: async () => 2 },
    $transaction: async fn => { transaction = true; return fn(db); },
  };
  const { NovelCoreCharacterService } = loadRuntimeSource("../novelCoreCharacterService.ts", {
    "../../db/prisma": { prisma: db }, "../../prompting/core/promptRunner": {},
    "../../prompting/prompts/novel/coreCharacter.prompts": {}, "../rag": {}, "./novelCoreSupport": {},
    "./worldContext/WorldContextGateway": { WorldContextGateway: class {} },
    "./novelCoreShared": { extractCharacterEventLines: content => { extracted.push(content); return [content]; } },
    "./characters/characterHardFacts": {}, "./production/actualState": adapter,
  });
  return { run: () => new NovelCoreCharacterService().syncCharacterTimeline("n", "person"), writes, extracted };
}

test("legacy character timeline excludes managed chapters from extraction, removal and insertion", async () => {
  const f = legacyCharacterTimelineFixture(); const result = await f.run();
  assert.deepEqual(f.extracted, ["legacy"]); assert.equal(result.syncedCount, 1);
  assert.deepEqual(f.writes[0][1].where.chapterId.notIn, ["managed"]);
  assert.deepEqual(f.writes[1][1].data.map(row => row.chapterId), ["legacy"]);
});

test("legacy character timeline refuses late journal ownership before any write", async () => {
  const f = legacyCharacterTimelineFixture({ race: true });
  await assert.rejects(f.run(), { code: "CHAPTER_PRODUCTION_CONFLICT" });
  assert.deepEqual(f.writes, []);
});

test("resource payload deduplication cannot inherit a prior operation or legacy rejection", async () => {
  let operationId = "old"; let existing = [];
  const quality = loadRuntimeSource("../state/stateProposalSourceQuality.ts", {});
  const { ChapterArtifactDeltaService } = loadRuntimeSource("ChapterArtifactDeltaService.ts", {
    "../characters/identity": {},
    "../production/reliability": { currentProductionSession: () => ({ operationId }) },
    "../production/actualState": { actualStateDb: { stateChangeProposal: { findMany: async () => existing } } },
    "./artifactSync/domain/deltaFormatting": { resolveCharacter: () => null },
    "../../../llm/invokeTimeout": {}, "../../../prompting/core/promptRunner": {},
    "../../../prompting/prompts/novel/chapterArtifactDelta.prompts": {}, "../../rag": {},
    "../../state/StateService": {}, "../../payoff/payoffLedgerShared": {},
    "../characterResource/CharacterResourceLedgerService": {}, "../characterMind/CharacterMindService": {},
    "../characterResource/CharacterResourceStaleScanService": {},
    "../characterResource/characterResourceShared": { normalizeResourceKey: () => "key" },
    "../fact/NovelFactService": {}, "../state/StateCommitService": {},
    "../state/stateProposalSourceQuality": quality, "./artifactSync/ChapterArtifactSyncResult": {},
    "./artifactSync/ChapterArtifactContentVersion": {},
  });
  const service = new ChapterArtifactDeltaService();
  const input = { novelId: "n", chapterId: "c", chapterOrder: 1, sourceType: "chapter_artifact_delta", sourceStage: "actual", contentHash: "same-hash", sourceQuality: "debt", characters: [],
    updates: [{ knownByCharacterNames: [], resourceName: "key", evidence: ["quote"] }] };
  const [old] = service.toCharacterResourceProposals(input);
  const legacyPayload = { ...old.payload }; delete legacyPayload.syncOperationId;
  existing = [{ payloadJson: JSON.stringify(old.payload) }, { payloadJson: JSON.stringify(legacyPayload) }];
  operationId = "new";
  const next = service.toCharacterResourceProposals(input);
  assert.equal(next[0].payload.syncOperationId, "new"); assert.equal(next[0].payload.syncContentHash, "same-hash");
  assert.equal((await service.filterPreviouslyAppliedResourceProposals(next)).length, 1);
  existing.push({ payloadJson: JSON.stringify(next[0].payload) });
  assert.equal((await service.filterPreviouslyAppliedResourceProposals(next)).length, 0);
});
