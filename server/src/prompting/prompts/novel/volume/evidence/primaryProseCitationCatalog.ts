import { createHash } from "node:crypto";

interface PrimaryProseSource {
  sourcePath: string;
  authority: "written_prose_not_planning";
  chapterId?: unknown;
  chapterOrder?: unknown;
  contentHash?: unknown;
  excerpts: Array<{ start: number; quote: string; evidenceId?: string }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Display-only representation: exact, contiguous slices, no omitted or paraphrased characters. */
export function buildPrimaryProseCitationCatalog(reviewContextJson?: string, priorChapterOrder?: number): {
  sources: PrimaryProseSource[];
  reviewContextDisplayJson: string;
} {
  const fallback = { sources: [], reviewContextDisplayJson: reviewContextJson || "No additional context supplied. Do not invent prior facts." };
  let context: unknown;
  try { context = JSON.parse(reviewContextJson || "{}"); } catch { return fallback; }
  if (!record(context) || !record(context.writtenEvidence) || !Array.isArray(context.writtenEvidence.chapters)) return fallback;
  const sources: PrimaryProseSource[] = [];
  context.writtenEvidence.chapters.forEach((chapter: unknown, index: number) => {
    if (!record(chapter) || typeof chapter.content !== "string" || !chapter.content.length) return;
    const content = chapter.content;
    const sourcePath = `writtenEvidence.chapters[${index}].content`;
    // Hash actual prose, not the caller's potentially stale contentHash metadata.
    const sourceHash = createHash("sha256").update(JSON.stringify([sourcePath, chapter.chapterId ?? null, chapter.order, content])).digest("hex");
    const eligible = typeof chapter.order === "number" && Number.isFinite(chapter.order)
      && typeof priorChapterOrder === "number" && Number.isFinite(priorChapterOrder) && chapter.order < priorChapterOrder;
    const excerpts: PrimaryProseSource["excerpts"] = [];
    for (let start = 0; start < content.length;) {
      let end = Math.min(start + 240, content.length);
      // Do not split a UTF-16 surrogate pair between display excerpts.
      if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) end--;
      const quote = content.slice(start, end);
      excerpts.push({ start, quote, ...(eligible && quote.trim() ? {
        evidenceId: `prose_${createHash("sha256").update(JSON.stringify([sourceHash, start, end])).digest("hex")}`,
      } : {}) });
      start = end;
    }
    sources.push({ sourcePath, authority: "written_prose_not_planning", chapterId: chapter.chapterId,
      chapterOrder: chapter.order, contentHash: chapter.contentHash, excerpts });
    // Only this local parsed display object changes. Validators retain the original JSON.
    chapter.content = `[DISPLAY REFERENCE: full exact content appears in primaryProseCitationCatalog at sourcePath=${sourcePath}; join excerpts in order. This marker is not evidence.]`;
  });
  return { sources, reviewContextDisplayJson: sources.length ? JSON.stringify(context) : fallback.reviewContextDisplayJson };
}

/** Restore only IDs offered for this input's earlier prose; never search or repair model-authored quotes. */
export function restorePrimaryProseCitations(
  references: Array<{ evidenceId: string }>, reviewContextJson?: string, chapterOrder?: number,
): Array<{ sourcePath: string; quote: string }> {
  const citations = new Map(buildPrimaryProseCitationCatalog(reviewContextJson, chapterOrder).sources.flatMap(source =>
    source.excerpts.flatMap(excerpt => excerpt.evidenceId
      ? [[excerpt.evidenceId, { sourcePath: source.sourcePath, quote: excerpt.quote }] as const] : [])));
  return references.map(reference => {
    const citation = citations.get(reference.evidenceId);
    if (!citation) throw new Error(`Unknown or stale earlier-prose evidenceId: ${reference.evidenceId}. Select an ID from the current primaryProseCitationCatalog; do not invent a quote.`);
    return { ...citation };
  });
}
