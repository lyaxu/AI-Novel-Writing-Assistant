const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports) {
  const filename = path.resolve(__dirname, file);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${source}\n})`, { filename })((id) => {
    if (!(id in imports)) throw new Error(`Unmocked boundary: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}
const schema = load("../../shared/types/planningRepair/advice.ts", { zod: require("zod") });
const encoding = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContextEncoding.ts", {});
const horizon = load("../src/services/novel/volume/planningPromises/planningHorizon.ts", {});
const adviceContextImports = { "../../../../volume/planningPromises": horizon };
const contextModule = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContext.ts", adviceContextImports);
const semanticReview = require("../dist/services/novel/director/recovery/planningRepair/advice/semanticReview");
const structuredOutput = load("../src/llm/structuredOutput.ts", { zod: require("zod"), "./providers": {}, "./reasoning": {} });
class TestAppError extends Error {}
const failureModule = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceFailure.ts", {
  zod: require("zod"), "../../../../../../llm/structuredOutput": structuredOutput,
  "../../../../../../middleware/errorHandler": { AppError: TestAppError },
});
const output = () => ({ summary: "复核后给出可执行方向", recommendedOptionId: "a", options: [{
  id: "a", title: "补齐行动因果", reason: "现有合同缺少行动前提", changes: ["补齐已有线索来源"], preserves: ["保留核心冲突"], tradeoffs: ["压缩次要叙述"],
  diagnosis: "real_gap", executionMode: "repair_then_review", affectedChapterIds: ["c1"], changesHardConstraints: false, requiresSourceEdit: false,
  blockerResolution: { status: "complete", remainingBlockers: [], rationale: "补齐唯一缺失的行动依据" },
  guidance: { intent: "补齐因果", actions: ["使用已有线索"], preserve: ["核心冲突"], verification: ["验证行动前提"] },
}] });
function fixture(useDefaultGenerator = false, promptRun) {
  let source = { row: { id: "t", seedPayloadJson: "old", updatedAt: "time" }, seed: {}, repair: { key: "r", novelId: "n", chapterId: "c1" },
    fingerprint: "f", sourceToken: "s", eligibleChapterIds: ["c1", "c2", "c3"], context: { userIntent: "保留设定", candidateAuthority: { versionId: "candidate-v1" }, candidateWindow: [{ chapters: [{ id: "c1", taskSheet: "先核对已经交付的记录，再检查箱内仍存在的痕迹。" }] }] } };
  let writes = 0, calls = 0, reviews = 0, rejectCas = false, pending;
  let reviewResult = async (_source, advice) => ({ advice, checks: advice.options.map(option => ({
    optionId: option.id, verdict: "supported", rationale: "核对当前候选后支持该方向",
    evidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录", relation: "supports" }],
  })) });
  const tx = { novelWorkflowTask: { updateMany: async ({ data }) => {
    writes++;
    if (rejectCas) return { count: 0 };
    source.seed = JSON.parse(data.seedPayloadJson); source.row.seedPayloadJson = data.seedPayloadJson;
    return { count: 1 };
  } } };
  const grants = [];
  const mod = load("../src/services/novel/director/recovery/planningRepair/advice/PlanningRepairAdviceService.ts", {
    "node:crypto": require("node:crypto"), "@ai-novel/shared/types/planningRepair/advice": schema,
    "../../../../../../db/prisma": { prisma: { $transaction: (fn) => fn(tx) } },
    "../../../../../../middleware/errorHandler": { AppError: Error },
    "../../../../../../prompting/core/promptRunner": { runStructuredPrompt: promptRun ?? (() => { throw new Error("Paid calls forbidden"); }) },
    "../../../../../../prompting/prompts/novel/volume/recovery/planningRepairAdvice.prompts": {},
    "../../../../../../prompting/prompts/novel/volume/recovery/planningRepairAdviceReview.prompts": {},
    "../../../../../../llm/invokeTimeout": { runWithEnforcedTimeout: ({ run }) => run(new AbortController().signal) }, "../PlanningRepairRecoveryService": {},
    "./AdviceContext": contextModule,
    "./AdviceFailure": failureModule,
    "./AdviceContextEncoding": encoding,
    "./semanticReview": semanticReview,
    "./AdviceSource": { readAdviceSource: async () => structuredClone(source), assertAdvicePaused: async () => {} },
  });
  const service = new mod.PlanningRepairAdviceService({ grant: async (taskId, input) => { grants.push(input); return { granted: true, replayed: grants.length > 1, taskId }; } },
    useDefaultGenerator ? undefined : async () => { calls++; return new Promise((resolve, reject) => { pending = { resolve, reject }; }); },
    useDefaultGenerator ? undefined : async (s, draft) => { reviews++; return reviewResult(s, draft); });
  return { service, source, grants, modelOptions: mod.adviceModelOptions, calls: () => calls, reviews: () => reviews, reviewWith: fn => { reviewResult = fn; }, writes: () => writes, resolve: (value = output()) => pending.resolve(value), fail: (error = new Error("timeout")) => pending.reject(error), casFail: () => { rejectCas = true; } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("old ready advice stays readable but loses recommendation and cannot execute without semantic approval", async () => {
  const f = fixture();
  f.source.seed.planningRepairAdvice = { adviceId: "legacy", repairKey: "r", fingerprint: "f", status: "ready", result: output() };
  const before = f.writes();
  const view = await f.service.status("t");
  assert.equal(view.status, "ready"); assert.equal(view.recommendedOptionId, undefined);
  assert.equal(view.options[0].canResume, false); assert.match(view.options[0].blockedReason, /证据与结论核验/);
  await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: "legacy", optionId: "a", idempotencyKey: "click" }), /证据与结论核验/);
  assert.equal(f.grants.length, 0); assert.equal(f.writes(), before); assert.equal(f.calls() + f.reviews(), 0);
});

