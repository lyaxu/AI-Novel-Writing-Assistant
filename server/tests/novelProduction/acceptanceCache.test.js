const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

function fixture() {
  const rows = new Map();
  const state = { revision: "v1", calls: 0, fail: false, identityFails: false, unavailable: false, mutateDuringRun: false, fallbackReads: 0, omitProgression: false };
  const { ChapterQualityGateService } = loadRuntimeSource("ChapterQualityGateService.ts", {
    "../../../db/prisma": { prisma: { chapterArtifactSyncCheckpoint: {
      findUnique: async ({ where }) => rows.get(JSON.stringify(where)) ?? null,
      findFirst: async ({ where }) => {
        state.fallbackReads++;
        return [...rows.values()].reverse().find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
      },
      upsert: async ({ where, create, update }) => rows.set(JSON.stringify(where), rows.has(JSON.stringify(where)) ? { ...rows.get(JSON.stringify(where)), ...update } : create),
    } } },
    "./ChapterAcceptanceAssessmentService": {},
    "./chapterRuntimePackageBuilders": { hashContent: (value) => crypto.createHash("sha256").update(value).digest("hex"), rememberCacheValue: (map, key, value) => map.set(key, value) },
  });
  const create = () => new ChapterQualityGateService({ acceptanceAssessmentService: {
    getCacheIdentity: async () => { if (state.identityFails) throw Error("config unavailable"); return state.revision; },
    assess: async () => {
      state.calls++;
      if (state.fail) throw Error("request failed");
      if (state.mutateDuringRun) state.revision = "v2";
      return { assessment: { riskTags: state.unavailable ? ["acceptance_gate_unavailable"] : [], blockingIssues: [],
        progressionChecks: state.omitProgression ? undefined : ["event_repetition", "knowledge_repetition", "prior_goal_followthrough"].map((dimension) => ({
          dimension, status: "not_applicable", previousEvidence: [], currentEvidence: [], validationIssues: [], explanation: "模拟已完成三维核验",
        })),
      } };
    },
  } });
  return { state, rows, create, input: { novelId: "n", chapterId: "c", content: "draft", request: {}, contextPackage: { chapter: { title: "Chapter", order: 1 } } } };
}

test("cache coalesces concurrent misses before persistent lookup resolves", async () => {
  const h = fixture(); const gate = h.create();
  await Promise.all([gate.runAcceptanceGate(h.input), gate.runAcceptanceGate(h.input)]);
  assert.equal(h.state.calls, 1);
  assert.equal(h.rows.size, 1);
});

test("rejected request clears in-flight slot and can be retried", async () => {
  const h = fixture(); const gate = h.create(); h.state.fail = true;
  await assert.rejects(gate.runAcceptanceGate(h.input), /request failed/);
  h.state.fail = false;
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
  assert.equal(h.state.fallbackReads, 0);
});

test("old same-content report with another request identity cannot bypass a fresh prompt", async () => {
  const h = fixture();
  await h.create().runAcceptanceGate(h.input);
  const [oldKey, oldRow] = [...h.rows][0];
  const payload = JSON.parse(oldRow.metadataJson);
  delete payload.result.assessment.progressionChecks;
  oldRow.metadataJson = JSON.stringify(payload);
  const oldJson = oldRow.metadataJson;
  h.state.revision = "prompt-v5";
  await h.create().runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
  assert.equal(h.rows.size, 2);
  assert.equal(h.rows.get(oldKey).metadataJson, oldJson);
  assert.equal(h.state.fallbackReads, 0);
});

test("exact-identity cache still requires complete postvalidated progression coverage", async () => {
  for (const mutate of [
    (assessment) => { delete assessment.progressionChecks; },
    (assessment) => { assessment.progressionChecks.pop(); },
    (assessment) => { assessment.progressionChecks[2] = assessment.progressionChecks[0]; },
    (assessment) => { delete assessment.progressionChecks[0].validationIssues; },
    (assessment) => { assessment.progressionChecks[0].status = "invented"; },
  ]) {
    const h = fixture();
    await h.create().runAcceptanceGate(h.input);
    for (const row of h.rows.values()) {
      const payload = JSON.parse(row.metadataJson); mutate(payload.result.assessment); row.metadataJson = JSON.stringify(payload);
    }
    await h.create().runAcceptanceGate(h.input);
    assert.equal(h.state.calls, 2);
  }
});

