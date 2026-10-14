import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { StructuredOutputError, StructuredOutputErrorCategory } from "../../../../llm/structuredOutput";
import type { ChapterPatchRepairFailedError } from "../../chapterPatchRepairService";

export interface JournalChapter {
  id: string;
  novelId: string;
  content: string | null;
  title: string;
  taskSheet: string | null;
  sceneCards: string | null;
  expectation: string | null;
  targetWordCount: number | null;
  mustAvoid?: string | null;
  conflictLevel?: number | null;
  revealLevel?: number | null;
  hook?: string | null;
}
export interface JournalContentWrite {
  content: string;
  generationState?: "planned" | "drafted" | "reviewed" | "repaired" | "approved" | "published";
  chapterStatus?: "unplanned" | "pending_generation" | "generating" | "pending_review" | "needs_repair" | "completed" | null;
}
export type JournalStateWrite = Omit<JournalContentWrite, "content"> & { riskFlags?: string | null; repairHistory?: string | null };
/** Private rejected model responses; never expose raw output through inspection projections. */
export interface CompletedPromptResponse {
  promptId: string;
  promptVersion: string;
  output: unknown;
  validationError: string;
  semanticRetryAttempts: number;
  maxSemanticRetryAttempts: number;
  repairAttempts: number;
}
/** A completed but invalid review is evidence, not a reusable successful step output. */
export interface IncompleteReviewResponse {
  code: "CHAPTER_REVIEW_INCOMPLETE";
  output: Record<string, unknown>;
  validationError: string;
}
/** A planning gate is not a transport failure; the owner certifies whether calls were settled. */
export interface PlanningPauseReceipt {
  version: 1;
  repairKey: string;
  round: number;
  candidateVersionId?: string;
  outcome: "settled" | "unknown";
}
export interface JournalStep {
  status: "running" | "done" | "failed" | "unknown";
  external: boolean;
  output?: unknown;
  error?: string;
  planningPause?: PlanningPauseReceipt;
  rejectedResponses?: CompletedPromptResponse[];
  rejectedReviews?: IncompleteReviewResponse[];
  /** Earlier complete answers when the subsequent correction failed; never a success receipt. */
  completedBeforeCorrectionFailures?: CompletedPromptResponse[];
}
export interface ChapterProductionJournalRecord {
  version: 1;
  operationId: string;
  requestFingerprint: string;
  request?: unknown;
  inputFingerprint: string;
  expectedFingerprint: string;
  expectedChapter: JournalChapter;
  token: string;
  expiresAt: number;
  status: "running" | "paused" | "completed";
  prepared?: unknown;
  steps: Record<string, JournalStep>;
  values: Record<string, unknown>;
  partialText?: string;
  error?: string;
  recoveryDecision?: { kind: "acknowledge_unknown"; originalOperationId: string; acknowledgedAt: number; affectedSteps: string[] };
}
export interface ChapterProductionInspection {
  operationId: string;
  status: ChapterProductionJournalRecord["status"];
  partialText?: string;
  steps: Array<{ key: string; status: JournalStep["status"]; error?: string }>;
  error?: string;
  savedDraft?: string;
  entry: "stream" | "repair" | "pipeline" | null;
  leaseActive: boolean;
  inputChanged: boolean;
  canResume: boolean;
  canAcknowledge: boolean;
  resumeBlockedReason?: string;
  workflowTaskId?: string;
}
export interface JournalRow { metadataJson: string | null; status: string }
export interface JournalTransaction {
  /** Local asset writes only; never start external work inside this transaction. */
  assetClient?: Prisma.TransactionClient;
  readChapter(novelId: string, chapterId: string): Promise<JournalChapter | null>;
  readJournal(novelId: string, chapterId: string): Promise<JournalRow | null>;
  writeJournal(novelId: string, chapterId: string, expectedJson: string | null, nextJson: string): Promise<void>;
  archiveJournal(novelId: string, chapterId: string, record: ChapterProductionJournalRecord): Promise<void>;
  writeContent(novelId: string, chapterId: string, expected: JournalChapter, data: JournalContentWrite): Promise<void>;
  writeState(novelId: string, chapterId: string, expected: JournalChapter, data: JournalStateWrite): Promise<void>;
}
export interface ChapterProductionJournalRepository {
  transaction<T>(fn: (tx: JournalTransaction) => Promise<T>): Promise<T>;
}
export class ChapterProductionError extends Error {
  constructor(public readonly code: "CHAPTER_PRODUCTION_BUSY" | "CHAPTER_PRODUCTION_CONFLICT" | "CHAPTER_PRODUCTION_UNCERTAIN" | "CHAPTER_PRODUCTION_STORAGE", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChapterProductionError";
  }
}
const definitiveStructuredCategories: ReadonlySet<StructuredOutputErrorCategory> = new Set([
  "unsupported_native_json", "thinking_pollution", "incomplete_json", "malformed_json", "schema_mismatch",
]);