test("explicit reacquisition can revalidate saved complete review without model calls, while GET cannot", async () => {
  const f = fixture();
  const reviewed = { advice: output(), checks: [{ optionId: "a", verdict: "supported", rationale: "核验完成", evidence: [
    { sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录", relation: "supports" },
  ] }] };
  f.source.seed.planningRepairAdvice = { adviceId: "rejected", requestId: "old", repairKey: "r", fingerprint: "f", status: "failed",
    failureDiagnostics: { category: "unknown", detail: "old source guard", rejectedOutput: { parsed: reviewed } } };
  assert.equal((await f.service.status("t")).status, "failed"); assert.equal(f.writes(), 0);
  const view = await f.service.request("t", { repairKey: "r", idempotencyKey: "recheck" });
  assert.equal(view.status, "ready"); assert.equal(view.options[0].canResume, true);
  assert.equal(f.calls() + f.reviews(), 0); assert.equal(f.grants.length, 0);
  await f.service.request("t", { repairKey: "r", idempotencyKey: "recheck" });
  assert.equal(f.writes(), 1); assert.equal(f.calls() + f.reviews(), 0);
});

test("stale, invalid, or draft-only rejected output cannot be reused as an approved semantic review", async () => {
  for (const variant of ["stale", "invented", "draft"]) {
    const f = fixture();
    const parsed = variant === "draft" ? output() : { advice: output(), checks: [{ optionId: "a", verdict: "supported", rationale: "核验", evidence: [
      { sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: variant === "invented" ? "不存在的原句" : "先核对已经交付的记录", relation: "supports" },
    ] }] };
    f.source.seed.planningRepairAdvice = { adviceId: "old", repairKey: "r", fingerprint: variant === "stale" ? "old-source" : "f", status: "failed",
      failureDiagnostics: { rejectedOutput: { parsed } } };
    assert.equal((await f.service.request("t", { repairKey: "r", idempotencyKey: variant })).status, "running");
    assert.equal(f.calls(), 1); assert.equal(f.reviews(), 0); f.fail(); await settle();
  }
});

const proseCapture = path.resolve(__dirname, "../../.codex-run/delivery-box-prose-evidence");
test("actual rejected cross-source review is reusable only through an explicit request with no generation or repair", {
  skip: !fs.existsSync(path.join(proseCapture, "seed.json")),
}, async () => {
  const read = name => JSON.parse(fs.readFileSync(path.join(proseCapture, `${name}.json`), "utf8"));
  const f = fixture(), seed = read("seed");
  f.source.seed = seed; f.source.repair = seed.planningRepair;
  f.source.fingerprint = seed.planningRepairAdvice.fingerprint;
  f.source.sourceToken = seed.planningRepairAdvice.sourceToken;
  f.source.eligibleChapterIds = seed.planningRepairSnapshot.eligibleChapterIds;
  f.source.context = contextModule.buildAdviceContext({ novel: {}, volumes: [], macro: null,
    chapters: read("chapters"), candidate: read("candidate"), seed, eligibleChapterIds: f.source.eligibleChapterIds });
  assert.equal((await f.service.status("t")).status, "failed"); assert.equal(f.writes(), 0);
  const view = await f.service.request("t", { repairKey: seed.planningRepair.key, idempotencyKey: "offline-explicit-recheck" });
  assert.equal(view.status, "ready"); assert.equal(view.options[0].executionMode, "repair_then_review");
  assert.equal(view.options[0].canResume, true);
  assert.equal(f.calls() + f.reviews(), 0); assert.equal(f.grants.length, 0);
  assert.equal(f.source.seed.planningRepair.rounds, 7); assert.equal(f.source.seed.planningRepair.maxRounds, 9);
});

test("production generation wiring performs exactly proposal plus review with all hidden retries disabled", async () => {
  const invocations = [];
  const f = fixture(true, async request => {
    invocations.push(request);
    if (invocations.length === 1) return { output: output() };
    return { output: { advice: output(), checks: [{ optionId: "a", verdict: "supported", rationale: "核对完成", evidence: [
      { sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录", relation: "supports" },
    ] }] } };
  });
  await f.service.request("t", { repairKey: "r", idempotencyKey: "two-stage" }); await settle();
  assert.equal((await f.service.status("t")).status, "ready");
  assert.deepEqual(invocations.map(r => r.options.stage), ["planning_repair_advice", "planning_repair_advice_review"]);
  assert.deepEqual(JSON.parse(invocations[1].promptInput.draftAdviceJson), output());
  for (const { options } of invocations) {
    assert.equal(options.transportRetryCount, 0); assert.equal(options.disableFallbackModel, true);
    assert.equal(options.disableStrategyFallback, true); assert.ok(options.signal);
  }
  await f.service.request("t", { repairKey: "r", idempotencyKey: "two-stage" }); await settle();
  assert.equal(invocations.length, 2); assert.equal(f.grants.length, 0);
});

test("draft is never ready before independent review and only corrected advice is persisted and adopted", async () => {
  const f = fixture(); let finish;
  f.reviewWith((_source, draft) => new Promise(resolve => { finish = () => {
    const advice = structuredClone(draft);
    advice.options[0].guidance.actions = ["修正真实冲突并为兑现引用提供显式同章修订映射"];
    resolve({ advice, checks: [{ optionId: "a", verdict: "corrected", rationale: "原结论与原文相反，须先修复", evidence: [
      { sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录", relation: "contradicts" },
    ] }] });
  }; }));
  const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "review" });
  f.resolve(); await settle();
  assert.equal((await f.service.status("t")).status, "running");
  assert.equal(f.source.seed.planningRepairAdvice.result, undefined);
  await f.service.request("t", { repairKey: "r", idempotencyKey: "review" });
  assert.equal(f.calls(), 1); assert.equal(f.reviews(), 1);
  finish(); await settle();
  assert.equal((await f.service.status("t")).options[0].canResume, true);
  await f.service.select("t", { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "adopt" });
  assert.match(f.grants[0].guidance, /显式同章修订映射/);
  f.source.seed.planningRepairAdvice.result.options[0].reason = "核验后的结果被更换";
  assert.equal((await f.service.status("t")).options[0].canResume, false);
});

test("review failure does not expose unchecked draft, retry, or grant recovery", async () => {
  const f = fixture();
  f.reviewWith(async () => { throw new Error("semantic review unavailable"); });
  await f.service.request("t", { repairKey: "r", idempotencyKey: "bad-review" });
  f.resolve(); await settle();
  const status = await f.service.status("t");
  assert.equal(status.status, "failed"); assert.equal(status.options, undefined);
  assert.equal(f.calls(), 1); assert.equal(f.reviews(), 1); assert.equal(f.grants.length, 0);
  assert.equal(f.source.seed.planningRepairAdvice.result, undefined);
});

test("source change before review prevents its call; source change during review rejects late completion", async () => {
  const first = fixture(); await first.service.request("t", { repairKey: "r", idempotencyKey: "before" });
  first.source.fingerprint = "changed"; first.resolve(); await settle();
  assert.equal(first.reviews(), 0);
  const second = fixture(); let finish;
  second.reviewWith((_source, advice) => new Promise(resolve => { finish = () => resolve({ advice, checks: [{
    optionId: "a", verdict: "supported", rationale: "checked", evidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录", relation: "supports" }],
  }] }); }));
  await second.service.request("t", { repairKey: "r", idempotencyKey: "during" }); second.resolve(); await settle();
  second.source.fingerprint = "changed"; finish(); await settle();
  assert.equal((await second.service.status("t")).status, "stale"); assert.equal(second.writes(), 1);
});

test("consumed advice is projected as applied rather than stale without allowing another grant", async () => {
  const f = fixture();
  const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "apply" });
  f.resolve(); await settle();
  f.source.seed.planningRepairRecoveryRequests = [{ repairKey: "other", idempotencyKey: `advice:${request.adviceId}:a` }];
  f.source.fingerprint = "changed";
  assert.equal((await f.service.status("t")).status, "stale");
  f.source.seed.planningRepairRecoveryRequests[0].repairKey = "r";
  const before = f.writes();
  const view = await f.service.status("t");
  assert.equal(view.status, "applied");
  assert.equal(view.options, undefined);
  assert.equal(f.writes(), before);
  assert.equal(f.calls(), 1);
  assert.equal(f.grants.length, 0);
});

