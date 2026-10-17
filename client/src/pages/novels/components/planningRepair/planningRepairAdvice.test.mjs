import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
function load(relative, overrides = {}, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const result = { exports: {} };
  cache.set(filename, result);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith(".")) {
      const basename = path.resolve(path.dirname(filename), name);
      const extension = name.endsWith("RepairAdviceOptions") ? ".tsx" : ".ts";
      return load(basename + extension, overrides, cache);
    }
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(localRequire, result, result.exports);
  return result.exports;
}
const presentation = load("planningRepairAdvicePresentation.ts");
const option = (id, canResume = true) => ({ id, title: `方案${id}`, reason: "保留人物选择", changes: ["调整后果"], preserves: ["核心关系"], tradeoffs: ["延后一次揭示"], canResume, blockedReason: canResume ? undefined : "需要扩大到窗口外章节" });
const ready = { status: "ready", adviceId: "advice-1", recommendedOptionId: "recommended", options: [option("alternative"), option("recommended"), option("blocked", false)] };
const status = { taskId: "task-1", novelId: "novel-1", status: "waiting_approval", planningRepair: { key: "repair-1" }, recoveryRequest: null };

test("recommended direction is the default but a non-recommended option remains selectable", () => {
  assert.equal(presentation.selectedPlanningRepairAdvice(ready, "")?.id, "recommended");
  assert.equal(presentation.selectedPlanningRepairAdvice(ready, "alternative")?.id, "alternative");
  assert.equal(presentation.canAdoptPlanningRepairAdvice(ready, "alternative", false), true);
  assert.equal(presentation.canAdoptPlanningRepairAdvice(ready, "blocked", false), false);
});

test("stale, failed, uncertain, running, missing and authorized recovery states never permit adoption", () => {
  for (const state of ["none", "stale", "applied", "failed", "uncertain", "running"]) {
    assert.equal(presentation.canAdoptPlanningRepairAdvice({ ...ready, status: state }, "recommended", false), false, state);
  }
  assert.equal(presentation.canAdoptPlanningRepairAdvice(undefined, "", false), false);
  assert.equal(presentation.canAdoptPlanningRepairAdvice(ready, "recommended", true), false);
});

function renderActions(advice, repairStatus = status, recoveryPreview = { available: false }) {
  const calls = [], mutations = [], queries = [];
  const api = {
    planningResumePolicyQueryKey: id => ["planning-repair", "resume-policy", id],
    planningReviewExistingQueryKey: id => ["planning-repair", "review-existing", id],
    getPlanningResumePolicy: async id => { calls.push(["get-policy",id]); return recoveryPreview; },
    getPlanningReviewExisting: async id => { calls.push(["get-review",id]); return recoveryPreview; },
    resumeOriginalPlanningPolicy: async (...args) => { calls.push(["policy",...args]); return {}; },
    reviewExistingPlanningCandidate: async (...args) => { calls.push(["review",...args]); return {}; },
    planningRepairAdviceQueryKey: id => ["planning-repair", "advice", id],
    getPlanningRepairAdvice: async id => { calls.push(["get", id]); return advice; },
    requestPlanningRepairAdvice: async (...args) => { calls.push(["generate", ...args]); return { status: "running" }; },
    selectPlanningRepairAdvice: async (...args) => { calls.push(["select", ...args]); return {}; },
    actOnPlanningRepair: async (...args) => { calls.push(["action", ...args]); return {}; },
  };
  const { RepairActions } = load("RepairActions.tsx", {
    "@/api/planningRepair": api,
    "@/api/queryKeys": { queryKeys: {} },
    "@/components/ui/button": { Button: ({ children, variant, size, ...props }) => React.createElement("button", props, children) },
    "lucide-react": { Pause: () => null, RefreshCw: () => null, Sparkles: () => null },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: () => {} }),
      useQuery: options => { queries.push(options); return { data: options.queryKey[1] === "advice" ? advice : recoveryPreview, isPending: false, refetch: options.queryFn }; },
      useMutation: options => { mutations.push(options); return { mutate: () => {}, isPending: false }; },
    },
  });
  return { html: renderToStaticMarkup(React.createElement(RepairActions, { status: repairStatus })), calls, mutations, queries };
}

