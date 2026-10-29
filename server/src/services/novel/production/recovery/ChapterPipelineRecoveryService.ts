import { ChapterProductionError, type createDefaultChapterProductionJournal } from "../reliability";

type Inspection = Awaited<ReturnType<ReturnType<typeof createDefaultChapterProductionJournal>["inspect"]>>;
export interface PipelineRecoveryJob {
  id: string; novelId: string; status: string; startOrder: number; endOrder: number;
  currentItemKey: string | null; pendingManualRecovery: boolean; cancelRequestedAt: Date | null;
  executionOwner: string | null; executionLeaseExpiresAt: Date | null; payload: string | null;
  updatedAt: Date;
}
export interface PipelineRecoveryExpectation { novelId: string; chapterId: string; updatedAt: Date; payload: string | null }
export type DirectorPipelineContinuationExpectation =
  | { kind: "completed"; novelId: string; chapterId: null; updatedAt: Date; payload: string | null }
  | ({ kind: "paused" } & PipelineRecoveryExpectation);
export interface DirectorPipelineRecoveryRequest { novelId: string; directorTaskId: string }
interface ExecutionScope { mode?: string; startOrder?: number; endOrder?: number; volumeOrder?: number }
/** A paused execution must finish its saved boundary before a new scope can replace it. */
export function assertUnchangedPipelineRecoveryScope(seed: { autoExecution?: ExecutionScope; directorInput?: { autoExecutionPlan?: ExecutionScope } }) {
  const previous = seed.autoExecution;
  const requested = seed.directorInput?.autoExecutionPlan;
  if (!previous || !requested) return;
  if (previous.mode !== requested.mode
    || (requested.mode === "chapter_range" && (previous.startOrder !== requested.startOrder || previous.endOrder !== requested.endOrder))
    || (requested.mode === "volume" && previous.volumeOrder !== requested.volumeOrder)) {
    throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "请先按原任务范围完成当前章节恢复，再调整后续写作范围。");
  }
}
interface RecoveryTarget { novelId: string; chapterId: string }
export interface PipelineRecoveryProjection {
  pipelineJobId?: string;
  pipelineRange?: { startOrder: number; endOrder: number };
  canResumePipeline: boolean;
}
export interface RecoveryChapterSnapshot {
  order: number;
  content?: string | null;
  generationState?: string | null;
  chapterStatus?: string | null;
}
/** Technical convergence of a job row whose target chapter is already factually complete. */
export interface CompletedPipelineJobExpectation {
  novelId: string;
  chapterId: string;
  /** The row's status at the moment the completed target was proven; CAS compares it. */
  jobStatus: string;
  updatedAt: Date;
  payload: string | null;
  completedAt: Date;
}
export interface ChapterPipelineRecoveryDeps {
  inspect: (target: RecoveryTarget) => Promise<Inspection>;
  findJob: (id: string) => Promise<PipelineRecoveryJob | null>;
  findChapter: (target: RecoveryTarget) => Promise<RecoveryChapterSnapshot | null>;
  resumeJob: (jobId: string, expected: PipelineRecoveryExpectation) => Promise<void>;
  /** Optional so read-only projections and older harnesses keep working without a write port. */
  completeJob?: (jobId: string, expected: CompletedPipelineJobExpectation) => Promise<void>;
  now?: () => number;
}

/** A source-page adapter for the existing job; never creates or resets a job. */
export class ChapterPipelineRecoveryService {
  constructor(private readonly deps: ChapterPipelineRecoveryDeps) {}

