import type { GenerationContextPackage } from "@ai-novel/shared/types/chapterRuntime";
import { parseChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import { buildChapterExecutionContractHash, readPlanExecutionContractHash, type ChapterExecutionContractHashInput } from "../plannerPersistence";

/** A runtime plan is an elaboration of this exact reviewed chapter contract. */
export function isPlanForCurrentContract(plan: { rawPlanJson?: string | null } | null, chapter: ChapterExecutionContractHashInput): boolean {
  return Boolean(plan && readPlanExecutionContractHash(plan.rawPlanJson) === buildChapterExecutionContractHash(chapter));
}

/** Project already-structured AI scene cards; do not infer plot facts from prose. */
export function projectEffectiveChapterPlan(
  plan: GenerationContextPackage["plan"],
  chapter: ChapterExecutionContractHashInput,
): GenerationContextPackage["plan"] {
  if (!plan || !isPlanForCurrentContract(plan, chapter)) return null;
  const scenePlan = parseChapterScenePlan(chapter.sceneCards, { targetWordCount: chapter.targetWordCount ?? undefined });
  // Historical unstructured contracts stay readable, without fabricating scene fields.
  if (!scenePlan || !chapter.taskSheet?.trim()) return plan;
  return {
    ...plan,
    objective: chapter.expectation?.trim() || chapter.taskSheet,
    hookTarget: chapter.hook ?? null,
    reveals: scenePlan.scenes.map(scene => scene.turn).filter(Boolean),
    riskNotes: [chapter.mustAvoid ?? "", ...scenePlan.scenes.flatMap(scene => scene.forbiddenExpansion)].filter(Boolean),
    mustAdvance: [...new Set([...scenePlan.requiredElements, ...scenePlan.scenes.flatMap(scene => scene.mustAdvance)])],
    mustPreserve: [...new Set(scenePlan.scenes.flatMap(scene => scene.mustPreserve))],
    // Keep creative turns, resistance and emotions from the approved detailed contract.
    // A separately generated plan cannot replace them with a second story sequence.
    scenes: scenePlan.scenes.map((scene, index) => ({
      id: scene.key, sortOrder: index + 1, title: scene.title, objective: scene.purpose,
      conflict: scene.resistance || null, reveal: scene.turn || null, emotionBeat: scene.emotionalShift || null,
    })),
  };
}
