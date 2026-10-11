import { ChapterProductionError, type createDefaultChapterProductionJournal } from "../reliability";

type Inspection = Awaited<ReturnType<ReturnType<typeof createDefaultChapterProductionJournal>["inspect"]>>;
export interface PipelineRecoveryJob {
  id: string; novelId: string; status: string; startOrder: number; endOrder: number;
  currentItemKey: string | null; pendingManualRecovery: boolean; cancelRequestedAt: Date | null;
  executionOwner: string | null; executionLeaseExpiresAt: Date | null; payload: string | null;
  updatedAt: Date;
}
export interface PipelineRecoveryExpectation { novelId: string; chapterId: string; updatedAt: Date; payload: string | null }
interface RecoveryTarget { novelId: string; chapterId: string }
export interface PipelineRecoveryProjection {
  pipelineJobId?: string;
  pipelineRange?: { startOrder: number; endOrder: number };
  canResumePipeline: boolean;
}
export interface ChapterPipelineRecoveryDeps {
  inspect: (target: RecoveryTarget) => Promise<Inspection>;
  findJob: (id: string) => Promise<PipelineRecoveryJob | null>;
  findChapter: (target: RecoveryTarget) => Promise<{ order: number } | null>;
  resumeJob: (jobId: string, expected: PipelineRecoveryExpectation) => Promise<void>;
  now?: () => number;
}

/** A source-page adapter for the existing job; never creates or resets a job. */
export class ChapterPipelineRecoveryService {
  constructor(private readonly deps: ChapterPipelineRecoveryDeps) {}

  private async loadJob(target: RecoveryTarget, inspection: NonNullable<Inspection>): Promise<PipelineRecoveryJob | null> {
    if (inspection.entry !== "pipeline" || inspection.workflowTaskId) return null;
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
    return payload.workflowTaskId ? null : job;
  }

  private projection(target: RecoveryTarget, inspection: NonNullable<Inspection>, job: PipelineRecoveryJob | null): PipelineRecoveryProjection {
    if (!job) return { canResumePipeline: false };
    const parentLeaseActive = Boolean(job.executionOwner && job.executionLeaseExpiresAt
      && job.executionLeaseExpiresAt.getTime() > (this.deps.now?.() ?? Date.now()));
    return {
      pipelineJobId: job.id, pipelineRange: { startOrder: job.startOrder, endOrder: job.endOrder },
      canResumePipeline: !inspection.leaseActive && !inspection.inputChanged && !inspection.canAcknowledge
        && !inspection.steps.some(step => step.status === "unknown")
        && inspection.status !== "completed" && ["queued", "running"].includes(job.status)
        && job.pendingManualRecovery && !job.cancelRequestedAt && !parentLeaseActive
        && job.currentItemKey === target.chapterId,
    };
  }

  async project(target: RecoveryTarget, inspection: NonNullable<Inspection>): Promise<PipelineRecoveryProjection> {
    return this.projection(target, inspection, await this.loadJob(target, inspection));
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
