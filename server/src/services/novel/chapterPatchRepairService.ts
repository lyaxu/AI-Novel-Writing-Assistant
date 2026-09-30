import type { LLMProvider } from "@ai-novel/shared/types/llm";
import type { ReviewIssue } from "@ai-novel/shared/types/novel";
import type { ChapterRepairContext, ChapterRuntimePackage } from "@ai-novel/shared/types/chapterRuntime";
import {
  applyChapterPatchRepairPlan,
  type ChapterPatchApplyResult,
  type ChapterPatchRepairPlan,
} from "@ai-novel/shared/types/chapterPatchRepair";
import { runStructuredPrompt } from "../../prompting/core/promptRunner";
import { buildChapterRepairContextBlocks } from "../../prompting/prompts/novel/chapterLayeredContext";
import { chapterPatchRepairPrompt } from "../../prompting/prompts/novel/chapterPatchRepair.prompts";

export type PatchRepairMode =
  | "detect_only"
  | "light_repair"
  | "heavy_repair"
  | "continuity_only"
  | "character_only"
  | "ending_only";

export interface ChapterPatchRepairInput {
  novelId?: string;
  chapterId?: string;
  novelTitle: string;
  chapterTitle: string;
  content: string;
  issues: ReviewIssue[];
  issuesJson?: string;
  modeHint?: string;
  repairContext?: ChapterRepairContext | null;
  runtimePackage?: ChapterRuntimePackage | null;
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  repairMode?: PatchRepairMode;
}

export interface ChapterPatchRepairResult {
  content: string;
  plan: ChapterPatchRepairPlan;
  appliedPatchIds: string[];
}

export class ChapterPatchRepairFailedError extends Error {
  constructor(
    message: string,
    readonly plan?: ChapterPatchRepairPlan,
    readonly applyResult?: ChapterPatchApplyResult,
  ) {
    super(message);
    this.name = "ChapterPatchRepairFailedError";
  }
}

export class ChapterPatchRepairService {
  async repair(input: ChapterPatchRepairInput): Promise<ChapterPatchRepairResult> {
    if (!input.content.trim()) {
      throw new ChapterPatchRepairFailedError("章节正文为空，不能执行局部补丁修复。");
    }
    if (input.repairMode === "detect_only") {
      throw new ChapterPatchRepairFailedError("当前为只检测模式，未执行章节修复。");
    }
    if (input.repairMode === "heavy_repair") {
      throw new ChapterPatchRepairFailedError("当前修复模式允许整章重写，跳过局部补丁。");
    }

    const repairContext = input.repairContext ?? input.runtimePackage?.context.chapterRepairContext;
    const contextBlocks = repairContext
      ? buildChapterRepairContextBlocks(repairContext)
      : undefined;
    const issueCatalog = input.issues.map((issue, index) => ({ id: `repair-issue-${index + 1}`, ...issue }));
    let generated: { output: ChapterPatchRepairPlan };
    try {
      generated = await runStructuredPrompt({
        asset: chapterPatchRepairPrompt,
        promptInput: {
          novelTitle: input.novelTitle,
          chapterTitle: input.chapterTitle,
          chapterContent: input.content,
          issuesJson: JSON.stringify({
            issueCatalog,
            additionalEvidence: input.issuesJson ?? null,
          }, null, 2),
          expectedIssueIds: issueCatalog.map(issue => issue.id),
          modeHint: input.modeHint,
        },
        contextBlocks,
        options: {
          provider: input.provider,
          model: input.model,
          temperature: Math.min(input.temperature ?? 0.35, 0.45),
          maxTokens: 4200 + issueCatalog.length * 96,
          novelId: input.novelId,
          chapterId: input.chapterId,
          stage: "chapter_patch",
          triggerReason: input.repairMode ?? "patch_first",
        },
      });
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : String(error);
      throw new ChapterPatchRepairFailedError(`局部补丁计划未通过结构校验：${message}`);
    }

    // Attach the exact input claim for durable audit; never trust a model-supplied copy.
    generated.output.issueResolutions = generated.output.issueResolutions?.map(row => ({
      ...row, inputEvidence: issueCatalog.find(issue => issue.id === row.issueId)?.evidence,
    }));
    let applied: ChapterPatchApplyResult;
    try {
      applied = applyChapterPatchRepairPlan(input.content, generated.output);
    } catch (error) {
      const message = formatPatchRepairApplyError(error);
      throw new ChapterPatchRepairFailedError(
        `局部补丁计划不可安全应用：${message}`,
        generated.output,
      );
    }
    if (!applied.success) {
      const reason = applied.failures.map((failure) => `${failure.patchId}: ${failure.reason}`).join("；")
        || generated.output.escalationReason
        || "局部补丁没有产生有效正文变化。";
      throw new ChapterPatchRepairFailedError(reason, generated.output, applied);
    }

    return {
      content: applied.content,
      plan: generated.output,
      appliedPatchIds: applied.appliedPatchIds,
    };
  }
}

function formatPatchRepairApplyError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}
