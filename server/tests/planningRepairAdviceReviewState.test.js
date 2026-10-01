const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function source(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename })((name) => {
    if (name in mocks) return mocks[name];
    if (name === "node:crypto") return require(name);
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports;
}
const base = "../src/services/novel/director/recovery/planningRepair/advice/";
const { buildAdviceContext } = source(`${base}AdviceContext.ts`, {
  "../../../../volume/planningPromises": { projectPlanningHorizon: () => ({}) },
});
const { buildCurrentAdviceReviewIssues, prepareAdviceSemanticReviewContext } = source(`${base}semanticReview/context.ts`, {
  "../AdviceContextEncoding": { prepareAdviceContext: JSON.stringify },
  "../AdviceContext": { adviceCandidateSourceText: () => "Current plan" },
  "./contract": {},
});
function fixture() {
  const chapter = { id: "c3", chapterId: "written3", chapterOrder: 3, taskSheet: "交付后由面板结算，远处角色目击发光。", sceneCards: { scenes: [] } };
  const doc = { volumes: [{ id: "v", chapters: [chapter] }] };
  return {
    novel: { id: "n" }, volumes: doc.volumes, chapters: [{ id: "written3", order: 3, content: "" }],
    candidate: { id: "version-new", contentJson: JSON.stringify(doc) }, macro: {}, eligibleChapterIds: ["c3"],
    seed: { directorInput: "计划后再写作", planningRepairSnapshot: { baselineDocument: doc }, planningRepair: {
      volumeId: "v", chapterId: "c3", affectedChapterIds: ["c3"], phase: "technical_failed",
      technicalError: "旧候选引文与当前字段不匹配", quality: { chapters: {} }, history: [
        { kind: "assessment", round: 0, result: { chapters: { c3: { issues: [
          { id: "arrival_missing", summary: "抵达前提未建立" }, { id: "trigger_missing", summary: "发光触发未建立" },
        ] } } } },
        ...Array.from({ length: 8 }, (_, i) => ({ kind: "repair", round: i + 1, output: { changes: [{ taskSheet: "OLD_EXECUTABLE_DRAFT" }] } })),
      ],
    } },
  };
}

test("technical review failure retains all prior claims beyond history display limit without treating unwritten prose as missing planning", () => {
  const input = fixture(); const ctx = buildAdviceContext(input);
  assert.equal(ctx.repair.recentHistory.length, 6);
  assert.equal(ctx.repair.lastCompletedAssessmentClaims.round, 0);
  const prepared = prepareAdviceSemanticReviewContext(ctx);
  const rendered = JSON.parse(prepared.contextJson);
  assert.equal(rendered.reviewState.stage, "planning_contract_before_prose");
  assert.equal(rendered.reviewState.currentAssessmentStatus, "pending_due_to_technical_failure");
  assert.equal(rendered.reviewState.technicalError, "旧候选引文与当前字段不匹配");
  assert.equal(rendered.chapterEvidence[0].content, "");
  assert.equal(rendered.candidateWindow[0].chapters[0].taskSheet, "交付后由面板结算，远处角色目击发光。");
  assert.equal(prepared.issueCatalog.length, 2);
  assert.ok(prepared.issueCatalog.every(row => row.authority === "historical_claim_requires_current_verification" && row.sourceRound === 0));
  assert.deepEqual(prepared.issueCatalog, buildCurrentAdviceReviewIssues(ctx));
  assert.ok(!prepared.contextJson.includes("OLD_EXECUTABLE_DRAFT"));
});

test("current reviewed result always supersedes historical claims, including a valid zero-issue result", () => {
  const ctx = buildAdviceContext(fixture());
  ctx.repair.quality = { chapters: { c3: { issues: [] } } };
  assert.deepEqual(buildCurrentAdviceReviewIssues(ctx), []);
  assert.equal(JSON.parse(prepareAdviceSemanticReviewContext(ctx).contextJson).reviewState.currentAssessmentStatus, "available");
  ctx.repair.quality.chapters.c3.issues.push({ id: "current", summary: "新问题" });
  assert.equal(buildCurrentAdviceReviewIssues(ctx)[0].sourceIssueId, "current");
  assert.equal(buildCurrentAdviceReviewIssues(ctx)[0].authority, undefined);
});

test("ordinary not-yet-reviewed plans do not revive historical issues and historical scopes cannot widen authorization", () => {
  const ctx = buildAdviceContext(fixture());
  ctx.repair.phase = "reviewing";
  assert.deepEqual(buildCurrentAdviceReviewIssues(ctx), []);
  ctx.repair.phase = "technical_failed";
  ctx.eligibleChapterIds = ["other"];
  assert.throws(() => buildCurrentAdviceReviewIssues(ctx), /超出当前授权范围/);
});

test("historical window claims retain their scope and require current verification", () => {
  const input = fixture();
  input.seed.planningRepair.history = [{ kind: "review", round: 1, result: { chapters: {}, window: { issues: ["跨章职责重叠", "后续承接未核实"] } } }];
  const ctx = buildAdviceContext(input); const issues = buildCurrentAdviceReviewIssues(ctx);
  assert.equal(issues.length, 2);
  assert.ok(issues.every(row => row.scope === "window" && row.authority === "historical_claim_requires_current_verification"));
  ctx.repair.affectedChapterIds = ["c3", "outside"];
  assert.throws(() => buildCurrentAdviceReviewIssues(ctx), /窗口问题/);
});

test("source evidence refresh prevents reviving claims from an obsolete evidence epoch", () => {
  const input = fixture();
  input.seed.planningRepair.history.push({ kind: "evidence_refresh", round: 9 });
  const fresh = buildAdviceContext(input);
  assert.equal(fresh.repair.lastCompletedAssessmentClaims, undefined);
  assert.deepEqual(buildCurrentAdviceReviewIssues(fresh), []);
  input.seed.planningRepair.history.push({ kind: "assessment", round: 9,
    result: { chapters: { c3: { issues: [{ id: "fresh", summary: "刷新后形成的主张" }] } } } });
  const issues = buildCurrentAdviceReviewIssues(buildAdviceContext(input));
  assert.deepEqual(issues.map(row => row.sourceIssueId), ["fresh"]);
});
