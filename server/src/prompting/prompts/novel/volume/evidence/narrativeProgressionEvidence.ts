import type { AiChapterTaskSheetQualityAssessment } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

/** Only primary prose from earlier chapters can establish what previously happened. */
export function narrativeProgressionPriorEvidenceIndex(reviewContextJson?: string, chapterOrder?: number) {
  let chapters: unknown[] = [];
  try {
    const parsed = JSON.parse(reviewContextJson || "{}") as { writtenEvidence?: { chapters?: unknown[] } } | null;
    if (Array.isArray(parsed?.writtenEvidence?.chapters)) chapters = parsed.writtenEvidence.chapters;
  } catch { /* Missing context stays unknown, never inferred from plans. */ }
  return buildChapterEvidenceIndex({ writtenEvidence: { chapters: chapters.map(chapter => {
    if (!chapter || typeof chapter !== "object") return null;
    const value = chapter as { order?: unknown; content?: unknown };
    return typeof value.order === "number" && typeof chapterOrder === "number" && value.order < chapterOrder
      && typeof value.content === "string" && value.content.trim() ? { content: value.content } : null;
  }) } });
}

/** AI decides narrative value; this validates citations and consistency only. */
export function validateNarrativeProgressionEvidence(
  output: AiChapterTaskSheetQualityAssessment,
  candidate: unknown,
  reviewContextJson?: string,
): void {
  if (!output.progressionChecks) return; // Legacy saved assessment, not fresh wire output.
  const current = buildChapterEvidenceIndex(candidate);
  const prior = narrativeProgressionPriorEvidenceIndex(reviewContextJson, (candidate as { chapterOrder?: number })?.chapterOrder);
  for (const check of output.progressionChecks) {
    if (!check.candidateEvidence.length || check.candidateEvidence.some(quote => !matchesChapterEvidence(current, quote))) {
      {
        const failed = check.candidateEvidence.filter(quote => !matchesChapterEvidence(current, quote));
        throw new Error(`Progression ${check.dimension} requires exact current candidate evidence. `
          + `candidateEvidence 共 ${check.candidateEvidence.length} 条，其中 ${failed.length} 条在候选里找不到：`
          + JSON.stringify(failed.map(quote => ({ sourcePath: quote.sourcePath ?? null, quote: (quote.quote ?? "").slice(0, 80) })))
          + "。引文必须是候选里的连续原文。");
      }
    }
    if (check.priorEvidence.some(quote => !matchesChapterEvidence(prior, quote))) {
      {
        const failed = check.priorEvidence.filter(quote => !matchesChapterEvidence(prior, quote));
        throw new Error(`Progression ${check.dimension} cites evidence absent from earlier written prose. `
          + `priorEvidence 共 ${check.priorEvidence.length} 条，其中 ${failed.length} 条在已写正文里找不到：`
          + JSON.stringify(failed.map(quote => ({ sourcePath: quote.sourcePath ?? null, quote: (quote.quote ?? "").slice(0, 80) })))
          + `。（已写正文索引覆盖前 ${check.priorEvidence.length ? "若干" : "0"} 章；若前文确实没有对应原文，应判 insufficient_context。）`);
      }
    }
    if (check.status !== "insufficient_context" && !check.priorEvidence.length) {
      throw new Error(`Progression ${check.dimension} needs earlier prose or an insufficient_context decision. 实际 status=${JSON.stringify(check.status)}，priorEvidence 长度 ${check.priorEvidence.length}：不引用前文时必须判 insufficient_context。`);
    }
    if (check.status === "stalled") {
      const issue = output.issues.find(issue => issue.id === check.issueId);
      if (!issue || !issue.repairHint.trim() || !check.repairHint.trim()) {
        throw new Error(`Stalled progression ${check.dimension} must link an existing blocking issue and repair direction. `
          + `issueId=${JSON.stringify(check.issueId)}${issue ? "（在本章问题列表里找到）" : "（在本章问题列表里找不到）"}，`
          + `check.repairHint 长度 ${check.repairHint.trim().length}，issue.repairHint 长度 ${issue ? issue.repairHint.trim().length : 0}。`);
      }
      if (output.verdict === "usable" || output.safeToSync || output.recommendedHandling === "use_as_is") {
        throw new Error(`Stalled progression cannot accompany an admission decision. 实际 verdict=${JSON.stringify(output.verdict)}，safeToSync=${JSON.stringify(output.safeToSync)}，recommendedHandling=${JSON.stringify(output.recommendedHandling ?? null)}：判 stalled 就不能同时判可用。`);
      }
    } else if (check.issueId !== null) {
      throw new Error(`Non-stalled progression ${check.dimension} must not create a blocking issue link. 实际 status=${JSON.stringify(check.status)}，却填写了 issueId=${JSON.stringify(check.issueId)}：只有 stalled 才能挂阻塞问题。`);
    }
  }
}
