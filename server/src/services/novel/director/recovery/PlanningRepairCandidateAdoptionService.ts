import type { Prisma } from "@prisma/client";
import type { VolumePlanDocument, VolumeChapterPlan } from "@ai-novel/shared/types/novel";
import { assessChapterExecutionContractShape } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { prisma } from "../../../../db/prisma";
import { chapterFingerprint } from "../../production/reliability";
import { persistActiveVolumeWorkspace } from "../../volume/volumeWorkspacePersistence";
import { serializeVolumeWorkspaceDocument } from "../../volume/volumeWorkspaceDocument";
import { evaluateCandidateCapacity } from "../../volume/chapterDetail/chapterCapacityGate";
import { writtenSourceFingerprint } from "../../volume/writtenEvidence";
import { logPipelineInfo, logPipelineWarn } from "../../novelCoreShared";
import {
  PREPARATION_JOURNAL_STEP_KEYS,
  planPlanningRepairCandidateAdoption,
  type PlanningRepairCandidateAdoptionEvidence,
} from "./PlanningRepairCandidateAdoptionPlan";
import { retirePreparationJournalIfSafe } from "./PreparationJournalRetirement";

const ACTIVE_COMMAND_STATUSES = ["queued", "leased", "running"] as const;
const PREPARATION_KEYS = new Set<string>(PREPARATION_JOURNAL_STEP_KEYS);

type Seed = Record<string, unknown>;
type JournalRecord = Record<string, unknown>;

export interface CandidateAdoptionTaskRow {
  id: string;
  novelId: string | null;
  lane: string;
  status: string;
  pendingManualRecovery: boolean;
  cancelRequestedAt: Date | null;
  updatedAt: Date;
  seedPayloadJson: string | null;
}

export interface CandidateAdoptionChapterSnapshot {
  id: string;
  novelId: string;
  order: number;
  title: string;
  content: string | null;
  expectation: string | null;
  targetWordCount: number | null;
  conflictLevel: number | null;
  revealLevel: number | null;
  mustAvoid: string | null;
  taskSheet: string | null;
  sceneCards: string | null;
  hook: string | null;
  updatedAt: Date;
}

export interface CandidateAdoptionInspection {
  evidence: PlanningRepairCandidateAdoptionEvidence;
  seed: Seed;
  candidateDocument: VolumePlanDocument;
  candidateVersionId: string;
  volumeChapterId: string;
  targetChapter: CandidateAdoptionChapterSnapshot;
  expectedCandidateContentJson: string;
  now: number;
}

export interface CandidateAdoptionResult {
  changed: boolean;
  adopted: boolean;
  reason: string | null;
  versionId?: string;
  chapterId?: string;
  chapterOrder?: number;
}

