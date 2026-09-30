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
      throw new Error(`Progression ${check.dimension} requires exact current candidate evidence.`);
    }
    if (check.priorEvidence.some(quote => !matchesChapterEvidence(prior, quote))) {
      throw new Error(`Progression ${check.dimension} cites evidence absent from earlier written prose.`);
    }
    if (check.status !== "insufficient_context" && !check.priorEvidence.length) {
      throw new Error(`Progression ${check.dimension} needs earlier prose or an insufficient_context decision.`);
    }
    if (check.status === "stalled") {
      const issue = output.issues.find(issue => issue.id === check.issueId);
      if (!issue || !issue.repairHint.trim() || !check.repairHint.trim()) {
        throw new Error(`Stalled progression ${check.dimension} must link an existing blocking issue and repair direction.`);
      }
      if (output.verdict === "usable" || output.safeToSync || output.recommendedHandling === "use_as_is") {
        throw new Error("Stalled progression cannot accompany an admission decision.");
      }
    } else if (check.issueId !== null) {
      throw new Error(`Non-stalled progression ${check.dimension} must not create a blocking issue link.`);
    }
  }
}
