const test = require("node:test");
const assert = require("node:assert/strict");
const { createSceneCausality } = require("./fixtures/sceneCausality.js");
const {
  applyPlanningRepairCandidate,
  planningRepairOutputSchema,
  planningRepairReviewOutputSchema,
} = require("../dist/services/novel/volume/planningRepair/planningRepairDomain.js");
const {
  planningRepairPrompt,
  planningRepairReviewPrompt,
} = require("../dist/prompting/prompts/novel/volume/planningRepair.prompts.js");
const { getRegisteredPromptAsset } = require("../dist/prompting/registry.js");
const { createChapterTaskSheetSchema } = require("../dist/services/novel/volume/chapterDetail/chapterDetailSchemas.js");

function change(id = "plan-1") {
  return {
    chapterId: id,
    summary: "Repair the overloaded investigation.",
    purpose: "Discover one clue.",
    exclusiveEvent: `Find the clue for ${id}.`,
    endingState: "The clue is verified.",
    nextChapterEntryState: "The hero follows the clue into danger.",
    taskSheet: "Find, test and verify the clue without revealing the culprit.",
    mustAvoid: "Do not reveal the culprit.",
    payoffRefs: [`clue-${id}`],
    sceneCards: [1, 2, 3].map((i) => ({
      key: `scene-${i}`,
      title: `Clue ${i}`,
      purpose: "Test evidence.",
      mustAdvance: ["A clue is tested."],
      mustPreserve: ["The culprit remains unknown."],
      entryState: "The hero lacks evidence.",
      exitState: "The hero has a new lead.",
      forbiddenExpansion: ["Do not resolve the next chapter."],
      targetWordCount: 1000,
      resistance: "A witness refuses to speak.",
      turn: "The witness offers proof.",
      emotionalShift: "Doubt becomes hope.",
      readerValue: "A concrete clue.",
      causality: createSceneCausality(),
    })),
    readerExperience: {
      readerQuestion: "Who concealed the clue?",
      promisedReward: "A verified clue.",
      rewardLevel: "partial",
      protagonistWant: "Find the truth.",
      primaryResistance: "An unreliable witness.",
      keyTurn: "The evidence checks out.",
      emotionalShift: "Suspicion becomes resolve.",
      informationReveal: "The clue is genuine.",
      netChange: "The hero can pursue a lead.",
      inheritedHookResponsibilities: ["Investigate the missing clue."],
      endingHook: "Who planted the evidence?",
    },
  };
}

function chapter(id, volumeId, order) {
  return {
    id, volumeId, chapterId: `persisted-${id}`, chapterOrder: order,
    title: `Immutable title ${id}`, beatKey: `beat-${id}`,
    summary: "Original overloaded summary.", purpose: "Original purpose.",
    exclusiveEvent: `Original event ${id}`, endingState: "Original ending.",
    nextChapterEntryState: "Original entry.", mustAvoid: "Original constraint.",
    taskSheet: "Original tasks.", sceneCards: "original serialized scene plan",
    targetWordCount: 3000, conflictLevel: 55, conflictLevelSource: "user", revealLevel: 30,
    styleContract: "Preserve style", payoffRefs: [`clue-${id}`],
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z",
  };
}

function document() {
  return {
    novelId: "novel-1", workspaceVersion: "v2", source: "volume", activeVersionId: "version-1",
    strategyPlan: null, critiqueReport: null, beatSheets: [], rebalanceDecisions: [],
    readiness: { marker: "coordinator-owned" }, derivedOutline: "keep", derivedStructuredOutline: "keep",
    volumes: [
      { id: "volume-1", novelId: "novel-1", title: "First", sortOrder: 1, status: "draft",
        openPayoffs: [], createdAt: "created", updatedAt: "updated",
        chapters: [chapter("previous", "volume-1", 1), chapter("plan-1", "volume-1", 2),
          chapter("plan-2", "volume-1", 3), chapter("next", "volume-1", 4)] },
      { id: "volume-2", novelId: "novel-1", title: "Second", sortOrder: 2, status: "draft",
        openPayoffs: [], createdAt: "created", updatedAt: "updated",
        chapters: [chapter("outside", "volume-2", 5)] },
    ],
  };
}

