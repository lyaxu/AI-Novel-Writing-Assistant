const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chapterSceneCardSchema, generatedChapterSceneCardSchema,
  normalizeChapterScenePlan, parseChapterScenePlan, serializeChapterScenePlan,
} = require("../../shared/dist/types/chapterLengthControl.js");
const {
  buildChapterWriterContextBlocks, buildChapterReviewContextBlocks, buildChapterRepairContextBlocks,
} = require("../dist/prompting/prompts/novel/chapterLayeredContext.js");
const { selectContextBlocks } = require("../dist/prompting/core/contextSelection.js");
const { resolvePromptContextBlocksForAsset } = require("../dist/prompting/context/promptContextResolution.js");
const { chapterWriterPrompt } = require("../dist/prompting/prompts/novel/chapterWriter.prompts.js");
const {
  chapterAcceptanceAssessmentSchema, generatedChapterAcceptanceAssessmentSchema,
  chapterAcceptanceAssessmentPrompt, semanticChapterAcceptanceSchema,
} = require("../dist/prompting/prompts/novel/chapterAcceptance.prompts.js");
const { buildEvidenceCatalog } = require("../dist/prompting/prompts/novel/acceptance/evidenceCatalog.js");

function causalContract() {
  return {
    actor: "林宁", choice: "暂不答应重归于好", motive: "需要确认对方愿意尊重自己的边界",
    prerequisites: [{ condition: "双方知道上次失约", sourceKind: "established_in_context", reference: "上一章末尾的失约争执" }],
    resistanceResponse: "对方认为沉默是在惩罚自己，停止解释",
    outcomeMechanism: "彼此对沉默的不同理解让会面未能和解",
    resultingConstraints: [{ constraint: "暂不共享家庭账户", persistence: "直到双方当面谈妥支出边界" }],
  };
}

function scene(index, includeCausality = true) {
  return {
    key: `scene_${index}`, title: "一次会面", purpose: "确认边界", mustAdvance: ["做出选择"],
    mustPreserve: ["保留分歧"], entryState: "尚未决定", exitState: "暂缓答复", forbiddenExpansion: [],
    targetWordCount: 800, resistance: "理解不同", turn: "拒绝立刻回答", emotionalShift: "期待转为失落",
    readerValue: "看清两人的分歧", ...(includeCausality ? { causality: causalContract() } : {}),
  };
}

function writeContext() {
  return {
    bookContract: { title: "家庭", hardConstraints: [], toneGuardrails: [], activeMilestonePayoffs: [] },
    chapterMission: { title: "会面", objective: "确认边界", expectation: "拒绝也是选择", hookTarget: "下次是否再见",
      mustAdvance: [], mustPreserve: [], riskNotes: [] },
    nextAction: "draft_chapter", chapterStateGoal: null, protectedSecrets: [],
    scenePlan: normalizeChapterScenePlan({ scenes: [1, 2, 3].map((i) => scene(i)) }, 2400),
    participants: [], characterBehaviorGuides: [], activeRelationStages: [], pendingCandidateGuards: [],
    localStateSummary: "冷战尚未结束", openConflictSummaries: [], ledgerPendingItems: [], ledgerUrgentItems: [],
    ledgerOverdueItems: [], ledgerSummary: null, characterResourceContext: null,
    recentChapterSummaries: [], openingAntiRepeatHint: "", styleContract: null,
    styleConstraints: [], continuationConstraints: [], ragFacts: [], payoffDirectives: [],
  };
}

test("scene causality survives normalization and persistence without fabricating legacy sources", () => {
  const plan = normalizeChapterScenePlan({ scenes: [scene(1), scene(2, false), scene(3)] }, 3000);
  const restored = parseChapterScenePlan(serializeChapterScenePlan(plan), { targetWordCount: 3000 });
  assert.deepEqual(restored.scenes[0].causality, causalContract());
  assert.equal(restored.scenes[1].causality, undefined);
  assert.equal(chapterSceneCardSchema.safeParse(scene(1, false)).success, true);
  assert.equal(generatedChapterSceneCardSchema.safeParse(scene(1, false)).success, false);
  assert.equal(generatedChapterSceneCardSchema.safeParse(scene(1)).success, true);
  const unknown = scene(1);
  unknown.causality.prerequisites[0] = { condition: "愿意见面的理由", sourceKind: "unresolved", reference: "未提供双方约见经过" };
  assert.equal(generatedChapterSceneCardSchema.safeParse(unknown).success, true);
  delete unknown.causality.prerequisites[0].reference;
  assert.equal(generatedChapterSceneCardSchema.safeParse(unknown).success, false);
});

