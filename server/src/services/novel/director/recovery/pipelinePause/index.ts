import { prisma } from "../../../../../db/prisma";
import { buildNovelEditResumeTarget } from "../../../workflow/novelWorkflow.shared";

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const parse = (json?: string | null): Data => { try { return object(JSON.parse(json || "{}")); } catch { return {}; } };
export interface PipelinePauseTask {
  id: string; novelId?: string | null; lane?: string; status: string; seedPayloadJson?: string | null;
  cancelRequestedAt?: unknown; pendingManualRecovery?: boolean; checkpointType?: string | null;
  checkpointSummary?: string | null; currentStage?: string | null; currentItemKey?: string | null;
  currentItemLabel?: string | null; lastError?: string | null; resumeTargetJson?: string | null;
}
export interface PipelinePauseJob {
  id: string; novelId: string; status: string; payload?: string | null; pendingManualRecovery?: boolean;
  executionOwner?: string | null; executionLeaseExpiresAt?: unknown; cancelRequestedAt?: unknown; error?: string | null;
}

/** Pure read projection: this result is never an update/CAS source or a resume authorization. */
export function projectPipelinePause<T extends PipelinePauseTask>(task: T, job: PipelinePauseJob | null,
  latestCommand: { status: string } | null): T {
  const seed = parse(task.seedPayloadJson);
  const auto = object(seed.autoExecution);
  if (task.lane !== "auto_director" || !task.novelId || !["queued", "running"].includes(task.status)
    || task.cancelRequestedAt || !job || auto.pipelineJobId !== job.id || job.novelId !== task.novelId
    || !["queued", "running"].includes(job.status) || !job.pendingManualRecovery
    || job.cancelRequestedAt || job.executionOwner || job.executionLeaseExpiresAt
    || (latestCommand && ["queued", "leased", "running"].includes(latestCommand.status))) return task;
  // Missing legacy ownership is not sufficient evidence to synthesize a recovery surface.
  if (parse(job.payload).workflowTaskId !== task.id) return task;
  const repair = object(seed.planningRepair); const recovery = object(seed.planningRepairRecovery);
  const action = object(repair.recoveryAction);
  const authorizedRepair = repair.novelId === task.novelId
    && ["assessing", "repairing", "reviewing", "ready"].includes(String(repair.phase))
    && !repair.pendingOperation && !recovery.pendingGrant && recovery.resumePhase === "chapter_execution"
    && typeof repair.key === "string" && Boolean(repair.key)
    && typeof action.requestId === "string" && Boolean(action.requestId)
    && action.requestId === recovery.idempotencyKey && repair.key === recovery.repairKey
    && typeof recovery.guidance === "string" && Boolean(recovery.guidance.trim());
  const summary = authorizedRepair ? "已确认的规划修复尚未进入复核，请回到节奏板继续已授权修复。"
    : task.checkpointSummary || job.error || task.lastError || "章节执行已暂停，请回到源工作区确认后继续。";
  const resumeTarget = authorizedRepair ? buildNovelEditResumeTarget({ novelId: task.novelId, taskId: task.id,
    stage: "structured", volumeId: typeof repair.volumeId === "string" ? repair.volumeId : undefined,
    chapterId: typeof repair.chapterId === "string" ? repair.chapterId : undefined }) : undefined;
  return { ...task, status: "waiting_approval", pendingManualRecovery: true,
    checkpointType: authorizedRepair ? "step_review_required" : task.checkpointType || "chapter_batch_ready",
    checkpointSummary: summary, currentItemLabel: summary,
    seedPayloadJson: JSON.stringify({ ...seed,
      directorSession: { ...object(seed.directorSession), isBackgroundRunning: false } }),
    ...(authorizedRepair ? { currentStage: "结构化大纲", currentItemKey: "planning_repair_confirmation",
      resumeTargetJson: JSON.stringify(resumeTarget), seedPayloadJson: JSON.stringify({ ...seed, resumeTarget,
        directorSession: { ...object(seed.directorSession), isBackgroundRunning: false } }) } : {}),
  };
}

export async function readPipelinePauseProjection<T extends PipelinePauseTask>(task: T,
  command?: { status: string } | null): Promise<T> {
  const jobId = object(parse(task.seedPayloadJson).autoExecution).pipelineJobId;
  if (task.lane !== "auto_director" || !["queued", "running"].includes(task.status)
    || task.cancelRequestedAt || typeof jobId !== "string" || !jobId) return task;
  const [job, latestCommand] = await Promise.all([
    prisma.generationJob.findUnique({ where: { id: jobId }, select: { id: true, novelId: true, payload: true,
      status: true, pendingManualRecovery: true, executionOwner: true, executionLeaseExpiresAt: true, cancelRequestedAt: true, error: true } }),
    command && ["queued", "leased", "running"].includes(command.status) ? Promise.resolve(command)
      : prisma.directorRunCommand.findFirst({ where: { taskId: task.id, status: { in: ["queued", "leased", "running"] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { status: true } }),
  ]);
  return projectPipelinePause(task, job, latestCommand);
}