function output(ids = ["plan-1"]) {
  return { requiresUserDecision: false, reason: "Distribute work within the fixed budgets.",
    changes: ids.map(change), obligationMoves: [] };
}

function apply(doc = document(), result = output(), ids = ["plan-1"], volumeId = "volume-1") {
  return applyPlanningRepairCandidate(doc, volumeId, ids, result);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("applies only allowlisted fields to real VolumeChapterPlan shape without mutation", () => {
  const doc = freeze(document());
  const proposal = freeze(output());
  const candidate = apply(doc, proposal);
  const before = doc.volumes[0].chapters[1];
  const after = candidate.volumes[0].chapters[1];
  assert.notEqual(candidate, doc);
  assert.equal(candidate.volumes[1], doc.volumes[1]);
  for (const index of [0, 2, 3]) assert.equal(candidate.volumes[0].chapters[index], doc.volumes[0].chapters[index]);
  for (const key of ["id", "volumeId", "chapterId", "chapterOrder", "title", "beatKey", "targetWordCount",
    "conflictLevel", "conflictLevelSource", "revealLevel", "styleContract", "createdAt", "updatedAt"]) {
    assert.deepEqual(after[key], before[key], key);
  }
  for (const key of Object.keys(doc).filter((key) => key !== "volumes")) assert.deepEqual(candidate[key], doc[key]);
  assert.equal(after.summary, proposal.changes[0].summary);
  assert.equal(typeof after.sceneCards, "string");
  assert.equal(Object.hasOwn(after, "readerExperience"), false);
  const plan = JSON.parse(after.sceneCards);
  assert.deepEqual(plan.readerExperience, proposal.changes[0].readerExperience);
  assert.equal(plan.targetWordCount, 3000);
  assert.equal(plan.lengthBudget.hardMaxWordCount, 3750);
  assert.equal(plan.scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0), 3000);
});

test("rejects protected fields instead of stripping or applying them", () => {
  for (const key of ["id", "volumeId", "title", "chapterOrder", "targetWordCount", "conflictLevel", "beatKey", "updatedAt"]) {
    const proposal = output();
    proposal.changes[0][key] = 9999;
    assert.throws(() => apply(document(), proposal), undefined, key);
  }
  assert.throws(() => apply(document(), { ...output(), document: document() }));
});

test("chapter 8/9 missing strengths are repairable without altering established chapter 7 strengths", () => {
  const doc = document();
  const blank = doc.volumes[0].chapters[2];
  blank.conflictLevel = null;
  blank.revealLevel = null;
  blank.conflictLevelSource = "ai";
  const proposal = output(["plan-1", "plan-2"]);
  proposal.changes[1].conflictLevel = 35;
  proposal.changes[1].revealLevel = 40;
  const result = apply(doc, proposal, ["plan-1", "plan-2"]);
  assert.equal(result.volumes[0].chapters[2].conflictLevel, 35);
  assert.equal(result.volumes[0].chapters[2].revealLevel, 40);
  assert.equal(result.volumes[0].chapters[1].conflictLevel, 55);
  assert.equal(result.volumes[0].chapters[1].revealLevel, 30);
  assert.equal(blank.conflictLevel, null);
  delete proposal.changes[1].revealLevel;
  assert.throws(() => apply(doc, proposal, ["plan-1", "plan-2"]), /missing revealLevel/);
});

