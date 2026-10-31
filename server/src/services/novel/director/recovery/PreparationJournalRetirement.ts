import type { Prisma } from "@prisma/client";
import { PREPARATION_JOURNAL_STEP_KEYS } from "./PlanningRepairCandidateAdoptionPlan";

/**
 * Retiring a superseded preparation journal.
 *
 * The chapter journal is normally the ownership record: a new execution may only replace it when
 * the previous operation completed. After a terminal planning repair leaves the old range job with
 * no chapter anchor, the paused journal only records failed preparation attempts (`prepare`,
 * `prepare.contract`, `prepare.execution_contract`) for a chapter that has no prose yet. Keeping it
 * active would make every rebuilt chapter execution fail with "chapter execution ownership
 * changed", so the rebuild archives the exact record under its operation id and removes the active
 * slot. The archive keeps the whole journal (steps, errors, planning-pause receipts) as evidence.
 *
 * The guard below is deliberately narrow: only a paused, preparation-only journal owned by the
 * job being superseded, with no unknown/running external call, no saved/partial prose and a
 * chapter fingerprint that still matches the contract the journal was opened for.
 */

const PREPARATION_KEYS = new Set<string>(PREPARATION_JOURNAL_STEP_KEYS);

export interface PreparationJournalRecordLike {
  version?: number;
  operationId?: string;
  status?: string;
  expiresAt?: number;
  request?: { entry?: string; workflowTaskId?: string } | null;
  expectedChapter?: { content?: string | null } | null;
  expectedFingerprint?: string | null;
  partialText?: string | null;
  steps?: Record<string, { status?: string; planningPause?: { outcome?: string } } | null> | null;
  values?: Record<string, unknown> | null;
  recoveryDecision?: { kind?: string } | null;
}

export type PreparationJournalRetirementPlan =
  | { retire: true }
  | { retire: false; reason: string };

export function planPreparationJournalRetirement(input: {
  journal: PreparationJournalRecordLike;
  expectedOperationId: string;
  taskId: string;
  now: number;
  /** Chapter fingerprint the journal was opened for; adoption runs it before changing the chapter. */
  expectedChapterFingerprint?: string | null;
}): PreparationJournalRetirementPlan {
  const { journal } = input;
  if (journal.operationId !== input.expectedOperationId) return { retire: false, reason: "operation_mismatch" };
  if (journal.status !== "paused") return { retire: false, reason: "not_paused" };
  if ((journal.expiresAt ?? 0) > input.now) return { retire: false, reason: "lease_active" };
  if (journal.request?.entry !== "pipeline") return { retire: false, reason: "not_pipeline_entry" };
  if (journal.request?.workflowTaskId !== input.taskId) return { retire: false, reason: "workflow_task_mismatch" };
  if ((journal.expectedChapter?.content ?? "").trim()) return { retire: false, reason: "expected_chapter_has_prose" };
  if ((journal.partialText ?? "").trim()) return { retire: false, reason: "partial_prose_present" };
  if (input.expectedChapterFingerprint !== undefined
    && input.expectedChapterFingerprint !== null
    && journal.expectedFingerprint !== input.expectedChapterFingerprint) {
    return { retire: false, reason: "chapter_contract_changed" };
  }
  const steps = journal.steps && typeof journal.steps === "object" ? journal.steps : {};
  const entries = Object.entries(steps);
  if (entries.length === 0) return { retire: false, reason: "no_preparation_steps" };
  for (const [key, step] of entries) {
    if (!PREPARATION_KEYS.has(key)) return { retire: false, reason: `non_preparation_step:${key}` };
    const status = step?.status;
    if (status === "unknown" || status === "running") return { retire: false, reason: "uncertain_step" };
    if (step?.planningPause?.outcome === "unknown") return { retire: false, reason: "uncertain_planning_pause" };
  }
  const values = journal.values && typeof journal.values === "object" ? journal.values : {};
  if (values["stream.started"] && !(steps["stream.normalize"]?.status === "done")) {
    return { retire: false, reason: "unfinished_stream" };
  }
  if (values["manual_repair.started"] && !values["manual_repair.content"]) {
    return { retire: false, reason: "unfinished_manual_repair" };
  }
  return { retire: true };
}

const slot = (novelId: string, chapterId: string, contentHash: string) => ({
  novelId,
  chapterId,
  contentHash,
  artifactType: "production_execution",
  syncMode: "journal",
});

export type PreparationJournalRetirementResult =
  | { status: "retired"; archiveContentHash: string }
  | { status: "none" }
  | { status: "blocked"; reason: string };

/**
 * Transaction-only helper. The caller owns the transaction and every surrounding CAS; this only
 * moves the active journal record to its archive slot and clears the active ownership row.
 */
export async function retirePreparationJournalIfSafe(
  tx: Prisma.TransactionClient,
  input: {
    novelId: string;
    chapterId: string;
    expectedOperationId: string;
    taskId: string;
    now: number;
    expectedChapterFingerprint?: string | null;
  },
): Promise<PreparationJournalRetirementResult> {
  const row = await tx.chapterArtifactSyncCheckpoint.findUnique({
    where: { novelId_chapterId_contentHash_artifactType_syncMode: slot(input.novelId, input.chapterId, "active") },
    select: { metadataJson: true, status: true },
  });
  if (!row?.metadataJson) return { status: "none" };
  let record: PreparationJournalRecordLike;
  try {
    record = JSON.parse(row.metadataJson) as PreparationJournalRecordLike;
  } catch {
    return { status: "blocked", reason: "journal_unreadable" };
  }
  const plan = planPreparationJournalRetirement({
    journal: record,
    expectedOperationId: input.expectedOperationId,
    taskId: input.taskId,
    now: input.now,
    expectedChapterFingerprint: input.expectedChapterFingerprint,
  });
  if (!plan.retire) return { status: "blocked", reason: plan.reason };
  const archiveContentHash = `${input.expectedOperationId}:superseded`;
  await tx.chapterArtifactSyncCheckpoint.upsert({
    where: { novelId_chapterId_contentHash_artifactType_syncMode: slot(input.novelId, input.chapterId, archiveContentHash) },
    create: {
      ...slot(input.novelId, input.chapterId, archiveContentHash),
      metadataJson: row.metadataJson,
      status: "paused",
    },
    update: {},
  });
  const removed = await tx.chapterArtifactSyncCheckpoint.deleteMany({
    where: slot(input.novelId, input.chapterId, "active"),
  });
  if (removed.count === 0) return { status: "none" };
  return { status: "retired", archiveContentHash };
}
