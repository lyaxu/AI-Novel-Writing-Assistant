import type {
  VolumeBeatSheet,
  VolumePlan,
  VolumePlanDocument,
} from "@ai-novel/shared/types/novel";
import { assessChapterExecutionContractShape } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import {
  ChapterScenePlanNormalizationError,
  normalizeChapterScenePlan,
  serializeChapterScenePlan,
} from "@ai-novel/shared/types/chapterLengthControl";
import { runStructuredPrompt } from "../../../../prompting/core/promptRunner";
import { volumeChapterExecutionContractPrompt } from "../../../../prompting/prompts/novel/volume/chapterDetail.prompts";
import { buildVolumeChapterDetailContextBlocks } from "../../../../prompting/prompts/novel/volume/contextBlocks";
import type { StoryMacroPlanService } from "../../storyMacro/StoryMacroPlanService";
import {
  ChapterTaskSheetQualityGateService,
} from "../ChapterTaskSheetQualityGateService";
import type {
  VolumeGenerateOptions,
  VolumeGenerationNovel,
  VolumeWorkspace,
} from "../volumeModels";
import { loadPlanningWrittenEvidence } from "../writtenEvidence";
import { loadSelectedPlanningDirection } from "../planningPromises";

/** Reusing complete text is not reusing a semantic approval from an unknown source. */
export async function reviewExistingExecutionContract(input: {
  novelId: string; volumeId: string; chapter: VolumePlan["chapters"][number];
  workspace: Pick<VolumePlanDocument, "volumes">;
  options: Pick<VolumeGenerateOptions, "provider" | "model" | "taskId" | "entrypoint" | "signal" | "chapterTaskSheetQualityMode">;
  writtenEvidence?: import("@ai-novel/shared/types/novel/writtenEvidence").PlanningWrittenEvidence;
  selectedPlanningDirection?: import("@ai-novel/shared/types/novel/planningPromises").SelectedPlanningDirection;
}) {
  const writtenEvidence = input.writtenEvidence ?? await loadPlanningWrittenEvidence(input.novelId, input.chapter.chapterOrder);
  const selectedPlanningDirection = input.selectedPlanningDirection ?? await loadSelectedPlanningDirection(input.novelId, input.options.taskId);
  await new ChapterTaskSheetQualityGateService().assertCanEnterExecution({
    ...input.chapter, novelId: input.novelId, volumeId: input.volumeId,
    chapterId: input.chapter.id, chapterOrder: input.chapter.chapterOrder,
  }, { ...input.options, mode: input.options.chapterTaskSheetQualityMode,
    reviewContextJson: JSON.stringify({ writtenEvidence, selectedPlanningDirection, planningCandidate: input.chapter,
      readonlyOpeningRoutes: projectReadonlyOpeningRoutes(input.workspace, input.chapter.id, selectedPlanningDirection),
      planningContext: { targetVolume: input.workspace.volumes.find((volume) => volume.id === input.volumeId) ?? null },
    }) });
  const latestEvidence = await loadPlanningWrittenEvidence(input.novelId, input.chapter.chapterOrder);
  const latestDirection = await loadSelectedPlanningDirection(input.novelId, input.options.taskId);
  if (latestEvidence.sourceFingerprint !== writtenEvidence.sourceFingerprint
    || JSON.stringify(latestDirection) !== JSON.stringify(selectedPlanningDirection)) {
    throw new Error("Written evidence or selected planning direction changed during contract review; reload before execution.");
  }
}

function projectReadonlyOpeningRoutes(
  workspace: Pick<VolumePlanDocument, "volumes">,
  chapterId: string,
  direction: import("@ai-novel/shared/types/novel/planningPromises").SelectedPlanningDirection | undefined,
) {
  const lastOpeningOrder = direction?.status === "available"
    ? Math.max(0, ...(direction.candidate.storyPrototype?.openingChain.map((item) => item.chapterOrder) ?? [])) : 0;
  return workspace.volumes.flatMap((volume) => volume.chapters)
    .filter((chapter) => chapter.id !== chapterId && chapter.chapterOrder <= lastOpeningOrder)
    .map(({ id, chapterOrder, title, summary, purpose, exclusiveEvent, endingState, nextChapterEntryState }) =>
      ({ id, chapterOrder, title, summary, purpose, exclusiveEvent, endingState, nextChapterEntryState, authority: "readonly_planning_not_prose" }));
}

