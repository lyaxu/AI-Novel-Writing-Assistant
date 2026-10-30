import type { PromptBudgetProfile } from "@ai-novel/shared/types/chapterRuntime";

export const NOVEL_PROMPT_BUDGETS = {
  directorCandidates: 1200,
  directorCandidatePatch: 1200,
  directorBookContract: 1400,
  directorBlueprint: 2400,
  storyMacroDecomposition: 2200,
  storyMacroFieldRegeneration: 1600,
  volumeStrategy: 2100,
  volumeStrategyCritique: 1800,
  volumeSkeleton: 2300,
  volumeBeatSheet: 1900,
  volumeChapterList: 1900,
  volumeChapterDetail: 1900,
  volumeRebalance: 1600,
  chapterWriter: 2900,
  chapterAcceptance: 1200,
  chapterArtifactDelta: 2600,
  chapterEditorWorkspaceDiagnosis: 1400,
  chapterEditorUserIntent: 900,
  chapterEditorRewrite: 1400,
  chapterLightAudit: 900,
  chapterReview: 2600,
  chapterRepair: 2200,
  chapterSummary: 1000,
} as const;

/**
 * Planning stages return whole-book or whole-volume structured documents. Provider defaults
 * and a per-volume formula keep underestimating that shape (a 2-volume skeleton can still
 * need more than 1840 tokens). Use one generous ceiling for every planner structured call;
 * the model still stops naturally once the document is complete.
 */
export const PLANNING_OUTPUT_TOKEN_BUDGET = 32_768;

export function resolveVolumeStrategyOutputTokenBudget(_expectedVolumeCount: number): number {
  return PLANNING_OUTPUT_TOKEN_BUDGET;
}

export const RUNTIME_PROMPT_BUDGET_PROFILES: PromptBudgetProfile[] = [
  {
    promptId: "novel.chapter.writer",
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterWriter,
    preferredGroups: [
      "chapter_boundary",
      "chapter_mission",
      "previous_chapter_tail",
      "reader_experience",
      "character_hard_facts",
      "payoff_directives",
      "style_contract",
      "volume_window",
      "participant_subset",
      "local_state",
      "open_conflicts",
      "recent_chapters",
    ],
    dropOrder: [
      "rag_facts",
      "world_rules",
      "continuation_constraints",
      "opening_constraints",
    ],
  },
  {
    promptId: "novel.chapter.acceptance_assessment",
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterAcceptance,
    preferredGroups: [
      "chapter_mission",
      "structure_obligations",
      "character_hard_facts",
      "local_state",
      "style_contract",
      "open_conflicts",
    ],
    dropOrder: [
      "recent_chapters",
      "participant_subset",
      "world_rules",
      "historical_issues",
    ],
  },
  {
    promptId: "novel.chapter.artifact_delta.extract",
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterArtifactDelta,
    preferredGroups: [
      "chapter_mission",
      "local_state",
      "character_hard_facts",
      "payoff_directives",
      "open_conflicts",
    ],
    dropOrder: [
      "recent_chapters",
      "world_rules",
      "historical_issues",
      "participant_subset",
    ],
  },
  {
    promptId: "audit.chapter.light",
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterLightAudit,
    preferredGroups: [
      "chapter_mission",
      "structure_obligations",
      "character_hard_facts",
      "local_state",
    ],
    dropOrder: [
      "recent_chapters",
      "participant_subset",
      "historical_issues",
      "world_rules",
    ],
  },
  {
    promptId: "audit.chapter.full",
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterReview,
    preferredGroups: [
      "chapter_mission",
      "structure_obligations",
      "character_hard_facts",
      "world_rules",
      "historical_issues",
    ],
    dropOrder: [
      "rag_facts",
      "recent_chapters",
      "participant_subset",
    ],
  },
  {
    promptId: "novel.review.repair",
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterRepair,
    preferredGroups: [
      "style_contract",
      "repair_issues",
      "chapter_mission",
      "previous_chapter_tail",
      "repair_boundaries",
      "character_hard_facts",
      "world_rules",
    ],
    dropOrder: [
      "recent_chapters",
      "participant_subset",
      "continuation_constraints",
    ],
  },
];
