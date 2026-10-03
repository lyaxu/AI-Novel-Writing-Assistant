const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { prepareAdviceSemanticReviewContext, resolveAdviceSemanticReview, validateAdviceSemanticReview } =
  require("../dist/services/novel/director/recovery/planningRepair/advice/semanticReview");
function source() {
  return { candidateAuthority: { versionId: "current-v" }, eligibleChapterIds: ["c1"],
    candidateWindow: [{ chapters: [{ id: "c1", exclusiveEvent: "Current verified implementation B", taskSheet: "Use current B" }] }],
    candidatePlanningHorizon: { beats: [{ mustDeliver: ["Future handoff"] }] },
    chapterEvidence: [{ id: "written1", content: "The earlier delivery is finished.", summary: "OLD SUMMARY" }],
    baselineWindow: "OLD BASELINE", currentWindow: "OLD SYNCED", novel: { title: "Test" }, macro: { rule: "Book constraint" },
    userIntent: { directorInput: "Original intent", selectedCandidate: { premise: "Original premise" }, startupPreparation: "OLD PREPARATION" },
    repair: { quality: { issue: "Check current obligations" }, obligationMoves: [{ action: "revise", obligation: "A", replacement: "B" }],
      guidance: "OLD GUIDANCE", recentHistory: ["OLD MODEL DRAFT"] } };
}
function raw(evidenceId) {
  return { issueAssessments: [], summary: "Review current source", recommendedOptionId: "a", options: [{ id: "a", title: "Repair current issue", reason: "Current source supports the direction",
    changes: ["Repair the gap"], preserves: ["Book constraint"], tradeoffs: [], diagnosis: "real_gap", executionMode: "repair_then_review",
    affectedChapterIds: ["c1"], changesHardConstraints: false, requiresSourceEdit: false,
    blockerResolution: { status: "complete", remainingBlockers: [], rationale: "Complete direction" },
    guidance: { intent: "Repair", actions: ["Repair current gap"], preserve: [], verification: ["Check current source"] },
    check: { verdict: "supported", rationale: "Current evidence", evidence: [{ evidenceId, relation: "supports" }] },
  }] };
}
test("review context removes competing versions and old advice while preserving current authority", () => {
  const input = source(); const before = JSON.stringify(input); const prepared = prepareAdviceSemanticReviewContext(input);
  for (const old of ["OLD BASELINE", "OLD SYNCED", "OLD GUIDANCE", "OLD MODEL DRAFT", "OLD SUMMARY", "OLD PREPARATION"]) assert.ok(!prepared.contextJson.includes(old));
  for (const retained of ["Current verified implementation B", "Original intent", "Book constraint", "Check current obligations", "已应用义务映射由运行时保留"]) assert.ok(prepared.contextJson.includes(retained));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(prepareAdviceSemanticReviewContext(input), prepared);
});
test("catalog selection restores exact current quote and rejects invented IDs or model-rewritten evidence", () => {
  const input = source(); const prepared = prepareAdviceSemanticReviewContext(input);
  const entry = prepared.evidenceCatalog.find(e => e.sourcePath.endsWith("exclusiveEvent"));
  const output = resolveAdviceSemanticReview(raw(entry.evidenceId), prepared);
  assert.deepEqual(output.checks[0].evidence, [{ sourcePath: entry.sourcePath, quote: entry.quote, relation: "supports" }]);
  assert.doesNotThrow(() => validateAdviceSemanticReview(output, input));
  assert.throws(() => resolveAdviceSemanticReview(raw("old-version-id"), prepared), /不存在/);
  const forged = raw(entry.evidenceId); forged.options[0].check.evidence[0].quote = "OLD BASELINE";
  assert.throws(() => resolveAdviceSemanticReview(forged, prepared));
  const changed = source(); changed.candidateWindow[0].chapters[0].exclusiveEvent = "Changed source C";
  assert.throws(() => resolveAdviceSemanticReview(raw(entry.evidenceId), prepareAdviceSemanticReviewContext(changed)), /不存在/);
});
test("readonly body and future plan catalog items cannot replace candidate chapter coverage", () => {
  const input = source(); const prepared = prepareAdviceSemanticReviewContext(input);
  const candidate = prepared.evidenceCatalog.find(e => e.authority === "current_candidate");
  const readonly = prepared.evidenceCatalog.filter(e => e.authority !== "current_candidate");
  assert.equal(readonly.length, 2);
  const model = raw(readonly[0].evidenceId);
  assert.throws(() => validateAdviceSemanticReview(resolveAdviceSemanticReview(model, prepared), input), /每个候选章节/);
  model.options[0].check.evidence.push(...[candidate, readonly[1]].map(e => ({ evidenceId: e.evidenceId, relation: "supports" })));
  assert.doesNotThrow(() => validateAdviceSemanticReview(resolveAdviceSemanticReview(model, prepared), input));
});
test("long written evidence uses exact bounded windows and retains passage endings", () => {
  const input = source(); input.chapterEvidence[0].content = "Beginning " + "a".repeat(1900) + " END";
  const prepared = prepareAdviceSemanticReviewContext(input);
  const prose = prepared.evidenceCatalog.filter(e => e.authority === "written_prose");
  assert.ok(prose.every(e => e.quote.length <= 600 && input.chapterEvidence[0].content.includes(e.quote)));
  assert.ok(prose.some(e => e.quote.endsWith(" END")));
  assert.equal(new Set(prepared.evidenceCatalog.map(e => e.evidenceId)).size, prepared.evidenceCatalog.length);
});
const capture = path.resolve(__dirname, "../../.codex-run/delivery-box-latest-evidence");
test("captured current candidate catalog cannot offer rejected baseline quotes under current fields", { skip: !fs.existsSync(path.join(capture, "candidate.json")) }, t => {
  const read = name => JSON.parse(fs.readFileSync(path.join(capture, name), "utf8").replace(/^\uFEFF/, ""));
  const seed = read("seed.json"); const candidate = read("candidate.json");
  const { buildAdviceContext } = require("../dist/services/novel/director/recovery/planningRepair/advice/AdviceContext");
  const input = buildAdviceContext({ novel: {}, volumes: seed.planningRepairSnapshot.baselineDocument.volumes,
    chapters: [], macro: null, candidate, seed, eligibleChapterIds: seed.planningRepairSnapshot.eligibleChapterIds });
  const prepared = prepareAdviceSemanticReviewContext(input);
  const rejected = seed.planningRepairAdvice.failureDiagnostics.rejectedOutput.parsed;
  const falseQuotes = rejected.checks.flatMap(c => c.evidence).filter(e => e.sourcePath.endsWith("exclusiveEvent") || e.sourcePath.endsWith("endingState"));
  assert.equal(falseQuotes.length, 2);
  for (const evidence of falseQuotes) {
    const current = prepared.evidenceCatalog.filter(e => e.sourcePath === evidence.sourcePath);
    assert.ok(current.length > 0); assert.ok(current.every(e => !e.quote.includes(evidence.quote)));
  }
  assert.ok(!prepared.contextJson.includes('"baselineWindow"'));
  assert.ok(!prepared.contextJson.includes('"recentHistory"'));
  t.diagnostic(`isolated=${prepared.contextJson.length}; catalog=${prepared.evidenceCatalog.length}`);
});