test("a quiet refusal needs neither a victory nor invented loss", () => {
  const refusal = scene(1);
  refusal.causality.prerequisites = [];
  refusal.causality.resultingConstraints = [];
  assert.equal(generatedChapterSceneCardSchema.safeParse(refusal).success, true);
});

test("writer, review and repair preserve identical complete causal evidence under a tiny context budget", () => {
  const write = writeContext();
  write.scenePlan.stateClaims = [{ id: "future-refusal", subject: "林宁", predicate: "本场暂不答应复合", temporalScope: "planned", modality: "intention", source: { kind: "planned_scene", sceneKey: "scene_1", phase: "action" } }];
  const review = { ...write, structureObligations: [], worldRules: [], historicalIssues: [] };
  const repair = { writeContext: write, issues: [], allowedEditBoundaries: [], structureObligations: [], worldRules: [], historicalIssues: [] };
  const variants = [buildChapterWriterContextBlocks(write), buildChapterReviewContextBlocks(review), buildChapterRepairContextBlocks(repair)];
  const projected = variants.map((blocks) => {
    const selected = selectContextBlocks(blocks, { maxTokensBudget: 1 });
    const block = selected.selectedBlocks.find((item) => item.group === "scene_causality");
    assert.ok(block);
    assert.equal(block.required, true);
    assert.equal(block.allowSummary, false);
    assert.equal(selected.summarizedBlockIds.includes(block.id), false);
    assert.match(block.content, /直到双方当面谈妥支出边界/);
    assert.match(block.content, /scene_3/);
    assert.match(block.content, /future-refusal/);
    assert.match(block.content, /"modality":"intention"/);
    assert.match(block.content, /不是已发生证据/);
    return block.content;
  });
  assert.equal(new Set(projected).size, 1);
});

test("runtime context broker resolves the causal contract for a writer asset", async () => {
  const result = await resolvePromptContextBlocksForAsset({
    asset: chapterWriterPrompt,
    executionContext: { entrypoint: "chapter_pipeline", metadata: { chapterWriteContext: writeContext() } },
  });
  assert.ok(result.blocks.some((block) => block.group === "scene_causality"), JSON.stringify(result.brokerResolution.resolverErrors));
});

function assessment() {
  return {
    status: "accepted", score: { coherence: 90, pacing: 90, repetition: 90, engagement: 90, voice: 90, overall: 90 },
    summary: "会面没有和解，但人物选择成立", blockingIssues: [], repairDirectives: [], riskTags: [],
    assetSyncRecommendation: { priority: "normal", reason: "保存关系变化", requiresFullPayoffReconcile: false },
    continuePolicy: "continue",
  };
}

function semanticReviewFixture(sceneKeys = ["scene_1", "scene_2"]) {
  const moments = [
    { actor: "林宁", text: "林宁读懂合同要求承担欠款后拒绝签字，仍然知道欠款条款，双方没有签约。", proposition: "合同要求承担欠款", action: "拒绝签字" },
    { actor: "江舟", text: "江舟知道借条要求担保后拒绝担保，仍然知道借条的担保要求，双方没有达成协议。", proposition: "借条要求担保", action: "拒绝担保" },
  ];
  const input = { chapterId: "refusals", chapterOrder: 1, content: moments.map(row => row.text).join("\n"),
    expectedSceneKeys: sceneKeys, establishedProse: [] };
  const catalog = buildEvidenceCatalog(input);
  const keys = sceneKeys.length ? sceneKeys : ["chapter"];
  const actions = keys.map((sceneKey, index) => {
    const moment = moments[index];
    const entry = catalog.entries.find(item => item.quote.trim() === moment.text); assert.ok(entry);
    const evidence = [{ evidenceId: entry.id }];
    const entity = `${moment.actor}对条款的知情`;
    const fact = storyTime => ({ entity, dimension: "knowledge", claim: `${moment.actor}知道${moment.proposition}`,
      evidence, storyTime, support: "supported", reason: "正文明确理解条款后作出拒绝，拒绝时仍运用同一信息。" });
    return { sceneKey, actor: moment.actor, action: moment.action, actionEvidence: evidence, claimIds: [],
      states: [{ entity, dimension: "knowledge", requiredForAction: "了解所拒绝的条款",
        before: fact("before_or_at_action"), after: fact("during_or_after_action"),
        prerequisite: { status: "satisfied", basis: fact("before_or_at_action"), reason: "作出拒绝前已知条款。" },
        resultChange: { status: "unchanged", basis: fact("during_or_after_action"), reason: "作出拒绝没有改变对同一条款的知情。" } }],
      explanation: "知情后拒绝，双方没有达成协议，不需额外胜利或代价。" };
  });
  const { status, ...base } = assessment();
  const raw = { ...base, issueChecks: [], missingObligations: [], decisionReason: "拒绝具有依据，继续写作。",
    sceneCausalityVerdicts: sceneKeys.map((sceneKey, index) => ({ sceneKey, outcomeObserved: false,
      choiceAndResistance: { claim: `${moments[index].actor}${moments[index].action}，没有达成协议`, evidence: actions[index].actionEvidence,
        support: "supported", reason: "知情后的拒绝是有因果依据的选择，未达成协议不等于因果缺陷。" }, constraints: [] })),
    progressionChecks: ["event_repetition", "knowledge_repetition", "prior_goal_followthrough"].map(dimension => ({
      dimension, status: "not_applicable", repeatsEstablishedBeat: null, addsNewConsequence: null,
      priorState: "首章没有比较职责", actualChange: "本章作出拒绝", newConsequence: "", previousEvidence: [], currentEvidence: [],
      explanation: "首章没有前章已完成职责。", repairSuggestion: "",
    })), actionStateChecks: actions };
  return { input, raw: semanticChapterAcceptanceSchema.parse(raw) };
}