type StoryMacroPlanResult = Awaited<ReturnType<StoryMacroPlanService["getPlan"]>> | null;

export function shouldRetryChapterExecutionContract(error: unknown, attempt: number): boolean {
  if (attempt > 0) {
    return false;
  }
  if (error instanceof ChapterScenePlanNormalizationError) {
    return true;
  }
  return Boolean(
    error
    && typeof error === "object"
    && (error as { promptQualityFailureKind?: unknown }).promptQualityFailureKind === "post_validate_failed"
  );
}

export function canReuseChapterExecutionContract(input: {
  novelId: string;
  volumeId: string;
  chapter: VolumePlan["chapters"][number];
}): boolean {
  return assessChapterExecutionContractShape({
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapter.id,
    chapterOrder: input.chapter.chapterOrder,
    title: input.chapter.title,
    summary: input.chapter.summary,
    purpose: input.chapter.purpose,
    exclusiveEvent: input.chapter.exclusiveEvent,
    endingState: input.chapter.endingState,
    nextChapterEntryState: input.chapter.nextChapterEntryState,
    conflictLevel: input.chapter.conflictLevel,
    revealLevel: input.chapter.revealLevel,
    targetWordCount: input.chapter.targetWordCount,
    mustAvoid: input.chapter.mustAvoid,
    payoffRefs: input.chapter.payoffRefs,
    taskSheet: input.chapter.taskSheet,
    sceneCards: input.chapter.sceneCards,
  }).canEnterExecution;
}