test("oversized unique context fails before timeout wrapper or any paid model boundary", async () => {
  const f = fixture(true);
  f.source.context = { unique: "唯一正文".repeat(50000) };
  await f.service.request("t", { repairKey: "r", idempotencyKey: "capacity" });
  await settle();
  const saved = f.source.seed.planningRepairAdvice;
  assert.equal(saved.status, "failed");
  assert.match(saved.failureDiagnostics.detail, /本次未调用模型/);
  assert.doesNotMatch(saved.failureDiagnostics.detail, /精简/);
  assert.equal(f.grants.length, 0);
});
test("GET never generates or writes; explicit POST is asynchronous and duplicate request does not pay twice", async () => {
  const f = fixture(); assert.equal((await f.service.status("t")).status, "none"); assert.equal(f.writes(), 0);
  assert.equal((await f.service.request("t", { repairKey: "r", idempotencyKey: "req" })).status, "running");
  await f.service.request("t", { repairKey: "r", idempotencyKey: "req" }); assert.equal(f.calls(), 1);
  f.resolve(); await settle(); const status = await f.service.status("t");
  assert.equal(status.status, "ready"); assert.equal(status.options[0].guidance, undefined); assert.equal(f.calls(), 1);
});
test("selection uses only persisted direction, stable recovery identity and source token", async () => {
  const f = fixture(); const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" }); f.resolve(); await settle();
  const input = { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "click1" };
  await f.service.select("t", input); await f.service.select("t", { ...input, idempotencyKey: "click2" });
  assert.equal(f.grants[0].idempotencyKey, f.grants[1].idempotencyKey); assert.equal(f.grants[0].expectedSourceToken, "s");
  assert.match(f.grants[0].guidance, /使用已有线索/);
  assert.equal(f.grants[0].executionMode, "repair_then_review");
  await assert.rejects(f.service.select("t", { ...input, optionId: "forged" }));
});

test("source-edit and legacy untyped advice remain readable but cannot authorize execution", async () => {
  for (const mode of ["source_edit", undefined]) {
    const f = fixture(); const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" });
    f.resolve(); await settle();
    f.source.seed.planningRepairAdvice.result.options[0].executionMode = mode;
    const view = await f.service.status("t");
    assert.equal(view.options[0].canResume, false);
    assert.match(view.options[0].blockedReason, mode ? /章节规划/ : /重新获取/);
    await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "click" }));
    assert.equal(f.grants.length, 0);
  }
});

test("partial fixes, creative-tradeoff review and legacy closure claims cannot be adopted", async () => {
  for (const patch of [
    { blockerResolution: { status: "partial", remainingBlockers: ["主要承接缺口仍未解决"], rationale: "只修措辞" } },
    { executionMode: "review_existing", diagnosis: "creative_tradeoff" },
    { blockerResolution: undefined },
    { blockerResolution: { status: "complete", remainingBlockers: ["后续待办"], rationale: "留给正文" } },
  ]) {
    const f = fixture(); const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" });
    f.resolve(); await settle();
    Object.assign(f.source.seed.planningRepairAdvice.result.options[0], patch);
    assert.equal((await f.service.status("t")).options[0].canResume, false);
    await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "click" }));
    assert.equal(f.grants.length, 0);
  }
});