  private async loadJob(target: RecoveryTarget, inspection: NonNullable<Inspection>, workflowTaskId?: string): Promise<PipelineRecoveryJob | null> {
    if (inspection.entry !== "pipeline" || (inspection.workflowTaskId || undefined) !== workflowTaskId) return null;
    // Identity was assigned by the executor. Random historical operations cannot be attributed safely.
    const suffix = `:${target.chapterId}`;
    if (!inspection.operationId.startsWith("pipeline:") || !inspection.operationId.endsWith(suffix)) return null;
    const jobId = inspection.operationId.slice("pipeline:".length, -suffix.length);
    if (!jobId || jobId.includes(":")) return null;
    const [job, chapter] = await Promise.all([this.deps.findJob(jobId), this.deps.findChapter(target)]);
    if (!job || job.id !== jobId || job.novelId !== target.novelId || !chapter
      || chapter.order < job.startOrder || chapter.order > job.endOrder) return null;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(job.payload ?? "null");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    } catch { return null; }
    return (payload.workflowTaskId || undefined) === workflowTaskId ? job : null;
  }

  private projection(target: RecoveryTarget, inspection: NonNullable<Inspection>, job: PipelineRecoveryJob | null): PipelineRecoveryProjection {
    if (!job) return { canResumePipeline: false };
    const parentLeaseActive = Boolean(job.executionOwner && job.executionLeaseExpiresAt
      && job.executionLeaseExpiresAt.getTime() > (this.deps.now?.() ?? Date.now()));
    return {
      pipelineJobId: job.id, pipelineRange: { startOrder: job.startOrder, endOrder: job.endOrder },
      canResumePipeline: !inspection.leaseActive && !inspection.inputChanged && !inspection.canAcknowledge
        && !inspection.steps.some(step => step.status === "unknown")
        && inspection.status !== "completed" && ["queued", "running", "failed"].includes(job.status)
        && job.pendingManualRecovery && !job.cancelRequestedAt && !parentLeaseActive
        && job.currentItemKey === target.chapterId,
    };
  }

  async project(target: RecoveryTarget, inspection: NonNullable<Inspection>): Promise<PipelineRecoveryProjection> {
    return this.projection(target, inspection, await this.loadJob(target, inspection));
  }

  /** Read-only preflight, shared by command acceptance and execution; neither clears a pause. */
  async prepareDirector(jobId: string, request: DirectorPipelineRecoveryRequest): Promise<PipelineRecoveryExpectation> {
    const original = await this.deps.findJob(jobId);
    if (!original?.currentItemKey || original.novelId !== request.novelId || !request.directorTaskId) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "原章节任务缺少可核对的恢复位置，请查看保留稿。");
    }
    const target = { novelId: request.novelId, chapterId: original.currentItemKey };
    const inspection = await this.deps.inspect(target);
    const job = inspection ? await this.loadJob(target, inspection, request.directorTaskId) : null;
    if (!inspection || job?.id !== jobId || !this.projection(target, inspection, job).canResumePipeline) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "请先在章节源页核对原任务、保留稿和未确认的调用结果，再继续自动导演。");
    }
    return { ...target, updatedAt: job.updatedAt, payload: job.payload };
  }

  /** A completed chapter needs no journal resume; only its original director may continue. */
  async prepareDirectorContinuation(
    jobId: string,
    request: DirectorPipelineRecoveryRequest,
  ): Promise<DirectorPipelineContinuationExpectation> {
    const original = await this.deps.findJob(jobId);
    if (original?.status !== "succeeded") {
      return { kind: "paused", ...await this.prepareDirector(jobId, request) };
    }
    const leaseExpiry = original.executionLeaseExpiresAt?.getTime();
    const leaseActiveOrInvalid = Boolean(original.executionOwner
      && (leaseExpiry === undefined || !Number.isFinite(leaseExpiry) || leaseExpiry > (this.deps.now?.() ?? Date.now())));
    let payload: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(original.payload ?? "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch { /* Invalid stored ownership cannot authorize continuation. */ }
    if (!jobId.trim() || !request.novelId.trim() || !request.directorTaskId.trim()
      || original.id !== jobId || original.novelId !== request.novelId
      || payload?.workflowTaskId !== request.directorTaskId
      || original.currentItemKey !== null || original.pendingManualRecovery !== false
      || original.cancelRequestedAt !== null || leaseActiveOrInvalid) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "上一章任务的完成状态或所属导演记录已变化，请刷新本书工作区核对后继续。");
    }
    return {
      kind: "completed", novelId: original.novelId, chapterId: null,
      updatedAt: original.updatedAt, payload: original.payload,
    };
  }

  /**
   * Explicit continuation only: converge a stale paused range job whose target chapter is
   * already factually complete.
   *
   * A chapter can finish and save while the range job row keeps its earlier `failed` +
   * `pendingManualRecovery` projection. The chapter journal is the execution witness: when the
   * journal is `completed`, belongs to this exact job/chapter, shows no unknown or still-running
   * external step, and the chapter prose is saved and marked completed, the range job is stale
   * bookkeeping rather than an unfinished pause. The caller may then resume at the next chapter.
   *
   * Anything uncertain (unknown call, changed manuscript, active lease, incomplete chapter,
   * journal owned by another operation) returns null so the strict preflight keeps blocking.
   */
  async reconcileStaleCompletedChapterJob(
    jobId: string,
    request: DirectorPipelineRecoveryRequest,
  ): Promise<Extract<DirectorPipelineContinuationExpectation, { kind: "completed" }> | null> {
    if (!this.deps.completeJob) return null;
    const original = await this.deps.findJob(jobId);
    if (!original || original.id !== jobId || !original.currentItemKey
      || original.novelId !== request.novelId || !request.directorTaskId.trim()) return null;
    // Only a paused/stale row needs convergence; live jobs and terminal rows follow their own paths.
    if (!original.pendingManualRecovery || original.cancelRequestedAt
      || !["queued", "running", "failed"].includes(original.status)) return null;
    let payload: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(original.payload ?? "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch { return null; }
    if (payload?.workflowTaskId !== request.directorTaskId) return null;
    const now = this.deps.now?.() ?? Date.now();
    const leaseExpiry = original.executionLeaseExpiresAt?.getTime();
    if (original.executionOwner
      && (leaseExpiry === undefined || !Number.isFinite(leaseExpiry) || leaseExpiry > now)) return null;
    const target = { novelId: original.novelId, chapterId: original.currentItemKey };
    const chapter = await this.deps.findChapter(target);
    // Deletion is not completion: only a saved, explicitly completed chapter is factually done.
    if (!chapter || chapter.chapterStatus !== "completed" || !(chapter.content ?? "").trim()) return null;
    const inspection = await this.deps.inspect(target);
    if (!inspection || inspection.entry !== "pipeline"
      || inspection.workflowTaskId !== request.directorTaskId
      || inspection.operationId !== `pipeline:${jobId}:${target.chapterId}`
      || inspection.status !== "completed"
      || inspection.leaseActive || inspection.inputChanged || inspection.canAcknowledge
      || inspection.steps.some(step => step.status === "unknown" || step.status === "running")) return null;
    const completedAt = new Date(now);
    await this.deps.completeJob(jobId, {
      novelId: target.novelId, chapterId: target.chapterId, jobStatus: original.status,
      updatedAt: original.updatedAt, payload: original.payload, completedAt,
    });
    return { kind: "completed", novelId: target.novelId, chapterId: null, updatedAt: completedAt, payload: original.payload };
  }
  async resume(target: RecoveryTarget & { operationId: string }): Promise<{ jobId: string }> {
    const inspection = await this.deps.inspect(target);
    if (!inspection || inspection.operationId !== target.operationId) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节执行记录已变化，请刷新并核对原任务。");
    }
    const job = await this.loadJob(target, inspection);
    const projection = this.projection(target, inspection, job);
    if (!projection.canResumePipeline || !projection.pipelineJobId) {
      throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "该范围任务不能从此处恢复，请核对任务状态、保留稿和恢复位置。");
    }
    await this.deps.resumeJob(projection.pipelineJobId, {
      novelId: target.novelId, chapterId: target.chapterId, updatedAt: job!.updatedAt, payload: job!.payload,
    });
    return { jobId: projection.pipelineJobId };
  }
}
