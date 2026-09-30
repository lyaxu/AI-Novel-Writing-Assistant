import { z } from "zod";

export const CHAPTER_PROGRESSION_DIMENSIONS = [
  "event_repetition", "knowledge_repetition", "prior_goal_followthrough",
] as const;

const evidenceSchema = z.object({
  source: z.enum(["current_prose", "established_context"]),
  sourceId: z.string().trim().min(1),
  quote: z.string().trim().min(1).max(180),
});

export const chapterProgressionCheckSchema = z.object({
  dimension: z.enum(CHAPTER_PROGRESSION_DIMENSIONS),
  status: z.enum(["progressed", "justified_repetition", "stalled", "insufficient_evidence", "not_applicable"]),
  priorState: z.string().trim().max(180),
  actualChange: z.string().trim().max(180),
  newConsequence: z.string().trim().max(180),
  previousEvidence: z.array(evidenceSchema).max(2),
  currentEvidence: z.array(evidenceSchema).max(2),
  explanation: z.string().trim().min(1).max(240),
  repairSuggestion: z.string().trim().max(240),
  validationIssues: z.array(z.string()).optional(),
});

export type ChapterProgressionCheck = z.infer<typeof chapterProgressionCheckSchema>;
