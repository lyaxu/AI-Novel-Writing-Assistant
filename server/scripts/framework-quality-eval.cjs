// Offline evaluation transport. No database access, provider loading, or model calls.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const DATA = path.resolve(__dirname, "../../docs/evals/framework-quality/cases.v1.json");
const CODES = ["unearned_prerequisite", "motivation_gap", "opposition_collapse", "constraint_erasure", "unearned_payoff"];

function challengePack(dataset) {
  // Deliberately omit pair IDs, answer keys, rationales and diagnostic source notes.
  const cases = dataset.cases.map(({ id, genre, facts, plan }) => ({ id, genre, facts, plan }))
    .sort((a, b) => crypto.createHash("sha256").update(a.id).digest("hex")
      .localeCompare(crypto.createHash("sha256").update(b.id).digest("hex")));
  return {
    version: dataset.version,
    instructions: "独立判断各段计划是否有证据明确的因果/人物缺陷。允许失败、拒绝、小回报、慢节奏与有效隐藏信息，不能仅因无胜利或无高潮判坏。只依据给定facts和plan，不替作者虚构补救情节。每项问题引用原文并解释缺失的因果桥。",
    allowedIssueCodes: CODES,
    responseShape: { version: dataset.version, results: [{ id: "case-01", issues: [{ code: "unearned_prerequisite", evidence: "原文引用", explanation: "缺失的关系" }] }] },
    cases,
  };
}

function evaluate(dataset, response) {
  if (response.version !== dataset.version || !Array.isArray(response.results)) throw new Error("评测版本或 results 无效。");
  const byId = new Map();
  for (const row of response.results) {
    if (!dataset.cases.some((c) => c.id === row.id) || byId.has(row.id)) throw new Error(`未知或重复样例: ${row.id}`);
    if (!Array.isArray(row.issues)) throw new Error(`issues 必须为数组: ${row.id}`);
    const item = dataset.cases.find((c) => c.id === row.id);
    const source = [...item.facts, item.plan].join("\n");
    const seenCodes = new Set();
    for (const issue of row.issues) {
      if (!CODES.includes(issue.code) || seenCodes.has(issue.code)) throw new Error(`未知或重复问题类型: ${row.id}`);
      if (typeof issue.evidence !== "string" || issue.evidence.trim().length < 6 || !source.includes(issue.evidence.trim())) throw new Error(`证据无法定位到样例: ${row.id}`);
      if (typeof issue.explanation !== "string" || issue.explanation.trim().length < 6) throw new Error(`缺少因果解释: ${row.id}`);
      seenCodes.add(issue.code);
    }
    byId.set(row.id, seenCodes);
  }
  const missingIds = dataset.cases.filter((c) => !byId.has(c.id)).map((c) => c.id);
  let truePositive = 0, falsePositive = 0, falseNegative = 0, soundCases = 0, soundCasesFlagged = 0;
  for (const item of dataset.cases) {
    const actual = byId.get(item.id) ?? new Set();
    truePositive += item.expected.filter((code) => actual.has(code)).length;
    falseNegative += item.expected.filter((code) => !actual.has(code)).length;
    falsePositive += [...actual].filter((code) => !item.expected.includes(code)).length;
    if (!item.expected.length) { soundCases++; if (actual.size) soundCasesFlagged++; }
  }
  const complete = !missingIds.length;
  return {
    version: dataset.version, complete, missingIds, truePositive, falsePositive, falseNegative,
    recall: truePositive / (truePositive + falseNegative || 1),
    precision: truePositive / (truePositive + falsePositive || 1),
    soundCaseFalseAlarmRate: soundCasesFlagged / (soundCases || 1),
    developmentGatePassed: complete && falseNegative === 0 && falsePositive === 0,
    limitation: "仅开发集缺陷识别；引用命中不证明语义判断正确；不代表小说达到8—9分。需人工核验解释及独立留出集。",
  };
}

if (require.main === module) {
  try {
    const dataset = JSON.parse(fs.readFileSync(DATA, "utf8"));
    const [command = "prepare", responsePath] = process.argv.slice(2);
    if (command !== "prepare" && command !== "score") throw new Error("用法: node scripts/framework-quality-eval.cjs prepare | score <response.json>");
    if (command === "score" && !responsePath) throw new Error("score 需要模型或人工评审结果文件；不会自动调用模型。");
    const result = command === "prepare" ? challengePack(dataset) : evaluate(dataset, JSON.parse(fs.readFileSync(responsePath, "utf8")));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (command === "score" && !result.complete) process.exitCode = 2;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { challengePack, evaluate };
