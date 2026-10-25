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
    {/* The failure text is only a live alert while the repair actually waits for the user.
        During assessing/repairing/reviewing it is a stale record from the previous pause, and
        after commit/abandon it must stop reading as a current problem. */}
    {repair.technicalError && !abandoned
      && (repair.phase === "waiting_confirmation" || repair.phase === "uncertain")
      ? <p role="alert" className="break-words text-sm text-destructive">{repair.technicalError}</p> : null}
    {repair.phase === "committed" ? <p className="text-sm text-emerald-700 dark:text-emerald-300">
      规划已通过复核并保存，这里不需要再操作。回到小说编辑页点“继续自动导演”（或“从最近检查点恢复”），从已保留的正文继续。
    </p> : null}
    {abandoned && repair.technicalError ? <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">这次修复中断时的报错（已放弃，仅作记录）</summary>
      <p className="mt-1 break-words text-muted-foreground">{repair.technicalError}</p>
    </details> : null}
    <p className="text-xs text-muted-foreground">起始章：第 {repair.chapterOrder} 章{repair.affectedChapterIds?.length ? ` · 涉及 ${repair.affectedChapterIds.length} 章` : ""}</p>
    <details className="rounded-md bg-background/50 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">不知道该选哪个？</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>候选方案可用、只是格式、引用或合同校验没过：先选“重新复核保留候选”或“按原策略继续”，复用已有候选更省模型费用；同一份答案复核两次仍失败时，再考虑放弃。</li>
        <li>需要改剧情或计划、但拿不准修改方向：选“让 AI 推荐修复方案”，看过建议再决定；这个选项会产生模型费用。</li>
        <li>已有明确修改方向：展开“高级：自定义修复方向”，写清要保留和要改的部分。</li>
        <li>规划来源或执行状态发生变化、或不想继续这一步：选“放弃这次修复”，再回小说编辑页点“继续自动导演”；章节计划与正文不受影响。</li>
        <li>只是稍后再处理：选“保持暂停”，候选和剩余轮次会保留。</li>
      </ul>
    </details>
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
    </div> : repair.phase === "committed" ? null : <p className="text-sm text-muted-foreground">
      {/* Rendered as an explanation, not as nothing. Previously this branch was `null`, so a repair
          that could not act showed no buttons and no reason — the user clicked repair again and again
          with no way to tell they were being held back. */}
      {repair.phase === "abandoned"
        ? "本次修复已放弃，章节计划与正文都没有改动。回到小说编辑页点“继续自动导演”，从原任务继续即可。"
        : <>现在这一步没有可以直接操作的修复：{isPlanningRepairTaskPaused(status)
          ? "这次修复不在等待你处理的状态，运行可能仍在继续或已经结束。"
          : `这次运行的当前状态是「${status.status === "cancelled" ? "已取消" : status.status === "succeeded" ? "已完成" : status.status}」，只有在等待你处理时才能在这里修复。`}
          上面显示的报错是上一次留下的记录；要重新走一遍，请等运行停在需要你确认的位置，再回来点「让 AI 推荐修复方案」。</>}
    </p>}
  </section>;
}
