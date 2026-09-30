import { createContextBlock } from "../../../prompting/core/contextBudget";
import type { ChapterPayoffValidationInput } from "./index";

/** Evidence consumed by exact validation must not be summarized by the prompt budget. */
export function buildPayoffPlanningEvidenceBlock(input: ChapterPayoffValidationInput, writtenEvidence: unknown) {
  return createContextBlock({
    id: "payoff_planning_evidence",
    group: "payoff_planning_evidence",
    priority: 100,
    required: true,
    allowSummary: false,
    content: [
      `currentChapterOrder: ${input.chapterOrder}`,
      ...Object.entries(input.contract).map(([key, value]) => `[currentContract.${key}]\n${value ?? ""}`),
      `[payoffCandidates]\n${JSON.stringify(input.candidates, null, 2)}`,
      `[planningWindow]\n${JSON.stringify(input.planningWindow, null, 2)}`,
      `[writtenEvidence]\n${JSON.stringify(writtenEvidence, null, 2)}`,
    ].join("\n\n"),
  });
}
