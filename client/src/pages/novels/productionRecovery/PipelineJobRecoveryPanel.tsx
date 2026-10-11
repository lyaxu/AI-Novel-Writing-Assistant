import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getNovelPipelineJob } from "@/api/novel";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { readChapterProductionRecovery, recoveryQueryKey, resumeChapterPipelineRecovery } from "./api";
import { resumeInspectedPipeline } from "./contracts";
import { refreshChapterProductionViews } from "./refreshViews";

export default function PipelineJobRecoveryPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [message, setMessage] = useState("");
  const recovery = useQuery({ queryKey: recoveryQueryKey(novelId, chapterId),
    queryFn: () => readChapterProductionRecovery(novelId, chapterId), enabled: Boolean(novelId && chapterId), retry: false });
  const record = recovery.data;
  const jobId = record?.entry === "pipeline" && !record.workflowTaskId ? record.pipelineJobId ?? "" : "";
  const job = useQuery({ queryKey: queryKeys.novels.pipelineJob(novelId, jobId || "none"),
    queryFn: () => getNovelPipelineJob(novelId, jobId), enabled: Boolean(jobId), retry: false });
  const chapterParams = new URLSearchParams(params);
  chapterParams.set("stage", "chapter");
  chapterParams.set("chapterId", chapterId);
  async function refresh() {
    await Promise.all([recovery.refetch(), ...(jobId ? [job.refetch()] : []), refreshChapterProductionViews(client, novelId, chapterId)]);
  }
  const resume = useMutation({
    mutationFn: async () => {
      setMessage("");
      const latest = await recovery.refetch();
      if (!record || latest.error) throw latest.error ?? new Error("请先读取本章保留进度。");
      await resumeInspectedPipeline({ inspected: record, latest: latest.data ?? null, jobId,
        submit: (operationId) => resumeChapterPipelineRecovery(novelId, chapterId, operationId) });
      setMessage("原批量任务的恢复请求已提交，请刷新查看执行进度。");
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "恢复失败，请刷新后核对。"),
    onSettled: refresh,
  });
  if (!jobId || record?.status === "completed") return null;
  const savedJob = job.data?.data;
  const validJob = savedJob?.id === jobId && savedJob.novelId === novelId;
  return <section className="space-y-3 rounded-xl bg-muted/30 p-4" aria-label="恢复原批量任务">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium">恢复原批量任务</h3>
      <Button size="sm" variant="ghost" disabled={recovery.isFetching || job.isFetching} onClick={() => void refresh()}>刷新保留进度</Button>
    </div>
    {validJob ? <p className="text-sm">范围：第 {savedJob.startOrder}—{savedJob.endOrder} 章，完成 {savedJob.completedCount}/{savedJob.totalCount} 章，重试 {savedJob.retryCount}/{savedJob.maxRetries}。恢复沿用原任务、参数与剩余预算。</p> : <p className="text-sm">{job.isError ? "原任务读取失败，请刷新后核对。" : "正在读取原任务范围。"}</p>}
    <p className="text-sm">先在 <Link className="underline" to={`/novels/${encodeURIComponent(novelId)}/edit?${chapterParams.toString()}`}>本章的“稿件与恢复”</Link> 核对保留稿与未知调用；有待判断的资源变更时，进入章节侧栏的“资源风险”确认或忽略。</p>
    {record?.canResumePipeline ? <Button disabled={!validJob || resume.isPending || recovery.isFetching || job.isFetching}
      onClick={() => resume.mutate()}>{resume.isPending ? "提交恢复请求…" : "从原任务未完成章节继续"}</Button>
      : <p className="text-sm text-muted-foreground">{record?.resumeBlockedReason || "请先核对本章的保留进度与暂停原因。"}</p>}
    {message ? <p className="text-sm" role="status">{message}</p> : null}
  </section>;
}