test("complete evidence-backed review disagreement remains executable without rewriting guidance", async () => {
  const f = fixture(); const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" });
  const result = output(); Object.assign(result.options[0], { changes: [], executionMode: "review_existing", diagnosis: "review_disagreement", candidateVersionId: "candidate-v1", candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录，再检查箱内仍存在的痕迹。" }] });
  f.resolve(result); await settle();
  assert.equal((await f.service.status("t")).options[0].canResume, true);
  await f.service.select("t", { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "click" });
  assert.equal(f.grants[0].executionMode, "review_existing");
});

test("candidate horizon preserves saved later routes separately from the baseline and never grants write access", () => {
  const { buildAdviceContext } = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContext.ts", adviceContextImports);
  const chapters = Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, chapterOrder: i + 1, title: `章${i + 1}`, summary: `真实候选路线${i + 1}` }));
  const current = { volumes: [{ id: "v", chapters }], beatSheets: [{ volumeId: "v", beats: [{ summary: "后续承接" }] }] };
  const baseline = { volumes: [{ id: "v", chapters: chapters.slice(0, 3) }], beatSheets: [] };
  const result = buildAdviceContext({ novel: {}, volumes: baseline.volumes, chapters: [], macro: null,
    candidate: { contentJson: JSON.stringify(current) }, eligibleChapterIds: ["p2", "p3"],
    seed: { planningRepair: { volumeId: "v" }, planningRepairSnapshot: { baselineDocument: baseline } } });
  assert.deepEqual(result.candidatePlanningHorizon.readonlyOpeningRoutes.map(route => route.chapterOrder), [1, 4, 5, 6, 7]);
  assert.deepEqual(result.baselinePlanningHorizon.readonlyOpeningRoutes.map(route => route.chapterOrder), [1]);
  assert.equal(result.candidatePlanningHorizon.readonlyOpeningRoutes[3].summary, "真实候选路线6");
  assert.deepEqual(result.eligibleChapterIds, ["p2", "p3"]);
  assert.equal(result.candidatePlanningHorizon.readonlyPlanningHorizon.authority, "readonly_planning_not_prose");
});
test("source changes invalidate ready advice and late result cannot overwrite source", async () => {
  const f = fixture(); const r = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" });
  f.source.fingerprint = "changed"; f.resolve(); await settle();
  assert.equal((await f.service.status("t")).status, "stale"); assert.equal(f.writes(), 1);
  await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: r.adviceId, optionId: "a", idempotencyKey: "click" }));
});

test("advice missing the current chapter or duplicating chapter scope cannot offer executable recovery", async () => {
  for (const affectedChapterIds of [["c2"], ["c1", "c1"]]) {
    const f = fixture(); const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" });
    f.resolve(); await settle();
    f.source.seed.planningRepairAdvice.result.options[0].affectedChapterIds = affectedChapterIds;
    const view = await f.service.status("t");
    assert.equal(view.options[0].canResume, false);
    await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "click" }));
    assert.equal(f.grants.length, 0);
  }
});
test("persisted running after restart is uncertain, no GET rerun; explicit new key can retry", async () => {
  const f = fixture(); f.source.seed.planningRepairAdvice = { adviceId: "old", requestId: "req", fingerprint: "f", status: "running" };
  assert.equal((await f.service.status("t")).status, "uncertain");
  assert.equal((await f.service.request("t", { repairKey: "r", idempotencyKey: "req" })).status, "uncertain"); assert.equal(f.calls(), 0);
  await f.service.request("t", { repairKey: "r", idempotencyKey: "new" }); f.fail(); await settle();
  assert.equal((await f.service.status("t")).status, "failed"); assert.equal(f.calls(), 1);
});
test("out of window or hard-constraint options cannot grant; CAS reservation prevents paid invocation", async () => {
  const f = fixture(); const r = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" }); f.resolve(); await settle();
  f.source.seed.planningRepairAdvice.result.options[0].affectedChapterIds = ["c4"];
  assert.equal((await f.service.status("t")).options[0].canResume, false);
  await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: r.adviceId, optionId: "a", idempotencyKey: "x" }));
  const g = fixture(); g.casFail(); await assert.rejects(g.service.request("t", { repairKey: "r", idempotencyKey: "req" })); assert.equal(g.calls(), 0);
});
test("schema rejects duplicate options and missing recommendation", () => {
  const value = output(); value.options.push(value.options[0]); assert.equal(schema.planningRepairAdviceOutputSchema.safeParse(value).success, false);
  const missing = output(); missing.recommendedOptionId = "unknown"; assert.equal(schema.planningRepairAdviceOutputSchema.safeParse(missing).success, false);
});
test("advice inherits task provider/model and rejects reused historical generation identity", async () => {
  const f = fixture();
  assert.deepEqual(f.modelOptions({ provider: "kimi", model: "k3", directorInput: { provider: "other", model: "other" } }), { provider: "kimi", model: "k3" });
  assert.deepEqual(f.modelOptions({ directorInput: { provider: "custom", model: "test" } }), { provider: "custom", model: "test" });
  f.source.seed.planningRepairAdviceRequests = ["old"];
  await assert.rejects(f.service.request("t", { repairKey: "r", idempotencyKey: "old" })); assert.equal(f.calls(), 0);
});

