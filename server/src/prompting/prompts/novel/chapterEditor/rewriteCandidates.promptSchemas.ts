import { z } from "zod";

export const chapterEditorRewriteCandidateSchema = z.object({
  label: z.string().trim().min(1).max(24),
  content: z.string().trim().min(1),
  summary: z.string().trim().min(1).max(160).optional(),
  rationale: z.string().trim().min(1).max(220).optional(),
  riskNotes: z.array(z.string().trim().min(1).max(120)).max(4).optional(),
  semanticTags: z.array(z.string().trim().min(1).max(24)).max(6).optional(),
});

export const chapterEditorRewriteCandidatesSchema = z.object({
  macroAlignmentNote: z.string().trim().min(1).max(220).optional(),
  // min(1), not min(2): a whole-chapter rewrite is produced one candidate per call, because asking
  // for two or three complete copies of a chapter in one reply overruns the model's output ceiling
  // (a real run stopped at 8192 tokens on a 4300-character chapter). The selection path still asks
  // for 2-3 candidates in one call, which is small enough to fit.
  candidates: z.array(chapterEditorRewriteCandidateSchema).min(1).max(3),
});

export type ChapterEditorRewriteCandidatesParsed = z.infer<typeof chapterEditorRewriteCandidatesSchema>;