test("current issue catalog is completely assessed before a compatible final action", () => {
  const input = source(); input.repair.quality = { chapters: { c1: { issues: [{ id: "handoff", summary: "Verify later handoff" }, { summary: "Unnamed current issue" }] } } };
  const prepared = prepareAdviceSemanticReviewContext(input);
  assert.equal(prepared.issueCatalog.length, 2);
  const entry = prepared.evidenceCatalog.find(e => e.authority === "current_candidate");
  const model = raw(entry.evidenceId);
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /完整且不重复/);
  model.issueAssessments = prepared.issueCatalog.map(issue => ({ issueId: issue.issueId, status: "present", evidenceIds: [entry.evidenceId], rationale: "Current evidence supports a remaining gap" }));
  const resolved = resolveAdviceSemanticReview(model, prepared);
  assert.equal(resolved.issueAssessments.length, 2);
  assert.equal(resolved.issueAssessments[0].chapterId, "c1");
  assert.doesNotThrow(() => validateAdviceSemanticReview(resolved, input));
  const legacy = structuredClone(resolved); delete legacy.issueAssessments;
  assert.throws(() => validateAdviceSemanticReview(legacy, input), /当前问题目录/);
  const fakeProof = structuredClone(resolved); fakeProof.issueAssessments[0].evidence[0].quote = "Invented old text";
  assert.throws(() => validateAdviceSemanticReview(fakeProof, input), /准确原文/);
  model.issueAssessments[1].issueId = model.issueAssessments[0].issueId;
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /完整且不重复/);
  model.issueAssessments[1].issueId = prepared.issueCatalog[1].issueId;
  model.options[0].executionMode = "review_existing";
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /不能仅复核/);
  model.issueAssessments.forEach(issue => { issue.status = "insufficient"; issue.evidenceIds = []; });
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /不能仅复核/);
});
test("review rejection retains the actual second-pass wire response privately", () => {
  const prepared = prepareAdviceSemanticReviewContext(source()); const model = raw("unknown");
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), error => {
    assert.equal(Object.keys(error).includes("rejectedOutput"), false);
    assert.equal(error.rejectedOutput.parsed, model); return true;
  });
});

