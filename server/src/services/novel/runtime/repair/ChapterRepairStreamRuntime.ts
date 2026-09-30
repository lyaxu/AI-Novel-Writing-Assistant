import type { BaseMessageChunk } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import type { ChapterPatchIssueResolution } from "@ai-novel/shared/types/chapterPatchRepair";
import type { GenerationContextPackage } from "@ai-novel/shared/types/chapterRuntime";
import type { ReviewIssue } from "@ai-novel/shared/types/novel";
import type { StreamDoneHelpers } from "../../../../llm/streaming";
import { prisma } from "../../../../db/prisma";
import { streamTextPrompt } from "../../../../prompting/core/promptRunner";
import { withChapterRepairContext } from "../../../../prompting/prompts/novel/chapterLayeredContext";
import { auditService } from "../../../audit/AuditService";
import { ChapterPatchRepairFailedError } from "../../chapterPatchRepairService";
import { chapterQualityLoopService } from "../../quality/ChapterQualityLoopService";
import { filterVerifiedRepairIssues } from "../acceptance";
import {
  isPass,
  logPipelineError,
  type RepairOptions,
} from "../../novelCoreShared";
import type { ChapterArtifactSyncService } from "../ChapterArtifactSyncService";
import type { ChapterContentFinalizationService } from "../ChapterContentFinalizationService";
import type { GenerationContextAssembler } from "../GenerationContextAssembler";
import type { ChapterLifecycleService } from "../lifecycle";
import { ChapterArtifactSyncBoundaryError } from "../artifactSync/ChapterArtifactSyncResult";
import {
  ChapterContextAssemblyError,
  assembleChapterAuditContextPackage,
} from "./chapterAuditContext";
import {
  createHeavyRepairPromptExecution,
  prepareChapterRepairExecution,
} from "./chapterRepairRuntime";

export interface ChapterRepairStreamRuntimeDeps {
  assembler?: Pick<GenerationContextAssembler, "assemble">;
  auditService: Pick<typeof auditService, "auditChapter">;
  artifactSyncService: Pick<ChapterArtifactSyncService, "syncChapterArtifacts">;
  contentFinalizationService: Pick<ChapterContentFinalizationService, "finalizeChapterContent">;
  lifecycleService: Pick<ChapterLifecycleService, "saveWorkingContent" | "markGenerationState">;
  resolveAuditIssues?: (novelId: string, issueIds: string[]) => Promise<unknown>;
  qualityLoopService?: Pick<typeof chapterQualityLoopService, "recordPatchAttempt">;
}

export class ChapterRepairStreamRuntime {
  constructor(private readonly deps: ChapterRepairStreamRuntimeDeps) {}

  async createRepairStream(
    novelId: string,
    chapterId: string,
    options: RepairOptions = {},
  ): Promise<{
    stream: AsyncIterable<BaseMessageChunk>;
    onDone: (fullContent: string, helpers: StreamDoneHelpers) => Promise<void>;
  }> {
    const [novel, chapter, bible] = await Promise.all([
      prisma.novel.findUnique({ where: { id: novelId } }),
      prisma.chapter.findFirst({ where: { id: chapterId, novelId } }),
      prisma.novelBible.findUnique({ where: { novelId } }),
    ]);
    if (!novel || !chapter) {
      throw new Error("小说或章节不存在");
    }

    const assembledContextPackage = await assembleChapterAuditContextPackage({
      assembler: this.deps.assembler,
      novelId,
      chapterId,
      options,
      operation: "repair",
    });
    const issues = await this.resolveRepairIssues(
      novelId,
      chapterId,
      chapter.content ?? "",
      options,
      assembledContextPackage,
    );
    const repairContextPackage = withChapterRepairContext(assembledContextPackage, issues);
    if (!repairContextPackage.chapterRepairContext) {
      const error = new Error("chapterRepairContext missing after successful context assembly");
      logPipelineError("Failed to derive repair context from assembled chapter context package.", {
        novelId,
        chapterId,
        operation: "repair",
        provider: options.provider ?? null,
        model: options.model ?? null,
        error: error.message,
      });
      throw new ChapterContextAssemblyError(novelId, chapterId, "repair", error);
    }

    const attemptId = `manual-patch:${randomUUID()}`;
    const recordAttempt = (issueResolutions: ChapterPatchIssueResolution[], outcome: "candidate_prepared" | "application_failed") =>
      (this.deps.qualityLoopService ?? chapterQualityLoopService).recordPatchAttempt({
        novelId, chapterId, entry: { attemptId, recordedAt: new Date().toISOString(),
          source: "manual_repair", outcome, issueResolutions },
      });
    const prepared = await prepareChapterRepairExecution({
      novelId,
      chapterId,
      novelTitle: novel.title,
      chapterTitle: chapter.title,
      content: chapter.content ?? "",
      issues,
      repairContext: repairContextPackage.chapterRepairContext,
      bibleContent: bible?.rawContent ?? "",
      options: {
        provider: options.provider,
        model: options.model,
        temperature: options.temperature,
        repairMode: options.repairMode,
      },
    }).catch(async (error: unknown) => {
      if (error instanceof ChapterPatchRepairFailedError && error.plan?.issueResolutions?.length) {
        try {
          await recordAttempt(error.plan.issueResolutions, "application_failed");
        } catch (persistenceError) {
          throw new AggregateError([error, persistenceError], "补丁未能安全应用，且处理回执保存失败。", { cause: error });
        }
      }
      throw error;
    });

    if (prepared.kind === "patched") {
      if (prepared.issueResolutions?.length) await recordAttempt(prepared.issueResolutions, "candidate_prepared");
      return {
        stream: createSingleChunkStream(prepared.content),
        onDone: async (fullContent: string, helpers: StreamDoneHelpers) => {
          await this.finalizeRepairResult({
            novelId,
            chapterId,
            options,
            content: prepared.content.trim() || fullContent,
            contextPackage: assembledContextPackage,
            helpers,
          });
        },
      };
    }

    const streamed = await streamTextPrompt(createHeavyRepairPromptExecution(prepared));
    return {
      stream: streamed.stream as AsyncIterable<BaseMessageChunk>,
      onDone: async (fullContent: string, helpers: StreamDoneHelpers) => {
        const completed = await streamed.complete;
        await this.finalizeRepairResult({
          novelId,
          chapterId,
          options,
          content: completed.output.trim() || fullContent,
          contextPackage: assembledContextPackage,
          helpers,
        });
      },
    };
  }