export interface CandidateAdoptionDeps {
  inspect: (input: { task: CandidateAdoptionTaskRow; trigger: string }) => Promise<CandidateAdoptionInspection | { reason: string }>;
  apply: (input: {
    task: CandidateAdoptionTaskRow;
    inspection: CandidateAdoptionInspection;
    plan: Extract<ReturnType<typeof planPlanningRepairCandidateAdoption>, { action: "adopt" }>;
    trigger: string;
  }) => Promise<{ changed: boolean; reason?: string }>;
  logInfo?: (message: string, meta?: Record<string, unknown>) => void;
  logWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

function record(value: unknown): value is Seed {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSeed(json: string | null | undefined): Seed | null {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJson(json: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json || "null");
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRepair(seed: Seed): {
  phase: string;
  candidateVersionId: string | null;
  chapterId: string | null;
  volumeId: string | null;
  chapterOrder: number | null;
  pendingWork: boolean;
} | null {
  const repair = seed.planningRepair;
  if (!record(repair) || repair.version !== 1 || typeof repair.key !== "string"
    || typeof repair.phase !== "string" || !Array.isArray(repair.history)) return null;
  const recovery = record(seed.planningRepairRecovery) ? seed.planningRepairRecovery : null;
  const recoveryAction = record(repair.recoveryAction) ? repair.recoveryAction : null;
  return {
    phase: repair.phase,
    candidateVersionId: typeof repair.candidateVersionId === "string" ? repair.candidateVersionId : null,
    chapterId: typeof repair.chapterId === "string" ? repair.chapterId : null,
    volumeId: typeof repair.volumeId === "string" ? repair.volumeId : null,
    chapterOrder: typeof repair.chapterOrder === "number" ? repair.chapterOrder : null,
    pendingWork: Boolean(repair.pendingOperation || repair.repairOutputPending || recoveryAction || recovery?.pendingGrant),
  };
}

function readExecutionRange(autoExecution: Seed | null): { startOrder: number; endOrder: number } | null {
  if (!autoExecution || autoExecution.enabled !== true || autoExecution.mode !== "chapter_range") return null;
  const startOrder = typeof autoExecution.startOrder === "number" ? autoExecution.startOrder : Number.NaN;
  const endOrder = typeof autoExecution.endOrder === "number" ? autoExecution.endOrder : Number.NaN;
  return Number.isSafeInteger(startOrder) && Number.isSafeInteger(endOrder) && startOrder >= 1 && endOrder >= startOrder
    ? { startOrder, endOrder }
    : null;
}

function readPayloadWorkflowTaskId(payload: string | null): string | null {
  const parsed = parseJson(payload);
  return parsed && typeof parsed.workflowTaskId === "string" ? parsed.workflowTaskId : null;
}

function liveLease(owner: string | null, expires: Date | null, now: number): boolean {
  if (!owner) return false;
  const expiry = expires?.getTime();
  return expiry === undefined || !Number.isFinite(expiry) || expiry > now;
}

function hasUncertainStep(journal: JournalRecord): boolean {
  const steps = record(journal.steps) ? journal.steps : {};
  return Object.values(steps).some(step => record(step) && (step.status === "unknown" || step.status === "running"))
    || Object.values(steps).some(step => record(step) && record(step.planningPause) && step.planningPause.outcome === "unknown")
    || Boolean(record(journal.values) && journal.values["stream.started"]
      && !(record(steps["stream.normalize"]) && steps["stream.normalize"].status === "done"))
    || Boolean(record(journal.values) && journal.values["manual_repair.started"] && !journal.values["manual_repair.content"]);
}

function hasWorkBeyondPreparation(journal: JournalRecord): boolean {
  const steps = record(journal.steps) ? journal.steps : {};
  return Object.keys(steps).some(key => !PREPARATION_KEYS.has(key));
}

function readCandidateChapter(
  document: VolumePlanDocument,
  volumeId: string,
  volumeChapterId: string,
): { volume: VolumePlanDocument["volumes"][number]; chapter: VolumeChapterPlan } | null {
  const volume = document.volumes.find(candidate => candidate.id === volumeId);
  if (!volume) return null;
  const chapter = volume.chapters.find(candidate => candidate.id === volumeChapterId);
  return chapter ? { volume, chapter } : null;
}

function candidateContractUsable(novelId: string, volumeId: string, chapter: VolumeChapterPlan): boolean {
  if (!chapter.taskSheet?.trim() || !chapter.sceneCards?.trim()) return false;
  const shape = assessChapterExecutionContractShape({
    novelId,
    volumeId,
    chapterId: chapter.id,
    chapterOrder: chapter.chapterOrder,
    title: chapter.title,
    summary: chapter.summary,
    purpose: chapter.purpose,
    exclusiveEvent: chapter.exclusiveEvent,
    endingState: chapter.endingState,
    nextChapterEntryState: chapter.nextChapterEntryState,
    conflictLevel: chapter.conflictLevel,
    revealLevel: chapter.revealLevel,
    targetWordCount: chapter.targetWordCount,
    mustAvoid: chapter.mustAvoid,
    payoffRefs: chapter.payoffRefs,
    taskSheet: chapter.taskSheet,
    sceneCards: chapter.sceneCards,
  });
  if (!shape.canEnterExecution) return false;
  const capacity = evaluateCandidateCapacity({
    targetWordCount: chapter.targetWordCount,
    exclusiveEvent: chapter.exclusiveEvent,
    sceneCards: chapter.sceneCards,
  }, { allowDeferable: true });
  return !(capacity.capacityPlanPresent && !capacity.passed);
}

const CHAPTER_SNAPSHOT_SELECT = {
  id: true, novelId: true, order: true, title: true, content: true, expectation: true, targetWordCount: true,
  conflictLevel: true, revealLevel: true, mustAvoid: true, taskSheet: true, sceneCards: true, hook: true, updatedAt: true,
} as const;

/**
 * Adopts a saved draft `VolumePlanVersion` candidate of a terminal planning repair into the real
 * workspace and materialized chapter, so the chapter execution rebuild starts from the existing
 * plan instead of regenerating it.
 *
 * The default `apply` is one serializable transaction: it re-reads and CAS-checks the task seed,
 * candidate draft, chapter row, old job and journal ownership before moving the exact journal to
 * its archive slot, activating the candidate version, persisting the volume workspace and writing
 * the chapter contract. The repair phase itself stays `abandoned` (the session was given up); a
 * `planningRepairCandidateAdoption` receipt records which candidate was adopted and why.
 */
export class PlanningRepairCandidateAdoptionService {
  constructor(private readonly deps: CandidateAdoptionDeps) {}

  async adopt(input: { task: CandidateAdoptionTaskRow; trigger: string }): Promise<CandidateAdoptionResult> {
    if (input.task.lane !== "auto_director" || input.task.cancelRequestedAt) {
      return { changed: false, adopted: false, reason: "task_unavailable" };
    }
    let inspection: CandidateAdoptionInspection | { reason: string };
    try {
      inspection = await this.deps.inspect(input);
    } catch (error) {
      (this.deps.logWarn ?? logPipelineWarn)("规划修复候选采纳预检失败，保留原暂停。", {
        taskId: input.task.id, trigger: input.trigger,
        error: error instanceof Error ? error.message : String(error),
      });
      return { changed: false, adopted: false, reason: "inspection_failed" };
    }
    if ("reason" in inspection) return { changed: false, adopted: false, reason: inspection.reason };
    const plan = planPlanningRepairCandidateAdoption(inspection.evidence);
    if (plan.action === "none") return { changed: false, adopted: false, reason: plan.reason };
    try {
      const applied = await this.deps.apply({ task: input.task, inspection, plan, trigger: input.trigger });
      if (!applied.changed) return { changed: false, adopted: false, reason: applied.reason ?? "adoption_not_applied" };
      (this.deps.logInfo ?? logPipelineInfo)("规划修复终止后已采纳保存的候选规划，不重新生成候选。", {
        taskId: input.task.id,
        trigger: input.trigger,
        action: "adopted_planning_repair_candidate",
        versionId: inspection.candidateVersionId,
        chapterId: plan.chapterId,
        chapterOrder: plan.chapterOrder,
        oldJobId: inspection.evidence.pipelineJobId,
      });
      return {
        changed: true,
        adopted: true,
        reason: null,
        versionId: inspection.candidateVersionId,
        chapterId: plan.chapterId,
        chapterOrder: plan.chapterOrder,
      };
    } catch (error) {
      (this.deps.logWarn ?? logPipelineWarn)("规划修复候选采纳写入未应用，保留原暂停。", {
        taskId: input.task.id, trigger: input.trigger,
        versionId: inspection.candidateVersionId, chapterId: plan.chapterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { changed: false, adopted: false, reason: "adoption_write_failed" };
    }
  }
}

async function inspectDefault(input: { task: CandidateAdoptionTaskRow; trigger: string }): Promise<CandidateAdoptionInspection | { reason: string }> {
  const task = input.task;
  if (!task.novelId) return { reason: "task_without_novel" };
  const seed = parseSeed(task.seedPayloadJson);
  if (!seed) return { reason: "seed_unreadable" };
  const repair = readRepair(seed);
  if (!repair) return { reason: "no_planning_repair" };
  const autoExecution = record(seed.autoExecution) ? seed.autoExecution : null;
  const pipelineJobId = typeof autoExecution?.pipelineJobId === "string" && autoExecution.pipelineJobId.trim()
    ? autoExecution.pipelineJobId.trim()
    : null;
  const now = Date.now();
  const [job, activeJobCount, activeCommandCount] = await Promise.all([
    pipelineJobId
      ? prisma.generationJob.findUnique({
        where: { id: pipelineJobId },
        select: {
          id: true, novelId: true, status: true, pendingManualRecovery: true, currentItemKey: true,
          payload: true, cancelRequestedAt: true, executionOwner: true, executionLeaseExpiresAt: true,
        },
      })
      : Promise.resolve(null),
    prisma.generationJob.count({ where: { novelId: task.novelId, status: { in: ["queued", "running"] } } }),
    prisma.directorRunCommand.count({ where: { taskId: task.id, status: { in: [...ACTIVE_COMMAND_STATUSES] } } }),
  ]);
  const executionRange = readExecutionRange(autoExecution);
  const volumeChapter = repair.chapterId
    ? await prisma.volumeChapterPlan.findUnique({
      where: { id: repair.chapterId },
      select: { id: true, volumeId: true, chapterId: true, chapterOrder: true },
    })
    : null;
  if (!volumeChapter || !repair.volumeId || typeof repair.chapterOrder !== "number"
    || volumeChapter.volumeId !== repair.volumeId
    || volumeChapter.chapterOrder !== repair.chapterOrder) {
    return { reason: "repair_chapter_mapping_missing" };
  }
  const chapterOrder = repair.chapterOrder;
  const chapter = await prisma.chapter.findFirst({
    where: { novelId: task.novelId, order: chapterOrder },
    select: CHAPTER_SNAPSHOT_SELECT,
  });
  if (!chapter || (volumeChapter.chapterId && volumeChapter.chapterId !== chapter.id)) {
    return { reason: "materialized_chapter_missing" };
  }
  const savedNextChapterId = typeof autoExecution?.nextChapterId === "string" ? autoExecution.nextChapterId : null;
  const savedNextChapterOrder = typeof autoExecution?.nextChapterOrder === "number" ? autoExecution.nextChapterOrder : null;
  if ((savedNextChapterId && savedNextChapterId !== chapter.id)
    || (savedNextChapterOrder !== null && savedNextChapterOrder !== chapter.order)) {
    return { reason: "next_chapter_pointer_mismatch" };
  }
  const chapters = await prisma.chapter.findMany({
    where: { novelId: task.novelId, order: { lt: chapter.order } },
    select: { id: true, order: true, title: true, content: true },
  });
  const currentWrittenFingerprint = writtenSourceFingerprint(chapters, chapter.order);
  const snapshot = record(seed.planningRepairSnapshot) ? seed.planningRepairSnapshot : null;
  const savedWrittenFingerprint = typeof snapshot?.writtenSourceFingerprint === "string"
    ? snapshot.writtenSourceFingerprint
    : null;
  const writtenSourceUnchanged = savedWrittenFingerprint === null || savedWrittenFingerprint === currentWrittenFingerprint;

  const candidateVersionId = repair.candidateVersionId;
  const version = candidateVersionId
    ? await prisma.volumePlanVersion.findFirst({
      where: { id: candidateVersionId, novelId: task.novelId },
      select: { id: true, novelId: true, status: true, contentJson: true },
    })
    : null;
  let candidateDocument: VolumePlanDocument | null = null;
  let candidateChapter: VolumeChapterPlan | null = null;
  if (version) {
    try {
      candidateDocument = JSON.parse(version.contentJson) as VolumePlanDocument;
    } catch {
      candidateDocument = null;
    }
  }
  if (candidateDocument && repair.volumeId) {
    candidateChapter = readCandidateChapter(candidateDocument, repair.volumeId, volumeChapter.id)?.chapter ?? null;
  }
  const journalRow = await prisma.chapterArtifactSyncCheckpoint.findUnique({
    where: {
      novelId_chapterId_contentHash_artifactType_syncMode: {
        novelId: task.novelId,
        chapterId: chapter.id,
        contentHash: "active",
        artifactType: "production_execution",
        syncMode: "journal",
      },
    },
    select: { metadataJson: true },
  });
  const journal = parseJson(journalRow?.metadataJson);
  const journalEvidence = journal ? {
    status: typeof journal.status === "string" ? journal.status : "",
    hasUncertainStep: hasUncertainStep(journal),
    hasWorkBeyondPreparation: hasWorkBeyondPreparation(journal),
    belongsToPreviousJob: Boolean(job && typeof journal.operationId === "string"
      && journal.operationId === `pipeline:${job.id}:${chapter.id}`),
  } : null;
  const jobEvidence = job ? {
    id: job.id,
    novelId: job.novelId,
    status: job.status,
    pendingManualRecovery: job.pendingManualRecovery,
    currentItemKey: job.currentItemKey,
    payloadWorkflowTaskId: readPayloadWorkflowTaskId(job.payload),
    leaseActive: liveLease(job.executionOwner, job.executionLeaseExpiresAt, now),
    cancelRequestedAt: job.cancelRequestedAt,
  } : null;
  const candidateEvidence = version ? {
    versionId: version.id,
    status: version.status,
    volumeMatches: Boolean(candidateDocument && repair.volumeId
      && candidateDocument.volumes.some(candidate => candidate.id === repair.volumeId)),
    volumeChapterId: candidateChapter?.id ?? null,
    chapterExists: Boolean(candidateChapter),
    chapterOrder: candidateChapter?.chapterOrder ?? null,
    contractUsable: Boolean(candidateChapter && candidateContractUsable(task.novelId, repair.volumeId!, candidateChapter)),
  } : null;
  const evidence: PlanningRepairCandidateAdoptionEvidence = {
    taskId: task.id,
    novelId: task.novelId,
    taskPaused: task.pendingManualRecovery || task.status === "waiting_approval" || task.status === "failed"
      || task.status === "running",
    cancelRequested: Boolean(task.cancelRequestedAt) || task.status === "cancelled",
    activeCommand: activeCommandCount > 0,
    activeJobInNovel: activeJobCount > 0,
    repairPhase: repair.phase,
    repairPendingWork: repair.pendingWork,
    candidateVersionId,
    executionRange,
    pipelineJobId,
    job: jobEvidence,
    targetChapter: {
      id: chapter.id,
      order: chapter.order,
      hasProse: Boolean((chapter.content ?? "").trim()),
      hasPlan: Boolean(chapter.taskSheet?.trim() && chapter.sceneCards?.trim()),
    },
    candidate: candidateEvidence,
    journal: journalEvidence,
    writtenSourceUnchanged,
  };
  if (!candidateDocument || !candidateChapter) {
    // Still return the inspection so the pure planner can report the precise reason.
    candidateDocument = candidateDocument
      ?? ({ novelId: task.novelId, workspaceVersion: "v2", volumes: [] } as unknown as VolumePlanDocument);
  }
  return {
    evidence,
    seed,
    candidateDocument,
    candidateVersionId: candidateVersionId ?? "",
    volumeChapterId: volumeChapter.id,
    targetChapter: chapter,
    expectedCandidateContentJson: version?.contentJson ?? "",
    now,
  };
}

function chapterContractData(candidate: VolumeChapterPlan) {
  return {
    expectation: candidate.summary?.trim() || candidate.exclusiveEvent?.trim() || null,
    targetWordCount: candidate.targetWordCount ?? null,
    conflictLevel: candidate.conflictLevel ?? null,
    revealLevel: candidate.revealLevel ?? null,
    mustAvoid: candidate.mustAvoid ?? null,
    taskSheet: candidate.taskSheet?.trim() || null,
    sceneCards: candidate.sceneCards ?? null,
  };
}

async function applyDefault(input: {
  task: CandidateAdoptionTaskRow;
  inspection: CandidateAdoptionInspection;
  plan: Extract<ReturnType<typeof planPlanningRepairCandidateAdoption>, { action: "adopt" }>;
  trigger: string;
}): Promise<{ changed: boolean; reason?: string }> {
  const { task, inspection, plan, trigger } = input;
  const expectedChapter = inspection.targetChapter;
  const now = new Date(inspection.now);
  const transaction = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const freshTask = await tx.novelWorkflowTask.findUnique({ where: { id: task.id } });
    if (!freshTask || freshTask.novelId !== task.novelId || freshTask.lane !== "auto_director"
      || freshTask.updatedAt.getTime() !== task.updatedAt.getTime()
      || freshTask.seedPayloadJson !== task.seedPayloadJson
      || freshTask.status !== task.status
      || freshTask.pendingManualRecovery !== task.pendingManualRecovery
      || freshTask.cancelRequestedAt) return { changed: false as const, reason: "task_changed" };
    const freshSeed = parseSeed(freshTask.seedPayloadJson);
    if (!freshSeed) return { changed: false as const, reason: "seed_unreadable" };
    const repair = readRepair(freshSeed);
    if (!repair || repair.candidateVersionId !== inspection.candidateVersionId
      || repair.chapterId !== inspection.volumeChapterId || repair.pendingWork) {
      return { changed: false as const, reason: "repair_changed" };
    }
    const version = await tx.volumePlanVersion.findFirst({
      where: { id: inspection.candidateVersionId, novelId: task.novelId!, status: "draft" },
      select: { id: true, contentJson: true },
    });
    if (!version || version.contentJson !== inspection.expectedCandidateContentJson) {
      return { changed: false as const, reason: "candidate_changed" };
    }
    let candidateDocument: VolumePlanDocument;
    try {
      candidateDocument = JSON.parse(version.contentJson) as VolumePlanDocument;
    } catch {
      return { changed: false as const, reason: "candidate_unreadable" };
    }
    const candidateChapter = readCandidateChapter(candidateDocument, repair.volumeId ?? "", plan.volumeChapterId)?.chapter;
    if (!candidateChapter || !candidateContractUsable(task.novelId!, repair.volumeId ?? "", candidateChapter)) {
      return { changed: false as const, reason: "candidate_contract_unusable" };
    }
    const chapter = await tx.chapter.findFirst({
      where: { id: expectedChapter.id, novelId: task.novelId!, order: expectedChapter.order },
      select: {
        id: true, novelId: true, order: true, title: true, content: true, expectation: true, targetWordCount: true,
        conflictLevel: true, revealLevel: true, mustAvoid: true, taskSheet: true, sceneCards: true, hook: true, updatedAt: true,
      },
    });
    if (!chapter || chapter.updatedAt.getTime() !== expectedChapter.updatedAt.getTime()
      || chapter.content !== expectedChapter.content
      || chapter.taskSheet !== expectedChapter.taskSheet
      || chapter.sceneCards !== expectedChapter.sceneCards
      || (chapter.content ?? "").trim()
      || (chapter.taskSheet ?? "").trim() || (chapter.sceneCards ?? "").trim()) {
      return { changed: false as const, reason: "chapter_changed" };
    }
    const job = await tx.generationJob.findUnique({
      where: { id: inspection.evidence.pipelineJobId ?? "" },
      select: {
        id: true, novelId: true, status: true, pendingManualRecovery: true, currentItemKey: true, payload: true,
        cancelRequestedAt: true, executionOwner: true, executionLeaseExpiresAt: true,
      },
    });
    if (!job || job.novelId !== task.novelId || job.status !== "failed" || job.currentItemKey
      || job.cancelRequestedAt || liveLease(job.executionOwner, job.executionLeaseExpiresAt, inspection.now)
      || readPayloadWorkflowTaskId(job.payload) !== task.id) {
      return { changed: false as const, reason: "job_changed" };
    }
    if ((await tx.generationJob.count({
      where: { novelId: task.novelId!, status: { in: ["queued", "running"] } },
    })) > 0) return { changed: false as const, reason: "active_job" };
    if ((await tx.directorRunCommand.count({
      where: { taskId: task.id, status: { in: [...ACTIVE_COMMAND_STATUSES] } },
    })) > 0) return { changed: false as const, reason: "active_command" };
    const journalRetirement = await retirePreparationJournalIfSafe(tx, {
      novelId: task.novelId!,
      chapterId: chapter.id,
      expectedOperationId: `pipeline:${job.id}:${chapter.id}`,
      taskId: task.id,
      now: inspection.now,
      expectedChapterFingerprint: chapterFingerprint({
        id: chapter.id, novelId: chapter.novelId, content: chapter.content, title: chapter.title,
        taskSheet: chapter.taskSheet, sceneCards: chapter.sceneCards, expectation: chapter.expectation,
        targetWordCount: chapter.targetWordCount, mustAvoid: chapter.mustAvoid,
        conflictLevel: chapter.conflictLevel, revealLevel: chapter.revealLevel, hook: chapter.hook,
      }),
    });
    if (journalRetirement.status === "blocked") {
      return { changed: false as const, reason: `journal_${journalRetirement.reason}` };
    }
    const chapterChanged = await tx.chapter.updateMany({
      where: {
        id: chapter.id,
        novelId: chapter.novelId,
        order: chapter.order,
        updatedAt: chapter.updatedAt,
        content: chapter.content,
        taskSheet: chapter.taskSheet,
        sceneCards: chapter.sceneCards,
      },
      data: chapterContractData(candidateChapter),
    });
    if (chapterChanged.count !== 1) return { changed: false as const, reason: "chapter_changed_during_apply" };
    const finalDocument: VolumePlanDocument = {
      ...candidateDocument,
      source: "volume",
      activeVersionId: plan.versionId,
    };
    await tx.volumePlanVersion.updateMany({
      where: { novelId: task.novelId!, status: "active" },
      data: { status: "frozen" },
    });
    const activated = await tx.volumePlanVersion.updateMany({
      where: { id: plan.versionId, novelId: task.novelId!, status: "draft" },
      data: {
        status: "active",
        contentJson: serializeVolumeWorkspaceDocument(finalDocument),
      },
    });
    if (activated.count !== 1) return { changed: false as const, reason: "candidate_changed_during_apply" };
    await persistActiveVolumeWorkspace(tx, task.novelId!, finalDocument, plan.versionId);
    const nextSeed: Seed = {
      ...freshSeed,
      planningRepair: {
        ...(record(freshSeed.planningRepair) ? freshSeed.planningRepair : {}),
        candidateVersionId: plan.versionId,
      },
      planningRepairCandidateAdoption: {
        version: 1,
        candidateVersionId: plan.versionId,
        repairKey: typeof (record(freshSeed.planningRepair) ? freshSeed.planningRepair.key : null) === "string"
          ? (freshSeed.planningRepair as Seed).key
          : null,
        volumeId: repair.volumeId,
        volumeChapterId: plan.volumeChapterId,
        chapterId: plan.chapterId,
        chapterOrder: plan.chapterOrder,
        adoptedAt: now.toISOString(),
        trigger,
        source: "terminal_planning_repair_candidate",
        writtenSourceFingerprint: record(freshSeed.planningRepairSnapshot)
          ? (freshSeed.planningRepairSnapshot as Seed).writtenSourceFingerprint ?? null
          : null,
      },
    };
    delete nextSeed.planningRepairRecovery;
    delete nextSeed.planningRepairPipelineRecovery;
    const updatedTask = await tx.novelWorkflowTask.updateMany({
      where: {
        id: task.id,
        updatedAt: task.updatedAt,
        seedPayloadJson: task.seedPayloadJson,
        status: task.status,
        pendingManualRecovery: task.pendingManualRecovery,
        cancelRequestedAt: null,
      },
      data: { seedPayloadJson: JSON.stringify(nextSeed), heartbeatAt: now },
    });
    if (updatedTask.count !== 1) return { changed: false as const, reason: "task_changed_during_apply" };
    return { changed: true as const };
  }, { isolationLevel: "Serializable", timeout: 20_000 });
  return transaction;
}

function defaultDeps(): CandidateAdoptionDeps {
  return {
    inspect: inspectDefault,
    apply: applyDefault,
    logInfo: logPipelineInfo,
    logWarn: logPipelineWarn,
  };
}

export function createPlanningRepairCandidateAdoptionService(
  overrides: Partial<CandidateAdoptionDeps> = {},
): PlanningRepairCandidateAdoptionService {
  const deps = { ...defaultDeps(), ...overrides };
  return new PlanningRepairCandidateAdoptionService({
    inspect: overrides.inspect ?? deps.inspect,
    apply: overrides.apply ?? deps.apply,
    logInfo: overrides.logInfo ?? deps.logInfo,
    logWarn: overrides.logWarn ?? deps.logWarn,
  });
}
