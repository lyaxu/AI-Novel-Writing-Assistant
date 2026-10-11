export interface ChapterProductionRecovery {
  operationId: string;
  status: "running" | "paused" | "completed";
  entry?: "stream" | "repair" | "pipeline" | null;
  leaseActive?: boolean;
  inputChanged?: boolean;
  canResume?: boolean;
  canAcknowledge?: boolean;
  resumeBlockedReason?: string;
  workflowTaskId?: string | null;
  pipelineJobId?: string | null;
  pipelineRange?: { startOrder: number; endOrder: number } | null;
  canResumePipeline?: boolean;
  partialText?: string;
  savedDraft?: string;
  error?: string;
  steps: Array<{ key: string; status: "running" | "done" | "failed" | "unknown"; error?: string }>;
}

export function recoveryScope(record: ChapterProductionRecovery): string {
  if (record.leaseActive) return "本章仍在执行，请刷新查看保留进度。";
  if (record.inputChanged) return "正文或写作约定有变化。请对照保留稿与当前正文，旧执行不会覆盖你的修改。";
  if (record.resumeBlockedReason) return record.resumeBlockedReason;
  if (record.steps.some((step) => step.status === "unknown" || step.status === "running")) {
    return "有调用结果尚未确认。先核对保留稿与调用记录；无法确认时，不会自动重新生成。";
  }
  if (record.status === "completed") return "本次操作完成；重新写作或修文需要明确发起新操作。";
  return "恢复沿用本次参数和完成步骤，只继续未完成部分。保留的正文不会因为恢复而先被清空。";
}

export function productionStepLabel(key: string): string {
  // These are labels for structured step identifiers, not story/intent routing.
  const group = key.split(".");
  if (group.includes("save") || group.includes("saveContent")) return "保存正文";
  if (group.includes("review") || group.includes("recheck") || group.includes("evaluate")) return "审查正文";
  if (group.includes("repair") || group.includes("candidate")) return "生成与复核修订稿";
  if (group.includes("commit") || group.includes("facts") || group.includes("timeline") || group.includes("sync")) return "提交故事状态与同步资料";
  if (group.includes("prepare") || group.includes("contract")) return "准备本章写作约定";
  if (group.includes("state") || group.includes("finalize")) return "保存完成状态";
  if (group.includes("stream") || group.includes("draft") || group.includes("normalize")) return "生成正文并保留输出";
  return "本章执行步骤";
}

export interface NewOperationPermit { previousOperationId: string; operationId: string }

export function recoveryInspectionVersion(record: ChapterProductionRecovery): string {
  return JSON.stringify([record.operationId, record.status, record.leaseActive, record.inputChanged, record.canAcknowledge,
    record.steps, record.savedDraft, record.partialText, record.pipelineJobId, record.canResumePipeline]);
}

/** Resume the original independent batch only after a fresh server inspection. */
export async function resumeInspectedPipeline(input: {
  inspected: ChapterProductionRecovery;
  latest: ChapterProductionRecovery | null;
  jobId: string;
  submit: (operationId: string) => Promise<unknown>;
}): Promise<void> {
  const record = input.latest;
  if (!record?.canResumePipeline || record.entry !== "pipeline" || record.workflowTaskId
    || record.leaseActive || record.inputChanged || record.canAcknowledge
    || record.pipelineJobId !== input.jobId
    || recoveryInspectionVersion(record) !== recoveryInspectionVersion(input.inspected)) {
    throw new Error("原批量任务的恢复条件有变化，请刷新保留进度后重新核对。");
  }
  await input.submit(record.operationId);
}

/** This action records a reviewed decision only; it never starts a model or parent task. */
export async function acknowledgeInspectedOperation(input: {
  inspected: ChapterProductionRecovery;
  latest: ChapterProductionRecovery | null;
  accepted: boolean;
  submit: (operationId: string) => Promise<unknown>;
}): Promise<void> {
  if (!input.accepted || !input.latest?.canAcknowledge || input.latest.leaseActive || input.latest.inputChanged
    || recoveryInspectionVersion(input.inspected) !== recoveryInspectionVersion(input.latest)) {
    throw new Error("核对内容或恢复条件有变化，请重新查看保留稿和调用记录。");
  }
  await input.submit(input.inspected.operationId);
}

export function resolveChapterOperation(record: ChapterProductionRecovery | null, permit?: NewOperationPermit): string | undefined {
  const operationId = consumeNewOperationPermit(record, permit);
  if (operationId) return operationId;
  if (record) {
    throw new Error(record.leaseActive
      ? "本章仍在执行。请在“稿件与恢复”查看进度。"
      : "请先在“稿件与恢复”核对保留内容。继续原操作请选择恢复；重新写作或修文请明确允许一次新操作。");
  }
  return undefined;
}

/** One explicit click permits one new request, never a polling/automatic retry. */
export function consumeNewOperationPermit(
  record: ChapterProductionRecovery | null,
  permit: NewOperationPermit | undefined,
): string | undefined {
  if (!permit) return undefined;
  if (!record || record.operationId !== permit.previousOperationId || record.leaseActive) {
    throw new Error("本章执行进度有变化，请刷新恢复区并重新核对。");
  }
  return permit.operationId;
}
