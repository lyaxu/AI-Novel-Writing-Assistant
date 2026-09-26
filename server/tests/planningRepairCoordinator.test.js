const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Block every DB/model boundary before loading the coordinator; all execution below is in-memory.
const coordinatorSource = path.resolve(__dirname, "../src/services/novel/volume/planningRepair/PlanningRepairCoordinator.ts");
const imports = {
  "../../../../prompting/core/promptRunner": { runStructuredPrompt: () => { throw new Error("Unexpected live model call"); } },
  "../../../../prompting/prompts/novel/volume/planningRepair.prompts": require("../dist/prompting/prompts/novel/volume/planningRepair.prompts.js"),
  "../ChapterTaskSheetQualityGateService": { ChapterTaskSheetQualityGateService: class { constructor() { throw new Error("Unexpected live gate"); } } },
  "../volumeWorkspaceDocument": require("../dist/services/novel/volume/volumeWorkspaceDocument.js"),
  "./PlanningRepairStore": { PlanningRepairStore: class { constructor() { throw new Error("Unexpected DB store"); } } },
  "./planningRepairDomain": require("../dist/services/novel/volume/planningRepair/planningRepairDomain.js"),
};
const coordinatorExports = {};
const coordinatorJs = ts.transpileModule(fs.readFileSync(coordinatorSource, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInThisContext(`(function(require, exports) { ${coordinatorJs}\n})`, { filename: coordinatorSource })((id) => {
  if (!Object.hasOwn(imports, id)) throw new Error(`Unmocked coordinator import: ${id}`);
  return imports[id];
}, coordinatorExports);
const { PlanningRepairCoordinator, passedPlanningReview } = coordinatorExports;
const { mapSemanticAssessmentToQualityGate } = require("../../shared/dist/types/chapterTaskSheetQuality.js");
const incident = require("./fixtures/planningRepair-chapter3.json");

const pass = { status: "passed", verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is", issues: [], summary: "pass", repairGuidance: [], confidence: 0.9 };
const reject = mapSemanticAssessmentToQualityGate(incident.assessment, "ai_copilot");
const windowPass = { usable: true, safeToSync: true, requiresUserDecision: false, summary: "pass", issues: [] };

function document() {
  return { novelId: "n", workspaceVersion: "v2", activeVersionId: "v0", source: "volume", strategyPlan: null, critiqueReport: null,
    beatSheets: [], rebalanceDecisions: [], readiness: {}, derivedOutline: "", derivedStructuredOutline: "",
    volumes: [{ id: "v", sortOrder: 1, title: "volume", status: "active", openPayoffs: [], chapters: [3, 4, 5].map(i => ({
      id: `c${i}`, volumeId: "v", chapterOrder: i, title: `chapter${i}`, summary: `summary${i}`, purpose: `purpose${i}`,
      exclusiveEvent: `event${i}`, endingState: `ending${i}`, nextChapterEntryState: `entry${i + 1}`, targetWordCount: 3000,
      payoffRefs: [], taskSheet: "a".repeat(100), mustAvoid: "No expansion", createdAt: "2026-09-25", updatedAt: "2026-09-25",
    })) }],
  };
}

function output(ids) {
  return { requiresUserDecision: false, reason: "reduce overload", obligationMoves: [], changes: ids.map((id, i) => ({
    chapterId: id, summary: "Repaired summary", purpose: "Repaired purpose", exclusiveEvent: `repaired ${id}`,
    endingState: `finish ${id}`, nextChapterEntryState: `next ${id}`, taskSheet: "Plan the encounter and concrete investigation without repetition. ".repeat(3),
    mustAvoid: "Do not alter established facts.", payoffRefs: [], conflictLevel: 55, revealLevel: 30,
    sceneCards: [1, 2, 3].map(n => ({ key: `s${n}`, title: `scene ${n}`, purpose: "Move investigation forward", mustAdvance: ["Investigate"], mustPreserve: ["Facts"],
      entryState: "Prior state", exitState: "New state", forbiddenExpansion: ["Other chapters"], targetWordCount: 1000,
      resistance: "Resistance", turn: "Concrete turn", emotionalShift: "Shift", readerValue: "Value" })),
    readerExperience: { readerQuestion: "Question", promisedReward: "Reward", rewardLevel: "partial", protagonistWant: "Want", primaryResistance: "Resistance",
      keyTurn: "Turn", emotionalShift: "Shift", informationReveal: "Reveal", netChange: "Change", inheritedHookResponsibilities: [], endingHook: "Hook" },
  })) };
}

function harness({ alwaysReject = false, local = false, windowReject = false } = {}) {
  const doc = document();
  const session = { document: doc, inputFingerprint: "source-1", eligibleChapterIds: ["c3", "c4", "c5"], state: { version: 1, key: "key", novelId: "n", volumeId: "v", chapterId: "c3", chapterOrder: 3, rounds: 0, maxRounds: 2, phase: "assessing", history: [] } };
  const calls = [];
  let commits = 0;
  const store = { begin: async () => session, save: async (s, state, candidate) => {
    s.state = structuredClone(state);
    if (candidate) s.candidate = structuredClone(candidate);
    return s;
  }, commit: async (s, candidate) => { commits++; s.state.phase = "committed"; return candidate; } };
  const gate = { evaluate: async (_chapter, options) => {
    assert.equal(options.model, "deepseek-v4-flash");
    assert.equal(options.provider, "deepseek");
    assert.equal(options.temperature, 0.1);
    calls.push("chapter_review");
    if (alwaysReject || session.state.rounds === 0) return { ...reject, recommendedHandling: local ? "repair_contract" : "replan_window" };
    return pass;
  } };
  const invoke = async ({ asset, promptInput, options }) => {
    assert.equal(options.provider, "deepseek");
    assert.equal(options.model, "deepseek-v4-flash");
    calls.push(asset.id);
    if (asset.id.endsWith("planning_repair_review")) return { output: windowReject ? { ...windowPass, usable: false, safeToSync: false, issues: ["Missing obligation"] } : windowPass };
    const context = JSON.parse(promptInput.contextJson);
    const repair = output(context.allowedChapterIds);
    for (const change of repair.changes) {
      const target = context.candidateChapters.find(chapter => chapter.id === change.chapterId).targetWordCount;
      change.sceneCards.forEach((scene, index) => { scene.targetWordCount = Math.floor(target / 3) + (index < target % 3 ? 1 : 0); });
    }
    return { output: repair };
  };
  const coordinator = new PlanningRepairCoordinator(store, gate, invoke);
  const input = { document: doc, volumeId: "v", chapterId: "c3", options: { taskId: "task", provider: "deepseek", model: "deepseek-v4-flash" }, context: {}, generateInitial: async () => ({ taskSheet: doc.volumes[0].chapters[0].taskSheet }) };
  return { coordinator, session, input, calls, store, gate, invoke, get commits() { return commits; } };
}

test("chapter 3 overload is repaired as one window, re-reviewed and committed once", async () => {
  const h = harness();
  const result = await h.coordinator.run(h.input);
  assert.equal(h.session.state.rounds, 1);
  assert.equal(h.commits, 1);
  assert.deepEqual(h.session.state.affectedChapterIds, ["c3", "c4", "c5"]);
  assert.ok(result.volumes[0].chapters.every(c => c.targetWordCount === 3000));
  assert.equal(h.calls.filter(x => x === "chapter_review").length, 4);
});

test("local repair does not expand to neighboring chapters", async () => {
  const h = harness({ local: true });
  const result = await h.coordinator.run(h.input);
  assert.deepEqual(h.session.state.affectedChapterIds, ["c3"]);
  assert.deepEqual(result.volumes[0].chapters[1], h.input.document.volumes[0].chapters[1]);
});

test("two failed rounds pause, and ordinary resume spends nothing", async () => {
  const h = harness({ alwaysReject: true });
  await assert.rejects(h.coordinator.run(h.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(h.session.state.rounds, 2);
  const count = h.calls.length;
  await assert.rejects(h.coordinator.run(h.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(h.calls.length, count);
  assert.equal(h.commits, 0);
});

test("whole-window defects cannot pass just because individual chapters passed", async () => {
  const h = harness({ windowReject: true });
  await assert.rejects(h.coordinator.run(h.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(h.session.state.rounds, 2);
  assert.equal(h.commits, 0);
});

test("an interrupted paid operation becomes uncertain without automatic replay", async () => {
  const h = harness();
  h.session.state.pendingOperation = { kind: "repair", startedAt: new Date().toISOString() };
  h.session.state.rounds = 1;
  await assert.rejects(h.coordinator.run(h.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(h.session.state.phase, "uncertain");
  assert.equal(h.session.state.rounds, 1);
  assert.equal(h.calls.length, 0);
});

test("network errors remain technical errors and preserve the pending call", async () => {
  const h = harness();
  h.input.generateInitial = async (beforeModelCall) => { await beforeModelCall(); throw new Error("ECONNRESET"); };
  await assert.rejects(h.coordinator.run(h.input), /ECONNRESET/);
  assert.equal(h.session.state.phase, "technical_failed");
  assert.ok(h.session.state.pendingOperation);
  assert.equal(h.commits, 0);
});

test("local contract reuse failures never acquire an uncertain paid-call marker", async () => {
  const h = harness();
  h.input.generateInitial = async () => { throw new Error("Local scene decoding failed"); };
  await assert.rejects(h.coordinator.run(h.input), /Local scene decoding failed/);
  assert.equal(h.session.state.phase, "technical_failed");
  assert.equal(h.session.state.pendingOperation, undefined);
  assert.equal(h.session.state.rounds, 0);
  assert.equal(h.calls.length, 0);
});

test("reused contracts still require semantic and window review before commit", async () => {
  const h = harness();
  h.gate.evaluate = async () => { h.calls.push("semantic"); return pass; };
  h.input.generateInitial = async () => {
    assert.equal(h.session.state.pendingOperation, undefined);
    return { taskSheet: h.input.document.volumes[0].chapters[0].taskSheet };
  };
  await h.coordinator.run(h.input);
  assert.deepEqual(h.calls, ["semantic", "novel.volume.planning_repair_review"]);
  assert.equal(h.commits, 1);
  assert.equal(h.session.state.rounds, 0);
});

test("autopilot permission alone is not a semantic pass", () => {
  assert.equal(passedPlanningReview({ ...reject, canEnterExecution: true }), false);
});

test("initial generation preserves user conflict level and ownership before review", async () => {
  const h = harness();
  Object.assign(h.input.document.volumes[0].chapters[0], { conflictLevel: 71, conflictLevelSource: "user" });
  h.input.generateInitial = async () => ({ conflictLevel: 12, conflictLevelSource: "ai", targetWordCount: 9000 });
  h.gate.evaluate = async chapter => {
    assert.equal(chapter.conflictLevel, 71);
    assert.equal(chapter.conflictLevelSource, "user");
    assert.equal(chapter.targetWordCount, 3000);
    return pass;
  };
  const result = await h.coordinator.run(h.input);
  assert.equal(result.volumes[0].chapters[0].conflictLevel, 71);
  assert.equal(h.commits, 1);
});

test("single flight shares same-task calls but rejects another task for the same chapter", async () => {
  const h = harness();
  let release;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  h.input.generateInitial = () => new Promise(resolve => { release = resolve; signalStarted(); });
  const first = h.coordinator.run(h.input);
  await started;
  assert.equal(h.coordinator.run(h.input), first);
  const other = harness();
  await assert.rejects(other.coordinator.run({ ...other.input, options: { ...other.input.options, taskId: "other-task" } }), /另一任务/);
  assert.equal(other.calls.length, 0);
  assert.equal(other.session.candidate, undefined);
  release({});
  await first;
  await other.coordinator.run(other.input);
  assert.equal(other.commits, 1);
});

function savedResponseHarness(proposal = output(["c3", "c4", "c5"])) {
  const h = harness();
  h.session.candidate = structuredClone(h.input.document);
  Object.assign(h.session.state, {
    phase: "repairing", rounds: 2, maxRounds: 2, affectedChapterIds: ["c3", "c4", "c5"],
    quality: { chapters: { c3: reject } }, history: [{ round: 2, kind: "repair", output: proposal }],
  });
  h.input.generateInitial = async () => { throw new Error("Must reuse persisted candidate"); };
  return h;
}

test("saved current-round output is applied before review even at the round cap", async () => {
  const h = savedResponseHarness();
  const evaluate = h.gate.evaluate;
  h.gate.evaluate = async (chapter, options) => {
    assert.equal(chapter.summary, "Repaired summary");
    return evaluate(chapter, options);
  };
  const result = await h.coordinator.run(h.input);
  assert.equal(result.volumes[0].chapters[0].summary, "Repaired summary");
  assert.equal(h.session.state.rounds, 2);
  assert.equal(h.calls.filter(call => call.endsWith("planning_repair")).length, 0);
  assert.equal(h.calls.filter(call => call === "chapter_review").length, 3);
  assert.equal(h.session.state.history.filter(entry => entry.kind === "repair").length, 1);
  assert.equal(h.commits, 1);
  await h.coordinator.run(h.input);
  assert.equal(h.commits, 1);
});

test("saved output requiring a decision pauses without reviewing or spending", async () => {
  const h = savedResponseHarness({ requiresUserDecision: true, reason: "Author must choose", changes: [], obligationMoves: [] });
  h.session.state.repairOutputPending = { inputFingerprint: h.session.inputFingerprint, round: 2 };
  await assert.rejects(h.coordinator.run(h.input), /Author must choose/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.session.state.rounds, 2);
  assert.equal(h.commits, 0);
  assert.equal(h.session.state.repairOutputPending, undefined);
});

test("invalid persisted output fails closed before any review or new model call", async () => {
  for (const proposal of [{ invalid: true }, output(["outside"]), (() => {
    const result = output(["c3", "c4", "c5"]);
    result.changes[0].sceneCards[0].targetWordCount = 4000;
    return result;
  })()]) {
    const h = savedResponseHarness(proposal);
    h.session.state.repairOutputPending = { inputFingerprint: h.session.inputFingerprint, round: 2 };
    await assert.rejects(h.coordinator.run(h.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
    assert.equal(h.calls.length, 0);
    assert.equal(h.session.state.rounds, 2);
    assert.equal(h.commits, 0);
    assert.equal(h.session.state.repairOutputPending, undefined);
    assert.equal(h.session.candidate.volumes[0].chapters[0].summary, "summary3");
  }
});

test("pending operations and prior-round responses are never treated as reusable current responses", async () => {
  const pending = savedResponseHarness();
  pending.session.state.pendingOperation = { kind: "repair", startedAt: "now" };
  await assert.rejects(pending.coordinator.run(pending.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(pending.session.state.phase, "uncertain");
  assert.equal(pending.calls.length, 0);
  const old = savedResponseHarness();
  old.session.state.history[0].round = 1;
  await assert.rejects(old.coordinator.run(old.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(old.session.candidate.volumes[0].chapters[0].summary, "summary3");
  assert.equal(old.commits, 0);
});

for (const defaultChapterLength of [2400, null]) {
  test(`window repair persists inherited budgets before invoking using default ${defaultChapterLength ?? 2800}`, async () => {
    const h = harness();
    h.input.context = { novel: { defaultChapterLength } };
    h.input.options.temperature = 0.7;
    h.input.document.volumes[0].chapters[1].targetWordCount = null;
    h.input.document.volumes[0].chapters[2].targetWordCount = undefined;
    const invoke = async args => {
      if (args.asset.id.endsWith("planning_repair")) {
        const targets = h.session.candidate.volumes[0].chapters.map(chapter => chapter.targetWordCount);
        assert.deepEqual(targets, [3000, defaultChapterLength ?? 2800, defaultChapterLength ?? 2800]);
        assert.deepEqual(JSON.parse(args.promptInput.contextJson).candidateChapters.map(chapter => chapter.targetWordCount), targets);
        assert.equal(h.session.state.quality.chapters.c4, undefined);
        assert.equal(h.session.state.quality.chapters.c5, undefined);
        assert.equal(h.session.state.quality.window, undefined);
      }
      return h.invoke(args);
    };
    const result = await new PlanningRepairCoordinator(h.store, h.gate, invoke).run(h.input);
    assert.deepEqual(result.volumes[0].chapters.map(chapter => chapter.targetWordCount), [3000, defaultChapterLength ?? 2800, defaultChapterLength ?? 2800]);
    assert.equal(h.commits, 1);
  });
}

test("local repair does not inherit or touch neighboring null budgets", async () => {
  const h = harness({ local: true });
  h.input.document.volumes[0].chapters[1].targetWordCount = null;
  const result = await h.coordinator.run(h.input);
  assert.equal(result.volumes[0].chapters[1].targetWordCount, null);
});

test("local review contains only the actual window and readonly next is not another candidate", async () => {
  const h = harness({ local: true });
  const invoke = async args => {
    const context = JSON.parse(args.promptInput.contextJson);
    assert.deepEqual(context.allowedChapterIds, ["c3"]);
    assert.deepEqual(context.originalChapters.map(c => c.id), ["c3"]);
    assert.deepEqual(context.candidateChapters.map(c => c.id), ["c3"]);
    assert.equal(context.readonlyNext.id, "c4");
    return h.invoke(args);
  };
  await new PlanningRepairCoordinator(h.store, h.gate, invoke).run(h.input);
  assert.equal(h.commits, 1);
});

test("window budgets prefer the session-frozen default over changed input context", async () => {
  const h = harness();
  h.session.effectiveDefaultChapterLength = 2700;
  h.input.context = { novel: { defaultChapterLength: 4500 } };
  h.input.document.volumes[0].chapters[1].targetWordCount = null;
  h.input.document.volumes[0].chapters[2].targetWordCount = null;
  const result = await h.coordinator.run(h.input);
  assert.deepEqual(result.volumes[0].chapters.map(chapter => chapter.targetWordCount), [3000, 2700, 2700]);
});

test("candidate save failure replays the finished response after same-source manual rebase", async () => {
  const h = savedResponseHarness();
  const save = h.store.save;
  let fail = true;
  h.store.save = async (session, state, candidate) => {
    if (candidate && fail) { fail = false; throw new Error("candidate save unavailable"); }
    return save(session, state, candidate);
  };
  await assert.rejects(h.coordinator.run(h.input), /candidate save unavailable/);
  assert.equal(h.session.state.phase, "technical_failed");
  assert.deepEqual(h.session.state.repairOutputPending, { inputFingerprint: "source-1", round: 2 });
  assert.equal(h.calls.length, 0);
  h.session.state.phase = "reviewing";
  h.session.state.quality = undefined;
  const result = await h.coordinator.run(h.input);
  assert.equal(result.volumes[0].chapters[0].summary, "Repaired summary");
  assert.equal(h.session.state.repairOutputPending, undefined);
  assert.equal(h.session.state.rounds, 2);
  assert.equal(h.calls.filter(call => call.endsWith("planning_repair")).length, 0);
  assert.equal(h.commits, 1);
});

test("source-changing rebase with cleared marker never applies old history output", async () => {
  const h = savedResponseHarness();
  h.session.state.phase = "reviewing";
  // PlanningRepairStore.rebase clears the marker when the source snapshot changes.
  h.session.inputFingerprint = "new-source";
  h.session.state.repairOutputPending = undefined;
  await assert.rejects(h.coordinator.run(h.input), { code: "PLANNING_REPAIR_CONFIRMATION_REQUIRED" });
  assert.equal(h.session.state.repairOutputPending, undefined);
  assert.equal(h.session.candidate.volumes[0].chapters[0].summary, "summary3");
  assert.equal(h.calls.filter(call => call.endsWith("planning_repair")).length, 0);
  assert.equal(h.commits, 0);
});

test("persisting inherited targets invalidates changed chapter reviews and aggregate review only", async () => {
  const h = harness();
  h.session.candidate = structuredClone(h.input.document);
  h.session.candidate.volumes[0].chapters[1].targetWordCount = null;
  h.session.state.quality = { chapters: { c3: pass, c4: pass, c5: pass }, window: windowPass };
  await h.coordinator.inheritWindowBudgets(h.input, h.session, ["c3", "c4"]);
  assert.deepEqual(Object.keys(h.session.state.quality.chapters), ["c3", "c5"]);
  assert.equal(h.session.state.quality.window, undefined);
  assert.deepEqual(h.session.candidate.volumes[0].chapters.map(chapter => chapter.targetWordCount), [3000, 2800, 3000]);
});