test("mount and status polling never request paid advice or resume the task", async () => {
  const view = renderActions({ status: "none" });
  assert.deepEqual(view.calls, []);
  await view.queries.find(q=>q.queryKey[1]==="advice").queryFn();
  await view.queries.find(q=>q.queryKey[1]==="advice").queryFn();
  assert.deepEqual(view.calls.map(call => call[0]), ["get", "get"]);
  assert.match(view.html, /让 AI 推荐修复方案/);
  assert.match(view.html, /生成与独立核验，最多调用模型 2 次并产生费用/);
  assert.match(view.html, /高级：自定义修复方向（可选）/);
  assert.equal(view.queries[0].retry, false);
  assert.equal(view.mutations[0].retry, false);
});

test("explicit adoption sends server option identifiers, never client-generated guidance", async () => {
  const view = renderActions(ready);
  assert.match(view.html, /AI 推荐/);
  assert.match(view.html, /采用此方案并修复/);
  assert.match(view.html, /追加 1 轮规划修复/);
  assert.match(view.html, /需要扩大到窗口外章节/);
  await view.mutations[1].mutationFn("adopt");
  const payload = view.calls[0][2];
  assert.equal(payload.adviceId, "advice-1");
  assert.equal(payload.optionId, "recommended");
  assert.equal("guidance" in payload, false);
  await view.mutations[1].mutationFn("adopt");
  assert.equal(view.calls[1][2].idempotencyKey, payload.idempotencyKey);
});

test("lost generation responses replay the request until polling confirms a terminal outcome", async () => {
  const advice = { status: "none" };
  const view = renderActions(advice);
  await view.mutations[0].mutationFn();
  await view.mutations[0].mutationFn();
  const originalKey = view.calls[0][2].idempotencyKey;
  assert.equal(view.calls[1][2].idempotencyKey, originalKey);
  Object.assign(advice, { status: "running", requestId: "request-1" });
  await view.mutations[0].mutationFn();
  assert.equal(view.calls[2][2].idempotencyKey, originalKey);
  Object.assign(advice, { status: "failed" });
  await view.mutations[0].mutationFn();
  const retryKey = view.calls[3][2].idempotencyKey;
  assert.notEqual(retryKey, originalKey);
  await view.mutations[0].mutationFn();
  assert.equal(view.calls[4][2].idempotencyKey, retryKey);
  Object.assign(advice, { status: "uncertain", requestId: "request-2" });
  await view.mutations[0].mutationFn();
  assert.notEqual(view.calls[5][2].idempotencyKey, retryKey);
});

test("existing authorization hides new grants and preserves its original direction and request key", async () => {
  const authorized = { ...status, recoveryRequest: { guidance: "原授权方向", idempotencyKey: "original-request",
    executionMode: "repair_then_review", affectedChapterIds: ["c2", "c3"] } };
  const view = renderActions(ready, authorized);
  assert.equal(view.queries[0].enabled, false);
  assert.match(view.html, /继续已确认的处理/);
  assert.doesNotMatch(view.html, /让 AI 推荐修复方案|采用此方案并修复|自定义修复方向/);
  await view.mutations[1].mutationFn("continue");
  assert.deepEqual(view.calls[0], ["action", "task-1", {
    action: "retry", repairKey: "repair-1", guidance: "原授权方向", idempotencyKey: "original-request",
    executionMode: "repair_then_review", affectedChapterIds: ["c2", "c3"],
  }]);
  await view.mutations[1].mutationFn("pause");
  assert.equal(view.calls[1][2].action, "pause");
});

