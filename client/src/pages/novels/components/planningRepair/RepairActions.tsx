import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, RefreshCw, Sparkles } from "lucide-react";
import {
  actOnPlanningRepair, getPlanningRepairAdvice, planningRepairAdviceQueryKey,
  requestPlanningRepairAdvice, selectPlanningRepairAdvice, type PlanningRepairStatus,
} from "@/api/planningRepair";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { RepairAdviceOptions } from "./RepairAdviceOptions";
import { authorizedPlanningRepairPayload, canAdoptPlanningRepairAdvice, selectedPlanningRepairAdvice } from "./planningRepairAdvicePresentation";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请稍后重试。";
}

export function RepairActions({ status }: { status: PlanningRepairStatus }) {
  const repair = status.planningRepair!;
  const client = useQueryClient();
  const [guidance, setGuidance] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [paused, setPaused] = useState(false);
  const inputId = useId();
  const adviceRequest = useRef<{ key: string; observedOutcome: string } | null>(null);
  const recoveryRequest = useRef<{ identity: string; key: string } | null>(null);
  const adviceQuery = useQuery({
    queryKey: planningRepairAdviceQueryKey(status.taskId),
    queryFn: () => getPlanningRepairAdvice(status.taskId),
    enabled: !status.recoveryRequest,
    retry: false,
    refetchInterval: 4000,
  });
  const advice = adviceQuery.data;
  const selected = selectedPlanningRepairAdvice(advice, selectedId);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["planning-repair"] });
    await client.invalidateQueries({ queryKey: ["tasks"] });
    if (status.novelId) {
      await client.invalidateQueries({ queryKey: queryKeys.novels.autoDirectorTask(status.novelId) });
      await client.invalidateQueries({ queryKey: queryKeys.novels.volumeWorkspace(status.novelId) });
    }
  };
  const generate = useMutation({
    retry: false,
    mutationFn: () => {
      const observedOutcome = advice && ["failed", "uncertain", "stale", "ready", "applied"].includes(advice.status)
        ? `${advice.requestId ?? advice.adviceId ?? ""}:${advice.status}` : "";
      if (!adviceRequest.current || (observedOutcome && adviceRequest.current.observedOutcome !== observedOutcome)) {
        adviceRequest.current = { key: crypto.randomUUID(), observedOutcome };
      }
      return requestPlanningRepairAdvice(status.taskId, { repairKey: repair.key, idempotencyKey: adviceRequest.current.key });
    },
    onSuccess: result => {
      adviceRequest.current = null;
      client.setQueryData(planningRepairAdviceQueryKey(status.taskId), result);
      setSelectedId("");
    },
    onSettled: () => client.invalidateQueries({ queryKey: planningRepairAdviceQueryKey(status.taskId) }),
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (action: "adopt" | "custom" | "continue" | "pause") => {
      if (action === "pause") return actOnPlanningRepair(status.taskId, { action, repairKey: repair.key });
      if (status.recoveryRequest) return actOnPlanningRepair(status.taskId, authorizedPlanningRepairPayload(status));
      if (action === "continue") throw new Error("没有可继续的已授权修复。");
      const identity = action === "adopt" ? `advice:${advice?.adviceId}:${selected?.id}` : `custom:${guidance.trim()}`;
      if (!recoveryRequest.current || recoveryRequest.current.identity !== identity) {
        recoveryRequest.current = { identity, key: crypto.randomUUID() };
      }
      if (action === "adopt") {
        if (!canAdoptPlanningRepairAdvice(advice, selectedId, false) || !advice?.adviceId || !selected) throw new Error("请重新获取可执行的修复方案。");
        return selectPlanningRepairAdvice(status.taskId, {
          repairKey: repair.key, adviceId: advice.adviceId, optionId: selected.id, idempotencyKey: recoveryRequest.current.key,
        });
      }
      if (!guidance.trim()) throw new Error("请填写自定义方向，或选择 AI 推荐的方案。");
      return actOnPlanningRepair(status.taskId, {
        action: "retry", repairKey: repair.key, guidance: guidance.trim(), idempotencyKey: recoveryRequest.current.key, executionMode: "repair_then_review",
      });
    },
    onSuccess: async (_, action) => { setPaused(action === "pause"); await refresh(); },
    onError: refresh,
  });
  const adviceRunning = advice?.status === "running" || generate.isPending;
  const busy = mutation.isPending || adviceRunning;
  const ready = advice?.status === "ready" && (advice.options?.length ?? 0) > 0;

  return <div className="space-y-4">
    {status.recoveryRequest ? <div className="space-y-2">
      <p className="text-sm">修复方向已获授权，可继续这次修复，或保持暂停。</p>
      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{status.recoveryRequest.guidance}</p>
      <Button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate("continue")}>
        <RefreshCw className="h-4 w-4" />{mutation.isPending ? "正在提交…" : "继续已授权修复"}
      </Button>
    </div> : <>
      <div className="space-y-2">
        <p className="text-sm">让 AI 根据待处理问题给出方案，再由你选择修复方向。</p>
        <p className="text-xs text-muted-foreground">获取方案会调用模型并产生费用；阅读方案不会启动修复。</p>
        <Button type="button" variant={ready ? "secondary" : "default"} disabled={busy || adviceQuery.isPending}
          onClick={() => generate.mutate()}>
          <Sparkles className="h-4 w-4" />{adviceRunning ? "AI 正在准备方案…" : advice && advice.status !== "none" ? "重新获取修复方案" : "让 AI 推荐修复方案"}
        </Button>
        {adviceRunning ? <p role="status" className="text-sm text-muted-foreground">正在分析问题并准备可选方向，任务保持暂停。</p> : null}
        {advice?.status === "stale" ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">章节计划或修复范围发生变化，请重新获取方案后选择。</p> : null}
        {advice?.status === "applied" ? <p role="status" className="text-sm text-muted-foreground">上次方案已采用。请查看本轮处理结果；仍有待处理问题时，可获取针对这些问题的新方案。</p> : null}
        {advice?.status === "failed" || advice?.status === "uncertain" ? <p role="alert" className="break-words text-sm text-destructive">
          {advice.error || (advice.status === "uncertain" ? "尚未确认是否取得方案，可刷新状态，或重新获取。" : "未能取得修复方案，可重新获取。")}
        </p> : null}
        {generate.isError ? <p role="alert" className="break-words text-sm text-destructive">{errorText(generate.error)}</p> : null}
        {adviceQuery.isError ? <p role="alert" className="text-sm text-destructive">无法读取方案状态。{errorText(adviceQuery.error)}</p> : null}
        {adviceQuery.isError || generate.isError || advice?.status === "uncertain" ? <Button type="button" variant="ghost" size="sm"
          disabled={adviceQuery.isFetching} onClick={() => void adviceQuery.refetch()}>刷新方案状态</Button> : null}
      </div>
      {ready && advice ? <div className="space-y-3">
        {advice.summary ? <p className="break-words text-sm">{advice.summary}</p> : null}
        <RepairAdviceOptions advice={advice} selectedId={selected?.id ?? ""} disabled={busy} onSelect={setSelectedId} />
        <p className="text-xs text-muted-foreground">{selected?.executionMode === "review_existing"
          ? "采用方案将复核原候选，不修改合同；仍未通过时保持暂停。复核会产生模型调用费用。"
          : selected?.executionMode === "source_edit" ? "请先按方案说明确认章节规划或卷规划，再获取可执行方案。"
          : "采用方案将追加 1 轮规划修复，先修改候选再复核，两者均会产生模型调用费用。"}</p>
        <Button type="button" disabled={busy || !canAdoptPlanningRepairAdvice(advice, selectedId, Boolean(status.recoveryRequest))}
          onClick={() => mutation.mutate("adopt")}>{mutation.isPending ? "正在提交…" : selected?.executionMode === "review_existing" ? "按此方向复核原候选" : "采用此方案并修复"}</Button>
      </div> : null}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">高级：自定义修复方向（可选）</summary>
        <div className="mt-3 space-y-2">
          <label htmlFor={inputId} className="block">补充希望保留的情节或调整方向</label>
          <textarea id={inputId} value={guidance} onChange={event => setGuidance(event.target.value)} maxLength={4000} disabled={busy}
            placeholder="例如：保留主角的选择，调整它带来的后果。"
            className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
          <p className="text-xs text-muted-foreground">提交后追加 1 轮规划修复并复核，将产生模型调用费用。</p>
          <Button type="button" variant="secondary" disabled={busy || !guidance.trim()} onClick={() => mutation.mutate("custom")}>按自定义方向修复</Button>
        </div>
      </details>
    </>}
    <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate("pause")}>
      <Pause className="h-4 w-4" />保持暂停
    </Button>
    {paused ? <p role="status" className="text-sm text-muted-foreground">任务保持暂停，已有内容和候选方案保留。</p> : null}
    {mutation.isError ? <p role="alert" className="break-words text-sm text-destructive">{errorText(mutation.error)}</p> : null}
  </div>;
}