test("existing user or AI strengths cannot be overwritten, legacy responses may omit known strengths", () => {
  for (const source of ["user", "ai"]) {
    const doc = document();
    doc.volumes[0].chapters[1].conflictLevelSource = source;
    for (const field of ["conflictLevel", "revealLevel"]) {
      const proposal = output();
      proposal.changes[0][field] = 99;
      assert.throws(() => apply(doc, proposal), /established/);
    }
    assert.equal(apply(doc).volumes[0].chapters[1].conflictLevel, 55);
  }
});

test("requires the exact allowed chapter set once, using planning IDs not persisted IDs", () => {
  assert.throws(() => apply(document(), output([])), /exact allowed/);
  assert.throws(() => apply(document(), output(["plan-1", "plan-1"])), /exact allowed/);
  assert.throws(() => apply(document(), output(["plan-1", "plan-2"])), /exact allowed/);
  assert.throws(() => apply(document(), output(["persisted-plan-1"])), /exact allowed/);
  assert.throws(() => apply(document(), output(), []), /allowed chapter set/);
  assert.throws(() => apply(document(), output(), ["plan-1", "plan-1"]), /allowed chapter set/);
  assert.throws(() => apply(document(), output(["outside"]), ["outside"]), /outside the target volume/);
  assert.throws(() => apply(document(), output(["missing"]), ["missing"]), /missing/);
  assert.throws(() => apply(document(), output(), ["plan-1"], "missing"), /target volume/);
  const duplicate = document();
  duplicate.volumes[1].chapters.push(chapter("plan-1", "volume-2", 9));
  assert.throws(() => apply(duplicate), /ambiguous/);
});

test("scene and reader schemas are the existing chapterDetail schemas", () => {
  const proposal = change();
  assert.equal(createChapterTaskSheetSchema().safeParse(proposal).success, true);
  assert.equal(planningRepairOutputSchema.safeParse(output()).success, true);
  for (const invalid of ["full", "complete", "unknown"]) {
    const candidate = output();
    candidate.changes[0].readerExperience.rewardLevel = invalid;
    assert.equal(planningRepairOutputSchema.safeParse(candidate).success, false);
  }
  for (const field of ["resistance", "turn", "emotionalShift", "readerValue"]) {
    const candidate = output();
    delete candidate.changes[0].sceneCards[0][field];
    assert.throws(() => apply(document(), candidate));
  }
});

test("rejects bloated scene budgets before the normalizer can conceal them", () => {
  const candidate = output();
  candidate.changes[0].sceneCards[0].targetWordCount = 1001;
  assert.throws(() => apply(document(), candidate), /exceeds its original word count budget/);
  candidate.changes[0].sceneCards[0].targetWordCount = 100000;
  assert.throws(() => apply(document(), candidate), /exceeds its original word count budget/);
});

test("normalizes smaller scene allocations using only the unchanged original target", () => {
  const candidate = output();
  candidate.changes[0].sceneCards.forEach((scene) => { scene.targetWordCount = 700; });
  const after = apply(document(), candidate).volumes[0].chapters[1];
  assert.equal(after.targetWordCount, 3000);
  assert.equal(JSON.parse(after.sceneCards).scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0), 3000);
});

test("rejects missing, noninteger and too-small original budgets without fallback or hangs", () => {
  for (const target of [undefined, null, 0, -1, 2, 0.2, 3000.5, Infinity, NaN]) {
    const doc = document();
    doc.volumes[0].chapters[1].targetWordCount = target;
    assert.throws(() => apply(doc), /original word count budget/);
  }
});

test("rejects invalid scenes and duplicate scene keys", () => {
  for (const count of [0, 2, 9]) {
    const candidate = output();
    candidate.changes[0].sceneCards = Array.from({ length: count }, (_, i) => ({ ...change().sceneCards[0], key: `s${i}` }));
    assert.throws(() => apply(document(), candidate));
  }
  const candidate = output();
  candidate.changes[0].sceneCards[1].key = candidate.changes[0].sceneCards[0].key;
  assert.throws(() => apply(document(), candidate), /duplicate scene keys/);
});