test("source fingerprint binds candidate, body and user intent; GET source checks have no side effects", async () => {
  const sourceModule = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceSource.ts", {
    "./AdviceContext": load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContext.ts", adviceContextImports),
    "node:crypto": require("node:crypto"), "../../../../../../middleware/errorHandler": { AppError: Error },
    "../planningRepairRecovery": { readPlanningRepairSeed: (json) => {
      const seed = JSON.parse(json); return { seed, repair: seed.planningRepair, recovery: seed.planningRepairRecovery };
    } },
  });
  const seed = { planningRepair: { key: "r", novelId: "n", candidateVersionId: "v" }, planningRepairSnapshot: { eligibleChapterIds: ["c1"] }, directorInput: { idea: "原始意图" } };
  const row = { id: "t", novelId: "n", lane: "auto_director", status: "waiting_approval", seedPayloadJson: JSON.stringify(seed) };
  const novel = { id: "n", title: "书", defaultChapterLength: 2800, creationExperience: "simple", updatedAt: new Date(0) };
  const chapter = { id: "c1", content: "" }; const candidate = { id: "v", contentJson: "candidate" };
  const tx = { novelWorkflowTask: { findUnique: async () => row }, novel: { findUnique: async () => novel },
    volumePlan: { findMany: async () => [] }, volumePlanVersion: { findMany: async () => [], findFirst: async () => candidate },
    chapter: { findMany: async () => [chapter] }, storyMacroPlan: { findUnique: async () => null },
    generationJob: { findFirst: async () => null }, directorRunCommand: { findFirst: async () => null } };
  const initial = await sourceModule.readAdviceSource(tx, "t");
  novel.creationExperience = "professional"; novel.updatedAt = new Date(1000);
  seed.productionExperience = "professional"; row.seedPayloadJson = JSON.stringify(seed);
  assert.equal((await sourceModule.readAdviceSource(tx, "t")).fingerprint, initial.fingerprint);
  chapter.content = "新增正文"; assert.notEqual((await sourceModule.readAdviceSource(tx, "t")).fingerprint, initial.fingerprint); chapter.content = "";
  candidate.contentJson = "changed"; assert.notEqual((await sourceModule.readAdviceSource(tx, "t")).fingerprint, initial.fingerprint); candidate.contentJson = "candidate";
  seed.directorInput.idea = "新意图"; row.seedPayloadJson = JSON.stringify(seed);
  assert.notEqual((await sourceModule.readAdviceSource(tx, "t")).fingerprint, initial.fingerprint);
  const source = await sourceModule.readAdviceSource(tx, "t"); source.repair.phase = "waiting_confirmation";
  await sourceModule.assertAdvicePaused(tx, source);
  source.recovery = { pendingGrant: true }; await assert.rejects(sourceModule.assertAdvicePaused(tx, source));
  source.recovery = null; tx.generationJob.findFirst = async () => ({ id: "busy" }); await assert.rejects(sourceModule.assertAdvicePaused(tx, source));
});

test("paid context includes window, adjacent evidence and missing-source markers but omits remote prose and full versions", () => {
  const { buildAdviceContext } = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContext.ts", adviceContextImports);
  const plans = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, chapterId: `c${i + 1}`, chapterOrder: i + 1, title: `章${i + 1}`, taskSheet: "合同" }));
  const doc = { beatSheets: [{ volumeId: "v", beats: [{ summary: "只读节奏" }] }, { volumeId: "other", beats: [] }], volumes: [{ id: "v", chapters: plans, escalationMode: "压力递进", protagonistChange: "主动选择", nextVolumeHook: "卷间承诺", resetPoint: "不可重置", openPayoffs: ["待兑现承诺"] }], semanticDocument: "整本衍生数据" };
  const result = buildAdviceContext({ novel: { title: "书", outline: "整本大纲", storyWorldSliceJson: "书约束" },
    volumes: doc.volumes, chapters: plans.map((p, i) => ({ id: p.chapterId, content: `正文${i + 1}` })), macro: null,
    candidate: { contentJson: JSON.stringify(doc) }, eligibleChapterIds: ["p2", "p3", "p4"],
    seed: { directorInput: { idea: "原意图" }, planningRepairSnapshot: { baselineDocument: doc }, planningRepair: { volumeId: "v", quality: { summary: "最新审查结果" }, history: Array.from({ length: 9 }, (_, i) => ({ round: i })) } } });
  const text = JSON.stringify(result);
  assert.match(text, /正文1/); assert.match(text, /正文5/); assert.doesNotMatch(text, /正文6|整本大纲|整本衍生数据/);
  assert.match(text, /原意图|书约束/); assert.equal(result.repair.recentHistory.length, 6);
  assert.equal(result.repair.quality.summary, "最新审查结果");
  assert.equal(result.candidateWindow[0].escalationMode, "压力递进");
  assert.equal(result.candidateWindow[0].nextVolumeHook, "卷间承诺");
  assert.deepEqual(result.candidateWindow[0].openPayoffs, ["待兑现承诺"]);
  assert.equal(result.baselinePlanningHorizon.readonlyPlanningHorizon.beats.length, 1);
  assert.equal(result.candidatePlanningHorizon.readonlyPlanningHorizon.beats[0].summary, "只读节奏");
  assert.deepEqual(result.candidatePlanningHorizon.readonlyOpeningRoutes.map(chapter => chapter.chapterOrder), [1, 5, 6, 7, 8]);
  assert.equal(result.candidatePlanningHorizon.readonlyPlanningHorizon.coverage.omittedRouteCount, 0);
  assert.deepEqual(result.candidateWindow[0].chapters.filter(chapter => chapter.writable).map(chapter => chapter.id), ["p2", "p3", "p4"]);
  assert.equal(result.repair.omittedEarlierHistoryCount, 3); assert.ok(result.missingEvidence.length > 0);
});

test("proven advice source conflict releases only its unspent reservation; unknown errors retain it", async () => {
  const reader = load("../src/services/novel/director/recovery/planningRepair/planningRepairRecovery.ts", {
    "../../../../../middleware/errorHandler": { AppError: Error },
  });
  const { PlanningRepairRecoveryService } = load("../src/services/novel/director/recovery/planningRepair/PlanningRepairRecoveryService.ts", {
    "../../../../../db/prisma": {}, "../../../../../middleware/errorHandler": { AppError: Error },
    "../../../workflow/NovelWorkflowService": {}, "../../../workflow/novelWorkflow.shared": {},
    "./planningRepairRecovery": reader, "../../../volume/planningRepair/PlanningRepairStore": {},
  });
  async function attempt(proven) {
    const seed = { planningRepair: { version: 1, key: "r", novelId: "n", volumeId: "v", chapterId: "c1", phase: "waiting_confirmation", rounds: 2, maxRounds: 2, history: [] },
      planningRepairRecovery: { repairKey: "r", resumePhase: "chapter_execution" } };
    let row = { id: "t", novelId: "n", lane: "auto_director", status: "waiting_approval", updatedAt: "time", seedPayloadJson: JSON.stringify(seed) };
    const workflow = { getTaskByIdWithoutHealing: async () => ({ ...row }), volumeService: { getVolumes: async () => ({}) },
      updateTaskManyWithRetry: async ({ where, data }) => { assert.equal(where.seedPayloadJson, row.seedPayloadJson); row = { ...row, ...data }; return { count: 1 }; } };
    const error = Object.assign(new Error("source mismatch"), proven ? { reason: "advice_source_changed" } : {});
    const service = new PlanningRepairRecoveryService(workflow, { rebase: async (input) => { assert.equal(input.expectedSourceToken, "bound"); throw error; } });
    await assert.rejects(service.grant("t", { action: "retry", repairKey: "r", guidance: "saved", idempotencyKey: "advice:a:o", expectedSourceToken: "bound" }));
    const result = JSON.parse(row.seedPayloadJson);
    assert.equal(result.planningRepair.maxRounds, 2); assert.equal(result.planningRepair.rounds, 2); assert.deepEqual(result.planningRepair.history, []);
    return result;
  }
  assert.equal((await attempt(true)).planningRepairRecovery.pendingGrant, undefined);
  assert.equal((await attempt(false)).planningRepairRecovery.pendingGrant, true);
});

