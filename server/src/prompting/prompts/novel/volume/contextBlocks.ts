import { createContextBlock } from "../../../core/contextBudget";
import type { PromptContextBlock } from "../../../core/promptTypes";
import {
  renderChapterForeshadowActionsContext,
  renderForeshadowScheduleSummary,
  selectForeshadowActionsForChapter,
  selectForeshadowActionsForChapterRange,
  type ChapterForeshadowAction,
} from "@ai-novel/shared/types/storyPlanningFramework";
import { buildVolumeChapterBudget, formatVolumeChapterBudgetLines } from "@ai-novel/shared/types/planningScale";
import { renderSelectedPlanningDirection } from "./context/planningFoundations";
import { buildPrimaryProseCitationCatalog } from "./evidence/primaryProseCitationCatalog";
import {
  buildBeatCard,
  buildBeatChapterRangeContext,
  buildBeatChapterSummary,
  buildBeatContextWindow,
  buildBeatSheetContext,
  buildChapterDetailDraft,
  buildChapterNeighborContext,
  buildCommonNovelContext,
  buildConflictLevelCurveContext,
  buildCompactVolumeCard,
  buildRecentChapterExecutionContext,
  buildTargetVolumeChapterBudgetContext,
  buildVolumeCountGuidanceContext,
  buildSoftFutureVolumeSummary,
  buildStoryMacroContext,
  buildStrategyContext,
  buildWindowedVolumeContext,
  type VolumeBeatSheetPromptInput,
  type VolumeChapterDetailPromptInput,
  type VolumeChapterListPromptInput,
  type VolumeRebalancePromptInput,
  type VolumeSkeletonPromptInput,
  type VolumeStrategyCritiquePromptInput,
  type VolumeStrategyPromptInput,
} from "./shared";

function guidanceBlock(guidance?: string): PromptContextBlock | null {
  if (!guidance?.trim()) {
    return null;
  }
  return createContextBlock({
    id: "guidance",
    group: "guidance",
    priority: 70,
    content: `User guidance:\n${guidance.trim()}`,
  });
}

function buildDeterministicVolumeBudgetContent(input: {
  chapterBudget: number;
  volumeChapterBudget?: import("@ai-novel/shared/types/planningScale").VolumeChapterBudget;
}): string {
  const budget = input.volumeChapterBudget ?? buildVolumeChapterBudget(input.chapterBudget);
  return [
    "已确定的整书分卷章节预算（拆章硬约束，不能把章节都挤进第一卷）：",
    ...formatVolumeChapterBudgetLines(budget),
  ].join("\n");
}

function collectChapterRangeForeshadowActions(input: {
  storyMacroPlan: VolumeChapterListPromptInput["storyMacroPlan"];
  startOrder: number;
  endOrder: number;
}): ChapterForeshadowAction[] {
  if (!input.storyMacroPlan?.foreshadowSchedule?.length) {
    return [];
  }
  return selectForeshadowActionsForChapterRange(
    input.storyMacroPlan.foreshadowSchedule,
    input.startOrder,
    input.endOrder,
  );
}

function buildVolumeForeshadowScheduleContent(input: {
  storyMacroPlan: VolumeChapterListPromptInput["storyMacroPlan"];
  startOrder: number;
  endOrder: number;
}): string {
  const schedule = input.storyMacroPlan?.foreshadowSchedule ?? [];
  const rangeActions = collectChapterRangeForeshadowActions(input);
  return [
    "全书核心伏笔/谜团表（规划约束：埋设、推进、回收章按表执行）：",
    renderForeshadowScheduleSummary(schedule),
    "",
    `本次拆章范围（第 ${input.startOrder}-${input.endOrder} 章）内必须落实的伏笔动作：`,
    renderChapterForeshadowActionsContext({ chapterOrder: input.startOrder, actions: rangeActions }),
    "",
    "拆章时必须在对应章序安排这些动作；不能把埋设、推进或回收合并到其他章，也不能把所有伏笔都挤到第一卷。",
  ].join("\n");
}

