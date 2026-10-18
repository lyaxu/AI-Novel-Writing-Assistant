import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/api/queryKeys";
import { correctInitialPlanningContract, getPlanningInitialContract, planningInitialContractQueryKey,
  type PlanningRepairStatus } from "@/api/planningRepair";

/** A rejected initial response is not a candidate: never offer paid candidate advice here. */
export function InitialContractActions({ status }: { status: PlanningRepairStatus }) {
  const repair = status.planningRepair!;
  const client = useQueryClient();
  const [confirmedToken, setConfirmedToken] = useState<string | null>(null);
  const request = useRef<{ token: string; key: string } | null>(null);
  const previous = status.recoveryRequest?.executionMode === "retry_initial_contract" ? status.recoveryRequest : null;
  const preview = useQuery({ queryKey: planningInitialContractQueryKey(status.taskId),
    queryFn: () => getPlanningInitialContract(status.taskId), enabled: !previous, retry: false, refetchInterval: 4000 });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["planning-repair"] });
    await client.invalidateQueries({ queryKey: ["tasks"] });
    if (status.novelId) {
      await client.invalidateQueries({ queryKey: queryKeys.novels.autoDirectorTask(status.novelId) });
      await client.invalidateQueries({ queryKey: queryKeys.novels.volumeWorkspace(status.novelId) });
    }
  };
  const mutation = useMutation({ retry: false, mutationFn: () => {
    if (previous) {
      if (!previous.initialContractToken) throw new Error("无法核对本次单次授权，请刷新状态。");
      return correctInitialPlanningContract(status.taskId, { repairKey: repair.key, token: previous.initialContractToken,
        idempotencyKey: previous.idempotencyKey });
    }
    const current = preview.data;
    if (!current?.available || confirmedToken !== current.token) throw new Error("请核对保留响应并确认本次纠正费用。");
    if (request.current?.token !== current.token) request.current = { token: current.token, key: crypto.randomUUID() };
    return correctInitialPlanningContract(status.taskId, { repairKey: repair.key, token: current.token,
      idempotencyKey: request.current.key });
  }, onSettled: refresh });
  const current = preview.data;
  const error = mutation.error ?? preview.error;
  return <div className="space-y-3">
    <p className="text-sm font-medium">纠正第 {repair.chapterOrder} 章初始规划</p>
    <p className="text-sm text-muted-foreground">初始规划响应未通过校验，尚未形成可复核候选。候选修复 {repair.rounds}/{repair.maxRounds ?? 2} 轮不包含此前初始生成费用；详细调用费用可在运行记录查看。</p>
    {previous ? <>
      <p className="text-sm">继续提交已确认的一次纠正，不追加授权次数。</p>
      <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>继续已确认的初始纠正</Button>
    </> : current?.available ? <>
      <p className="text-xs text-muted-foreground">{current.initialGenerationAttempts === null ? "历史初始生成次数未单独记录。" : `初始生成累计 ${current.initialGenerationAttempts} 次。`}单次授权纠正累计 {current.correctionAttempts} 次。</p>
      <p className="text-sm">本次对保留的完整响应纠正 1 次，将产生模型费用；纠正失败则保留响应并暂停。成功后进行语义和窗口复核，并使用原剩余 {current.remainingRounds} 轮处理质量问题；通过后按原范围第 {current.startOrder}–{current.endOrder} 章继续写作。复核、必要修复及写作也会产生费用。</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1"
        disabled={mutation.isPending} checked={confirmedToken === current.token}
        onChange={event => setConfirmedToken(event.target.checked ? current.token : null)} />
        <span>同意纠正保留响应一次，并在复核通过后继续原范围写作。</span></label>
      <Button disabled={mutation.isPending || confirmedToken !== current.token} onClick={() => mutation.mutate()}>
        {mutation.isPending ? "正在提交…" : "纠正初始规划并继续"}</Button>
    </> : <p role="status" className="text-sm text-muted-foreground">{current?.reason ?? "正在核对保留响应和原任务。"}</p>}
    {preview.isError || mutation.isError ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "无法核对处理结果，请刷新状态。"}</p> : null}
    <Button variant="ghost" disabled={preview.isFetching || mutation.isPending} onClick={() => void refresh()}>刷新恢复状态</Button>
    <p className="text-xs text-muted-foreground">未提交时任务保持暂停，保留响应和已有内容。</p>
  </div>;
}