export function completedPromptResponseFromError(error: unknown): CompletedPromptResponse | undefined {
  if (!(error instanceof Error)) return undefined;
  const typed = error as Error & { code?: unknown; completedPromptResponse?: CompletedPromptResponse };
  const response = typed.completedPromptResponse;
  return typed.code === "PROMPT_POST_VALIDATION_FAILED" && response
    && typeof response.promptId === "string" && typeof response.promptVersion === "string"
    && Object.prototype.hasOwnProperty.call(response, "output")
    && typeof response.validationError === "string"
    && Number.isInteger(response.semanticRetryAttempts) && response.semanticRetryAttempts >= 0
    && Number.isInteger(response.maxSemanticRetryAttempts) && response.maxSemanticRetryAttempts >= 0
    && response.semanticRetryAttempts >= response.maxSemanticRetryAttempts
    && Number.isInteger(response.repairAttempts) && response.repairAttempts >= 0
    ? response : undefined;
}

/** This receipt preserves the earlier answer without classifying the later call as definitive. */
export function completedBeforeCorrectionFailureFromError(error: unknown): CompletedPromptResponse | undefined {
  if (!(error instanceof Error)) return undefined;
  const response = (error as Error & { completedBeforeCorrectionFailure?: CompletedPromptResponse }).completedBeforeCorrectionFailure;
  return response && typeof response.promptId === "string" && typeof response.promptVersion === "string"
    && Object.prototype.hasOwnProperty.call(response, "output") && typeof response.validationError === "string"
    && Number.isInteger(response.semanticRetryAttempts) && response.semanticRetryAttempts > 0
    && Number.isInteger(response.maxSemanticRetryAttempts) && response.maxSemanticRetryAttempts >= response.semanticRetryAttempts
    && Number.isInteger(response.repairAttempts) && response.repairAttempts >= 0 ? response : undefined;
}

/** Keep the full private review including raw answer, deferred edits and all diagnostics. */
export function incompleteReviewResponseFromError(error: unknown): IncompleteReviewResponse | undefined {
  if (!(error instanceof Error)) return undefined;
  const typed = error as Error & { code?: unknown; reviewOutput?: unknown };
  const output = typed.reviewOutput;
  if (typed.code !== "CHAPTER_REVIEW_INCOMPLETE" || !output || typeof output !== "object" || Array.isArray(output)) return undefined;
  return { code: "CHAPTER_REVIEW_INCOMPLETE", output: output as Record<string, unknown>, validationError: error.message };
}

/** Structural error protocols avoid importing prompt execution/DB into the journal boundary. */
export function planningPauseFromError(error: unknown): PlanningPauseReceipt | undefined {
  if (!(error instanceof Error)) return undefined;
  const typed = error as Error & { code?: unknown; planningPause?: PlanningPauseReceipt };
  const receipt = typed.planningPause;
  return typed.code === "PLANNING_REPAIR_CONFIRMATION_REQUIRED" && receipt?.version === 1
    && typeof receipt.repairKey === "string" && receipt.repairKey.length > 0
    && Number.isSafeInteger(receipt.round) && receipt.round >= 0
    && (receipt.outcome === "settled" || receipt.outcome === "unknown")
    && (receipt.candidateVersionId === undefined || typeof receipt.candidateVersionId === "string")
    ? receipt : undefined;
}

export function isDefinitiveProductionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (completedPromptResponseFromError(error)) return true;
  if (planningPauseFromError(error)?.outcome === "settled") return true;
  if (["CHAPTER_EMPTY_CONTENT", "CHAPTER_REVIEW_INCOMPLETE"].includes(String((error as Error & { code?: unknown }).code))) return true;
  const typed: Partial<StructuredOutputError & ChapterPatchRepairFailedError> = error;
  if (typed.name === "ChapterPatchRepairFailedError") return true;
  return typed.name === "StructuredOutputError" && typed.category !== undefined
    && definitiveStructuredCategories.has(typed.category);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  }
  return value;
}
export function productionFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value)) ?? "null").digest("hex");
}
export function chapterFingerprint(chapter: JournalChapter): string {
  return productionFingerprint({ content: chapter.content ?? "", title: chapter.title, taskSheet: chapter.taskSheet, sceneCards: chapter.sceneCards, expectation: chapter.expectation, targetWordCount: chapter.targetWordCount,
    mustAvoid: chapter.mustAvoid ?? null, conflictLevel: chapter.conflictLevel ?? null, revealLevel: chapter.revealLevel ?? null, hook: chapter.hook ?? null });
}
