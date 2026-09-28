import { z } from "zod";

export interface PlanningWrittenEvidence {
  version: 1;
  targetChapterOrder: number;
  sourceFingerprint: string;
  authority: "written_prose_not_planning";
  chapters: Array<{ chapterId: string; order: number; title: string; contentHash: string; content: string }>;
  coverage: {
    policy: "recent_full_chapters"; maxChapters: number; maxCharacters: number;
    omittedWrittenChapterCount: number; excludedOversizeChapterIds: string[];
    missingPreviousChapter: boolean; complete: boolean;
    unknown: string[];
  };
  compressedFacts: {
    authority: "secondary_not_proof";
    items: Array<{ chapterId: string | null; chapterOrder: number; contentHash: string | null; text: string; category: string }>;
    omittedCount: number;
  };
}

export const planningWrittenEvidenceSchema: z.ZodType<PlanningWrittenEvidence> = z.object({
  version: z.literal(1), targetChapterOrder: z.number().int().positive(), sourceFingerprint: z.string().min(1),
  authority: z.literal("written_prose_not_planning"),
  chapters: z.array(z.object({ chapterId: z.string(), order: z.number().int(), title: z.string(), contentHash: z.string(), content: z.string() })).max(3),
  coverage: z.object({ policy: z.literal("recent_full_chapters"), maxChapters: z.number().int(), maxCharacters: z.number().int(),
    omittedWrittenChapterCount: z.number().int().nonnegative(), excludedOversizeChapterIds: z.array(z.string()),
    missingPreviousChapter: z.boolean(), complete: z.boolean(), unknown: z.array(z.string()) }),
  compressedFacts: z.object({ authority: z.literal("secondary_not_proof"), omittedCount: z.number().int().nonnegative(),
    items: z.array(z.object({ chapterId: z.string().nullable(), chapterOrder: z.number().int(), contentHash: z.string().nullable(), text: z.string(), category: z.string() })).max(48) }),
});
