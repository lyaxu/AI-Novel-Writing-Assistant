import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  getNovelPlanningRepairStatus, getPlanningRepairStatus,
  novelPlanningRepairQueryKey, planningRepairQueryKey, type PlanningRepairStatus,
} from "@/api/planningRepair";
import { planningRepairHistory, planningRepairIssues } from "./planningRepairPresentation";
import { RepairActions } from "./RepairActions";
import { isPlanningRepairConfirmationPhase, isPlanningRepairTaskPaused } from "@ai-novel/shared/types/planningRepair/recovery";

const PHASE_LABELS: Record<NonNullable<PlanningRepairStatus["planningRepair"]>["phase"], string> = {
  assessing: "检查章节计划", repairing: "修复章节计划", reviewing: "复核质量", ready: "等待保存候选方案",
  committed: "修复方案已保存", waiting_confirmation: "选择修复方向", uncertain: "选择修复方向", technical_failed: "修复暂时中断",
};

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
  const canAct = (isPlanningRepairConfirmationPhase(repair.phase) || Boolean(repair.pendingOperation) || Boolean(status.recoveryRequest))
    && isPlanningRepairTaskPaused(status);
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