// Captured completed model response, 2026-09-28 05:13 UTC (stop, 2902 output tokens).
const rejectedAdvice = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/planningRepairAdvice-rejected.json"), "utf8"));
const generatedSchema = load("../src/llm/generatedContentSchema.ts", { zod: require("zod") });
let repairCalls = 0;
const parser = load("../src/llm/structuredInvokeParser.ts", {
  zod: require("zod"), "./generatedContentSchema": generatedSchema, "./structuredOutput": structuredOutput,
  "./structuredInvokeRepair": { repairWithLlm: async () => { repairCalls++; throw new Error("Paid repair forbidden"); } },
  "../services/novel/novelP0Utils": { extractJSONValue: value => value },
  "../platform/llm/streaming/responseDiagnostics": load("../src/platform/llm/streaming/responseDiagnostics.ts", {}),
});
const prompt = load("../src/prompting/prompts/novel/volume/recovery/planningRepairAdvice.prompts.ts", {
  zod: require("zod"), "@langchain/core/messages": { HumanMessage: class { constructor(content) { this.content = content; } }, SystemMessage: class { constructor(content) { this.content = content; } } },
  "@ai-novel/shared/types/planningRepair/advice": schema,
  "../../../../../llm/generatedContentSchema": generatedSchema,
});
const parse = (value, contract = prompt.planningRepairAdvicePrompt.outputSchema, extra = {}) => parser.parseStructuredLlmRawContentDetailed({
  rawContent: typeof value === "string" ? value : JSON.stringify(value), schema: contract,
  label: "advice-offline", strategy: "prompt_json", profile: {}, maxRepairAttempts: 0, finishReason: "stop", ...extra,
});

test("v9 prompt renders the full shared contract and example, with explicit paid-recovery boundaries", () => {
  const asset = prompt.planningRepairAdvicePrompt;
  const text = asset.render({ contextJson: "{}" })[0].content;
  assert.equal(asset.version, "v9"); assert.equal(asset.repairPolicy.maxAttempts, 0); assert.equal(asset.semanticRetryPolicy.maxAttempts, 0);
  const jsonSchema = JSON.parse(text.split("完整输出契约（minItems/maxItems是数量，minLength/maxLength是字符数）：\n")[1].split("\n输出格式示例")[0]);
  const fields = jsonSchema.properties.options.items.properties;
  assert.deepEqual(fields.diagnosis.enum, schema.planningRepairAdviceDiagnoses);
  assert.equal(fields.guidance.properties.actions.maxItems, 8);
  assert.equal(fields.affectedChapterIds.maxItems, 3);
  assert.equal(jsonSchema.properties.options.maxItems, 3);
  assert.equal(schema.planningRepairAdviceOutputSchema.safeParse(prompt.planningRepairAdviceExample).success, true);
  assert.match(text, /不得超过4000字符/); assert.match(text, /采用一个可执行方案即明确授权追加1轮/);
  assert.match(text, /不要让写作新手查询服务器schema/);
  assert.match(fs.readFileSync(path.join(__dirname, "../src/prompting/registry/promptAssetLoaderEntries.ts"), "utf8"), /novel\.planning_repair\.advice@v9/);
});

test("real rejected response keeps every action under wider non-safety limits but still rejects invented diagnoses", async () => {
  const failure = schema.planningRepairAdviceOutputSchema.safeParse(rejectedAdvice);
  assert.equal(failure.success, false);
  assert.deepEqual(failure.error.issues.map(issue => issue.path.join(".")), ["options.0.executionMode", "options.0.blockerResolution", "options.1.diagnosis", "options.1.executionMode", "options.1.blockerResolution", "options.2.diagnosis", "options.2.executionMode", "options.2.blockerResolution"]);
  const valid = structuredClone(rejectedAdvice);
  // Test fixture variant only: production must never infer or remap a diagnosis.
  valid.options[1].diagnosis = "missing_information"; valid.options[2].diagnosis = "review_disagreement";
  valid.options.forEach(option => { option.executionMode = "source_edit"; option.blockerResolution = { status: "unknown", remainingBlockers: [], rationale: "需要源工作区确认" }; });
  const result = await parse(valid);
  assert.deepEqual(result.data, valid);
  assert.equal(result.data.options[0].changes.length, 7);
  assert.equal(result.data.options[0].guidance.actions.length, 7);
  assert.equal(result.data.options[0].guidance.preserve.length, 6);
  assert.equal(result.data.options[0].guidance.verification.length, 5);
});

test("strict contracts never silently trim guidance or a fourth affected chapter; default parser behavior is preserved", async () => {
  const { z } = require("zod");
  const unmarked = z.object({ values: z.array(z.string()).max(1) });
  assert.deepEqual((await parse({ values: ["a", "b"] }, unmarked)).data, { values: ["a"] });
  for (const mutate of [value => { value.options[0].guidance.actions = Array(9).fill("必须保留的独立动作"); },
    value => { value.options[0].affectedChapterIds = ["c1", "c2", "c3", "c4"]; },
    value => { value.options[0].guidance.actions = Array(8).fill("动".repeat(390)); value.options[0].guidance.preserve = Array(4).fill("保".repeat(290)); }]) {
    const value = output(); mutate(value);
    await assert.rejects(parse(value), error => {
      assert.equal(error.category, "schema_mismatch");
      assert.equal(error.rejectedOutput.rawContent, JSON.stringify(value));
      assert.equal(Object.keys(error).includes("rejectedOutput"), false);
      assert.equal(JSON.stringify(error).includes("rawContent"), false);
      return true;
    });
  }
  assert.equal(repairCalls, 0);
});