test("option-owned checks preserve the complete shared advice validation and reject old wrappers", () => {
  const prepared = prepareAdviceSemanticReviewContext(source()); const entry = prepared.evidenceCatalog.find(e => e.authority === "current_candidate");
  const wire = raw(entry.evidenceId);
  assert.doesNotThrow(() => resolveAdviceSemanticReview(wire, prepared));
  const { summary, recommendedOptionId, options, ...review } = wire;
  assert.throws(() => resolveAdviceSemanticReview({ ...review, advice: { summary, recommendedOptionId, options } }, prepared));
  assert.throws(() => resolveAdviceSemanticReview({ ...wire, recommendedOptionId: "not-an-option" }, prepared));
});

test("removing a draft alternative removes its check by construction while persisted reviews stay compatible", () => {
  const input = source(); const prepared = prepareAdviceSemanticReviewContext(input);
  const entry = prepared.evidenceCatalog.find(e => e.authority === "current_candidate");
  const draft = raw(entry.evidenceId);
  draft.options.push({ ...structuredClone(draft.options[0]), id: "b" });
  const final = structuredClone(draft); final.options.pop();
  const resolved = resolveAdviceSemanticReview(final, prepared);
  assert.deepEqual(resolved.advice.options.map(option => option.id), ["a"]);
  assert.deepEqual(resolved.checks.map(check => check.optionId), ["a"]);
  assert.equal(Object.hasOwn(resolved.advice.options[0], "check"), false);
  assert.doesNotThrow(() => validateAdviceSemanticReview(JSON.parse(JSON.stringify(resolved)), input));
  assert.throws(() => resolveAdviceSemanticReview({ ...final, checks: [{ optionId: "b", ...draft.options[1].check }] }, prepared));
  const missing = structuredClone(final); delete missing.options[0].check;
  assert.throws(() => resolveAdviceSemanticReview(missing, prepared));
  const renamed = structuredClone(final); renamed.options[0].id = "c"; renamed.recommendedOptionId = "c";
  assert.deepEqual(resolveAdviceSemanticReview(renamed, prepared).checks.map(check => check.optionId), ["c"]);
});

test("binding a check to an option never bypasses blocked or contradictory review-only semantics", () => {
  const input = source(); const prepared = prepareAdviceSemanticReviewContext(input);
  const entry = prepared.evidenceCatalog.find(e => e.authority === "current_candidate");
  const wire = raw(entry.evidenceId);
  wire.options[0].check.verdict = "blocked";
  assert.throws(() => validateAdviceSemanticReview(resolveAdviceSemanticReview(wire, prepared), input), /来源工作区/);
  Object.assign(wire.options[0], { executionMode: "review_existing", diagnosis: "review_disagreement", changes: [],
    candidateVersionId: "current-v", candidateEvidence: [{ sourcePath: entry.sourcePath, quote: entry.quote }] });
  wire.options[0].check.verdict = "corrected";
  wire.options[0].check.evidence[0].relation = "contradicts";
  assert.throws(() => validateAdviceSemanticReview(resolveAdviceSemanticReview(wire, prepared), input), /反证/);
});