test("rejects duplicate exclusive events inside and outside the window", () => {
  const candidate = output(["plan-1", "plan-2"]);
  candidate.changes[1].exclusiveEvent = candidate.changes[0].exclusiveEvent;
  assert.throws(() => apply(document(), candidate, ["plan-1", "plan-2"]), /duplicates exclusive event/);
  for (const id of ["previous", "next", "outside"]) {
    const proposal = output();
    proposal.changes[0].exclusiveEvent = `Original event ${id}`;
    assert.throws(() => apply(document(), proposal), /duplicates exclusive event/);
  }
});

test("rejects mechanically repeated end and entry states", () => {
  const candidate = output();
  candidate.changes[0].nextChapterEntryState = candidate.changes[0].endingState;
  assert.throws(() => apply(document(), candidate), /repeats its ending/);
});

test("preserves aggregate payoff references without treating shared hook counts as duties", () => {
  const candidate = output();
  candidate.changes[0].payoffRefs = [];
  assert.throws(() => apply(document(), candidate), /lost payoff obligation/);
  candidate.changes[0].payoffRefs = ["clue-plan-1", "clue-plan-1"];
  assert.doesNotThrow(() => apply(document(), candidate));
  const shared = output(["plan-1", "plan-2"]);
  shared.changes[1].payoffRefs.push("clue-plan-1");
  assert.doesNotThrow(() => apply(document(), shared, ["plan-1", "plan-2"]));
});

test("allows in-window duty movement and merge while validating the obligation ledger", () => {
  const proposal = output(["plan-1", "plan-2"]);
  proposal.changes[0].payoffRefs = [];
  proposal.changes[1].payoffRefs.push("clue-plan-1");
  const move = { obligation: "clue-plan-1", fromChapterId: "plan-1", toChapterId: "plan-2", action: "move", reason: "Fit the budget." };
  proposal.obligationMoves = [move];
  assert.doesNotThrow(() => apply(document(), proposal, ["plan-1", "plan-2"]));
  const doc = document();
  doc.volumes[0].chapters[2].payoffRefs.push("clue-plan-1");
  move.action = "merge";
  assert.doesNotThrow(() => apply(doc, proposal, ["plan-1", "plan-2"]));
  move.action = "retain";
  assert.throws(() => apply(doc, proposal, ["plan-1", "plan-2"]), /Retain/);
  move.toChapterId = "plan-1";
  assert.throws(() => apply(doc, proposal, ["plan-1", "plan-2"]), /ledger disagrees/);
});

test("rejects out-of-window, conflicting and nonsensical obligation moves", () => {
  const proposal = output();
  const retain = { obligation: "clue-plan-1", fromChapterId: "plan-1", toChapterId: "plan-1", action: "retain", reason: "Keep the clue." };
  proposal.obligationMoves = [retain];
  assert.doesNotThrow(() => apply(document(), proposal));
  proposal.obligationMoves.push({ ...retain });
  assert.throws(() => apply(document(), proposal), /conflicting obligation/);
  proposal.obligationMoves = [{ ...retain, toChapterId: "next" }];
  assert.throws(() => apply(document(), proposal), /readonly/);
  proposal.obligationMoves = [{ ...retain, action: "move" }];
  assert.throws(() => apply(document(), proposal), /cross chapters/);
});

test("allows same-chapter merge without removing the retained payoff reference", () => {
  const proposal = output();
  proposal.obligationMoves = [{ obligation: "clue-plan-1", fromChapterId: "plan-1", toChapterId: "plan-1",
    action: "merge", reason: "Combine clue verification and witness questioning in the same scene." }];
  assert.doesNotThrow(() => apply(document(), proposal));
});

test("cross-chapter movement may preserve a shared book hook reference on the source", () => {
  const proposal = output(["plan-1", "plan-2"]);
  proposal.changes[1].payoffRefs.push("clue-plan-1");
  proposal.obligationMoves = [{ obligation: "clue-plan-1", fromChapterId: "plan-1", toChapterId: "plan-2",
    action: "move", reason: "Move the reveal, retain the source hook setup." }];
  assert.doesNotThrow(() => apply(document(), proposal, ["plan-1", "plan-2"]));
});