test("completed rejected output is saved privately, never adoptable and never retried on GET", async () => {
  let rejected;
  try { await parse(rejectedAdvice); } catch (error) { rejected = error; }
  const f = fixture(); const r = await f.service.request("t", { repairKey: "r", idempotencyKey: "rejected" });
  f.fail(rejected); await settle();
  const view = await f.service.status("t");
  assert.equal(view.status, "failed"); assert.match(view.error, /AI 返回的方案格式不完整/);
  assert.doesNotMatch(JSON.stringify(view), /schema_mismatch|missing_info|rawContent|failureDiagnostics/);
  assert.equal(f.source.seed.planningRepairAdvice.failureDiagnostics.rejectedOutput.rawContent, JSON.stringify(rejectedAdvice));
  await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: r.adviceId, optionId: rejectedAdvice.options[0].id, idempotencyKey: "forbidden" }));
  await f.service.status("t"); await f.service.request("t", { repairKey: "r", idempotencyKey: "rejected" });
  assert.equal(f.calls(), 1); assert.equal(f.grants.length, 0); assert.equal(repairCalls, 0);
});

test("failure presentation distinguishes typed timeout, connection and output capacity, without message matching", async () => {
  const timeout = Object.assign(new Error("opaque"), { name: "TimeoutError" });
  assert.match(failureModule.describeAdviceFailure(timeout).error, /超时/);
  for (const [category, expected] of [["transport_error", /连接/], ["output_limit", /输出容量/]]) {
    const error = new structuredOutput.StructuredOutputError({ category, message: "opaque", diagnostics: {} });
    assert.match(failureModule.describeAdviceFailure(error).error, expected);
    assert.equal(failureModule.describeAdviceFailure(error).failureDiagnostics.rejectedOutput, undefined);
  }
  assert.doesNotMatch(failureModule.describeAdviceFailure(new Error("TimeoutError schema_mismatch")).error, /超时|格式/);
  await assert.rejects(parse(rejectedAdvice, undefined, { finishReason: "length" }), error => {
    assert.equal(error.category, "output_limit"); assert.equal(error.rejectedOutput, undefined); return true;
  });
});

test("legacy failed advice receives a safe read-only projection without rewriting its original error", async () => {
  const f = fixture();
  f.source.seed.planningRepairAdvice = { adviceId: "old", requestId: "old-request", fingerprint: "f", status: "failed", error: "[STRUCTURED_OUTPUT:schema_mismatch] options.0.guidance.actions too big" };
  const original = JSON.stringify(f.source.seed);
  const view = await f.service.status("t");
  assert.match(view.error, /上次未能取得可用方案/);
  assert.doesNotMatch(view.error, /STRUCTURED_OUTPUT|guidance|too big/);
  assert.equal(JSON.stringify(f.source.seed), original); assert.equal(f.writes(), 0); assert.equal(f.calls(), 0);
});


test("advice separates rejected historical repairs from the authoritative persisted candidate", () => {
  const old = "当前候选仍要求已经交付物品从箱内消失";
  const proposed = "未应用修复改为检查箱内残留痕迹";
  const doc = { volumes: [{ id: "v", chapters: [{ id: "c1", chapterOrder: 1, taskSheet: old }] }], beatSheets: [] };
  const result = contextModule.buildAdviceContext({ novel: {}, volumes: doc.volumes, chapters: [], macro: null,
    candidate: { id: "candidate-v1", contentJson: JSON.stringify(doc) }, eligibleChapterIds: ["c1"],
    seed: { planningRepair: { volumeId: "v", technicalError: "lost original obligation", obligationMoves: [{ action: "retain" }], history: [{ kind: "repair", round: 7, output: { obligationMoves: [], reviewTargets: ["check source"], remainingRisks: ["pending"], changes: [{ chapterId: "c1", taskSheet: proposed, payoffRefs: ["proposed duty"] }] } },
      { kind: "rejected_response", round: 7, output: { summary: "rejected" } }] }, planningRepairSnapshot: { baselineDocument: doc } } });
  assert.equal(result.candidateAuthority.versionId, "candidate-v1");
  assert.equal(result.candidateWindow[0].chapters[0].taskSheet, old);
  assert.equal(result.repair.technicalError, "lost original obligation");
  assert.deepEqual(result.repair.obligationMoves, [{ action: "retain" }]);
  assert.deepEqual(result.repair.recentHistory[0].output.obligationMoves, []);
  assert.deepEqual(result.repair.recentHistory[0].output.reviewTargets, ["check source"]);
  assert.deepEqual(result.repair.recentHistory[0].output.remainingRisks, ["pending"]);
  assert.deepEqual(result.repair.recentHistory[0].output.proposedChapterObligations, [{ chapterId: "c1", payoffRefs: ["proposed duty"] }]);
  assert.equal(result.repair.recentHistory[0].output.changes, undefined);
  assert.ok(!JSON.stringify(result).includes(proposed));
  assert.ok(result.candidateEvidencePaths.includes("candidateWindow[0].chapters[0].taskSheet"));
  assert.equal(result.repair.recentHistory[0].provenance.authoritativeForCurrentCandidate, false);
  assert.equal(result.repair.recentHistory[1].provenance.role, "rejected_model_response_not_applied");
});

