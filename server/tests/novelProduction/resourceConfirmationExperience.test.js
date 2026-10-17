const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadRuntimeSource } = require("./sourceHarness.cjs");
const schema = loadRuntimeSource(path.resolve(__dirname, "../../../shared/types/characterResource.ts"), { zod: require("zod") });
const extractionSchema = loadRuntimeSource(path.resolve(__dirname, "../../src/prompting/prompts/novel/characterResource.promptSchemas.ts"), {
  zod: require("zod"), "@ai-novel/shared/types/characterResource": schema,
});
const sourceQuality = loadRuntimeSource("../state/stateProposalSourceQuality.ts", {});
const { buildResourceReviewPresentation } = loadRuntimeSource(path.resolve(__dirname,
  "../../../client/src/pages/novels/components/chapterInsights/resourceReviewPresentation.ts"), {});

function validator(inActualState = true) {
  const { CharacterResourceValidationService } = loadRuntimeSource("../characterResource/CharacterResourceValidationService.ts", {
    "../production/actualState": { currentActualStateTransaction: () => inActualState ? {} : null },
    "@ai-novel/shared/types/characterResource": schema,
    "./characterResourceShared": { compactText: (value) => String(value ?? "").trim() },
    "../state/stateProposalSourceQuality": sourceQuality,
  });
  return new CharacterResourceValidationService();
}

function proposal(payload = {}, overrides = {}) {
  return {
    id: "resource-review", novelId: "novel", chapterId: "chapter", sourceType: "chapter_artifact_delta",
    proposalType: "character_resource_update", status: "validated", riskLevel: "low",
    summary: "用掉最后一张护身符", evidence: ["她点燃最后一张护身符，符纸在掌心化成灰。"], validationNotes: [],
    payload: {
      resourceName: "护身符", resourceType: "consumable", narrativeFunction: "tool", updateType: "consumed",
      ownerType: "character", ownerName: "阿青", holderCharacterName: "阿青", statusAfter: "consumed",
      visibilityAfter: { readerKnows: true, holderKnows: true, knownByCharacterIds: [] },
      narrativeImpact: "阿青后续不能再次使用这张护身符。", constraints: [], confidence: 0.96,
      ...payload,
    },
    ...overrides,
  };
}

test("clear story events automatically record even when the resource is lost, consumed or a hidden card", () => {
  for (const [updateType, statusAfter] of [["consumed", "consumed"], ["lost", "lost"], ["destroyed", "destroyed"], ["damaged", "damaged"], ["revealed", "hidden"]]) {
    const result = validator().validateProposal(proposal({ updateType, statusAfter, narrativeFunction: "hidden_card" }));
    assert.equal(result.status, "committed", updateType);
  }
});

test("fact uncertainty remains pending regardless of low risk label or missing explanation fields", () => {
  const service = validator();
  assert.equal(service.validateProposal(proposal({}, { riskLevel: "high" })).status, "pending_review");
  assert.equal(service.validateProposal(proposal({ confidence: 0.2 })).status, "pending_review");
  assert.equal(service.validateProposal(proposal({ reviewQuestion: "旧账记载护身符已经烧掉，本章使用的是另一张吗？" })).status, "pending_review");
  assert.equal(service.validateProposal(proposal({}, { evidence: [] })).status, "rejected");
  assert.equal(service.validateProposal(proposal({ statusAfter: "invalid" })).status, "rejected");
  assert.equal(validator(false).validateProposal(proposal({}, { sourceQuality: "debt" })).status, "pending_review");
});

test("structured review retains a concrete ownership conflict through persistence schema and user presentation", () => {
  const review = {
    riskReason: "已有账本将铜钥匙记为老周所有，正文只说明阿青借走，没有转赠证据。",
    reviewQuestion: "铜钥匙仍属于老周、只是借给阿青吗？",
    ledgerFact: "铜钥匙归老周所有。",
    chapterFact: "阿青借走铜钥匙。",
  };
  const parsedExtraction = extractionSchema.characterResourceExtractionUpdateSchema.parse({
    ...proposal().payload, ...review, riskLevel: "high", evidence: ["老周：钥匙借你，用完还我。"],
  });
  const persisted = schema.characterResourceUpdatePayloadSchema.parse({ ...parsedExtraction,
    visibilityAfter: { readerKnows: parsedExtraction.readerKnows, holderKnows: parsedExtraction.holderKnows, knownByCharacterIds: [] },
  });
  const saved = proposal(persisted, { riskLevel: "high" });
  const validated = validator().validateProposal(saved);
  assert.equal(validated.status, "pending_review");
  const displayed = buildResourceReviewPresentation(validated);
  assert.equal(displayed.question, review.reviewQuestion);
  assert.equal(displayed.ledgerFact, review.ledgerFact);
  assert.equal(displayed.chapterFact, review.chapterFact);
});

test("legacy proposals preserve their stated reason without inventing an older ledger fact", () => {
  const old = proposal({}, { riskLevel: "high", validationNotes: ["正文没有说明钥匙从老周转交阿青。", "resource update requires manual review"] });
  const displayed = buildResourceReviewPresentation(old);
  assert.equal(displayed.question, old.validationNotes[0]);
  assert.equal(displayed.ledgerFact, null);
  assert.equal(displayed.chapterFact, null);
  assert.equal(validator().validateProposal(old).status, "pending_review");
  const missing = buildResourceReviewPresentation(proposal({}, { riskLevel: "high", validationNotes: ["resource update requires manual review"] }));
  assert.match(missing.question, /未说明具体疑点/);
  assert.equal(missing.ledgerFact, null);
});