test("original-policy entry explains remaining budget, cost and continuation while review-only remains optional",async()=>{
  const view=renderActions({status:"none"},status,{available:true,token:"preview",remainingRounds:2,chapterOrder:6,startOrder:4,endOrder:10});
  assert.deepEqual(view.calls,[]);
  assert.match(view.html,/按原策略继续/); assert.match(view.html,/剩余 2 轮自动修复，不追加轮次/);
  assert.match(view.html,/第 4–10 章继续写作/); assert.match(view.html,/修复和后续写作都会产生模型费用/);
  assert.match(view.html,/重新复核保留候选/);
  await assert.rejects(view.mutations[1].mutationFn("policy"),/请刷新并核对/);
  await assert.rejects(view.mutations[1].mutationFn("review"),/请刷新并核对/);
  assert.deepEqual(view.calls,[]);
});

test("authorized original-policy replay preserves its token and never falls into round-adding generic retry",async()=>{
  const authorized={...status,recoveryRequest:{guidance:"按原策略",idempotencyKey:"grant",executionMode:"resume_existing_policy",candidateRecoveryToken:"frozen-token"}};
  const view=renderActions(ready,authorized);
  await view.mutations[1].mutationFn("continue");
  assert.deepEqual(view.calls,[["policy","task-1",{repairKey:"repair-1",token:"frozen-token",idempotencyKey:"grant"}]]);
  assert.throws(()=>presentation.authorizedPlanningRepairPayload(authorized),/原策略继续入口/);
  const missing=renderActions(ready,{...authorized,recoveryRequest:{...authorized.recoveryRequest,candidateRecoveryToken:undefined}});
  await assert.rejects(missing.mutations[1].mutationFn("continue"),/无法核对原策略授权/);
  assert.deepEqual(missing.calls,[]);
});

test("expired and uncertain advice show recovery choices without an adoption button", () => {
  const applied = renderActions({ ...ready, status: "applied" }).html;
  assert.match(applied, /上次方案已采用/);
  assert.doesNotMatch(applied, /章节计划或修复范围发生变化|采用此方案并修复/);
  const stale = renderActions({ ...ready, status: "stale" }).html;
  assert.match(stale, /重新获取方案后选择/);
  assert.doesNotMatch(stale, /采用此方案并修复/);
  const uncertain = renderActions({ status: "uncertain" }).html;
  assert.match(uncertain, /刷新方案状态/);
  assert.match(uncertain, /重新获取修复方案/);
  assert.doesNotMatch(uncertain, /采用此方案并修复/);
});

test("advice GET remains separate from paid generation and selection API commands", async () => {
  const calls = [];
  const apiPath = path.resolve(root, "../../../../api/planningRepair/index.ts");
  const api = load(apiPath, { "../client": { apiClient: {
    get: async url => { calls.push(["get", url]); return { data: { data: { status: "none" } } }; },
    post: async (url, payload) => { calls.push(["post", url, payload]); return { data: { data: {} } }; },
  } } });
  await api.getPlanningRepairAdvice("task/a");
  assert.deepEqual(calls, [["get", "/novel-workflows/task%2Fa/planning-repair/advice"]]);
  await api.requestPlanningRepairAdvice("task/a", { repairKey: "r", idempotencyKey: "generation-1" });
  await api.selectPlanningRepairAdvice("task/a", { repairKey: "r", adviceId: "a", optionId: "o", idempotencyKey: "grant-1" });
  assert.equal(calls[1][1], "/novel-workflows/task%2Fa/planning-repair/advice");
  assert.equal(calls[2][1], "/novel-workflows/task%2Fa/planning-repair/advice/select");
  await api.getPlanningResumePolicy("task/a");
  await api.resumeOriginalPlanningPolicy("task/a",{repairKey:"r",token:"proof",idempotencyKey:"grant-2"});
  assert.deepEqual(calls.slice(3),[["get","/novel-workflows/task%2Fa/planning-repair/resume-policy"],
    ["post","/novel-workflows/task%2Fa/planning-repair/resume-policy",{repairKey:"r",token:"proof",idempotencyKey:"grant-2"}]]);
});