test("window issues use real chapter scope and cannot disappear from mandatory assessments", () => {
  const input = source(); input.eligibleChapterIds = ["c1", "c2", "c3"];
  input.repair.affectedChapterIds = ["c1", "c2"];
  input.candidateWindow[0].chapters.push({ id: "c2", taskSheet: "Current second chapter execution" });
  input.repair.quality = { chapters: {}, window: { safeToSync: false, issues: ["The handoff between these chapters contradicts the promised deadline"] } };
  const prepared = prepareAdviceSemanticReviewContext(input); const issue = prepared.issueCatalog[0];
  assert.equal(issue.scope, "window"); assert.deepEqual(issue.affectedChapterIds, ["c1", "c2"]);
  assert.equal(issue.chapterId, "c1");
  const evidence = prepared.evidenceCatalog.find(e => e.sourcePath.includes("chapters[0]"));
  const next = prepared.evidenceCatalog.find(e => e.sourcePath.includes("chapters[1]"));
  const model = raw(evidence.evidenceId);
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /完整且不重复/);
  model.issueAssessments = [{ issueId: issue.issueId, status: "present", evidenceIds: [evidence.evidenceId], rationale: "Current window still has a mismatch" }];
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /独立覆盖/);
  model.options[0].affectedChapterIds = ["c1", "c2"];
  model.options[0].check.evidence.push({ evidenceId: next.evidenceId, relation: "supports" });
  const output = resolveAdviceSemanticReview(model, prepared);
  assert.deepEqual(output.issueAssessments[0].affectedChapterIds, ["c1", "c2"]);
  assert.doesNotThrow(() => validateAdviceSemanticReview(output, input));
  const narrowed = structuredClone(output); narrowed.issueAssessments[0].affectedChapterIds = ["c1"];
  assert.throws(() => validateAdviceSemanticReview(narrowed, input), /章节不匹配/);
});
test("mutually exclusive alternatives cannot jointly cover remaining chapter issues", () => {
  const input = source(); input.eligibleChapterIds = ["c1", "c2"];
  input.candidateWindow[0].chapters.push({ id: "c2", taskSheet: "Second chapter contract" });
  input.repair.quality = { chapters: { c1: { issues: [{ summary: "First remaining issue" }] }, c2: { issues: [{ summary: "Second remaining issue" }] } } };
  const prepared = prepareAdviceSemanticReviewContext(input);
  const first = prepared.evidenceCatalog.find(e => e.sourcePath.includes("chapters[0]"));
  const second = prepared.evidenceCatalog.find(e => e.sourcePath.includes("chapters[1]"));
  const model = raw(first.evidenceId);
  model.issueAssessments = prepared.issueCatalog.map((issue, i) => ({ issueId: issue.issueId, status: "present", evidenceIds: [(i ? second : first).evidenceId], rationale: "A current remaining gap" }));
  model.options.push({ ...structuredClone(model.options[0]), id: "b", affectedChapterIds: ["c2"] });
  model.options[1].check.evidence = [{ evidenceId: second.evidenceId, relation: "supports" }];
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /不能由多个备选拼接覆盖/);
  model.options.forEach(option => { option.executionMode = "source_edit"; option.requiresSourceEdit = true; });
  assert.doesNotThrow(() => validateAdviceSemanticReview(resolveAdviceSemanticReview(model, prepared), input));
});

