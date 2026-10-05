import { buildCurrentAdviceReviewIssues } from "./context";
import { adviceCandidateEvidenceError, adviceCandidateSourceText } from "../AdviceContext";
import { planningRepairAdviceReviewOutputSchema, assertAdviceIssueCoverage, type PlanningRepairAdviceReviewOutput } from "./contract";
export { planningRepairAdviceReviewOutputSchema, type PlanningRepairAdviceReviewOutput } from "./contract";

/** Written prose can support a cross-source contradiction, but never stand in for a candidate chapter. */
function writtenProse(context: unknown, path: string): string | null {
  const match = /^chapterEvidence\[(\d+)\]\.content$/.exec(path);
  if (!match || !context || typeof context !== "object") return null;
  const chapters = (context as { chapterEvidence?: unknown }).chapterEvidence;
  const chapter: unknown = Array.isArray(chapters) ? chapters[Number(match[1])] : null;
  if (!chapter || typeof chapter !== "object") return null;
  const content = (chapter as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content : null;
}

/** Later planning may witness a handoff, but remains a plan rather than written fact. */
function readonlyPlanningText(context: unknown, path: string): string | null {
  if (!/^candidatePlanningHorizon(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+$/.test(path)) return null;
  let value: unknown = context;
  for (const segment of path.match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? []) {
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { return null; } }
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : null;
}

/**
 * Same set of chapter ids, regardless of order or repeats.
 *
 * Used where the contract fixes *which* chapters an issue covers but says nothing about the order
 * they are listed in, so ordering must not be part of the judgement.
 */
function sameChapterIdSet(left: readonly string[] | undefined, right: readonly string[]): boolean {
  const a = [...new Set(left ?? [])].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** AI decides semantic support; this guard only verifies provenance and structured safety. */
export function validateAdviceSemanticReview(output: PlanningRepairAdviceReviewOutput, context: unknown): void {
  planningRepairAdviceReviewOutputSchema.parse(output);
  const currentIssues = buildCurrentAdviceReviewIssues(context);
  const assessments = output.issueAssessments ?? [];
  const issueIds = new Set(assessments.map(item => item.issueId));
  if (issueIds.size !== assessments.length || issueIds.size !== currentIssues.length
    || currentIssues.some(issue => !issueIds.has(issue.issueId))) {
    throw new Error("语义核验必须完整且不重复地核对当前问题目录，请重新获取建议。");
  }
  for (const assessment of assessments) {
    const issue = currentIssues.find(item => item.issueId === assessment.issueId)!;
    // Compared as sets, not as serialized arrays. Neither the schema nor the prompt states an order
    // for affectedChapterIds, so a semantically identical answer that listed the same chapters in a
    // different order used to be rejected — and rejected forever, because nothing told the model
    // which order was wanted.
    const windowMatches = issue.scope !== "window"
      || (assessment.scope === "window" && sameChapterIdSet(assessment.affectedChapterIds, issue.affectedChapterIds));
    if (assessment.chapterId !== issue.chapterId || !windowMatches) {
      throw new Error(
        `问题核验章节不匹配当前目录：${assessment.issueId} 返回 chapterId=${assessment.chapterId}、`
        + `affectedChapterIds=[${(assessment.affectedChapterIds ?? []).join(", ")}]；`
        + `目录要求 chapterId=${issue.chapterId}、affectedChapterIds=[${issue.affectedChapterIds.join(", ")}]。`,
      );
    }
    if (assessment.status !== "insufficient" && !assessment.evidence.length) throw new Error("问题判断缺少本次原文证据。");
    for (const evidence of assessment.evidence) {
      const candidate = adviceCandidateSourceText(context, evidence.sourcePath);
      const text = candidate?.text ?? writtenProse(context, evidence.sourcePath) ?? readonlyPlanningText(context, evidence.sourcePath);
      if (!text || !text.includes(evidence.quote) || (candidate && !issue.affectedChapterIds.includes(candidate.chapterId))) {
        throw new Error("问题判断证据必须来自对应当前候选或只读资料的准确原文。");
      }
    }
    assertAdviceIssueCoverage(assessment.status, issue, output.advice.options);
  }
  const options = output.advice.options;
  const ids = new Set(output.checks.map(check => check.optionId));
  if (ids.size !== output.checks.length || ids.size !== options.length || options.some(option => !ids.has(option.id))) {
    throw new Error("语义核验必须逐项覆盖最终建议，且不能重复或引用其他方案。");
  }
  for (const option of options) {
    const check = output.checks.find(item => item.optionId === option.id)!;
    const error = adviceCandidateEvidenceError(option, context);
    if (error) throw new Error(error);
    const witnessed = new Set<string>();
    for (const evidence of check.evidence) {
      const source = adviceCandidateSourceText(context, evidence.sourcePath);
      if (source) {
        if (!option.affectedChapterIds.includes(source.chapterId) || !source.text.includes(evidence.quote)) {
          throw new Error("语义核验引用与该方案当前候选的原文不一致。");
        }
        witnessed.add(source.chapterId);
      } else {
        const prose = writtenProse(context, evidence.sourcePath) ?? readonlyPlanningText(context, evidence.sourcePath);
        if (!prose || !prose.includes(evidence.quote)) {
          throw new Error("语义核验引用须准确对应当前候选、只读后续规划或已提供的正文原文。");
        }
      }
    }
    if (check.verdict !== "blocked" && !option.affectedChapterIds.every(id => witnessed.has(id))) {
      throw new Error("语义核验依据必须覆盖最终方案涉及的每个候选章节。");
    }
    if (check.verdict === "blocked" && (option.executionMode !== "source_edit" || !option.requiresSourceEdit)) {
      throw new Error("核验未通过的方向只能返回来源工作区处理，不能直接恢复。");
    }
    if (option.executionMode === "review_existing" && (
      check.verdict === "blocked" || check.evidence.some(item => item.relation === "contradicts") ||
      !check.evidence.some(item => item.relation === "supports") || option.diagnosis !== "review_disagreement" ||
      option.blockerResolution.status !== "complete" || option.blockerResolution.remainingBlockers.length > 0 || option.changes.length > 0
    )) throw new Error("仅复核建议存在反证或未闭合缺口，必须修正方案后再核验。");
  }
}

export { prepareAdviceSemanticReviewContext, resolveAdviceSemanticReview,
  type PreparedAdviceSemanticReviewContext, type AdviceReviewEvidence } from "./context";
export { planningRepairAdviceReviewModelOutputSchema, type PlanningRepairAdviceReviewModelOutput } from "./contract";
