import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  abandonPlanningRepair, getNovelPlanningRepairStatus, getPlanningRepairStatus,
  novelPlanningRepairQueryKey, planningRepairQueryKey, type PlanningRepairStatus,
} from "@/api/planningRepair";
import { Button } from "@/components/ui/button";
import { planningRepairHistory, planningRepairIssues } from "./planningRepairPresentation";
import { RepairActions } from "./RepairActions";
import { isPlanningRepairConfirmationPhase, isPlanningRepairTaskPaused } from "@ai-novel/shared/types/planningRepair/recovery";

const PHASE_LABELS: Record<NonNullable<PlanningRepairStatus["planningRepair"]>["phase"], string> = {
  assessing: "检查章节计划", repairing: "修复章节计划", reviewing: "复核质量", ready: "等待保存候选方案",
  committed: "修复方案已保存", waiting_confirmation: "选择修复方向", uncertain: "选择修复方向", technical_failed: "修复暂时中断",
  abandoned: "修复已放弃",
};

export default function PlanningRepairPanel({ novelId }: { novelId: string }) {
  const [params] = useSearchParams();
  const taskId = params.get("directorTaskId")?.trim() ?? "";
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: taskId ? planningRepairQueryKey(taskId) : novelPlanningRepairQueryKey(novelId),
    queryFn: () => taskId ? getPlanningRepairStatus(taskId) : getNovelPlanningRepairStatus(novelId),
    enabled: Boolean(novelId), retry: false, refetchInterval: 4000,
  });
  const status = query.data;
  const repair = status?.novelId === novelId ? status.planningRepair : null;
  const abandon = useMutation({
    mutationFn: (targetTaskId: string) => abandonPlanningRepair(targetTaskId, "用户在规划修复面板放弃这次修复"),
    onSuccess: (_data, targetTaskId) => {
      void queryClient.invalidateQueries({ queryKey: planningRepairQueryKey(targetTaskId) });
    },
  });
  if (!status || !repair) return query.isError && taskId ? <p role="alert" className="text-sm text-destructive">无法读取规划修复状态，请刷新后重试。</p> : null;
  const canAct = (isPlanningRepairConfirmationPhase(repair.phase) || Boolean(repair.pendingOperation) || Boolean(status.recoveryRequest))
    && isPlanningRepairTaskPaused(status);
  const abandoned = repair.phase === "abandoned";
  const history = planningRepairHistory(repair.history);
  const issues = planningRepairIssues(repair.quality);
  return <section aria-label="章节规划修复" className="space-y-3 rounded-md bg-amber-50/60 p-4 dark:bg-amber-950/20">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">章节规划修复</h3>
      <span className="text-sm">{PHASE_LABELS[repair.phase]} · {repair.rounds}/{repair.maxRounds ?? 2} 轮</span>
    </div>
    <p className="break-words text-sm">{repair.summary}</p>
    {/* After the user gives up, the failure text stays on record but must stop reading as a live
        error: leaving it as an alert is the frozen message this panel is meant to clear. */}
    {repair.technicalError && !abandoned ? <p role="alert" className="break-words text-sm text-destructive">{repair.technicalError}</p> : null}
    {abandoned && repair.technicalError ? <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">这次修复中断时的报错（已放弃，仅作记录）</summary>
      <p className="mt-1 break-words text-muted-foreground">{repair.technicalError}</p>
    </details> : null}
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
    {canAct ? <div className="space-y-3">
      <RepairActions key={`${status.taskId}:${repair.key}:${repair.rounds}:${repair.maxRounds ?? 2}`} status={status} />
      <div className="space-y-1 pt-1">
        {/* Sits next to "保持暂停" in the same panel, so the two must not read alike: one keeps the
            session for later, the other ends it. Light visual weight because it is the rare path. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          disabled={abandon.isPending}
          onClick={() => {
            const confirmed = window.confirm([
              "放弃这次修复？",
              "",
              "· 候选方案会被丢弃，章节计划与正文都不会改动",
              "· 这次修复到此结束，需要时再从这一步重新发起",
              "· 放弃记录会保留在修复记录里",
            ].join("\n"));
            if (confirmed) abandon.mutate(status.taskId);
          }}
        >
          {abandon.isPending ? "放弃中…" : "放弃这次修复"}
        </Button>
        <p className="text-xs text-muted-foreground">
          修复反复中断、暂时不想处理时用这个：它会结束这次修复，之后需要重新发起。如果只是想先放一放，用上面的「保持暂停」即可，之后可以接着修。
        </p>
        {abandon.isError ? <p role="alert" className="break-words text-xs text-destructive">
          {abandon.error instanceof Error ? abandon.error.message : "放弃失败，请稍后重试。"}
        </p> : null}
      </div>
    </div> : null}
  </section>;
}
