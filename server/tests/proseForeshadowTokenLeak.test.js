const test = require("node:test");
const assert = require("node:assert/strict");

const { detectProseQuality } = require("../dist/services/novel/runtime/proseQuality/ProseQualityDetector.js");

const leakFindings = (content) => detectProseQuality(content).findings
  .filter((finding) => finding.code === "prose_foreshadow_token_leak");

test("a foreshadow token left in finished prose is reported", () => {
  const findings = leakFindings("黄蓉把图摊开 [伏笔:L001]，看了很久，才开口。");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.match(findings[0].message, /\[伏笔:L001\]/);
  // The reader must never see bookkeeping, so the fix is to delete the marker, not to explain it.
  assert.match(findings[0].fixSuggestion, /删去标记本身/);
});

test("every leaked key in the same paragraph is named, not just the first", () => {
  const findings = leakFindings("他想起 [伏笔:L001] 的事，也想起 [伏笔:L002] 的话。");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /\[伏笔:L001\]/);
  assert.match(findings[0].message, /\[伏笔:L002\]/);
});

test("clean prose produces no token-leak finding", () => {
  assert.deepEqual(leakFindings("黄蓉把图摊开，看了很久，才开口。"), []);
  // Discussing foreshadowing in words is a soft engineering-term signal, not a token leak.
  assert.deepEqual(leakFindings("这伏笔埋了很久，她一直没提。"), []);
  // A malformed, unterminated marker is not claimed as a leak.
  assert.deepEqual(leakFindings("他写道 [伏笔:L001 然后停笔。"), []);
});

test("the leak does not disable the other prose checks", () => {
  const report = detectProseQuality("作为一个AI语言模型，我无法继续创作。[伏笔:L001]");
  const codes = new Set(report.findings.map((finding) => finding.code));
  assert.ok(codes.has("prose_foreshadow_token_leak"));
  assert.ok(codes.has("prose_ai_self_reference"));
  assert.equal(report.hasBlockingFindings, true);
});