  private async resolveRepairIssues(
    novelId: string,
    chapterId: string,
    content: string,
    options: RepairOptions,
    contextPackage: GenerationContextPackage,
  ): Promise<ReviewIssue[]> {
    if (Array.isArray(options.reviewIssues)) {
      return options.reviewIssues;
    }

    const auditIssues = options.auditIssueIds?.length
      ? await prisma.auditIssue.findMany({
        where: { id: { in: options.auditIssueIds }, report: { novelId, chapterId } },
        include: { report: { select: { legacyScoreJson: true } } },
        orderBy: { createdAt: "asc" },
      })
      : [];
    if (auditIssues.length > 0) {
      const verifiedIssues = filterVerifiedRepairIssues(auditIssues, auditIssues.map((item) => item.report));
      if (verifiedIssues.length === 0) {
        throw new ChapterPatchRepairFailedError("所选问题的原文来源尚未核实，请先复查审校证据，再执行修文。");
      }
      return verifiedIssues.map((item) => ({
        severity: item.severity as ReviewIssue["severity"],
        category: item.auditType === "continuity"
          ? "coherence"
          : item.auditType === "character"
            ? "logic"
            : "pacing",
        evidence: item.evidence,
        fixSuggestion: item.fixSuggestion,
      }));
    }

    const fallbackAudit = await this.deps.auditService.auditChapter(novelId, chapterId, "full", {
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      content,
      contextPackage,
    });
    return fallbackAudit.issues;
  }

  private async finalizeRepairResult(input: {
    novelId: string;
    chapterId: string;
    options: RepairOptions;
    content: string;
    contextPackage: GenerationContextPackage;
    helpers: StreamDoneHelpers;
  }): Promise<void> {
    const runId = `chapter-repair:${input.chapterId}`;
    input.helpers.writeFrame({
      type: "run_status",
      runId,
      status: "running",
      phase: "finalizing",
      message: "修复稿已生成，正在保存正文并重新审校。",
    });

    const repairedContent = input.content.trim();
    if (!repairedContent) {
      throw new ChapterPatchRepairFailedError("修复结果为空，未保存章节正文。");
    }

    await this.deps.lifecycleService.saveWorkingContent({
      novelId: input.novelId,
      chapterId: input.chapterId,
      content: repairedContent,
      generationState: "repaired",
    });
    const finalized = await this.deps.contentFinalizationService.finalizeChapterContent({
      novelId: input.novelId,
      chapterId: input.chapterId,
      request: {
        provider: input.options.provider,
        model: input.options.model,
        temperature: input.options.temperature,
      },
      contextPackage: input.contextPackage,
      content: repairedContent,
      runId: null,
      startMs: null,
      deferArtifactBackgroundSync: true,
      scheduleDeferredArtifactBackgroundSync: false,
    });
    const pass = !finalized.needsRepair && isPass(finalized.runtimePackage.audit.score);
    const artifactSyncResult = await this.deps.artifactSyncService.syncChapterArtifacts(
      input.novelId,
      input.chapterId,
      repairedContent,
      {
        scheduleBackgroundSync: true,
        awaitArtifactDelta: true,
        skipLegacySummaryAndFacts: true,
        contentProvenance: pass ? "confirmed" : "debt",
        provider: input.options.provider,
        model: input.options.model,
      },
    );
    if (artifactSyncResult.status !== "completed" && artifactSyncResult.status !== "degraded") {
      throw new ChapterArtifactSyncBoundaryError(artifactSyncResult);
    }

    if (pass) {
      await this.deps.lifecycleService.markGenerationState(input.chapterId, "approved");
      if (input.options.auditIssueIds?.length) {
        const resolveAuditIssues = this.deps.resolveAuditIssues
          ?? ((novelId: string, issueIds: string[]) => auditService.resolveIssues(novelId, issueIds));
        await resolveAuditIssues(input.novelId, input.options.auditIssueIds).catch(() => null);
      }
    }

    input.helpers.writeFrame({
      type: "run_status",
      runId,
      status: "succeeded",
      phase: "completed",
      message: pass
        ? "章节修复已完成，本章已达到可继续推进状态。"
        : "修复稿已保存，但仍有问题待继续处理。",
    });
  }
}

async function* createSingleChunkStream(content: string): AsyncIterable<BaseMessageChunk> {
  yield { content } as BaseMessageChunk;
}
