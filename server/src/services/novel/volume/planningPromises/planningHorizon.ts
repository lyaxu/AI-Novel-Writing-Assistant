import type { VolumePlanDocument } from "@ai-novel/shared/types/novel";

/** Reading later plans never grants permission to rewrite them or treats them as prose facts. */
export function projectPlanningHorizon(
  workspace: Pick<VolumePlanDocument, "volumes"> & Partial<Pick<VolumePlanDocument, "beatSheets">>,
  volumeId: string,
  excludedChapterIds: readonly string[],
) {
  const volume = workspace.volumes.find((item) => item.id === volumeId);
  const excluded = new Set(excludedChapterIds);
  const targetOrder = volume?.chapters.find((chapter) => excluded.has(chapter.id))?.chapterOrder ?? 1;
  const available = (volume?.chapters ?? []).filter((chapter) => !excluded.has(chapter.id));
  const selected = available.slice().sort((left, right) =>
    Math.abs(left.chapterOrder - targetOrder) - Math.abs(right.chapterOrder - targetOrder)
      || left.chapterOrder - right.chapterOrder).slice(0, 24).sort((left, right) => left.chapterOrder - right.chapterOrder);
  return {
    readonlyOpeningRoutes: selected.map(({ id, chapterOrder, title, summary, purpose, exclusiveEvent, endingState, nextChapterEntryState }) =>
      ({ id, chapterOrder, title, summary, purpose, exclusiveEvent, endingState, nextChapterEntryState,
        authority: "readonly_planning_not_prose" as const })),
    readonlyPlanningHorizon: {
      authority: "readonly_planning_not_prose" as const,
      volumeId,
      beats: workspace.beatSheets?.find((sheet) => sheet.volumeId === volumeId)?.beats ?? [],
      coverage: { maxRouteChapters: 24, omittedRouteCount: available.length - selected.length,
        note: "路线只覆盖已保存的本卷章节，节奏板只说明计划承接；未拆出的章节不是已存在合同。看到后续安排不扩大可修改窗口，也不自动豁免原选早期回报的时间要求。" },
    },
  };
}
