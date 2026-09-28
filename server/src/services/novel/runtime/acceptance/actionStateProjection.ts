import type { ActionStateCheck } from "@ai-novel/shared/types/novel/sceneCausality";
import type { ChapterAcceptanceAssessmentOutput } from "../../../../prompting/prompts/novel/chapterAcceptance.prompts";

function effectiveCheck(check: ActionStateCheck): ActionStateCheck {
  // Evidence validation has already made these uncertain; do not turn a bad citation into a repair order.
  if (check.verdict === "insufficient_evidence" && check.validationIssues?.length) return check;
  const contradiction = check.states.some((state) => state.transitionStatus === "contradicted");
  const missing = check.states.some((state) => state.transitionStatus === "missing"
    || state.transitionStatus === "not_needed" && (state.stateChanged || state.enablingTransitionRequired));
  if (contradiction) return { ...check, verdict: "contradicted" };
  if (missing && check.verdict === "earned") return { ...check, verdict: "unearned" };
  if (check.verdict === "earned" && check.states.some((state) => state.transitionStatus === "unknown")) {
    return { ...check, verdict: "insufficient_evidence" };
  }
  return check;
}

/** Consume structured state judgments without reclassifying plot or selecting a global policy. */
export function projectActionStateAssessment(output: ChapterAcceptanceAssessmentOutput): ChapterAcceptanceAssessmentOutput {
  if (!output.actionStateChecks && !output.actionStateAuditIssues?.length) return output;
  const checks = (output.actionStateChecks ?? []).map(effectiveCheck);
  const failures = checks.map((check, index) => ({ check, index })).filter(({ check }) => check.verdict !== "earned");
  const coverage = output.actionStateAuditIssues ?? [];
  if (!failures.length && !coverage.length) return { ...output, actionStateChecks: checks };
  const blockingIssues: ChapterAcceptanceAssessmentOutput["blockingIssues"] = [];
  const repairDirectives: ChapterAcceptanceAssessmentOutput["repairDirectives"] = [];
  const riskTags = [...output.riskTags, ...coverage];
  for (const { check, index } of failures) {
    const code = `action_state_${check.verdict}_${check.sceneKey}_${index}`;
    const evidence = [
      `场景 ${check.sceneKey}；${check.actor}：${check.action}。${check.explanation}`,
      ...check.states.map((state) => `${state.dimension}/${state.entity}：前=${state.before}；行动要求=${state.requiredForAction}；后=${state.after}；过渡=${state.transitionStatus}`),
      ...check.actionEvidence.map((item) => `${item.source}/${item.sourceId}：${item.quote}`),
      ...check.states.flatMap((state) => [...state.beforeEvidence, ...state.afterEvidence, ...state.transitionEvidence])
        .map((item) => `${item.source}/${item.sourceId}：${item.quote}`),
      ...(check.validationIssues ?? []),
    ].join("\n");
    const unknown = check.verdict === "insufficient_evidence";
    riskTags.push(code);
    blockingIssues.push({
      code, category: "continuity", severity: check.verdict === "contradicted" ? "high" : "medium", evidence,
      fixSuggestion: unknown
        ? "核对已写正文与引用来源；证据不足时保留质量债，不要补造先前事件。"
        : `核对${check.action}之前的真实状态，调整行动或补写合法且先发生的过渡；保留已建立的世界规则，禁止通过迁移状态或凭空恢复完成结果。`,
    });
    if (!unknown) repairDirectives.push({
      mode: "patch", target: "continuity",
      instruction: `${code}：${evidence}\n修正此关键行动的状态衔接；先前正文是事实边界，计划不是已发生证据。不得用事后恢复解释事前行动，不新增没有来源的物品/知识；合法魔法与恢复可保留其建立过程。`,
    });
  }
  for (const code of coverage) blockingIssues.push({
    code, category: "continuity", severity: "medium", evidence: "本轮接收结果未覆盖要求的关键行动状态核验。",
    fixSuggestion: "保留正文和未完成核验风险，后续复查关键行动；不自动编造问题或补文。",
  });
  const needsRepair = failures.some(({ check }) => check.verdict !== "insufficient_evidence");
  const sceneCausalityVerdicts = output.sceneCausalityVerdicts?.map((scene) => {
    const failed = failures.filter(({ check }) => check.sceneKey === scene.sceneKey);
    if (scene.verdict !== "earned" || !failed.length) return scene;
    const verdict = failed.some(({ check }) => check.verdict === "contradicted") ? "contradicted" as const
      : failed.some(({ check }) => check.verdict === "unearned") ? "unearned" as const : "insufficient_evidence" as const;
    return { ...scene, verdict };
  });
  return {
    ...output, actionStateChecks: checks, sceneCausalityVerdicts,
    status: output.status === "accepted" ? needsRepair ? "repairable" : "continue_with_risk" : output.status,
    continuePolicy: output.status === "accepted" ? needsRepair ? "repair_once" : "continue" : output.continuePolicy,
    // State failures precede cosmetic/aggregate issues so the existing bounded repair window retains them.
    blockingIssues: [...blockingIssues, ...output.blockingIssues.filter((issue) => !blockingIssues.some((item) => item.code === issue.code))],
    repairDirectives: [...repairDirectives, ...output.repairDirectives.filter((item) => !repairDirectives.some((added) => added.instruction === item.instruction))],
    riskTags: [...new Set(riskTags)],
  };
}
