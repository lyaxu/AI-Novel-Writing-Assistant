import { z } from "zod";

export const CHAPTER_PATCH_REPAIR_STRATEGIES = [
  "patch_first",
  "full_rewrite",
] as const;

export type ChapterPatchRepairStrategy = typeof CHAPTER_PATCH_REPAIR_STRATEGIES[number];

export const chapterPatchOperationSchema = z.object({
  id: z.string().trim().min(1),
  targetExcerpt: z.string().trim().min(6),
  replacement: z.string().trim(),
  reason: z.string().trim().min(1),
  issueIds: z.array(z.string().trim().min(1)).max(8).default([]),
});

export const chapterPatchIssueResolutionSchema = z.object({
  issueId: z.string().trim().min(1),
  disposition: z.enum(["patched", "deferred", "not_supported", "plan_conflict"]),
  patchIds: z.array(z.string().trim().min(1)),
  reason: z.string().trim().min(1),
  inputEvidence: z.string().optional(),
});
export type ChapterPatchIssueResolution = z.infer<typeof chapterPatchIssueResolutionSchema>;

export const chapterPatchRepairPlanSchema = z.object({
  strategy: z.enum(CHAPTER_PATCH_REPAIR_STRATEGIES).default("patch_first"),
  summary: z.string().trim().min(1),
  patches: z.array(chapterPatchOperationSchema).max(8).default([]),
  requiresFullRewrite: z.boolean().default(false),
  escalationReason: z.string().trim().nullable().optional(),
  // Old persisted plans remain readable; the current prompt requires a complete receipt.
  issueResolutions: z.array(chapterPatchIssueResolutionSchema).optional(),
});

export type ChapterPatchOperation = z.infer<typeof chapterPatchOperationSchema>;
export type ChapterPatchRepairPlan = z.infer<typeof chapterPatchRepairPlanSchema>;

export type ChapterPatchApplyFailureType =
  | "requires_full_rewrite"
  | "missing_target"
  | "ambiguous_target"
  | "introduces_duplicate"
  | "no_effect";

export type ChapterPatchMatchStrategy = "exact" | "normalized_whitespace";

export interface ChapterPatchApplyFailure {
  patchId: string;
  reason: string;
  failureType: ChapterPatchApplyFailureType;
  matchedBy?: ChapterPatchMatchStrategy;
  occurrenceCount?: number;
}

export interface ChapterPatchAppliedPatch {
  patchId: string;
  matchedBy: ChapterPatchMatchStrategy;
}

export interface ChapterPatchApplyResult {
  success: boolean;
  content: string;
  appliedPatchIds: string[];
  appliedPatches: ChapterPatchAppliedPatch[];
  failures: ChapterPatchApplyFailure[];
}

function countOccurrences(content: string, target: string): number {
  if (target.length === 0) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(target, cursor);
    if (index < 0) {
      break;
    }
    count += 1;
    cursor = index + target.length;
  }
  return count;
}

interface PatchMatch {
  start: number;
  end: number;
  matchedBy: ChapterPatchMatchStrategy;
}

function buildWhitespaceNormalizedIndex(value: string): {
  text: string;
  originalIndices: number[];
} {
  const chars: string[] = [];
  const originalIndices: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (/\s/u.test(char)) {
      continue;
    }
    chars.push(char);
    originalIndices.push(index);
  }
  return {
    text: chars.join(""),
    originalIndices,
  };
}

function findWhitespaceNormalizedMatches(content: string, target: string): PatchMatch[] {
  const normalizedContent = buildWhitespaceNormalizedIndex(content);
  const normalizedTarget = buildWhitespaceNormalizedIndex(target);
  if (!normalizedTarget.text) {
    return [];
  }

  const matches: PatchMatch[] = [];
  let cursor = 0;
  while (cursor < normalizedContent.text.length) {
    const normalizedIndex = normalizedContent.text.indexOf(normalizedTarget.text, cursor);
    if (normalizedIndex < 0) {
      break;
    }
    const lastNormalizedIndex = normalizedIndex + normalizedTarget.text.length - 1;
    const start = normalizedContent.originalIndices[normalizedIndex];
    const endSourceIndex = normalizedContent.originalIndices[lastNormalizedIndex];
    if (typeof start === "number" && typeof endSourceIndex === "number") {
      matches.push({
        start,
        end: endSourceIndex + 1,
        matchedBy: "normalized_whitespace",
      });
    }
    cursor = normalizedIndex + normalizedTarget.text.length;
  }
  return matches;
}

function findSafePatchMatch(content: string, target: string): {
  match: PatchMatch | null;
  occurrenceCount: number;
  matchedBy?: ChapterPatchMatchStrategy;
} {
  const exactCount = countOccurrences(content, target);
  if (exactCount === 1) {
    const start = content.indexOf(target);
    return {
      match: {
        start,
        end: start + target.length,
        matchedBy: "exact",
      },
      occurrenceCount: exactCount,
      matchedBy: "exact",
    };
  }
  if (exactCount > 1) {
    return {
      match: null,
      occurrenceCount: exactCount,
      matchedBy: "exact",
    };
  }

  const normalizedMatches = findWhitespaceNormalizedMatches(content, target);
  if (normalizedMatches.length === 1) {
    return {
      match: normalizedMatches[0]!,
      occurrenceCount: normalizedMatches.length,
      matchedBy: "normalized_whitespace",
    };
  }
  return {
    match: null,
    occurrenceCount: normalizedMatches.length,
    matchedBy: normalizedMatches.length > 0 ? "normalized_whitespace" : undefined,
  };
}