export function buildVolumeStrategyContextBlocks(input: VolumeStrategyPromptInput): PromptContextBlock[] {
  return [
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "existing_volume_window",
      group: "existing_volume_window",
      priority: 88,
      content: `Existing volume window:\n${buildWindowedVolumeContext(input.workspace.volumes)}`,
    }),
    createContextBlock({
      id: "volume_count_guidance",
      group: "volume_count_guidance",
      priority: 96,
      required: true,
      allowSummary: false,
      content: `Volume count guidance:\n${buildVolumeCountGuidanceContext(input.volumeCountGuidance)}`,
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}

export function buildVolumeStrategyCritiqueContextBlocks(input: VolumeStrategyCritiquePromptInput): PromptContextBlock[] {
  return [
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "strategy_context",
      group: "strategy_context",
      priority: 98,
      required: true,
      allowSummary: false,
      content: `Strategy plan:\n${buildStrategyContext(input.strategyPlan)}`,
    }),
    createContextBlock({
      id: "existing_volume_window",
      group: "existing_volume_window",
      priority: 84,
      content: `Existing volume window:\n${buildWindowedVolumeContext(input.workspace.volumes)}`,
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}

export function buildVolumeSkeletonContextBlocks(input: VolumeSkeletonPromptInput): PromptContextBlock[] {
  return [
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "strategy_context",
      group: "strategy_context",
      priority: 98,
      required: true,
      allowSummary: false,
      content: `Strategy plan:\n${buildStrategyContext(input.strategyPlan)}`,
    }),
    createContextBlock({
      id: "existing_volume_window",
      group: "existing_volume_window",
      priority: 84,
      content: `Existing volume window:\n${buildWindowedVolumeContext(input.workspace.volumes)}`,
    }),
    createContextBlock({
      id: "volume_count_guidance",
      group: "volume_count_guidance",
      priority: 96,
      required: true,
      allowSummary: false,
      content: `Volume count guidance:\n${buildVolumeCountGuidanceContext(input.volumeCountGuidance)}`,
    }),
    createContextBlock({
      id: "chapter_budget",
      group: "chapter_budget",
      priority: 94,
      required: true,
      allowSummary: false,
      content: buildDeterministicVolumeBudgetContent({
        chapterBudget: input.chapterBudget,
        volumeChapterBudget: input.volumeCountGuidance.volumeChapterBudget,
      }),
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}

export function buildVolumeBeatSheetContextBlocks(input: VolumeBeatSheetPromptInput): PromptContextBlock[] {
  return [
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "strategy_context",
      group: "strategy_context",
      priority: 82,
      content: `Strategy plan:\n${buildStrategyContext(input.strategyPlan)}`,
    }),
    createContextBlock({
      id: "target_volume",
      group: "target_volume",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Target volume:\n${buildCompactVolumeCard(input.targetVolume)}`,
    }),
    createContextBlock({
      id: "target_chapter_count",
      group: "target_chapter_count",
      priority: 96,
      required: true,
      allowSummary: false,
      content: `Target chapter count: ${input.targetChapterCount}`,
    }),
    createContextBlock({
      id: "volume_window",
      group: "volume_window",
      priority: 88,
      content: `Adjacent volume window:\n${buildWindowedVolumeContext(input.workspace.volumes, input.targetVolume.id)}`,
    }),
    createContextBlock({
      id: "soft_future_summary",
      group: "soft_future_summary",
      priority: 74,
      content: `Future soft summary:\n${buildSoftFutureVolumeSummary(input.workspace.volumes, input.targetVolume.id)}`,
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}

export function buildVolumeChapterListContextBlocks(input: VolumeChapterListPromptInput): PromptContextBlock[] {
  return [
    createContextBlock({ id: "written_evidence", group: "written_evidence", priority: 110, required: true, allowSummary: false,
      content: JSON.stringify({ writtenEvidence: input.writtenEvidence ?? { coverage: { complete: false, unknown: ["未提供已写正文来源；不得把旧计划当作事实"] } } }) }),
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "strategy_context",
      group: "strategy_context",
      priority: 94,
      content: `Strategy plan:\n${buildStrategyContext(input.strategyPlan)}`,
    }),
    createContextBlock({
      id: "target_volume",
      group: "target_volume",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Target volume:\n${buildCompactVolumeCard(input.targetVolume)}`,
    }),
    createContextBlock({
      id: "target_beat_contract",
      group: "target_beat_contract",
      priority: 98,
      required: true,
      allowSummary: false,
      content: [
        `Target beat:\n${buildBeatCard(input.targetBeat)}`,
        `Beat chapter contract:\n${buildBeatChapterRangeContext({
          targetBeat: input.targetBeat,
          targetBeatChapterCount: input.targetBeatChapterCount,
          targetChapterStartOrder: input.targetChapterStartOrder,
          targetChapterEndOrder: input.targetChapterEndOrder,
          nextAvailableChapterOrder: input.nextAvailableChapterOrder,
        })}`,
      ].join("\n\n"),
    }),
    createContextBlock({
      id: "beat_context_window",
      group: "beat_context_window",
      priority: 90,
      content: `Adjacent beat window:\n${buildBeatContextWindow({
        previousBeat: input.previousBeat,
        nextBeat: input.nextBeat,
      })}`,
    }),
    createContextBlock({
      id: "previous_beat_chapters",
      group: "previous_beat_chapters",
      priority: 86,
      content: `Previous generated beat summary:\n${buildBeatChapterSummary(input.previousBeatChapterSummary)}`,
    }),
    createContextBlock({
      id: "preserved_beat_chapters",
      group: "preserved_beat_chapters",
      priority: 84,
      content: `Locked existing beat summary:\n${buildBeatChapterSummary(input.preservedBeatChapterSummary)}`,
    }),
    createContextBlock({
      id: "volume_chapter_budget",
      group: "volume_chapter_budget",
      priority: 95,
      required: true,
      allowSummary: false,
      content: buildTargetVolumeChapterBudgetContext({
        novel: input.novel,
        volumeOrder: input.targetVolume.sortOrder,
        volumeTitle: input.targetVolume.title,
      }),
    }),
    ...(input.storyMacroPlan?.foreshadowSchedule?.length
      ? [createContextBlock({
        id: "foreshadow_schedule",
        group: "foreshadow_schedule",
        priority: 97,
        required: true,
        allowSummary: false,
        content: buildVolumeForeshadowScheduleContent({
          storyMacroPlan: input.storyMacroPlan,
          startOrder: input.targetChapterStartOrder,
          endOrder: input.targetChapterEndOrder,
        }),
      })]
      : []),
    createContextBlock({
      id: "conflict_level_curve",
      group: "conflict_level_curve",
      priority: 96,
      required: true,
      allowSummary: false,
      content: `Conflict level anchors and curve:\n${buildConflictLevelCurveContext(input.targetVolume, undefined, { includeChapterTitles: false })}`,
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}

export function buildVolumeChapterDetailContextBlocks(input: VolumeChapterDetailPromptInput): PromptContextBlock[] {
  const prose = buildPrimaryProseCitationCatalog(JSON.stringify({ writtenEvidence: input.writtenEvidence ?? {
    coverage: { complete: false, unknown: ["未提供已写正文来源"] },
  } }), input.targetChapter.chapterOrder);
  return [
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({ id: "written_evidence", group: "written_evidence", priority: 110, required: true, allowSummary: false,
      content: `${prose.reviewContextDisplayJson}\nprimaryProseCitationCatalog (exact prior prose; stateClaims.source.evidenceIds select these IDs):\n${JSON.stringify(prose.sources)}` }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "target_volume",
      group: "target_volume",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Target volume:\n${buildCompactVolumeCard(input.targetVolume)}`,
    }),
    createContextBlock({
      id: "target_beat_sheet",
      group: "target_beat_sheet",
      priority: 96,
      content: `Target beat sheet:\n${buildBeatSheetContext(input.targetBeatSheet)}`,
    }),
    ...(input.storyMacroPlan?.foreshadowSchedule?.length
      ? [createContextBlock({
        id: "chapter_foreshadow_actions",
        group: "chapter_foreshadow_actions",
        priority: 98,
        required: true,
        allowSummary: false,
        content: renderChapterForeshadowActionsContext({
          chapterOrder: input.targetChapter.chapterOrder,
          actions: selectForeshadowActionsForChapter(
            input.storyMacroPlan.foreshadowSchedule,
            input.targetChapter.chapterOrder,
          ),
        }),
      })]
      : []),
    createContextBlock({
      id: "chapter_neighbors",
      group: "chapter_neighbors",
      priority: 98,
      required: true,
      allowSummary: false,
      content: `Chapter neighbors:\n${buildChapterNeighborContext(input.targetVolume, input.targetChapter.id)}`,
    }),
    createContextBlock({
      id: "conflict_level_curve",
      group: "conflict_level_curve",
      priority: 99,
      required: true,
      allowSummary: false,
      content: `Conflict level anchors and curve:\n${buildConflictLevelCurveContext(input.targetVolume, input.targetChapter.id)}`,
    }),
    createContextBlock({
      id: "recent_execution_contracts",
      group: "recent_execution_contracts",
      priority: 97,
      content: `Recent execution contracts:\n${buildRecentChapterExecutionContext(input.targetVolume, input.targetChapter.id)}`,
    }),
    createContextBlock({
      id: "chapter_detail_draft",
      group: "chapter_detail_draft",
      priority: 96,
      required: true,
      allowSummary: false,
      content: `Existing draft:\n${buildChapterDetailDraft(input.targetChapter, input.detailMode)}`,
    }),
    createContextBlock({
      id: "payoff_cadence",
      group: "payoff_cadence",
      priority: 97,
      required: Boolean(input.payoffCadence?.dueCount),
      allowSummary: false,
      content: `Due ledger promises:\n${input.payoffCadence?.text
        ?? "本章没有到期的账本承诺。不要为了填满这个位置而新造承诺或提前兑现远期安排。"}`,
    }),
    createContextBlock({
      id: "volume_window",
      group: "volume_window",
      priority: 82,
      content: `Adjacent volume window:\n${buildWindowedVolumeContext(input.workspace.volumes, input.targetVolume.id)}`,
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}

export function buildVolumeRebalanceContextBlocks(input: VolumeRebalancePromptInput): PromptContextBlock[] {
  return [
    createContextBlock({ id: "selected_planning_direction", group: "selected_planning_direction", priority: 108, required: true, allowSummary: false,
      content: renderSelectedPlanningDirection(input.novel.selectedPlanningDirection) }),
    createContextBlock({
      id: "book_contract",
      group: "book_contract",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Novel contract:\n${buildCommonNovelContext(input.novel)}`,
    }),
    createContextBlock({
      id: "macro_constraints",
      group: "macro_constraints",
      priority: 92,
      required: true,
      allowSummary: false,
      content: `Story macro:\n${buildStoryMacroContext(input.storyMacroPlan)}`,
    }),
    createContextBlock({
      id: "strategy_context",
      group: "strategy_context",
      priority: 94,
      content: `Strategy plan:\n${buildStrategyContext(input.strategyPlan)}`,
    }),
    createContextBlock({
      id: "anchor_volume",
      group: "anchor_volume",
      priority: 100,
      required: true,
      allowSummary: false,
      content: `Anchor volume:\n${buildCompactVolumeCard(input.anchorVolume)}`,
    }),
    createContextBlock({
      id: "adjacent_volumes",
      group: "adjacent_volumes",
      priority: 90,
      content: [
        input.previousVolume ? `Previous volume:\n${buildCompactVolumeCard(input.previousVolume)}` : "",
        input.nextVolume ? `Next volume:\n${buildCompactVolumeCard(input.nextVolume)}` : "",
      ].filter(Boolean).join("\n\n") || "Adjacent volumes: none",
    }),
    createContextBlock({
      id: "volume_window",
      group: "volume_window",
      priority: 84,
      content: `Adjacent volume window:\n${buildWindowedVolumeContext(input.workspace.volumes, input.anchorVolume.id)}`,
    }),
    guidanceBlock(input.guidance),
  ].filter((block): block is PromptContextBlock => Boolean(block));
}
