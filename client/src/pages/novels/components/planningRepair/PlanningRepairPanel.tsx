import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Pause, RefreshCw } from "lucide-react";
import {
  actOnPlanningRepair, getNovelPlanningRepairStatus, getPlanningRepairStatus,
  novelPlanningRepairQueryKey, planningRepairQueryKey, type PlanningRepairStatus,
} from "@/api/planningRepair";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { planningRepairHistory, planningRepairIssues } from "./planningRepairPresentation";

const PHASE_LABELS: Record<NonNullable<PlanningRepairStatus["planningRepair"]>["phase"], string> = {
  assessing: "检查章节计划", repairing: "修复章节计划", reviewing: "复核质量", ready: "等待保存候选方案",
  committed: "修复方案已保存", waiting_confirmation: "等待修复方向", uncertain: "需要确认修复方向", technical_failed: "修复暂时中断",
};

function RepairActions({ status }: { status: PlanningRepairStatus }) {
  const repair = status.planningRepair!;
  const [guidance, setGuidance] = useState(status.recoveryRequest?.guidance ?? "");
  const [paused, setPaused] = useState(false);
  const request = useRef<{ guidance: string; key: string } | null>(status.recoveryRequest
    ? { guidance: status.recoveryRequest.guidance, key: status.recoveryRequest.idempotencyKey } : null);
  const inputId = useId();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (action: "retry" | "pause") => {
      if (action === "pause") return actOnPlanningRepair(status.taskId, { action, repairKey: repair.key });
      const trimmed = guidance.trim();
      if (!request.current || request.current.guidance !== trimmed) request.current = { guidance: trimmed, key: crypto.randomUUID() };
      return actOnPlanningRepair(status.taskId, { action, repairKey: repair.key, guidance: trimmed, idempotencyKey: request.current.key });
    },
    onSuccess: async (_, action) => {
      setPaused(action === "pause");
      await client.invalidateQueries({ queryKey: ["planning-repair"] });
      await client.invalidateQueries({ queryKey: ["tasks"] });
      if (status.novelId) {
        await client.invalidateQueries({ queryKey: queryKeys.novels.autoDirectorTask(status.novelId) });
        await client.invalidateQueries({ queryKey: queryKeys.novels.volumeWorkspace(status.novelId) });
      }
    },
  });
  return <div className="space-y-3">
    <label htmlFor={inputId} className="block text-sm font-medium">修复方向</label>
    <textarea id={inputId} value={guidance} onChange={(event) => setGuidance(event.target.value)} maxLength={4000}
      disabled={mutation.isPending || Boolean(status.recoveryRequest)} placeholder="说明希望保留的情节、需要调整的章节分工或其他限制"
      className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!guidance.trim() || mutation.isPending} onClick={() => {
        if (!status.recoveryRequest && !window.confirm("追加一轮规划修复将产生模型调用费用，并按填写的方向重新修复和复核。是否确认？")) return;
        mutation.mutate("retry");
      }}>
        <RefreshCw className="mr-2 h-4 w-4" />{mutation.isPending && mutation.variables === "retry" ? "正在提交…" : status.recoveryRequest ? "继续已授权修复" : "追加一轮修复"}
      </Button>
      <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate("pause")}>
        <Pause className="mr-2 h-4 w-4" />保持暂停
      </Button>
    </div>
    {paused ? <p role="status" className="text-sm text-muted-foreground">任务保持暂停，已有内容和候选方案保留。</p> : null}
    {mutation.isError ? <p role="alert" className="break-words text-sm text-destructive">{mutation.error instanceof Error ? mutation.error.message : "提交失败，请重试。"}</p> : null}
  </div>;
}

export default function PlanningRepairPanel({ novelId }: { novelId: string }) {
  const [params] = useSearchParams();
  const taskId = params.get("directorTaskId")?.trim() ?? "";
  const query = useQuery({
    queryKey: taskId ? planningRepairQueryKey(taskId) : novelPlanningRepairQueryKey(novelId),
    queryFn: () => taskId ? getPlanningRepairStatus(taskId) : getNovelPlanningRepairStatus(novelId),
    enabled: Boolean(novelId), retry: false, refetchInterval: 4000,
  });
  const status = query.data;
  const repair = status?.novelId === novelId ? status.planningRepair : null;
  if (!status || !repair) return query.isError && taskId ? <p role="alert" className="text-sm text-destructive">无法读取规划修复状态，请刷新后重试。</p> : null;
  const canAct = (["waiting_confirmation", "uncertain", "technical_failed"].includes(repair.phase) || Boolean(repair.pendingOperation) || Boolean(status.recoveryRequest))
    && ["waiting_approval", "failed"].includes(status.status);
  const history = planningRepairHistory(repair.history);
  const issues = planningRepairIssues(repair.quality);
  return <section aria-label="章节规划修复" className="space-y-3 rounded-md bg-amber-50/60 p-4 dark:bg-amber-950/20">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">章节规划修复</h3>
      <span className="text-sm">{PHASE_LABELS[repair.phase]} · {repair.rounds}/{repair.maxRounds ?? 2} 轮</span>
    </div>
    <p className="break-words text-sm">{repair.summary}</p>
    {repair.technicalError ? <p role="alert" className="break-words text-sm text-destructive">{repair.technicalError}</p> : null}
    <p className="text-xs text-muted-foreground">起始章：第 {repair.chapterOrder} 章{repair.affectedChapterIds?.length ? ` · 涉及 ${repair.affectedChapterIds.length} 章` : ""}</p>
    {issues.length ? <ul aria-label="待处理问题" className="list-disc space-y-1 pl-5 text-sm">
      {issues.map((issue) => <li key={issue} className="break-words">{issue}</li>)}
    </ul> : null}
    {history.length ? <details className="text-sm">
      <summary className="cursor-pointer font-medium">修复记录</summary>
      <ol className="mt-2 space-y-2">
        {history.map((item, index) => <li key={`${item.round}:${item.kind}:${index}`} className="break-words">
          <span className="mr-2 text-muted-foreground">第 {item.round} 轮 · {item.kind === "repair" ? "修改" : "复核"}</span>{item.summary}
        </li>)}
      </ol>
    </details> : null}
    {canAct ? <RepairActions key={`${status.taskId}:${repair.key}:${repair.rounds}:${repair.maxRounds ?? 2}`} status={status} /> : null}
  </section>;
}
