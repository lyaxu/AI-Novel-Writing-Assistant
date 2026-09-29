interface PrimaryProseSource {
  sourcePath: string;
  authority: "written_prose_not_planning";
  chapterId?: unknown;
  chapterOrder?: unknown;
  contentHash?: unknown;
  excerpts: Array<{ start: number; quote: string }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Display-only representation: exact, contiguous slices, no omitted or paraphrased characters. */
export function buildPrimaryProseCitationCatalog(reviewContextJson?: string): {
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
    const excerpts: PrimaryProseSource["excerpts"] = [];
    for (let start = 0; start < content.length;) {
      let end = Math.min(start + 240, content.length);
      // Do not split a UTF-16 surrogate pair between display excerpts.
      if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) end--;
      excerpts.push({ start, quote: content.slice(start, end) });
      start = end;
    }
    sources.push({ sourcePath, authority: "written_prose_not_planning", chapterId: chapter.chapterId,
      chapterOrder: chapter.order, contentHash: chapter.contentHash, excerpts });
    // Only this local parsed display object changes. Validators retain the original JSON.
    chapter.content = `[DISPLAY REFERENCE: full exact content appears in primaryProseCitationCatalog at sourcePath=${sourcePath}; join excerpts in order. This marker is not evidence.]`;
  });
  return { sources, reviewContextDisplayJson: sources.length ? JSON.stringify(context) : fallback.reviewContextDisplayJson };
}