test("user-decision output cannot be applied or carry proposed changes", () => {
  const proposal = { ...output([]), requiresUserDecision: true };
  assert.throws(() => apply(document(), proposal), /requires user decision/);
  assert.deepEqual(planningRepairPrompt.postValidate(proposal, { contextJson: "{}" }, {}), proposal);
  proposal.changes = [change()];
  assert.throws(() => planningRepairPrompt.postValidate(proposal, { contextJson: "{}" }, {}), /must not propose/);
});

test("aggregate review schema is strict and rejects contradictory sync claims", () => {
  const result = { usable: true, safeToSync: true, requiresUserDecision: false, summary: "All duties preserved.", issues: [] };
  assert.deepEqual(planningRepairReviewOutputSchema.parse(result), result);
  for (const patch of [{ usable: false }, { requiresUserDecision: true }, { issues: ["Lost hook."] }, { extra: true }, { safeToSync: "true" }]) {
    assert.equal(planningRepairReviewOutputSchema.safeParse({ ...result, ...patch }).success, false);
  }
  assert.equal(planningRepairReviewOutputSchema.safeParse({ ...result, usable: false, safeToSync: false, issues: ["Lost hook."] }).success, true);
});

test("registered assets expose the coordinator API without model routing or calls", () => {
  for (const [asset, taskType] of [[planningRepairPrompt, "replan"], [planningRepairReviewPrompt, "review"]]) {
    assert.equal(getRegisteredPromptAsset(asset.id, asset.version), asset);
    assert.equal(asset.taskType, taskType);
    assert.equal(asset.mode, "structured");
    assert.equal(Object.hasOwn(asset, "modelRoute"), false);
    const contextJson = JSON.stringify({ originalDocument: document(), qualityResults: [{ complete: "quality" }],
      bookConstraints: { rule: "fixed" }, beatSheet: { full: true }, readonlyContext: { previous: "entry", next: "exit" }, guidance: ["Repair overload."] });
    const messages = asset.render({ contextJson }, {});
    assert.equal(messages[1].content, contextJson);
    assert.match(messages[0].content, /readonly/);
    assert.match(messages[0].content, /原始目标字数/);
    assert.match(messages[0].content, /人物线/);
    assert.match(messages[0].content, /使用中文/);
    for (const key of ["bookConstraints", "volume", "strategyPlan", "beatSheet", "allowedChapterIds",
      "originalChapters", "candidateChapters", "readonlyPrevious", "readonlyNext", "assessment", "obligationMoves", "guidance"]) {
      assert.ok(messages[0].content.includes(key), key);
    }
  }
  const instructions = planningRepairReviewPrompt.render({ contextJson: "{}" }, {})[0].content;
  assert.match(instructions, /丢失或重复职责/);
  assert.match(instructions, /完整的原始质量结果/);
  assert.match(instructions, /数字合规不代表负载合理/);
  assert.match(planningRepairPrompt.render({ contextJson: "{}" }, {})[0].content, /同一场景内合并职责/);
});

test("boundary and execution prompts explicitly use the curve's 0-100 scale", () => {
  const assets = require("../dist/prompting/prompts/novel/volume/chapterDetail.prompts.js");
  for (const asset of [assets.volumeChapterBoundaryPrompt, assets.volumeChapterExecutionContractPrompt]) {
    assert.equal(getRegisteredPromptAsset(asset.id, asset.version), asset);
    const instructions = asset.render({ detailMode: "boundary" }, { blocks: [] })[0].content;
    assert.match(instructions, /0-100/);
    assert.match(instructions, /不是 1-5/);
    assert.match(instructions, /不为曲线好看硬造高潮/);
  }
});
