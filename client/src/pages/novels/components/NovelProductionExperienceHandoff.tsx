import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NovelProductionScope } from "@ai-novel/shared/types/novelWorkflow";
import { extractDirectorTaskSeedPayloadFromMeta, isDirectorAutoExecutionRunMode, type DirectorAutoExecutionPlan, type DirectorRunMode } from "@ai-novel/shared/types/novelDirector";
import { ArrowRight, BookOpen, Check, Loader2, Settings2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { selectNovelProductionExperience } from "@/api/novelWorkflow";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import OnboardingTip from "@/components/onboarding/OnboardingTip";
import { queryKeys } from "@/api/queryKeys";
import { getTaskDetail } from "@/api/tasks";
import { buildDirectorAutoExecutionPlanLabel } from "./directorAutoExecutionPlan.shared";

interface NovelProductionExperienceHandoffProps {
  taskId: string;
  novelId: string;
  novelTitle?: string;
}

export default function NovelProductionExperienceHandoff({
  taskId,
  novelId,
  novelTitle,
}: NovelProductionExperienceHandoffProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [productionScope, setProductionScope] = useState<NovelProductionScope>("sample3");
  const taskQuery = useQuery({
    queryKey: queryKeys.tasks.detail("novel_workflow", taskId),
    queryFn: () => getTaskDetail("novel_workflow", taskId),
    retry: false,
  });
  const seed = extractDirectorTaskSeedPayloadFromMeta(taskQuery.data?.data?.meta) as {
    takeover?: unknown;
    directorInput?: { runMode?: DirectorRunMode; autoExecutionPlan?: DirectorAutoExecutionPlan };
  } | null;
  const confirmedPlan = seed?.takeover
    && isDirectorAutoExecutionRunMode(seed.directorInput?.runMode)
    ? seed.directorInput?.autoExecutionPlan : undefined;
  const scopeReady = taskQuery.isSuccess && Boolean(seed);
  const scopeLabel = confirmedPlan ? buildDirectorAutoExecutionPlanLabel(confirmedPlan) : null;
  const completionLabel = scopeLabel ? `按已确认范围推进：${scopeLabel}`
    : productionScope === "book" ? "持续写完整本书" : "样章完成后停下试读";
  const mutation = useMutation({
    mutationFn: async (experience: "simple" | "professional") => {
      if (!scopeReady) throw new Error("请先读取本次写作范围。");
      const response = await selectNovelProductionExperience(taskId, experience, confirmedPlan ? undefined : productionScope);
      if (!response.data) {
        throw new Error("生产方式选择没有返回跳转位置。");
      }
      return response.data;
    },
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.firstNovel }),
      ]);
      toast.success(response.autoExecutionPlan
        ? `已提交 ${buildDirectorAutoExecutionPlanLabel(response.autoExecutionPlan)} 的写作任务。`
        : response.productionScope === "book" ? "全书写作已启动。" : "样章写作已启动，完成后等待试读。" );
      navigate(response.targetRoute, { replace: true });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "选择生产方式失败，请重试。"),
  });

  return (
    <section className="mx-auto max-w-5xl space-y-5 px-3 py-6 sm:px-4 lg:px-0">
      <OnboardingTip
        storageKey="production-experience-handoff"
        title="选择你想使用的创作界面"
        description="两种界面共享同一套创作、审校和恢复能力；阅读书架更专注于正文，完整工作台会展示更多创作资料。"
      />
      <div className="relative overflow-hidden rounded-3xl bg-foreground px-6 py-7 text-background shadow-[0_30px_80px_-50px_hsl(var(--foreground))] sm:px-8 sm:py-9">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm font-medium text-background/70">
            <BookOpen className="h-4 w-4" />
            开写前准备完成
          </div>
          <h1 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
            选择《{novelTitle?.trim() || "这本小说"}》的创作界面
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-background/70">
            故事方向、角色和卷章安排准备完毕。
          </p>
        </div>
      </div>
      {!scopeReady ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{taskQuery.isPending ? "正在读取本次写作范围…" : "未能读取本次写作范围，请重新读取后选择创作界面。"}</p>
          {!taskQuery.isPending ? <Button variant="outline" onClick={() => void taskQuery.refetch()}>重新读取范围</Button> : null}
        </div>
      ) : scopeLabel ? (
        <div className="space-y-2">
          <h2 className="text-base font-semibold">本次写作范围：{scopeLabel}</h2>
          <p className="text-sm text-muted-foreground">两种界面都按此范围继续，先核验规划，再生成正文。</p>
        </div>
      ) : <fieldset disabled={mutation.isPending} className="space-y-3">
        <legend className="text-base font-semibold">本次写作范围</legend>
        <div className="flex flex-wrap gap-5">
          {([['sample3', '试写前3章'], ['sample5', '试写前5章'], ['book', '写完整本']] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="production-scope" value={value} checked={productionScope === value} onChange={() => setProductionScope(value)} />{label}
            </label>
          ))}
        </div>
      </fieldset>}
      <div className="grid gap-4 md:grid-cols-2">
        <article className="flex flex-col rounded-3xl border border-primary/30 bg-background p-6 shadow-[0_24px_65px_-50px_hsl(var(--primary))] ring-1 ring-primary/10 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">推荐新手</span>
          </div>
          <h2 className="mt-5 text-xl font-semibold text-foreground">阅读书架</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">优先展示章节进度、已保存正文和需要关注的事项。</p>
          <ul className="mt-5 flex-1 space-y-3 text-sm text-foreground">
            {[completionLabel, "自动审校、修复与必要重规划", "专注阅读已保存正文"].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <Check className="h-4 w-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
          <Button type="button" className="mt-6 w-full justify-between" disabled={mutation.isPending || !scopeReady} onClick={() => mutation.mutate("simple")}>
            {mutation.isPending && mutation.variables === "simple" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            使用阅读书架
            <ArrowRight className="h-4 w-4" />
          </Button>
        </article>
        <article className="flex flex-col rounded-3xl border border-border/80 bg-background p-6 sm:p-7">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Settings2 className="h-5 w-5" />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-foreground">完整工作台</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">展示规划、角色、章节和任务等完整创作资料。</p>
          <ul className="mt-5 flex-1 space-y-3 text-sm text-foreground">
            {[completionLabel, "查看并调整全部创作资产", "自由修改卷章规划与正文"].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                {item}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="mt-6 w-full justify-between" disabled={mutation.isPending || !scopeReady} onClick={() => mutation.mutate("professional")}>
            {mutation.isPending && mutation.variables === "professional" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
            使用完整工作台
            <ArrowRight className="h-4 w-4" />
          </Button>
        </article>
      </div>
    </section>
  );
}