test("fresh incomplete progression assessment is returned but never cached as a completed gate", async () => {
  const h = fixture(); const gate = h.create(); h.state.omitProgression = true;
  await gate.runAcceptanceGate(h.input);
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
  assert.equal(h.rows.size, 0);
  h.state.omitProgression = false;
  await gate.runAcceptanceGate(h.input);
  await h.create().runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 3);
});

test("unavailable result clears slot without writing a successful cache", async () => {
  const h = fixture(); const gate = h.create(); h.state.unavailable = true;
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.rows.size, 0);
  h.state.unavailable = false;
  await gate.runAcceptanceGate(h.input);
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
});

test("configuration identity changes invalidate memory and persistent caches", async () => {
  const h = fixture(); const gate = h.create();
  await gate.runAcceptanceGate(h.input);
  h.state.revision = "v2";
  await gate.runAcceptanceGate(h.input);
  await h.create().runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
});

test("identity lookup failure bypasses old cache without blocking assessment", async () => {
  const h = fixture(); const gate = h.create();
  await gate.runAcceptanceGate(h.input);
  h.state.identityFails = true;
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
  assert.equal(h.rows.size, 1);
});

test("configuration mutation during assessment does not publish stale result", async () => {
  const h = fixture(); const gate = h.create(); h.state.mutateDuringRun = true;
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.rows.size, 0);
  h.state.mutateDuringRun = false;
  await gate.runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
});

test("legacy cache schema is ignored without deleting historical rows", async () => {
  const h = fixture();
  await h.create().runAcceptanceGate(h.input);
  for (const row of h.rows.values()) {
    const payload = JSON.parse(row.metadataJson); payload.schemaVersion = 1; row.metadataJson = JSON.stringify(payload);
  }
  await h.create().runAcceptanceGate(h.input);
  assert.equal(h.state.calls, 2);
  assert.equal(h.rows.size, 1);
});

test("cache identity renders effective context, overrides and model without volatile package metadata", async () => {
  const state = { context: "original", slot: "default", template: "official", model: "model-a", version: "v1" };
  const asset = { id: "acceptance", get version() { return state.version; }, slots: [{}], taskType: "review" };
  const { buildAcceptanceCacheIdentity } = loadRuntimeSource("acceptance/cacheIdentity.ts", {
    "./causalAssessment": loadRuntimeSource("acceptance/causalAssessment.ts", {
      "./actionStateProjection": loadRuntimeSource("acceptance/actionStateProjection.ts", {}),
      "./progressionProjection": loadRuntimeSource("acceptance/progressionProjection.ts", {}),
    }),
    "node:crypto": crypto,
    "../../../../llm/factory": { resolveLLMClientOptions: async () => ({ provider: "p", model: state.model, apiKey: "secret", baseURL: "local" }) },
    "../../../../prompting/core/promptRunner": { preparePromptExecution: ({ promptInput, contextBlocks }) => ({ context: {}, messages: [{ getType: () => "human", content: JSON.stringify({ promptInput, contextBlocks }) }] }) },
    "../../../../prompting/context/promptContextResolution": { resolvePromptContextBlocksForAsset: async () => ({ blocks: [state.context] }) },
    "../../../../prompting/prompts/novel/chapterLayeredContext": { buildChapterReviewContextBlocks: () => [] },
    "../../../../prompting/prompts/novel/chapterAcceptance.prompts": { chapterAcceptanceAssessmentPrompt: asset },
    "../../../../prompting/slots/PromptSlotOverrideService": { promptSlotOverrideService: { resolveForRuntime: async () => ({ appendBlocks: [state.slot] }) } },
    "../../../../prompting/templates/templateRuntime": { resolveAdvancedPromptMessages: async ({ officialMessages }) => [...officialMessages, { getType: () => "system", content: state.template }] },
  });
  const input = { novelId: "n", chapterId: "c", novelTitle: "N", chapterTitle: "C", chapterOrder: 1, content: "draft", contextPackage: { generatedAt: "old" } };
  const original = await buildAcceptanceCacheIdentity(input);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(await buildAcceptanceCacheIdentity({ ...input, contextPackage: { generatedAt: "new" } }), original);
  for (const key of Object.keys(state)) {
    const previous = state[key]; state[key] = "changed";
    assert.notEqual(await buildAcceptanceCacheIdentity(input), original, key);
    state[key] = previous;
  }
  assert.notEqual(await buildAcceptanceCacheIdentity({ ...input, targetWordCount: 9000 }), original);
  assert.notEqual(await buildAcceptanceCacheIdentity({ ...input, contextPackage: {
    chapterReviewContext: { scenePlan: { scenes: [{ key: "s1", causality: {} }] } },
  } }), original, "requested causal coverage changes the cache identity");
});
