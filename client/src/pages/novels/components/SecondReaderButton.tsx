import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, Loader2 } from "lucide-react";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ReadingReport {
  text: string; model: string; startOrder: number; endOrder: number; reviewedAt: string;
}

export default function SecondReaderButton({ novelId, maxOrder }: { novelId: string; maxOrder: number }) {
  const storageKey = `novel-second-reader:v1:${novelId}`;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(Math.max(1, Math.min(5, maxOrder)));
  const [saveWarning, setSaveWarning] = useState(false);
  const [report, setReport] = useState<ReadingReport | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return value && typeof value.text === "string" && typeof value.model === "string"
        && typeof value.reviewedAt === "string" && Number.isInteger(value.startOrder)
        && Number.isInteger(value.endOrder) ? value : null;
    } catch { return null; }
  });
  const review = useMutation({
    mutationFn: async (range: { startOrder: number; endOrder: number }) => {
      const response = await apiClient.post<{ data: ReadingReport }>(`/second-reader/${novelId}`, range, { timeout: 300000 });
      return response.data.data;
    },
    retry: false,
    onSuccess: (result) => {
      setReport(result);
      try { localStorage.setItem(storageKey, JSON.stringify(result)); setSaveWarning(false); }
      catch { setSaveWarning(true); }
    },
  });
  return <>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>
      <BookOpen className="mr-2 h-4 w-4" />第二读者
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>第二读者 · 故事试读</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 text-sm">起始章
            <Input className="mt-1 w-24" type="number" min={1} max={maxOrder || undefined} value={start}
              disabled={review.isPending} onChange={e => setStart(Number(e.target.value))} />
          </label>
          <label className="min-w-0 text-sm">结束章
            <Input className="mt-1 w-24" type="number" min={start} max={maxOrder || undefined} value={end}
              disabled={review.isPending} onChange={e => setEnd(Number(e.target.value))} />
          </label>
          <Button type="button" disabled={review.isPending || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > maxOrder}
            onClick={() => review.mutate({ startOrder: start, endOrder: end })}>
            {review.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}
            {review.isPending ? "试读中" : "评估是否值得展开"}
          </Button>
        </div>
        {review.isError && <p role="alert" className="text-sm text-destructive">复核失败，已有阅读意见保留。</p>}
        {saveWarning && <p role="alert" className="text-sm text-destructive">浏览器保存失败，请暂勿关闭页面。</p>}
        {report && <section className="min-w-0 space-y-3 border-t pt-4">
          <p className="break-words text-sm text-muted-foreground">第{report.startOrder}—{report.endOrder}章 · {report.model} · {new Date(report.reviewedAt).toLocaleString()}</p>
          <div className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{report.text}</div>
        </section>}
      </DialogContent>
    </Dialog>
  </>;
}
