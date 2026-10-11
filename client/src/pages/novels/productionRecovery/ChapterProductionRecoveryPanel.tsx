import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/api/queryKeys";
import { readChapterProductionRecovery, recoveryQueryKey } from "./api";
import { productionStepLabel, recoveryScope, recoveryInspectionVersion } from "./contracts";
import { useOperationPermit } from "./operationPermit";

interface Props { novelId: string; chapterId: string; currentContent: string; busy?: boolean; refreshSignal?: string }
const STEP_STATUS = { done: "完成", running: "待核对", failed: "未完成", unknown: "结果未确认" } as const;

function downloadDraft(chapterId: string, label: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${chapterId}-${label}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ChapterProductionRecoveryPanel({ novelId, chapterId, currentContent, busy, refreshSignal }: Props) {
  const client = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const [resuming, setResuming] = useState(false);
  const authorize = useOperationPermit((state) => state.authorize);
  const clear = useOperationPermit((state) => state.clear);
  const permit = useOperationPermit((state) => state.permits[`${novelId}:${chapterId}`]);
  const query = useQuery({
    queryKey: recoveryQueryKey(novelId, chapterId),
    queryFn: () => readChapterProductionRecovery(novelId, chapterId),
    enabled: Boolean(novelId && chapterId),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const stream = useSSE();
  const record = query.data;
  const inspectionVersion = record ? recoveryInspectionVersion(record) : "";
  useEffect(() => {
    setChecked(false);
    clear(novelId, chapterId);
  }, [novelId, chapterId, inspectionVersion, currentContent, clear]);
  useEffect(() => {
    void client.invalidateQueries({ queryKey: recoveryQueryKey(novelId, chapterId) });
  }, [busy, refreshSignal, novelId, chapterId, client]);
  useEffect(() => () => clear(novelId, chapterId), [novelId, chapterId, clear]);

  async function resume() {
    if (!record || inFlight.current) return;
    inFlight.current = true;
    setResuming(true);
    setMessage("");
    try {
      const fresh = await query.refetch();
      if (fresh.error || !fresh.data || fresh.data.operationId !== record.operationId || !fresh.data.canResume) {
        setMessage("恢复条件有变化，请核对最新保留内容与步骤。");
        return;
      }
      clear(novelId, chapterId);
      await stream.start(`/novels/${novelId}/chapters/${chapterId}/runtime/recovery/resume`, { operationId: record.operationId });
    } finally {
      inFlight.current = false;
      setResuming(false);
      await Promise.all([
        query.refetch(),
        client.invalidateQueries({ queryKey: queryKeys.novels.detail(novelId) }),
        client.invalidateQueries({ queryKey: queryKeys.novels.chapterEditorWorkspace(novelId, chapterId) }),
      ]);
    }
  }

  async function allowNewOperation() {
    if (!checked || !record || busy || resuming) return;
    const fresh = await query.refetch();
    if (fresh.error || !fresh.data || recoveryInspectionVersion(fresh.data) !== inspectionVersion || fresh.data.leaseActive) {
      setChecked(false);
      setMessage("执行进度有变化，请重新核对。");
      return;
    }
    authorize(novelId, chapterId, record.operationId);
    setMessage("请选择本章的生成或修文按钮。仅下一次手动操作会使用新执行，旧保留稿与记录会归档保留。");
  }

  if (!chapterId) return null;
  if (query.isError) return <section className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900" aria-label="稿件与恢复">
    恢复记录读取失败。为保护保留稿，请刷新核对后再操作。
    <Button variant="ghost" onClick={() => void query.refetch()}>重新读取</Button>
  </section>;
  if (!record) return null;
  const disabled = Boolean(busy || resuming || record.leaseActive || query.isFetching);
  const belongsToRange = record.entry === "pipeline" || Boolean(record.workflowTaskId);
  const unfinished = record.steps.find((step) => step.status === "unknown" || step.status === "failed")
    ?? record.steps.find((step) => step.status === "running");
  return <section className="space-y-3 rounded-xl bg-muted/30 p-4" aria-label="稿件与恢复">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium">稿件与恢复</h3>
      <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新保留进度</Button>
    </div>
    <p className="text-sm text-muted-foreground">{recoveryScope(record)}</p>
    {unfinished ? <p className="text-sm">待处理：{productionStepLabel(unfinished.key)} · {STEP_STATUS[unfinished.status]}</p> : null}
    <p className="text-xs text-muted-foreground">范围：仅本章的本次操作。恢复会复用完成步骤；新操作可能重新调用模型，保留稿不会被预先清空。</p>
    {belongsToRange && record.status !== "completed" ? <p className="text-sm">此章属于连续写作任务。请在本工作区的连续写作任务入口核对范围与暂停原因，再恢复原任务。</p> : null}
    <details>
      <summary className="cursor-pointer text-sm">查看执行步骤（{record.steps.filter((step) => step.status === "done").length}/{record.steps.length} 完成）</summary>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{record.steps.map((step, index) => <li key={step.key}>
        {index + 1}. {productionStepLabel(step.key)} · {STEP_STATUS[step.status]}{step.error ? `：${step.error}` : ""}
      </li>)}</ul>
    </details>
    {[
      { label: "当前已保存正文", text: currentContent, note: "仅显示服务端正文；编辑器中尚未保存的修改仍保留在编辑器与本地草稿。" },
      { label: "本次保留的稿件快照", text: record.savedDraft, note: "此快照可能早于人工编辑，请与当前正文对照。" },
      { label: "未完成的流式草稿", text: record.partialText, note: "这段输出可能截断，尚不能当作完整正文。" },
    ].map((draft) => draft.text ? <details key={draft.label} className="space-y-2">
      <summary className="cursor-pointer text-sm">{draft.label}（{draft.text.length} 字符）</summary>
      <p className="text-xs text-muted-foreground">{draft.note}</p>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{draft.text}</pre>
      <Button size="sm" variant="secondary" onClick={() => downloadDraft(chapterId, draft.label, draft.text!)}>下载这份稿件</Button>
    </details> : null)}
    {!record.savedDraft && !record.partialText ? <p className="text-xs text-muted-foreground">本次操作尚未保留正文输出。</p> : null}
    {record.canResume ? <Button disabled={disabled} onClick={() => void resume()}>{resuming ? "恢复执行中…" : "从未完成步骤恢复"}</Button> : null}
    {(!belongsToRange || record.status === "completed") && !record.leaseActive ? <div className="space-y-2 pt-2">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => setChecked(event.target.checked)} className="mt-1" />
        <span>我已核对保留稿、当前正文和调用记录；若有结果不明的调用，我确认接受可能重复调用的风险，并决定另起一次操作。</span>
      </label>
      <Button variant="secondary" disabled={disabled || !checked || Boolean(permit)} onClick={() => void allowNewOperation()}>允许下一次手动生成或修文</Button>
      {permit ? <Button variant="ghost" onClick={() => { clear(novelId, chapterId); setChecked(false); setMessage(""); }}>撤回新操作选择</Button> : null}
    </div> : null}
    {message || stream.error ? <p className="text-sm" role="status">{stream.error || message}</p> : null}
  </section>;
}
