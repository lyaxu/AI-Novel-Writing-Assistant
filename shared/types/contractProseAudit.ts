import { z } from "zod";

/**
 * Contract-vs-prose audit.
 *
 * The question this answers is the one a human asks after reading a chapter: did the chapter actually
 * do what its contract said it would? Only part of that is mechanical — an empty event list, a
 * leftover planning marker — so those are checked deterministically. "Is this element delivered in
 * the prose" is a reading judgment and must come from structured AI understanding, never from
 * keyword matching: a chapter can deliver an event without reusing the contract's wording, and text
 * similarity would both miss those and accept mere mentions.
 */

export const CONTRACT_PROSE_VERDICTS = ["delivered", "partial", "absent", "contradicted"] as const;
export type ContractProseVerdict = (typeof CONTRACT_PROSE_VERDICTS)[number];

export const contractProseElementCheckSchema = z.object({
  index: z.number().int().min(0),
  element: z.string().trim().min(1).max(240),
  verdict: z.enum(CONTRACT_PROSE_VERDICTS),
  /** A short quote from the prose, or an explicit note that nothing supports it. */
  evidence: z.string().trim().max(240),
  note: z.string().trim().max(240),
});
export type ContractProseElementCheck = z.infer<typeof contractProseElementCheckSchema>;

export const contractProseSceneCheckSchema = z.object({
  sceneKey: z.string().trim().min(1).max(80),
  resistanceDelivered: z.boolean(),
  turnDelivered: z.boolean(),
  evidence: z.string().trim().max(240),
  note: z.string().trim().max(240),
});
export type ContractProseSceneCheck = z.infer<typeof contractProseSceneCheckSchema>;

/**
 * A stretch of dialogue that repeats the same exchange without adding information — the shape that
 * turns a tense negotiation into padding (report: "leave—press" repeated three times).
 */
export const contractProseRepeatedExchangeSchema = z.object({
  /** What keeps being re-litigated. */
  subject: z.string().trim().min(1).max(160),
  /** How many times the same exchange recurs. */
  repeats: z.number().int().min(2).max(20),
  evidence: z.string().trim().max(240),
  /** What the author could cut and what must be added instead. */
  fixHint: z.string().trim().max(240),
});
export type ContractProseRepeatedExchange = z.infer<typeof contractProseRepeatedExchangeSchema>;

/**
 * A character changes position without a new fact forcing it — the reader is told to accept the
 * change because the plot needs it.
 */
export const contractProseUnsupportedTurnSchema = z.object({
  character: z.string().trim().min(1).max(80),
  from: z.string().trim().min(1).max(160),
  to: z.string().trim().min(1).max(160),
  evidence: z.string().trim().max(240),
  fixHint: z.string().trim().max(240),
});
export type ContractProseUnsupportedTurn = z.infer<typeof contractProseUnsupportedTurnSchema>;

export const contractProseAuditSchema = z.object({
  elements: z.array(contractProseElementCheckSchema),
  scenes: z.array(contractProseSceneCheckSchema),
  endingHookDelivered: z.boolean(),
  endingHookEvidence: z.string().trim().max(240),
  repeatedExchanges: z.array(contractProseRepeatedExchangeSchema).max(5).default([]),
  unsupportedTurns: z.array(contractProseUnsupportedTurnSchema).max(5).default([]),
  summary: z.string().trim().min(1).max(600),
});
export type ContractProseAudit = z.infer<typeof contractProseAuditSchema>;

/**
 * The writing-layer defects, asked in their own call.
 *
 * Measured reason for the split: asked inside the full delivery audit — one JSON with six sections —
 * the model returned both defect arrays empty for a chapter whose unsupported turn a focused,
 * single-question probe identified immediately. The capability was there; the batched prompt
 * diluted it. Delivery checking and defect hunting are different readings and get separate calls.
 */
export const contractProseDefectsSchema = z.object({
  repeatedExchanges: z.array(contractProseRepeatedExchangeSchema).max(5).default([]),
  unsupportedTurns: z.array(contractProseUnsupportedTurnSchema).max(5).default([]),
  /** What the reader would most want changed, whether or not it fits the two defect shapes. */
  biggestWeakness: z.string().trim().max(400).default(""),
  summary: z.string().trim().min(1).max(600),
});
export type ContractProseDefects = z.infer<typeof contractProseDefectsSchema>;
