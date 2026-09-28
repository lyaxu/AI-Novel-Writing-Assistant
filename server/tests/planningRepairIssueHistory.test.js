const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReviewIssueHistory } = require("../dist/services/novel/volume/planningRepair/domain/reviewIssueHistory.js");
const issue = id => ({ id, severity: "medium", target: "scene_cards", summary: `original ${id}`, repairHint: `repair ${id}` });
const check = (id, status = "resolved") => ({ issueId: id, status,
  candidateEvidence: [{ sourcePath: "taskSheet", quote: "检查动作" }], explanation: "检查动作已安排" });
const assessment = (issues, issueChecks = [], chapterId = "c") => ({ kind: "assessment", result: { chapters: { [chapterId]: { issues, issueChecks } } } });

test("resolved issue remains available after an unrelated review and retains original scope", () => {
  const original = issue("source");
  const history = [assessment([original]), assessment([{ ...original, summary: "expanded scope" }], [check("source", "partially_resolved")]),
    assessment([issue("handoff")], [check("source")]), assessment([], [check("handoff")])];
  const result = buildReviewIssueHistory(history, "c");
  assert.deepEqual(result.previousIssues, [original, issue("handoff")]);
  assert.deepEqual(result.priorIssueDecisions.map(x => x.issueId), ["source", "handoff"]);
});

test("history budget retains every active issue and only eight most recently resolved issues", () => {
  const old = Array.from({ length: 24 }, (_, i) => issue(`old${i}`));
  const active = Array.from({ length: 12 }, (_, i) => issue(`active${i}`));
  const history = [assessment(old), assessment(active, old.map(x => check(x.id)))];
  const result = buildReviewIssueHistory(history, "c");
  assert.deepEqual(result.previousIssues.map(x => x.id), [...active, ...old.slice(-8)].map(x => x.id));
  assert.equal(result.omittedResolvedIssueCount, 16);
  // Rechecking an old resolution does not displace a newly resolved problem.
  history.push(assessment(active.slice(1), [check("active0"), ...old.slice(-8).map(x => check(x.id))]));
  const updated = buildReviewIssueHistory(history, "c");
  assert.ok(updated.previousIssues.some(x => x.id === "active0"));
  assert.ok(!updated.previousIssues.some(x => x.id === "old16"));
});

test("evidence refresh and chapter identity isolate historical decisions", () => {
  const history = [assessment([issue("old")]), assessment([], [check("old")]), { kind: "evidence_refresh" },
    assessment([issue("other")], [], "other"), assessment([issue("new")])];
  assert.deepEqual(buildReviewIssueHistory(history, "c"), {
    previousIssues: [issue("new")], priorIssueDecisions: [], omittedResolvedIssueCount: 0,
  });
});

test("new regression replaces the historical resolved decision while preserving original scope", () => {
  const original = issue("source");
  const history = [assessment([original]), assessment([], [check("source")]),
    assessment([{ ...original, summary: "new regression" }], [check("source", "unresolved")])];
  const result = buildReviewIssueHistory(history, "c");
  assert.deepEqual(result.previousIssues, [original]);
  assert.equal(result.priorIssueDecisions[0].status, "unresolved");
});
