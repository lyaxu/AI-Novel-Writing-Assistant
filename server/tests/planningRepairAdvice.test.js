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
const structuredOutput = load("../src/llm/structuredOutput.ts", { zod: require("zod"), "./providers": {}, "./reasoning": {} });
class TestAppError extends Error {}
const failureModule = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceFailure.ts", {
  zod: require("zod"), "../../../../../../llm/structuredOutput": structuredOutput,
  "../../../../../../middleware/errorHandler": { AppError: TestAppError },
});
const output = () => ({ summary: "复核后给出可执行方向", recommendedOptionId: "a", options: [{
  id: "a", title: "补齐行动因果", reason: "现有合同缺少行动前提", changes: ["补齐已有线索来源"], preserves: ["保留核心冲突"], tradeoffs: ["压缩次要叙述"],
  diagnosis: "real_gap", affectedChapterIds: ["c1"], changesHardConstraints: false, requiresSourceEdit: false,
  guidance: { intent: "补齐因果", actions: ["使用已有线索"], preserve: ["核心冲突"], verification: ["验证行动前提"] },
}] });
function fixture() {
  let source = { row: { id: "t", seedPayloadJson: "old", updatedAt: "time" }, seed: {}, repair: { key: "r", novelId: "n", chapterId: "c1" },
    fingerprint: "f", sourceToken: "s", eligibleChapterIds: ["c1", "c2", "c3"], context: { userIntent: "保留设定" } };
  let writes = 0, calls = 0, rejectCas = false, pending;
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
    "../../../../../../prompting/core/promptRunner": { runStructuredPrompt: () => { throw new Error("Paid calls forbidden"); } },
    "../../../../../../prompting/prompts/novel/volume/recovery/planningRepairAdvice.prompts": {},
    "../../../../../../llm/invokeTimeout": {}, "../PlanningRepairRecoveryService": {},
    "./AdviceFailure": failureModule,
    "./AdviceSource": { readAdviceSource: async () => structuredClone(source), assertAdvicePaused: async () => {} },
  });
  const service = new mod.PlanningRepairAdviceService({ grant: async (taskId, input) => { grants.push(input); return { granted: true, replayed: grants.length > 1, taskId }; } },
    async () => { calls++; return new Promise((resolve, reject) => { pending = { resolve, reject }; }); });
  return { service, source, grants, modelOptions: mod.adviceModelOptions, calls: () => calls, writes: () => writes, resolve: (value = output()) => pending.resolve(value), fail: (error = new Error("timeout")) => pending.reject(error), casFail: () => { rejectCas = true; } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
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
  await assert.rejects(f.service.select("t", { ...input, optionId: "forged" }));
});
test("source changes invalidate ready advice and late result cannot overwrite source", async () => {
  const f = fixture(); const r = await f.service.request("t", { repairKey: "r", idempotencyKey: "req" });
  f.source.fingerprint = "changed"; f.resolve(); await settle();
  assert.equal((await f.service.status("t")).status, "stale"); assert.equal(f.writes(), 1);
  await assert.rejects(f.service.select("t", { repairKey: "r", adviceId: r.adviceId, optionId: "a", idempotencyKey: "click" }));
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
    "./AdviceContext": load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContext.ts", {}),
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
  const { buildAdviceContext } = load("../src/services/novel/director/recovery/planningRepair/advice/AdviceContext.ts", {});
  const plans = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, chapterId: `c${i + 1}`, chapterOrder: i + 1, title: `章${i + 1}`, taskSheet: "合同" }));
  const doc = { volumes: [{ id: "v", chapters: plans, escalationMode: "压力递进", protagonistChange: "主动选择", nextVolumeHook: "卷间承诺", resetPoint: "不可重置", openPayoffs: ["待兑现承诺"] }], semanticDocument: "整本衍生数据" };
  const result = buildAdviceContext({ novel: { title: "书", outline: "整本大纲", storyWorldSliceJson: "书约束" },
    volumes: doc.volumes, chapters: plans.map((p, i) => ({ id: p.chapterId, content: `正文${i + 1}` })), macro: null,
    candidate: { contentJson: JSON.stringify(doc) }, eligibleChapterIds: ["p2", "p3", "p4"],
    seed: { directorInput: { idea: "原意图" }, planningRepairSnapshot: { baselineDocument: doc }, planningRepair: { quality: { summary: "最新审查结果" }, history: Array.from({ length: 9 }, (_, i) => ({ round: i })) } } });
  const text = JSON.stringify(result);
  assert.match(text, /正文1/); assert.match(text, /正文5/); assert.doesNotMatch(text, /正文6|整本大纲|整本衍生数据/);
  assert.match(text, /原意图|书约束/); assert.equal(result.repair.recentHistory.length, 6);
  assert.equal(result.repair.quality.summary, "最新审查结果");
  assert.equal(result.candidateWindow[0].escalationMode, "压力递进");
  assert.equal(result.candidateWindow[0].nextVolumeHook, "卷间承诺");
  assert.deepEqual(result.candidateWindow[0].openPayoffs, ["待兑现承诺"]);
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

test("v2 prompt renders the full shared contract and example, with explicit paid-recovery boundaries", () => {
  const asset = prompt.planningRepairAdvicePrompt;
  const text = asset.render({ contextJson: "{}" })[0].content;
  assert.equal(asset.version, "v2"); assert.equal(asset.repairPolicy.maxAttempts, 0); assert.equal(asset.semanticRetryPolicy.maxAttempts, 0);
  const jsonSchema = JSON.parse(text.split("完整输出契约（minItems/maxItems是数量，minLength/maxLength是字符数）：\n")[1].split("\n输出格式示例")[0]);
  const fields = jsonSchema.properties.options.items.properties;
  assert.deepEqual(fields.diagnosis.enum, schema.planningRepairAdviceDiagnoses);
  assert.equal(fields.guidance.properties.actions.maxItems, 8);
  assert.equal(fields.affectedChapterIds.maxItems, 3);
  assert.equal(jsonSchema.properties.options.maxItems, 3);
  assert.equal(schema.planningRepairAdviceOutputSchema.safeParse(prompt.planningRepairAdviceExample).success, true);
  assert.match(text, /不得超过4000字符/); assert.match(text, /采用一个可执行方案即明确授权追加1轮/);
  assert.match(text, /不要让写作新手查询服务器schema/);
  assert.match(fs.readFileSync(path.join(__dirname, "../src/prompting/registry/promptAssetLoaderEntries.ts"), "utf8"), /novel\.planning_repair\.advice@v2/);
});

test("real rejected response keeps every action under wider non-safety limits but still rejects invented diagnoses", async () => {
  const failure = schema.planningRepairAdviceOutputSchema.safeParse(rejectedAdvice);
  assert.equal(failure.success, false);
  assert.deepEqual(failure.error.issues.map(issue => issue.path.join(".")), ["options.1.diagnosis", "options.2.diagnosis"]);
  const valid = structuredClone(rejectedAdvice);
  // Test fixture variant only: production must never infer or remap a diagnosis.
  valid.options[1].diagnosis = "missing_information"; valid.options[2].diagnosis = "review_disagreement";
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