export async function generateChapterTaskSheetDetail(params: {
  promptInput: {
    writtenEvidence?: import("@ai-novel/shared/types/novel/writtenEvidence").PlanningWrittenEvidence;
    novel: VolumeGenerationNovel;
    workspace: VolumeWorkspace;
    storyMacroPlan: StoryMacroPlanResult;
    strategyPlan: VolumePlanDocument["strategyPlan"];
    targetVolume: VolumePlan;
    targetBeatSheet: VolumeBeatSheet | null;
    targetChapter: VolumePlan["chapters"][number];
    guidance?: string;
    detailMode: "task_sheet";
  };
  options: VolumeGenerateOptions;
  onBeforeModelCall?: () => Promise<void>;
}): Promise<{
  purpose: string;
  exclusiveEvent: string;
  endingState: string;
  nextChapterEntryState: string;
  conflictLevel: number;
  revealLevel: number;
  targetWordCount: number;
  mustAvoid: string;
  payoffRefs: string[];
  taskSheet: string;
  sceneCards: string;
}> {
  const existingChapter = params.promptInput.targetChapter;
  if (
    !params.promptInput.guidance?.trim()
    && canReuseChapterExecutionContract({
      novelId: params.promptInput.workspace.novelId,
      volumeId: params.promptInput.targetVolume.id,
      chapter: existingChapter,
    })
  ) {
    if (!params.options.planningRepairManaged) await reviewExistingExecutionContract({
      novelId: params.promptInput.workspace.novelId, volumeId: params.promptInput.targetVolume.id,
      chapter: existingChapter, options: params.options, writtenEvidence: params.promptInput.writtenEvidence,
      workspace: params.promptInput.workspace,
      selectedPlanningDirection: params.promptInput.novel.selectedPlanningDirection,
    });
    const scenePlan = normalizeChapterScenePlan(
      JSON.parse(existingChapter.sceneCards!),
      existingChapter.targetWordCount,
    );
    return {
      purpose: existingChapter.purpose?.trim() || existingChapter.summary.trim(),
      exclusiveEvent: existingChapter.exclusiveEvent?.trim() || existingChapter.summary.trim(),
      endingState: existingChapter.endingState?.trim() || "本章完成当前章节任务，并为下一章留下明确入口。",
      nextChapterEntryState: existingChapter.nextChapterEntryState?.trim() || existingChapter.endingState?.trim() || "下一章承接本章结果继续推进。",
      // Reuse is allowed only after the shape guard verified both numeric levels.
      conflictLevel: existingChapter.conflictLevel!,
      revealLevel: existingChapter.revealLevel!,
      targetWordCount: existingChapter.targetWordCount ?? 2200,
      mustAvoid: existingChapter.mustAvoid?.trim() || "避免偏离本章任务单和卷节奏。",
      payoffRefs: existingChapter.payoffRefs,
      taskSheet: existingChapter.taskSheet?.trim() ?? "",
      sceneCards: serializeChapterScenePlan(scenePlan),
    };
  }

  let lastError: Error | null = null;
  let qualityFeedback: string | null = null;
  const qualityGate = new ChapterTaskSheetQualityGateService();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const promptInput = qualityFeedback
        ? {
          ...params.promptInput,
          guidance: [
            params.promptInput.guidance?.trim(),
            `上一版章节执行合同未通过质量门禁：${qualityFeedback}`,
          ].filter(Boolean).join("\n"),
        }
        : params.promptInput;
      await params.onBeforeModelCall?.();
      const generated = await runStructuredPrompt({
        asset: volumeChapterExecutionContractPrompt,
        promptInput,
        contextBlocks: buildVolumeChapterDetailContextBlocks(promptInput),
        options: {
          provider: params.options.provider,
          model: params.options.model,
          temperature: params.options.temperature ?? 0.35,
          // The contract includes all scene cards, not just the task-sheet summary.
          maxTokens: 8_192,
          taskId: params.options.taskId,
          entrypoint: params.options.entrypoint,
          novelId: promptInput.workspace.novelId,
          volumeId: promptInput.targetVolume.id,
          chapterId: promptInput.targetChapter.id,
          stage: "chapter_execution_contract",
          itemKey: "chapter_detail_bundle",
          scope: "chapter_detail",
          triggerReason: "chapter_detail_generation",
          signal: params.options.signal,
        },
      });
      if (params.options.planningRepairManaged && promptInput.targetChapter.targetWordCount) {
        generated.output.targetWordCount = promptInput.targetChapter.targetWordCount;
      }
      const scenePlan = normalizeChapterScenePlan(
        {
          scenes: generated.output.sceneCards,
          readerExperience: generated.output.readerExperience,
        },
        generated.output.targetWordCount ?? promptInput.targetChapter.targetWordCount,
      );
      if (!params.options.planningRepairManaged) await qualityGate.assertCanEnterExecution({
        novelId: promptInput.workspace.novelId,
        volumeId: promptInput.targetVolume.id,
        chapterId: promptInput.targetChapter.id,
        chapterOrder: promptInput.targetChapter.chapterOrder,
        title: promptInput.targetChapter.title,
        summary: promptInput.targetChapter.summary,
        purpose: generated.output.purpose,
        exclusiveEvent: generated.output.exclusiveEvent,
        endingState: generated.output.endingState,
        nextChapterEntryState: generated.output.nextChapterEntryState,
        conflictLevel: generated.output.conflictLevel,
        revealLevel: generated.output.revealLevel,
        targetWordCount: generated.output.targetWordCount,
        mustAvoid: generated.output.mustAvoid,
        payoffRefs: generated.output.payoffRefs,
        taskSheet: generated.output.taskSheet,
        sceneCards: serializeChapterScenePlan(scenePlan),
      }, {
        mode: params.options.chapterTaskSheetQualityMode,
        provider: params.options.provider,
        model: params.options.model,
        taskId: params.options.taskId,
        entrypoint: params.options.entrypoint,
        signal: params.options.signal,
        reviewContextJson: JSON.stringify({ writtenEvidence: promptInput.writtenEvidence ?? null,
          selectedPlanningDirection: promptInput.novel.selectedPlanningDirection ?? null,
          readonlyOpeningRoutes: projectReadonlyOpeningRoutes(promptInput.workspace, promptInput.targetChapter.id, promptInput.novel.selectedPlanningDirection),
          planningContext: { novel: promptInput.novel, targetVolume: promptInput.targetVolume } }),
      });
      return {
        purpose: generated.output.purpose.trim(),
        exclusiveEvent: generated.output.exclusiveEvent.trim(),
        endingState: generated.output.endingState.trim(),
        nextChapterEntryState: generated.output.nextChapterEntryState.trim(),
        conflictLevel: generated.output.conflictLevel,
        revealLevel: generated.output.revealLevel,
        targetWordCount: generated.output.targetWordCount,
        mustAvoid: generated.output.mustAvoid.trim(),
        payoffRefs: generated.output.payoffRefs,
        taskSheet: generated.output.taskSheet.trim(),
        sceneCards: serializeChapterScenePlan(scenePlan),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("章节执行合同生成失败。");
      if (!shouldRetryChapterExecutionContract(error, attempt)) {
        throw lastError;
      }
      qualityFeedback = lastError.message;
    }
  }

  throw lastError ?? new Error("章节执行合同生成失败。");
}
