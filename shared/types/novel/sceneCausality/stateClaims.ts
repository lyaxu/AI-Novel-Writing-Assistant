import { z } from "zod";

const claimId = z.string().trim().min(1).max(64);
const evidenceId = z.string().regex(/^prose_[a-f0-9]{64}$/);
const citation = z.object({ sourcePath: z.string().min(1), quote: z.string().min(1).max(240) }).strict();
const writtenSource = z.object({
  kind: z.literal("written_prose"), evidenceIds: z.array(evidenceId).min(1).max(3),
  // Restored by the server, never authored by the model.
  evidence: z.array(citation).min(1).max(3).optional(),
}).strict();
const plannedSource = z.object({
  kind: z.literal("planned_scene"), sceneKey: z.string().trim().min(1).max(48),
  phase: z.enum(["entry", "action", "exit"]),
}).strict();
const unknownSource = z.object({ kind: z.literal("unknown"), reason: z.string().trim().min(1).max(240) }).strict();

export const chapterStateClaimSchema = z.object({
  id: claimId,
  subject: z.string().trim().min(1).max(64),
  predicate: z.string().trim().min(1).max(160),
  temporalScope: z.enum(["prior", "planned"]),
  modality: z.enum(["fact", "intention", "attempt", "outcome"]),
  source: z.discriminatedUnion("kind", [writtenSource, plannedSource, unknownSource]),
}).strict();
export const chapterStateClaimWireSchema = chapterStateClaimSchema.extend({
  source: z.discriminatedUnion("kind", [writtenSource.omit({ evidence: true }).strict(), plannedSource, unknownSource]),
});
export const chapterStateClaimsSchema = z.array(chapterStateClaimSchema).max(48);
export const chapterStateClaimsWireSchema = z.array(chapterStateClaimWireSchema).min(1).max(48);
export const sceneStateTransitionSchema = z.object({
  beforeClaimIds: z.array(claimId).max(6),
  actionClaimIds: z.array(claimId).min(1).max(6),
  afterClaimIds: z.array(claimId).min(1).max(6),
}).strict();
export const stateClaimPrerequisiteWireSchema = z.object({ claimIds: z.array(claimId).min(1).max(6) }).strict();

export type ChapterStateClaim = z.infer<typeof chapterStateClaimSchema>;
export type ChapterStateClaimWire = z.infer<typeof chapterStateClaimWireSchema>;
export type SceneStateTransition = z.infer<typeof sceneStateTransitionSchema>;