test("invalid extraction gets an explicit non-confirmable explanation even with a saved review question", () => {
  const displayed = buildResourceReviewPresentation(proposal({ reviewQuestion: "是否确认？" }, { validationNotes: ["actual_state:invalid_extraction"] }));
  assert.match(displayed.question, /不能直接确认为事实/);
});

test("normal legacy extraction output is still accepted without review-only fields", () => {
  const parsed = extractionSchema.characterResourceExtractionUpdateSchema.parse({ ...proposal().payload, riskLevel: "low", evidence: proposal().evidence });
  assert.equal(parsed.reviewQuestion, undefined);
  assert.equal(parsed.ledgerFact, undefined);
  assert.equal(validator().validateProposal(proposal(parsed)).status, "committed");
});

const explainedUpdate = extractionSchema.characterResourceExtractionUpdateSchema.parse({
  ...proposal().payload, riskLevel: "high", evidence: proposal().evidence,
  riskReason: "已有记录与本章消耗状态矛盾。", reviewQuestion: "本章烧掉的是另一张护身符吗？",
  ledgerFact: "已有记录中仅有的护身符已经消耗。", chapterFact: "本章又烧掉一张护身符。",
});
const resourceTools = {
  compactText: (value) => String(value ?? "").trim(), normalizeResourceKey: () => "resource-key",
};

function assertMappedReview(mapped) {
  for (const key of ["riskReason", "reviewQuestion", "ledgerFact", "chapterFact"]) {
    assert.equal(mapped.payload[key], explainedUpdate[key], key);
  }
  assert.equal(validator().validateProposal(mapped).status, "pending_review");
  assert.equal(buildResourceReviewPresentation(mapped).question, explainedUpdate.reviewQuestion);
}

test("standalone resource extraction preserves concrete review fields in its persisted proposal payload", async () => {
  let promptInput;
  const identity = {
    ...loadRuntimeSource("../characters/identity/CharacterIdentityIndex.ts", {}),
    ...loadRuntimeSource("../characters/identity/characterIdentityRepository.ts", {}),
  };
  const { CharacterResourceExtractionService } = loadRuntimeSource("../characterResource/CharacterResourceExtractionService.ts", {
    crypto: require("node:crypto"),
    "../../../db/prisma": { prisma: {
      novel: { findUnique: async () => ({ title: "离线测试" }) },
      chapter: { findFirst: async () => ({ id: "chapter", order: 6, title: "符纸", content: proposal().evidence[0] }) },
      character: { findMany: async () => [{ id: "character", name: "阿青", role: "主角" }] },
      characterCastOptionMember: { findMany: async () => [] },
      stateChangeProposal: { findMany: async () => [] },
    } },
    "../../../prompting/core/promptRunner": { runStructuredPrompt: async (input) => {
      promptInput = input.promptInput;
      return { output: { updates: [explainedUpdate] } };
    } },
    "../../../prompting/prompts/novel/characterResource.prompts": {},
    "../characters/identity": identity,
    "./characterResourceShared": resourceTools,
    "./CharacterResourceLedgerService": { characterResourceLedgerService: { listResources: async () => [{
      name: "护身符", holderCharacterName: "阿青", ownerType: "character", ownerName: "老周", status: "consumed", summary: "已经烧掉。",
    }] } },
  });
  const mapped = await new CharacterResourceExtractionService().extractChapterResourceProposals({ novelId: "novel", chapterId: "chapter" });
  assertMappedReview(mapped[0]);
  assert.equal(mapped[0].payload.holderCharacterId, "character");
  assert.match(promptInput.existingResourceText, /owner=老周/);
});

test("chapter artifact delta preserves the same review contract instead of dropping it during mapping", () => {
  const { ChapterArtifactDeltaService } = loadRuntimeSource("ChapterArtifactDeltaService.ts", {
    "../production/reliability": { currentProductionSession: () => null },
    "../characters/identity": {},
    "./artifactSync/domain/deltaFormatting": { resolveCharacter: (characters, name) => characters.find((character) => character.name === name) ?? null },
    "../production/actualState": {}, "../../../llm/invokeTimeout": {}, "../../../prompting/core/promptRunner": {},
    "../../../prompting/prompts/novel/chapterArtifactDelta.prompts": {}, "../../rag": {}, "../../state/StateService": {},
    "../../payoff/payoffLedgerShared": {}, "../characterResource/CharacterResourceLedgerService": {},
    "../characterMind/CharacterMindService": {}, "../characterResource/CharacterResourceStaleScanService": {},
    "../characterResource/characterResourceShared": resourceTools,
    "../fact/NovelFactService": {}, "../state/StateCommitService": {},
    "../state/stateProposalSourceQuality": sourceQuality,
    "./artifactSync/ChapterArtifactSyncResult": {}, "./artifactSync/ChapterArtifactContentVersion": {},
  });
  const mapped = new ChapterArtifactDeltaService().toCharacterResourceProposals({
    novelId: "novel", chapterId: "chapter", chapterOrder: 6, sourceType: "chapter_artifact_delta", sourceStage: "chapter_execution",
    contentHash: "offline", sourceQuality: "clean", characters: [{ id: "character", name: "阿青" }], updates: [explainedUpdate],
  });
  assertMappedReview(mapped[0]);
});
