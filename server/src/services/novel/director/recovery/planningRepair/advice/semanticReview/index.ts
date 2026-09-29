import { adviceCandidateEvidenceError, adviceCandidateSourceText } from "../AdviceContext";
import { planningRepairAdviceReviewOutputSchema, type PlanningRepairAdviceReviewOutput } from "./contract";
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

/** AI decides semantic support; this guard only verifies provenance and structured safety. */
export function validateAdviceSemanticReview(output: PlanningRepairAdviceReviewOutput, context: unknown): void {
  planningRepairAdviceReviewOutputSchema.parse(output);
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
        const prose = writtenProse(context, evidence.sourcePath);
        if (!prose || !prose.includes(evidence.quote)) {
          throw new Error("语义核验引用须准确对应当前候选或已提供的正文原文。");
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