test("historical claims require complete current-source dispositions before review-only advice can execute", () => {
  const input = source();
  input.repair.phase = "technical_failed";
  input.repair.quality = { chapters: {} };
  input.repair.lastCompletedAssessmentClaims = { authority: "historical_claim_requires_current_verification", kind: "assessment", round: 0,
    assessment: { chapters: { c1: { issues: [{ id: "old-a", summary: "Earlier missing implementation" }, { id: "old-b", summary: "Earlier handoff concern" }] } } } };
  const prepared = prepareAdviceSemanticReviewContext(input);
  const entry = prepared.evidenceCatalog.find(e => e.authority === "current_candidate");
  const model = raw(entry.evidenceId);
  Object.assign(model.options[0], { executionMode: "review_existing", diagnosis: "review_disagreement", changes: [],
    candidateVersionId: "current-v", candidateEvidence: [{ sourcePath: entry.sourcePath, quote: entry.quote }] });
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /完整且不重复/);
  model.issueAssessments = prepared.issueCatalog.map((issue, i) => ({ issueId: issue.issueId,
    status: i ? "disputed" : "resolved", rationale: "Current implementation supersedes this historical claim", evidenceIds: [entry.evidenceId] }));
  assert.doesNotThrow(() => validateAdviceSemanticReview(resolveAdviceSemanticReview(model, prepared), input));
  model.issueAssessments[1].status = "present";
  assert.throws(() => resolveAdviceSemanticReview(model, prepared), /不能仅复核/);
});

const technicalCapture = path.resolve(__dirname, "../../.codex-run/advice-coverage-20260930/source-input.json");
test("actual technical-stop input retains both historical claims and explicit planning stage within the existing capacity", {
  skip: !fs.existsSync(technicalCapture),
}, t => {
  const input = JSON.parse(fs.readFileSync(technicalCapture, "utf8"));
  const { buildAdviceContext } = require("../dist/services/novel/director/recovery/planningRepair/advice/AdviceContext");
  const prepared = prepareAdviceSemanticReviewContext(buildAdviceContext(input));
  assert.deepEqual(prepared.issueCatalog.map(row => row.sourceIssueId), ["linghu_tracking_prerequisite_missing", "box_absorption_trigger_missing"]);
  assert.ok(prepared.issueCatalog.every(row => row.authority === "historical_claim_requires_current_verification"));
  assert.ok(prepared.contextJson.includes("planning_contract_before_prose"));
  assert.ok(prepared.contextJson.includes("pending_due_to_technical_failure"));
  assert.ok(prepared.contextJson.includes("Promise storyPrototype.openingChain[0]"));
  assert.ok(prepared.contextJson.length <= 160000);
  t.diagnostic(`actual isolated chars=${prepared.contextJson.length}; issues=${prepared.issueCatalog.length}; evidence=${prepared.evidenceCatalog.length}`);
});

test("wire evidence catalog names locations instead of repeating quoted text, keeping headroom under the cap", {
  skip: !fs.existsSync(technicalCapture),
}, t => {
  const input = JSON.parse(fs.readFileSync(technicalCapture, "utf8"));
  const { buildAdviceContext } = require("../dist/services/novel/director/recovery/planningRepair/advice/AdviceContext");
  const prepared = prepareAdviceSemanticReviewContext(buildAdviceContext(input));
  const findCatalog = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.evidenceCatalog && Array.isArray(node.evidenceCatalog.entries)) return node.evidenceCatalog;
    for (const child of Object.values(node)) { const hit = findCatalog(child); if (hit) return hit; }
    return null;
  };
  const wire = findCatalog(JSON.parse(prepared.contextJson));
  assert.ok(wire, "the wire payload must expose a catalog of quotable locations");
  assert.equal(wire.entries.length, prepared.evidenceCatalog.length);
  // Every quoted window is a literal slice of a field already present in this same payload.
  // Repeating it inside the catalog doubled the payload and pushed real requests at the capacity
  // guard, so the wire form must stay a list of locations only.
  assert.ok(wire.entries.every(entry => typeof entry.id === "string" && typeof entry.path === "string"
    && entry.quote === undefined && entry.evidenceId === undefined));
  // Ids stay content-addressed: a stale id from another context must not silently resolve.
  assert.ok(prepared.evidenceCatalog.every(entry => /^ev[0-9a-f]{10}$/.test(entry.evidenceId)));
  assert.ok(prepared.contextJson.length <= 130000, `expected a slimmer payload, got ${prepared.contextJson.length}`);
  t.diagnostic(`wire chars=${prepared.contextJson.length}; catalog entries=${wire.entries.length}`);
});