test("fresh acceptance requires evidence rows and validates exact expected-scene coverage", () => {
  assert.equal(chapterAcceptanceAssessmentSchema.safeParse(assessment()).success, true);
  assert.equal(generatedChapterAcceptanceAssessmentSchema.safeParse(assessment()).success, false);
  const { input, raw } = semanticReviewFixture();
  const output = chapterAcceptanceAssessmentPrompt.postValidate(raw, input);
  assert.deepEqual(output.sceneCausalityVerdicts.map(row => row.sceneKey), input.expectedSceneKeys);
  assert.ok(output.sceneCausalityVerdicts.every(row => row.verdict === "earned"));
  const [first, second] = raw.sceneCausalityVerdicts;
  for (const rows of [[], [first], [first, first], [first, { ...second, sceneKey: "wrong" }]]) {
    assert.throws(() => chapterAcceptanceAssessmentPrompt.postValidate({ ...raw, sceneCausalityVerdicts: rows }, input), /scene_coverage_invalid/);
  }
  const fallback = semanticReviewFixture([]);
  assert.doesNotThrow(() => chapterAcceptanceAssessmentPrompt.postValidate(fallback.raw, fallback.input));
  const missingFinding = structuredClone(raw); delete missingFinding.sceneCausalityVerdicts[0].choiceAndResistance;
  assert.throws(() => chapterAcceptanceAssessmentPrompt.postValidate(missingFinding, input), /required_semantic_finding_missing/);
  const falseCitation = structuredClone(raw); falseCitation.actionStateChecks[0].actionEvidence = [{ evidenceId: "invented" }];
  assert.throws(() => chapterAcceptanceAssessmentPrompt.postValidate(falseCitation, input), /unknown_evidence_id/);
});

test("acceptance prompt separates visible result from earned outcome and keeps negative outcomes valid", () => {
  const messages = chapterAcceptanceAssessmentPrompt.render({ novelTitle: "家庭", chapterOrder: 1,
    chapterTitle: "会面", content: "她没有答应。", expectedSceneKeys: ["scene_1"] },
  { blocks: [], selectedBlockIds: [], droppedBlockIds: [], summarizedBlockIds: [], estimatedInputTokens: 0 });
  const system = String(messages[0].content);
  assert.match(system, /不能只检查结果发生/);
  assert.match(system, /计划里的场景安排不能替代正文/);
  assert.match(system, /未发生\/无法确认的声明如实保留未覆盖风险/);
  assert.match(String(messages[1].content), /expectedSceneKeys.*scene_1/);
  const { input, raw } = semanticReviewFixture();
  const output = chapterAcceptanceAssessmentPrompt.postValidate(raw, input);
  assert.equal(output.status, "accepted");
  assert.ok(output.sceneCausalityVerdicts.every(row => row.outcomeObserved === false && row.verdict === "earned"));
  assert.deepEqual(output.blockingIssues, []); assert.deepEqual(output.repairDirectives, []);
});
