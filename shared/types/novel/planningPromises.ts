import { z } from "zod";

const sourceText = z.string().trim().min(1);
export const selectedPlanningCandidateSchema = z.object({
  id: sourceText,
  sellingPoint: sourceText.optional(),
  coreConflict: sourceText.optional(),
  protagonistPath: sourceText.optional(),
  hookStrategy: sourceText.optional(),
  progressionLoop: sourceText.optional(),
  endingDirection: sourceText.optional(),
  storyPrototype: z.object({
    protagonistWant: sourceText, opposition: sourceText, difficultChoice: sourceText,
    distinctiveEngine: sourceText, earlyPayoff: sourceText, appealRisk: sourceText,
    openingChain: z.array(z.object({
      chapterOrder: z.number().int().min(1), action: sourceText, resistance: sourceText,
      choice: sourceText, consequence: sourceText, payoff: sourceText, nextQuestion: sourceText,
    })).min(1).max(5),
  }).optional(),
});
export type SelectedPlanningDirection = {
  status: "available";
  sourceTaskId: string;
  fingerprint: string;
  candidate: z.infer<typeof selectedPlanningCandidateSchema>;
} | { status: "missing"; reason: string };

/** Source grouping only. Whether an adaptation fulfils the promise is an AI judgment. */
export function selectedPlanningPromiseIds(source: SelectedPlanningDirection | undefined, chapterOrder = Infinity): string[] {
  if (source?.status !== "available") return [];
  const ids: string[] = (["sellingPoint", "coreConflict", "protagonistPath"] as const).filter(key => Boolean(source.candidate[key]));
  if (source.candidate.storyPrototype) {
    ids.push("storyPrototype.distinctiveEngine", "storyPrototype.earlyPayoff");
    source.candidate.storyPrototype.openingChain.forEach((chapter, index) => {
      if (chapter.chapterOrder <= chapterOrder) ids.push(`storyPrototype.openingChain[${index}]`);
    });
  }
  return ids;
}

export function isOpeningPlanningPromise(sourceId: string): boolean {
  return sourceId === "storyPrototype.earlyPayoff" || sourceId.startsWith("storyPrototype.openingChain[");
}