test("review evidence rejects history, wrong version, title-only proof and invented current text", () => {
  const f = fixture(); const option = { ...output().options[0], executionMode: "review_existing", candidateVersionId: "candidate-v1",
    candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "先核对已经交付的记录，再检查箱内仍存在的痕迹。" }] };
  assert.equal(contextModule.adviceCandidateEvidenceError(option, f.source.context), null);
  for (const patch of [ { candidateVersionId: "old" }, { candidateEvidence: undefined },
    { candidateEvidence: [{ sourcePath: "repair.recentHistory[0].output.changes[0].taskSheet", quote: "历史修复已经改成正确实现方式" }] },
    { candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].title", quote: "标题不能证明具体问题已经解决" }] },
    { candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "仅在修复提案中出现的全新句子" }] },
    { affectedChapterIds: ["c1", "c2"] } ]) {
    assert.ok(contextModule.adviceCandidateEvidenceError({ ...option, ...patch }, f.source.context));
  }
});

test("new advice cannot become ready by quoting an unapplied repair as current candidate", async () => {
  const f = fixture(); await f.service.request("t", { repairKey: "r", idempotencyKey: "new-rejected-proof" });
  const result = output(); Object.assign(result.options[0], { executionMode: "review_existing", diagnosis: "review_disagreement",
    candidateVersionId: "candidate-v1", candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].taskSheet", quote: "仅历史返回里存在的修复措辞不算当前候选" }] });
  f.resolve(result); await settle();
  assert.equal((await f.service.status("t")).status, "failed");
  assert.equal(f.grants.length, 0);
});

test("legacy review-only advice remains readable but cannot grant recovery without current candidate proof", async () => {
  const f = fixture(); const request = await f.service.request("t", { repairKey: "r", idempotencyKey: "legacy-review" });
  f.resolve(); await settle();
  Object.assign(f.source.seed.planningRepairAdvice.result.options[0], { executionMode: "review_existing", diagnosis: "review_disagreement" });
  const view = await f.service.status("t");
  assert.equal(view.status, "ready"); assert.equal(view.options[0].canResume, false);
  assert.match(view.options[0].blockedReason, /当前候选.*原文依据/);
  await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: request.adviceId, optionId: "a", idempotencyKey: "click" }), /重新获取/);
  assert.equal(f.grants.length, 0);
});


test("candidate proof accepts brief real evidence and parses saved scene JSON without treating history as current", () => {
  const option = { ...output().options[0], executionMode: "review_existing", candidateVersionId: "v",
    candidateEvidence: [{ sourcePath: "candidateWindow[0].chapters[0].sceneCards.scenes[0].mustAdvance[0]", quote: "已交付" }] };
  const context = { candidateAuthority: { versionId: "v" }, candidateWindow: [{ chapters: [{ id: "c1",
    sceneCards: JSON.stringify({ scenes: [{ mustAdvance: ["已交付"] }] }) }] }] };
  assert.equal(contextModule.adviceCandidateEvidenceError(option, context), null);
  option.candidateEvidence[0].quote = "";
  assert.ok(contextModule.adviceCandidateEvidenceError(option, context));
});


const capturedAdviceDir = path.resolve(__dirname, "../../.codex-run/delivery-box-advice-failure");
test("captured failed advice rebuild keeps real candidate plain and historical proposal duties distinct", {
  skip: !fs.existsSync(path.join(capturedAdviceDir, "candidate.json")) || !fs.existsSync(path.join(capturedAdviceDir, "request-readable.json")),
}, t => {
  const read = name => JSON.parse(fs.readFileSync(path.join(capturedAdviceDir, name), "utf8").replace(/^\uFEFF/, ""));
  const seed = read("seed.json"); const candidate = read("candidate.json");
  const before = JSON.stringify({ seed, candidate });
  const messages = read("request-readable.json");
  const encoded = JSON.parse(messages.at(-1).content);
  const expand = node => {
    if (node && typeof node === "object" && Object.keys(node).length === 1 && Object.hasOwn(node, encoded.referenceKey)) return expand(encoded.sources[node[encoded.referenceKey]]);
    if (Array.isArray(node)) return node.map(expand);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expand(v)]));
    return node;
  };
  const previous = expand(encoded.context);
  const context = contextModule.buildAdviceContext({ novel: previous.novel, volumes: previous.currentWindow,
    chapters: previous.chapterEvidence, macro: previous.macro, candidate, seed, eligibleChapterIds: previous.eligibleChapterIds });
  const prepared = encoding.prepareAdviceContext(context);
  const envelope = JSON.parse(prepared);
  assert.deepEqual((envelope.context ?? envelope).candidateWindow, context.candidateWindow);
  const chapter = context.candidateWindow.flatMap(v => v.chapters).find(c => c.chapterOrder === 3);
  assert.ok(chapter.taskSheet.includes("油纸包连旧痕一起不见"));
  assert.ok(context.candidateEvidencePaths.some(p => p.includes("sceneCards.scenes[")));
  for (const entry of context.repair.recentHistory.filter(e => e.kind === "repair")) {
    const original = seed.planningRepair.history.find(e => e.kind === "repair" && e.round === entry.round);
    assert.equal(entry.output.changes, undefined);
    assert.deepEqual(entry.output.obligationMoves, original.output.obligationMoves);
    assert.deepEqual(entry.output.proposedChapterObligations.map(c => c.payoffRefs), original.output.changes.map(c => c.payoffRefs));
  }
  assert.deepEqual(context.repair.technicalError, seed.planningRepair.technicalError);
  assert.deepEqual(context.repair.obligationMoves, seed.planningRepair.obligationMoves);
  assert.equal(JSON.stringify({ seed, candidate }), before, "source fingerprint inputs stay untouched");
  assert.ok(contextModule.adviceCandidateEvidenceError({ executionMode: "review_existing", candidateVersionId: candidate.id,
    affectedChapterIds: [chapter.id], candidateEvidence: [{ sourcePath: `candidateWindow[0].chapters[${context.candidateWindow[0].chapters.indexOf(chapter)}].taskSheet`, quote: "箱底残留暗红印痕与薄绢碎屑" }] }, context));
  t.diagnostic(`captured input=${messages.at(-1).content.length}; rebuilt input=${prepared.length}; candidate paths=${context.candidateEvidencePaths.length}`);
});
