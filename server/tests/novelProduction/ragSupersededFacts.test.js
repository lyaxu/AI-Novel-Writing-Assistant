const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

function harness({ failLookup = false, rerank = false } = {}) {
  const rows = [
    { ownerType: "consistency_fact", ownerId: "old-fact" },
    { ownerType: "character_timeline", ownerId: "old-timeline" },
    { ownerType: "consistency_fact", ownerId: "deleted-fact" },
    { ownerType: "consistency_fact", ownerId: "current-fact" },
    { ownerType: "character_timeline", ownerId: "current-timeline" },
    { ownerType: "chapter", ownerId: "chapter" },
  ].map((item, index) => ({ ...item, id: String(index), chunkText: item.ownerId, chunkOrder: index, score: 1, novelId: "novel" }));
  const lookups = []; const reranked = [];
  const model = (type, activeId) => ({ findMany: async ({ where }) => {
    lookups.push({ type, where });
    if (failLookup) throw new Error("source validity unavailable");
    assert.deepEqual(where.source, { not: "superseded" });
    return where.id.in.includes(activeId) ? [{ id: activeId }] : [];
  } });
  class Tracer { setScope() {} record() {} flushAsync() {} }
  const { HybridRetrievalService } = loadRuntimeSource("../../rag/HybridRetrievalService.ts", {
    "../../db/prisma": { prisma: { knowledgeChunk: { findMany: async () => rows },
      consistencyFact: model("fact", "current-fact"), characterTimeline: model("timeline", "current-timeline") } },
    "../../config/rag": { ragConfig: { enabled: true, defaultTenantId: "t", finalTopK: 3, vectorCandidates: 10, keywordCandidates: 10, rerankerEnabled: rerank } },
    "./utils": { normalizeRagText: value => value, toKeywordTerms: value => [value], compactSnippet: value => value },
    "./EmbeddingService": {}, "./VectorStoreService": {},
    "../knowledge/common": { resolveKnowledgeDocumentIds: async () => [] },
    "./types": { RAG_OWNER_TYPES: ["consistency_fact", "character_timeline", "chapter", "knowledge_document"] },
    "./chunkFacets": { hasRagFacets: () => false, normalizeRagFacets: () => undefined },
    "./RagRetrievalTracer": { RagRetrievalTracer: Tracer },
    "./RagRerankerService": { resolveRerankerCandidateLimit: value => value },
  });
  const service = new HybridRetrievalService({ embedTexts: async () => ({ vectors: [[1]] }) }, {
    ensureCollection: async () => {}, search: async () => rows.map(row => ({ id: row.id, score: row.score, payload: row })),
  }, { rerank: async ({ documents }) => { reranked.push(...documents); return { used: false, results: [] }; } });
  return { service, lookups, reranked };
}

test("stale vectors and keyword chunks cannot expose superseded or deleted source facts before queue cleanup", async () => {
  const h = harness({ rerank: true });
  const result = await h.service.retrieve("事实", { novelId: "novel" });
  assert.deepEqual(result.map(row => row.ownerId), ["current-fact", "current-timeline", "chapter"]);
  assert.deepEqual(h.reranked.map(row => row.ownerId), ["current-fact", "current-timeline", "chapter"]);
  assert.equal(h.lookups.length, 2, "one source query per owner type, including both retrieval channels");
});

test("source validity lookup failure never returns unverified cached facts", async () => {
  const h = harness({ failLookup: true });
  await assert.rejects(h.service.buildContextBlock("事实", { novelId: "novel" }), /source validity unavailable/);
  assert.equal(h.reranked.length, 0);
});
