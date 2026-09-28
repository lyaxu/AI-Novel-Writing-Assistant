import { createHash } from "node:crypto";
import type { PlanningWrittenEvidence } from "@ai-novel/shared/types/novel/writtenEvidence";

export interface WrittenChapterSource { id: string; order: number; title: string; content: string | null }
export interface CompressedFactSource { chapterOrder: number; text: string; category: string }
export const writtenContentHash = (content: string) => createHash("sha256").update(content).digest("hex");

export function writtenSourceFingerprint(chapters: readonly WrittenChapterSource[], targetChapterOrder: number): string {
  const manifest = chapters.filter((c) => c.order < targetChapterOrder && Boolean(c.content?.trim()))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((c) => ({ chapterId: c.id, order: c.order, contentHash: writtenContentHash(c.content!) }));
  return writtenContentHash(JSON.stringify(manifest));
}

export function buildPlanningWrittenEvidence(input: {
  chapters: readonly WrittenChapterSource[]; targetChapterOrder: number; facts?: readonly CompressedFactSource[];
}): PlanningWrittenEvidence {
  if (!Number.isSafeInteger(input.targetChapterOrder) || input.targetChapterOrder < 1) throw new Error("Invalid chapter order for written evidence.");
  const maxChapters = 3, maxCharacters = 24000;
  const preceding = input.chapters.filter((c) => c.order < input.targetChapterOrder && Boolean(c.content?.trim()))
    .sort((a, b) => b.order - a.order || a.id.localeCompare(b.id));
  const chapters: PlanningWrittenEvidence["chapters"] = [];
  const excludedOversizeChapterIds: string[] = [];
  let used = 0;
  for (const chapter of preceding.slice(0, maxChapters)) {
    if (used + chapter.content!.length > maxCharacters) { excludedOversizeChapterIds.push(chapter.id); continue; }
    chapters.push({ chapterId: chapter.id, order: chapter.order, title: chapter.title,
      contentHash: writtenContentHash(chapter.content!), content: chapter.content! });
    used += chapter.content!.length;
  }
  chapters.sort((a, b) => a.order - b.order);
  const omittedWrittenChapterCount = preceding.length - chapters.length;
  const missingPreviousChapter = input.targetChapterOrder > 1 && !chapters.some((c) => c.order === input.targetChapterOrder - 1);
  const facts = (input.facts ?? []).filter((f) => f.chapterOrder < input.targetChapterOrder)
    .sort((a, b) => b.chapterOrder - a.chapterOrder);
  const includedFacts: CompressedFactSource[] = [];
  let factCharacters = 0;
  for (const fact of facts) {
    if (includedFacts.length >= 48 || factCharacters + fact.text.length > 8000) continue;
    includedFacts.push(fact); factCharacters += fact.text.length;
  }
  return {
    version: 1, targetChapterOrder: input.targetChapterOrder, authority: "written_prose_not_planning",
    sourceFingerprint: writtenSourceFingerprint(input.chapters, input.targetChapterOrder), chapters,
    coverage: { policy: "recent_full_chapters", maxChapters, maxCharacters, omittedWrittenChapterCount,
      excludedOversizeChapterIds, missingPreviousChapter, complete: omittedWrittenChapterCount === 0 && !missingPreviousChapter,
      unknown: ["未提供的章节或未记载的物品、位置、知识来源属于未知；不能推断已存在或不存在。",
        ...(missingPreviousChapter ? ["直接前章完整正文缺失，不能声称已核对其动作资源与人物状态。"] : []),
        ...(omittedWrittenChapterCount ? ["仅覆盖列出的完整正文，窗口外历史未被本次原文证据覆盖。"] : [])] },
    compressedFacts: { authority: "secondary_not_proof", omittedCount: facts.length - includedFacts.length,
      items: includedFacts.map((fact) => {
        const source = chapters.find((c) => c.order === fact.chapterOrder);
        return { chapterId: source?.chapterId ?? null, contentHash: source?.contentHash ?? null,
          chapterOrder: fact.chapterOrder, text: fact.text, category: fact.category };
      }) },
  };
}