/**
 * Shortest run of characters that counts as "this text is already in the chapter".
 *
 * Chinese prose repeats short idioms naturally, so the bar has to be high enough that a common
 * phrase is not mistaken for duplication; the observed defect had whole sentences re-emitted
 * (28–38 characters of exact overlap), which this catches with margin.
 */
const DUPLICATE_SPAN_MIN_CHARS = 24;

/**
 * A span of `candidate` that already occurs in `existing`, or null.
 *
 * Used to answer one precise question: does the text this patch is *adding* repeat text the chapter
 * already contains? Deliberately not "is the chapter repetitive" — that would blame a patch for
 * duplication it did not cause. The target region is excluded by the caller, so a replacement that
 * simply keeps the original wording of the span it replaces is not flagged.
 */
function findSharedSpan(existing: string, candidate: string, minLength: number): string | null {
  if (existing.length < minLength || candidate.length < minLength) return null;
  const windows = new Set<string>();
  for (let index = 0; index + minLength <= existing.length; index += 1) {
    windows.add(existing.slice(index, index + minLength));
  }
  for (let index = 0; index + minLength <= candidate.length; index += 1) {
    const span = candidate.slice(index, index + minLength);
    if (windows.has(span)) return span;
  }
  return null;
}

export function applyChapterPatchRepairPlan(
  content: string,
  plan: ChapterPatchRepairPlan,
): ChapterPatchApplyResult {
  const normalizedPlan = chapterPatchRepairPlanSchema.parse(plan);
  let nextContent = content;
  const appliedPatchIds: string[] = [];
  const appliedPatches: ChapterPatchAppliedPatch[] = [];
  const failures: ChapterPatchApplyFailure[] = [];

  if (normalizedPlan.strategy !== "patch_first" || normalizedPlan.requiresFullRewrite) {
    return {
      success: false,
      content,
      appliedPatchIds,
      appliedPatches,
      failures: [{
        patchId: "plan",
        reason: normalizedPlan.escalationReason?.trim() || "补丁计划要求整章重写。",
        failureType: "requires_full_rewrite",
      }],
    };
  }

  for (const patch of normalizedPlan.patches) {
    const target = patch.targetExcerpt.trim();
    const replacement = patch.replacement.trim();
    const matchResult = findSafePatchMatch(nextContent, target);
    if (!matchResult.match) {
      failures.push({
        patchId: patch.id,
        reason: matchResult.occurrenceCount === 0
          ? "目标片段不存在，不能安全应用局部补丁。"
          : "目标片段出现多次，不能确定局部补丁位置。",
        failureType: matchResult.occurrenceCount === 0 ? "missing_target" : "ambiguous_target",
        matchedBy: matchResult.matchedBy,
        occurrenceCount: matchResult.occurrenceCount,
      });
      continue;
    }

    const beforePatch = nextContent;
    // The chapter without the span being replaced: text still present in the rest of the chapter.
    const restOfChapter = beforePatch.slice(0, matchResult.match.start) + beforePatch.slice(matchResult.match.end);
    const duplicated = findSharedSpan(restOfChapter, replacement, DUPLICATE_SPAN_MIN_CHARS);
    if (duplicated) {
      // A real run shipped a chapter whose second half retold the first: the repair was asked to fix
      // a repetition, and its replacement re-emitted material already in the chapter. Nothing checked
      // that, so the duplicated prose was saved as the finished chapter.
      failures.push({
        patchId: patch.id,
        reason: `补丁的 replacement 把正文里已有的内容又写了一遍（重复片段：“${duplicated}…”）。`
          + "replacement 应当只替换 targetExcerpt 对应的片段；若要新增内容，不要重述已有段落。",
        failureType: "introduces_duplicate",
        matchedBy: matchResult.match.matchedBy,
        occurrenceCount: matchResult.occurrenceCount,
      });
      continue;
    }
    nextContent = [
      nextContent.slice(0, matchResult.match.start),
      replacement,
      nextContent.slice(matchResult.match.end),
    ].join("");
    if (nextContent === beforePatch) {
      failures.push({
        patchId: patch.id,
        reason: "局部补丁没有产生有效正文变化。",
        failureType: "no_effect",
        matchedBy: matchResult.match.matchedBy,
        occurrenceCount: matchResult.occurrenceCount,
      });
      continue;
    }
    appliedPatchIds.push(patch.id);
    appliedPatches.push({
      patchId: patch.id,
      matchedBy: matchResult.match.matchedBy,
    });
  }

  const changed = nextContent.trim() !== content.trim();
  return {
    success: failures.length === 0 && appliedPatchIds.length > 0 && changed,
    content: nextContent,
    appliedPatchIds,
    appliedPatches,
    failures,
  };
}
