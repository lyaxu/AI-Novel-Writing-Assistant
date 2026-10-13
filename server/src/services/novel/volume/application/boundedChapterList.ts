import type { VolumeBeat, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { getBeatExpectedChapterCount } from "../volumeGenerationHelpers";

/** Global order is owned by the accepted beat budgets, never by the number of rows materialized. */
export function resolveBoundedChapterPlans(
  document: VolumePlanDocument,
  volumeId: string,
  range: { startOrder: number; endOrder: number },
  targetBeatKey?: string,
): Array<{ beat: VolumeBeat; chapterCount: number; chapterStartOrder: number; chapterEndOrder: number; globalOrder: number }> {
  if (!Number.isSafeInteger(range.startOrder) || !Number.isSafeInteger(range.endOrder)
    || range.startOrder < 1 || range.endOrder < range.startOrder) {
    throw new Error("滚动章节规划范围无效。");
  }
  let volumeOffset = 0;
  for (const volume of document.volumes.slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
    const sheet = document.beatSheets.find((item) => item.volumeId === volume.id);
    if (!sheet?.beats.length) throw new Error("缺少前序卷节奏板，无法确定滚动章节的全书序号。");
    const budget = sheet.beats.reduce((sum, beat) => sum + Math.max(1, getBeatExpectedChapterCount(beat)), 0);
    if (volume.id !== volumeId) { volumeOffset += budget; continue; }
    if (range.startOrder <= volumeOffset || range.endOrder > volumeOffset + budget) {
      throw new Error("滚动章节规划超出目标卷的节奏板范围。");
    }
    const existing = new Set(document.volumes.flatMap((item) => item.chapters.map((chapter) => chapter.chapterOrder)));
    const plans: ReturnType<typeof resolveBoundedChapterPlans> = [];
    let beatOffset = volumeOffset;
    for (const beat of sheet.beats) {
      const beatEnd = beatOffset + Math.max(1, getBeatExpectedChapterCount(beat));
      for (let order = Math.max(range.startOrder, beatOffset + 1); order <= Math.min(range.endOrder, beatEnd); order += 1) {
        if (existing.has(order)) continue;
        if (targetBeatKey && beat.key !== targetBeatKey) throw new Error("滚动章节序号与目标节奏段不一致。");
        plans.push({ beat, chapterCount: 1, chapterStartOrder: order - volumeOffset,
          chapterEndOrder: order - volumeOffset, globalOrder: order });
      }
      beatOffset = beatEnd;
    }
    return plans;
  }
  throw new Error("滚动章节规划的目标卷不存在。");
}
