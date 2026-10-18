const test = require("node:test");
const assert = require("node:assert/strict");
const { projectPlanningStateReview } = require("../dist/prompting/prompts/novel/volume/evidence/planningStateReview");

const openingReason = "本章为全书第一章，无更早正文可引用；该事实来自书级构思，作为开篇既定前提，非已写正文。";
const claims = [
  { id: "SC1", subject: "主角", predicate: "重生回到灾变前", temporalScope: "prior", modality: "fact",
    source: { kind: "unknown", reason: openingReason } },
  { id: "SC2", subject: "主角", predicate: "决定去买站", temporalScope: "planned", modality: "intention",
    source: { kind: "planned_scene", sceneKey: "scene1", phase: "entry" } },
  { id: "SC3", subject: "老周", predicate: "抬价试探", temporalScope: "planned", modality: "attempt",
    source: { kind: "planned_scene", sceneKey: "scene1", phase: "action" } },
  { id: "SC4", subject: "主角", predicate: "签下产权", temporalScope: "planned", modality: "outcome",
    source: { kind: "planned_scene", sceneKey: "scene1", phase: "exit" } },
];
function candidate(chapterOrder = 1) {
  return { chapterOrder, sceneCards: JSON.stringify({
    stateClaims: claims,
    scenes: [{ key: "scene1", causality: { prerequisites: [{ claimIds: ["SC1"] }],
      stateTransition: { beforeClaimIds: ["SC1", "SC2"], actionClaimIds: ["SC3"], afterClaimIds: ["SC4"] } } }],
  }) };
}
const evidence = (index, quote) => ({ sourcePath: `stateClaims[${index}].predicate`, quote });
function output(stateChecks) {
  return { verdict: "usable", safeToSync: true, loadRisk: "normal", recommendedHandling: "use_as_is", summary: "",
    issues: [], confidence: 0.8, issueChecks: [], promiseChecks: [], refinements: [], issueDecisions: [], stateChecks };
}
function plannedChecks() {
  return [
    { claimId: "SC2", status: "established_in_plan", evidence: [evidence(1, "决定去买站")], issueId: null },
    { claimId: "SC3", status: "established_in_plan", evidence: [evidence(2, "抬价试探")], issueId: null },
    { claimId: "SC4", status: "established_in_plan", evidence: [evidence(3, "签下产权")], issueId: null },
  ];
}

test("first-chapter declared unknown premise may be accepted in plan with entry evidence", () => {
  const checks = [{ claimId: "SC1", status: "established_in_plan",
    evidence: [{ sourcePath: "stateClaims[0].source.reason", quote: openingReason }], issueId: null }, ...plannedChecks()];
  assert.doesNotThrow(() => projectPlanningStateReview(output(checks), candidate()));
});

test("first-chapter declared unknown premise may stay insufficient without blocking execution", () => {
  const checks = [{ claimId: "SC1", status: "insufficient_context", evidence: [], issueId: null }, ...plannedChecks()];
  assert.doesNotThrow(() => projectPlanningStateReview(output(checks), candidate()));
});

test("unknown prior premise accepted in plan is still rejected outside the first chapter", () => {
  const checks = [{ claimId: "SC1", status: "established_in_plan",
    evidence: [{ sourcePath: "stateClaims[0].source.reason", quote: openingReason }], issueId: null }, ...plannedChecks()];
  assert.throws(() => projectPlanningStateReview(output(checks), candidate(2)), /planned transition needs current plan evidence/);
  const insufficient = [{ claimId: "SC1", status: "insufficient_context", evidence: [], issueId: null }, ...plannedChecks()];
  assert.throws(() => projectPlanningStateReview(output(insufficient), candidate(2)), /unknown prerequisite cannot silently admit execution/);
});

test("supported historical state still requires earlier primary prose", () => {
  const checks = [{ claimId: "SC1", status: "supported",
    evidence: [{ sourcePath: "stateClaims[0].source.reason", quote: openingReason }], issueId: null }, ...plannedChecks()];
  assert.throws(() => projectPlanningStateReview(output(checks), candidate()), /supported historical state requires earlier primary prose/);
});
