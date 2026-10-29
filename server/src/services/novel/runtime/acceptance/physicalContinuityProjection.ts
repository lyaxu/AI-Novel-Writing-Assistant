import type { ChapterAcceptanceAssessmentOutput } from "../../../../prompting/prompts/novel/chapterAcceptance.prompts";

const DIMENSION_LABELS: Record<string, string> = {
  object_container: "物品与容器",
  action_prerequisite: "动作前置条件",
  physical_environment: "物理与环境",
  continuity_state: "连续性状态",
};

const DEFAULT_FIX_SUGGESTION = "补足已经建立的动作过程、限制动作规模或统一前后描述；不得新增世界设定、不得改大纲，也不得把审计意见写进正文。";

/**
 * Deterministic projection of the AI's structured physical-continuity verdict.
 *
 * The AI owns the semantic judgement; the program only turns an explicitly reported
 * `defect` with verified current-prose evidence into the existing blocking-issue /
 * repair / quality-debt pipeline. Missing or unknown findings stay visible as risk
 * tags instead of edit orders, and world-rule exemptions never produce issues.
 * This function is idempotent: projected issues keep their code so repeated
 * normalization does not duplicate them.
 */
export function projectPhysicalContinuityAssessment(
  output: ChapterAcceptanceAssessmentOutput,
): ChapterAcceptanceAssessmentOutput {
  const checks = output.physicalContinuityChecks;
  if (!checks?.length) return output;
  const existingCodes = new Set(output.blockingIssues.map((issue) => issue.code));
  const blockingIssues = [...output.blockingIssues];
  const riskTags = [...output.riskTags];
  let changed = false;
  for (const check of checks) {
    const label = DIMENSION_LABELS[check.dimension] ?? check.dimension;
    if (check.verdict === "unknown") {
      const tag = `physical_unknown_${check.dimension}`;
      if (!riskTags.includes(tag)) {
        riskTags.push(tag);
        changed = true;
      }
      continue;
    }
    if (check.verdict !== "defect") continue;
    const currentProseEvidence = check.evidence.filter((item) => item.source === "current_prose");
    // A defect without a verified current-prose basis is not an actionable edit order.
    if (!currentProseEvidence.length) continue;
    const code = `physical_${check.dimension}`;
    if (existingCodes.has(code)) continue;
    existingCodes.add(code);
    blockingIssues.push({
      severity: check.severity ?? "medium",
      category: "continuity",
      code,
      evidence: [
        `${label}：${check.explanation}`,
        ...check.evidence.map((item) => `${item.source === "current_prose" ? "本章" : "已写前章"}：${item.quote}`),
        check.worldRuleBasis ? `设定依据：${check.worldRuleBasis}` : "",
      ].filter(Boolean).join("\n"),
      fixSuggestion: check.fixSuggestion ?? DEFAULT_FIX_SUGGESTION,
      sourceEvidence: check.evidence,
    });
    riskTags.push(code);
    changed = true;
  }
  if (!changed) return output;
  return {
    ...output,
    blockingIssues,
    riskTags: [...new Set(riskTags)],
  };
}
