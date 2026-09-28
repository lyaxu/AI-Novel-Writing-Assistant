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

test("all resolved issues survive beyond eight IDs while repeated rounds fold to the latest decision", () => {
  const old = Array.from({ length: 24 }, (_, i) => issue(`old${i}`));
  const active = Array.from({ length: 12 }, (_, i) => issue(`active${i}`));
  const history = [assessment(old), assessment(active, old.map(x => check(x.id)))];
  const result = buildReviewIssueHistory(history, "c");
  assert.deepEqual(result.previousIssues.map(x => x.id), [...old, ...active].map(x => x.id));
  assert.equal(result.omittedResolvedIssueCount, 0);
  for (let round = 0; round < 20; round++) {
    history.push(assessment(active.slice(1), [check("active0"), ...old.map(x => ({ ...check(x.id), explanation: `review ${round}` }))]));
  }
  const updated = buildReviewIssueHistory(history, "c");
  assert.equal(updated.previousIssues.length, 36);
  assert.equal(updated.priorIssueDecisions.length, 25);
  assert.equal(updated.priorIssueDecisions.find(x => x.issueId === "old0").explanation, "review 19");
  assert.equal(updated.previousIssues[0].summary, "original old0");
  assert.equal(updated.omittedResolvedIssueCount, 0);
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
