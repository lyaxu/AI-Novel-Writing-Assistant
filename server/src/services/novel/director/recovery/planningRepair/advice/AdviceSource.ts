import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../../../../../middleware/errorHandler";
import { readPlanningRepairSeed } from "../planningRepairRecovery";
import { buildAdviceContext } from "./AdviceContext";

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const adviceHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export async function readAdviceSource(tx: Prisma.TransactionClient, taskId: string) {
  const row = await tx.novelWorkflowTask.findUnique({ where: { id: taskId } });
  if (!row || row.lane !== "auto_director" || !row.novelId) throw new AppError("自动导演任务不存在。", 404);
  const { seed, repair, recovery } = readPlanningRepairSeed(row.seedPayloadJson);
  if (!repair || repair.novelId !== row.novelId) throw new AppError("规划修复记录不存在或归属已变化。", 409);
  const novel = await tx.novel.findUnique({ where: { id: row.novelId } });
  if (!novel) throw new AppError("小说不存在。", 404);
  const volumes = await tx.volumePlan.findMany({ where: { novelId: row.novelId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { chapters: { orderBy: { chapterOrder: "asc" } } } });
  const versions = await tx.volumePlanVersion.findMany({ where: { novelId: row.novelId, OR: [{ status: "active" }, { id: { in: volumes.flatMap((v) => v.sourceVersionId ? [v.sourceVersionId] : []) } }] }, orderBy: [{ version: "asc" }] });
  const chapters = await tx.chapter.findMany({ where: { novelId: row.novelId }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  const macro = await tx.storyMacroPlan.findUnique({ where: { novelId: row.novelId } });
  const candidate = repair.candidateVersionId ? await tx.volumePlanVersion.findFirst({ where: { id: repair.candidateVersionId, novelId: row.novelId } }) : null;
  if (repair.candidateVersionId && !candidate) throw new AppError("修复候选版本不存在，请检查规划来源。", 409);
  const { creationExperience: _experience, updatedAt: _updatedAt, ...novelSource } = novel;
  const sourceToken = adviceHash({ novel: novelSource, volumes, versions, chapters, macro });
  const { planningRepairAdvice: _advice, planningRepairAdviceRequests: _requests,
    productionExperience: _productionExperience,
    autoExecution: _executionProgress, pipelineJobId: _pipelineJob, ...intentSeed } = seed;
  const snapshot = seed.planningRepairSnapshot as { eligibleChapterIds?: string[] } | undefined;
  const eligibleChapterIds = snapshot?.eligibleChapterIds;
  if (!Array.isArray(eligibleChapterIds) || !eligibleChapterIds.length) throw new AppError("修复窗口缺少可验证范围，请先检查规划来源。", 409);
  const fingerprint = adviceHash({ sourceToken, candidate, intentSeed, status: row.status, cancelled: row.cancelRequestedAt });
  const context = buildAdviceContext({ novel: novelSource, volumes, chapters, macro, candidate, seed: intentSeed, eligibleChapterIds });
  return { row, seed, repair, recovery, sourceToken, fingerprint, context, eligibleChapterIds };
}
export type AdviceSource = Awaited<ReturnType<typeof readAdviceSource>>;

export async function assertAdvicePaused(tx: Prisma.TransactionClient, source: AdviceSource) {
  const { row, repair, recovery } = source;
  if (!["waiting_approval", "failed"].includes(row.status) || row.cancelRequestedAt
    || !["waiting_confirmation", "uncertain", "technical_failed"].includes(repair.phase)) {
    throw new AppError("请在规划修复暂停后获取建议。", 409);
  }
  if (recovery?.pendingGrant || (recovery?.idempotencyKey && recovery.guidance
    && !["waiting_confirmation", "uncertain", "committed"].includes(repair.phase))) {
    throw new AppError("已有确认的修复方向，请继续该请求。", 409);
  }
  if (await tx.generationJob.findFirst({ where: { novelId: row.novelId!, status: { in: ["queued", "running"] } } })
    || await tx.directorRunCommand.findFirst({ where: { taskId: row.id, status: { in: ["queued", "leased", "running"] } } })) {
    throw new AppError("当前仍有生成请求，请等待结果后获取建议。", 409);
  }
}
