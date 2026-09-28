const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectChapterRepairCandidate,
} = require("../dist/services/novel/runtime/selection/ChapterRepairCandidateSelection.js");

function runtimePackage(score, options = {}) {
  const issues = options.issues ?? [];
  return {
    audit: {
      score: {
        coherence: score,
        pacing: score,
        repetition: score,
        engagement: score,
        voice: score,
        overall: score,
      },
      openIssues: issues,
      reports: [],
      hasBlockingIssues: options.hasBlockingIssues ?? issues.some((issue) => (
        issue.severity === "high" || issue.severity === "critical"
      )),
    },
    obligationCoverage: {
      status: options.missing?.length ? "unmet" : "satisfied",
      missing: options.missing ?? [],
      summary: "test",
    },
  };
}

function evaluation(content, score, options = {}) {
  return {
    content,
    pass: options.pass ?? false,
    runtimePackage: runtimePackage(score, options),
  };
}

test("selects a repair candidate that passes after the original failed", () => {
  const result = selectChapterRepairCandidate({
    original: evaluation("original", 70),
    candidate: evaluation("candidate", 85, { pass: true }),
  });

  assert.equal(result.selected, "candidate");
  assert.equal(result.reasonCode, "candidate_passed");
  assert.notEqual(result.originalContentHash, result.candidateContentHash);
});

test("retains the original when a higher-scoring candidate adds a severe issue", () => {
  const result = selectChapterRepairCandidate({
    original: evaluation("original", 70),
    candidate: evaluation("The sealed door vanished without explanation.", 78, {
      issues: [{ severity: "high", code: "NEW_RISK", evidence: '"The sealed door vanished without explanation."' }],
    }),
  });

  assert.equal(result.selected, "original");
  assert.equal(result.reasonCode, "original_retained_new_severe_issue");
});

test("a reclassified existing passage does not discard a proven local repair even when score drops", () => {
  const existing = "雾比他想的冷，湿意顺着衣领往骨头里钻。";
  const original = evaluation(`烧婚书时她手指发抖。放下茶盏时指尖那一顿。${existing}`, 88, {
    issues: [
      { id: "prop", code: "prop_mismatch", severity: "low", evidence: "放下茶盏" },
      { id: "ending", code: "ending_deviation", severity: "low", evidence: existing },
    ],
  });
  const candidate = evaluation(`烧婚书时她手指发抖。烧婚书时指尖那一抖。${existing}`, 87, {
    issues: [{ id: "boundary", code: "boundary_crossing", severity: "high", evidence: `结束态越界：“${existing}”` }],
    missing: [{ kind: "forbidden_crossing", summary: "结束态越界", evidence: `“${existing}”` }],
  });
  const before = JSON.stringify(candidate);
  const result = selectChapterRepairCandidate({ original, candidate });
  assert.equal(result.selected, "candidate");
  assert.equal(result.reasonCode, "candidate_improved");
  assert.deepEqual(result.severeEvidenceAttribution, [{ issueKey: "boundary_crossing", location: "existing_text" }]);
  assert.equal(JSON.stringify(candidate), before, "newly discovered risks must remain on the selected assessment");
});

test("unlocatable severe evidence stays unknown rather than asserting a newly introduced defect", () => {
  const result = selectChapterRepairCandidate({
    original: evaluation("Original chapter content.", 70),
    candidate: evaluation("Improved chapter content.", 95, {
      pass: true,
      issues: [{ id: "risk", code: "RISK", severity: "critical", evidence: "The character state contradicts an earlier chapter." }],
    }),
  });
  assert.equal(result.selected, "original");
  assert.equal(result.reasonCode, "original_retained_uncertain_severe_evidence");
  assert.equal(result.severeEvidenceAttribution[0].location, "unknown");
});

test("short common words cannot prove a severe problem was already present", () => {
  const result = selectChapterRepairCandidate({
    original: evaluation("He stopped and thought about it.", 70),
    candidate: evaluation("He stopped and immediately changed everything.", 90, {
      pass: true, issues: [{ id: "risk", code: "risk", severity: "high", evidence: 'Problem at "He stopped".' }],
    }),
  });
  assert.equal(result.reasonCode, "original_retained_uncertain_severe_evidence");
});

test("only whitespace and quotation presentation differences are normalized for location", () => {
  const passage = "The locked vault remained completely sealed.";
  const result = selectChapterRepairCandidate({
    original: evaluation(passage, 80, { issues: [{ code: "old", severity: "low", evidence: passage }] }),
    candidate: evaluation("The locked vault\nremained completely sealed.", 79, {
      pass: true, issues: [{ code: "new", severity: "high", evidence: `“${passage}”` }],
    }),
  });
  assert.equal(result.selected, "candidate");
  assert.equal(result.severeEvidenceAttribution[0].location, "existing_text");
});

test("does not treat rewritten evidence as a new severe issue", () => {
  const original = evaluation("original", 70, {
    missing: [{ kind: "must_hit_now", summary: "兑现承诺" }],
    issues: [{ id: "issue-1", code: "CHARACTER_CONTINUITY", severity: "high", evidence: "角色伤势与前文冲突" }],
  });
  const candidate = evaluation("candidate", 78, {
    issues: [{ id: "issue-2", code: "CHARACTER_CONTINUITY", severity: "high", evidence: "角色负伤状态与上章矛盾" }],
  });
  candidate.issues = [{
    severity: "critical",
    category: "voice",
    evidence: "修复稿泄漏了参考作品专名。",
    fixSuggestion: "移除参考作品专名。",
  }];

  const result = selectChapterRepairCandidate({ original, candidate });

  assert.equal(result.selected, "candidate");
  assert.equal(result.reasonCode, "candidate_improved");
});

test("selects a candidate that reduces missing obligations", () => {
  const result = selectChapterRepairCandidate({
    original: evaluation("original", 70, {
      missing: [{ kind: "must_hit_now", summary: "兑现承诺" }],
    }),
    candidate: evaluation("candidate", 70),
  });

  assert.equal(result.selected, "candidate");
  assert.equal(result.reasonCode, "candidate_improved");
});

test("retains the original when only the overall score improves", () => {
  const result = selectChapterRepairCandidate({
    original: evaluation("original", 70),
    candidate: evaluation("candidate", 79),
  });

  assert.equal(result.selected, "original");
  assert.equal(result.reasonCode, "original_retained_no_clear_improvement");
});
