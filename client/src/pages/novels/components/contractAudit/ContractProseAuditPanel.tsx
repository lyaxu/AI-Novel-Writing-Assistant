import { useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { auditNovelContractProse, type ContractProseAuditResult } from "@/api/novel/contractProseAudit";
import { Button } from "@/components/ui/button";

/**
 * "Did the chapters I wrote actually do what their plans said" — asked after finishing a stretch of
 * chapters, so the entry lives where the chapters are rather than in a terminal.
 *
 * Deliberately one button. The panel around it already carries several actions, and adding a row of
 * controls here would make the crowding the user reported worse, not better.
 */
export default function ContractProseAuditPanel({ novelId }: { novelId: string }) {
  const [result, setResult] = useState<ContractProseAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult((await auditNovelContractProse(novelId)) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "核对失败，请稍后重试。");
    } finally {
      setRunning(false);
    }
  };

  const checked = result?.report.chapters.filter((chapter) => !chapter.skippedReason) ?? [];
  const skipped = result?.report.chapters.length ? result.report.chapters.length - checked.length : 0;
  const high = result?.report.findings.filter((finding) => finding.severity === "high").length ?? 0;

  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => void run()}>
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
        {running ? "正在核对…" : "核对章节计划与正文"}
      </Button>
      <span className="text-xs text-muted-foreground">
        检查已写章节是否做到了计划里要求的事。只读，不会改动计划或正文；有正文的章节每章调用一次模型。
      </span>
    </div>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {result ? <details className="text-sm" open>
      <summary className="cursor-pointer font-medium">
        核对结果：已核对 {checked.length} 章{skipped ? `，${skipped} 章无正文未核对` : ""}，问题 {result.report.findings.length} 条{high ? `（其中严重 ${high} 条）` : ""}
      </summary>
      <ol className="mt-2 space-y-1">
        {result.report.findings.length === 0 ? <li className="text-muted-foreground">没有发现问题。</li> : null}
        {result.report.findings.map((finding, index) => <li key={`${finding.chapterOrder}:${index}`} className="break-words">
          <span className="mr-2 text-muted-foreground">第 {finding.chapterOrder} 章</span>
          {finding.message}
          {finding.detail ? <span className="block text-xs text-muted-foreground">{finding.detail}</span> : null}
        </li>)}
      </ol>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">逐条核对明细</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs">{result.markdown}</pre>
      </details>
    </details> : null}
  </div>;
}
