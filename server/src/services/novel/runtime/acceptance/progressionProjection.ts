import type { ChapterAcceptanceAssessmentOutput } from "../../../../prompting/prompts/novel/chapterAcceptance.prompts";

/** Route AI progression verdicts into existing local repair/debt handling, not global replanning. */
export function projectProgressionAssessment(output: ChapterAcceptanceAssessmentOutput): ChapterAcceptanceAssessmentOutput {
  if (!output.progressionChecks && !output.progressionAuditIssues?.length) return output;
  const failures = (output.progressionChecks ?? []).filter((check) => check.status === "stalled" || check.status === "insufficient_evidence");
  const coverage = output.progressionAuditIssues ?? [];
  if (!failures.length && !coverage.length) return output;
  const blockingIssues: ChapterAcceptanceAssessmentOutput["blockingIssues"] = [];
  const repairDirectives: ChapterAcceptanceAssessmentOutput["repairDirectives"] = [];
  const riskTags = [...output.riskTags, ...coverage];
  for (const check of failures) {
    const code = `chapter_progression_${check.dimension}_${check.status}`;
    const unknown = check.status === "insufficient_evidence";
    const evidence = [
      check.explanation, `前文状态：${check.priorState}；本章实际变化：${check.actualChange || "未确认"}；新后果：${check.newConsequence || "未确认"}`,
      ...[...check.previousEvidence, ...check.currentEvidence].map((item) => `${item.source}/${item.sourceId}：${item.quote}`),
      ...(check.validationIssues ?? []),
    ].join("\n");
    riskTags.push(code);
    blockingIssues.push({
      // `stalled` is a proven repetition: validateProgressionEvidence downgrades it to
      // insufficient_evidence unless BOTH sides carry verbatim quotes from real prior
      // prose and this chapter's prose. It is therefore not "we could not check" but
      // "we checked and this chapter re-stages delivered material", which must be able
      // to reach blockingIssueIds (only high/critical do) instead of being recorded as
      // medium debt and passed over. Evidence insufficiency stays medium on purpose.
      code, category: "plot", severity: unknown ? "medium" : "high", evidence,
      fixSuggestion: unknown ? "核对前后章节原文与覆盖范围；保留未核实的推进质量债，不补造前情。" : check.repairSuggestion,
    });
    if (!unknown) repairDirectives.push({
      mode: "patch", target: "plot",
      instruction: `${code}：${evidence}\n${check.repairSuggestion}。保留有效的细腻描写、关系和认识变化，只调整没有新后果的重复职责；不要用新增大事件或强制提速代替承接。`,
    });
  }
  for (const code of coverage) blockingIssues.push({
    code, category: "plot", severity: "medium", evidence: "本轮实际推进检查缺失或重复，不能认证前后章职责得到承接。",
    fixSuggestion: "保留正文和未核验风险，后续对照前文复核；不要自动改写未知问题。",
  });
  const needsRepair = failures.some((check) => check.status === "stalled");
  const promotesToRepair = needsRepair && (output.status === "accepted" || output.status === "continue_with_risk");
  return {
    ...output,
    status: promotesToRepair ? "repairable" : output.status === "accepted" ? "continue_with_risk" : output.status,
    continuePolicy: promotesToRepair ? "repair_once" : output.status === "accepted" ? "continue" : output.continuePolicy,
    blockingIssues: [...blockingIssues, ...output.blockingIssues.filter((issue) => !blockingIssues.some((item) => item.code === issue.code))],
    repairDirectives: [...repairDirectives, ...output.repairDirectives.filter((item) => !repairDirectives.some((added) => added.instruction === item.instruction))],
    riskTags: [...new Set(riskTags)],
  };
}
