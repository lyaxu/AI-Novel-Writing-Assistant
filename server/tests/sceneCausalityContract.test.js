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
  chapterAcceptanceAssessmentPrompt,
} = require("../dist/prompting/prompts/novel/chapterAcceptance.prompts.js");

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

function verdict(sceneKey) {
  return { sceneKey, outcomeObserved: true, verdict: "earned", prerequisiteEvidence: ["前文已交代失约"],
    choiceAndResistanceEvidence: "她说再想想，他收起准备好的解释", outcomeMechanismEvidence: "沉默被理解成拒绝，两人没有谈妥",
    constraintEvidence: ["她保留自己的账户"], explanation: "未和解的结果来自双方选择与理解差异" };
}

function actionCheck(sceneKey) {
  const quote = (text) => ({ source: "current_prose", sourceId: "current", quote: text });
  return { sceneKey, actor: "她", action: "收信", actionEvidence: [quote("她把信收好。")], verdict: "earned", explanation: "读信后收好信件",
    states: [{ dimension: "knowledge", entity: "信件内容", before: "已读信", requiredForAction: "已知道信的内容", after: "仍知道信的内容",
      beforeEvidence: [quote("她读完信。")], afterEvidence: [quote("她把信收好。")], transitionEvidence: [],
      enablingTransitionRequired: false, stateChanged: false, transitionStatus: "not_needed" }] };
}

test("fresh acceptance requires evidence rows and validates exact expected-scene coverage", () => {
  assert.equal(chapterAcceptanceAssessmentSchema.safeParse(assessment()).success, true);
  assert.equal(generatedChapterAcceptanceAssessmentSchema.safeParse(assessment()).success, false);
  const complete = generatedChapterAcceptanceAssessmentSchema.parse({ ...assessment(), sceneCausalityVerdicts: [verdict("scene_1"), verdict("scene_2")],
    actionStateChecks: [actionCheck("scene_1"), actionCheck("scene_2")] });
  const input = { chapterOrder: 1, content: "她读完信。她把信收好。", expectedSceneKeys: ["scene_1", "scene_2"] };
  assert.deepEqual(chapterAcceptanceAssessmentPrompt.postValidate(complete, input).sceneCausalityVerdicts, complete.sceneCausalityVerdicts);
  for (const rows of [[], [verdict("scene_1")], [verdict("scene_1"), verdict("scene_1")], [verdict("scene_1"), verdict("wrong")]]) {
    assert.throws(() => chapterAcceptanceAssessmentPrompt.postValidate({ ...complete, sceneCausalityVerdicts: rows }, input), /逐一覆盖/);
  }
  assert.doesNotThrow(() => chapterAcceptanceAssessmentPrompt.postValidate({ ...complete, sceneCausalityVerdicts: [] }, { ...input, expectedSceneKeys: [] }));
  const brokenEvidence = verdict("scene_1");
  brokenEvidence.outcomeMechanismEvidence = "";
  assert.equal(generatedChapterAcceptanceAssessmentSchema.safeParse({ ...assessment(), sceneCausalityVerdicts: [brokenEvidence] }).success, false);
});

test("acceptance prompt separates visible result from earned outcome and keeps negative outcomes valid", () => {
  const messages = chapterAcceptanceAssessmentPrompt.render({ novelTitle: "家庭", chapterOrder: 1,
    chapterTitle: "会面", content: "她没有答应。", expectedSceneKeys: ["scene_1"] },
  { blocks: [], selectedBlockIds: [], droppedBlockIds: [], summarizedBlockIds: [], estimatedInputTokens: 0 });
  const system = String(messages[0].content);
  assert.match(system, /不能把‘完成必达结果’当成‘结果有合理成因’/);
  assert.match(system, /没有战斗、没有成功、安静的关系变化均可 earned/);
  assert.match(system, /不能抄合同当正文证据/);
  assert.match(String(messages[1].content), /expectedSceneKeys.*scene_1/);
});
