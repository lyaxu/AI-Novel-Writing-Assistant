import { RefreshCw } from "lucide-react";
import type { CharacterResourceLedgerItem } from "@ai-novel/shared/types/characterResource";
import type { ChapterExecutionInsightsSidebarProps } from "./chapterInsights.types";
import { getTimelineCheckLabel } from "./TimelinePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildResourceReviewPresentation } from "./resourceReviewPresentation";

const OWNER_TYPE_LABELS: Record<string, string> = {
  character: "人物", organization: "组织", location: "地点", world: "世界公共资源", unknown: "归属未明",
};
const RESOURCE_STATUS_LABELS: Record<string, string> = {
  available: "可用", hidden: "隐藏", borrowed: "借用中", transferred: "已转交", lost: "丢失",
  consumed: "已消耗", damaged: "受损", destroyed: "毁坏", stale: "待复核",
};

function proposalText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : "未说明";
}

function ResourceGroup(props: {
  title: string;
  items: CharacterResourceLedgerItem[];
  emptyText: string;
}) {
  const { title, items, emptyText } = props;
  return (
    <div className="rounded-lg bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {items.length > 0 ? (
        <div className="mt-2 space-y-2">
          {items.slice(0, 4).map((item) => (
            <div key={item.id} className="rounded-md bg-muted/15 p-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">{item.name}</span>
                <Badge variant="outline">{RESOURCE_STATUS_LABELS[item.status] ?? item.status}</Badge>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-xs leading-5 text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}

export default function ResourceRiskPanel(props: ChapterExecutionInsightsSidebarProps) {
  const {
    selectedChapter,
    chapterResourceContext,
    isLoadingChapterResourceContext = false,
    resourceWorkflowMode = "manual",
    pendingCharacterResourceProposals = [],
    onExtractChapterResources,
    isExtractingChapterResources = false,
    onConfirmCharacterResourceProposal,
    onRejectCharacterResourceProposal,
    confirmingCharacterResourceProposalId = "",
    rejectingCharacterResourceProposalId = "",
    chapterRuntimePackage,
  } = props;

  const isAutoDirectorMode = resourceWorkflowMode === "auto_director";
  const modeHint = isAutoDirectorMode
    ? "自动导演会记录正文中明确发生的资源变化；事实或归属有疑问时，请你对照证据确认。"
    : "改完正文后可复查本章资源变化，确认后的结果会影响后续写作。";
  const openConflicts = chapterRuntimePackage?.context.openConflicts ?? [];
  const blockingIssues = chapterRuntimePackage?.audit.openIssues ?? [];
  const failureSummary = chapterRuntimePackage?.failureClassification?.summary?.trim() ?? "";
  const timelineCheck = chapterRuntimePackage?.timelineCheck ?? null;

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">资源与风险</div>
            <div className="mt-1 text-sm font-medium text-foreground">本章关键资源和风险提示</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{modeHint}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={isAutoDirectorMode ? "secondary" : "outline"}>{isAutoDirectorMode ? "自动同步" : "手动复查"}</Badge>
            {pendingCharacterResourceProposals.length > 0 ? <Badge variant="secondary">{pendingCharacterResourceProposals.length}</Badge> : null}
          </div>
        </div>
        {!isAutoDirectorMode ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onExtractChapterResources?.()}
            disabled={isExtractingChapterResources || !onExtractChapterResources}
            className="mt-3 w-full justify-center gap-2"
          >
            <RefreshCw className={isExtractingChapterResources ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {isExtractingChapterResources ? "复查中..." : "复查本章资源"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-xl bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">风险摘要</div>
          <div className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>失败分类</span>
              <span className="font-medium text-foreground">{failureSummary || "无"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>开放冲突</span>
              <span className="font-medium text-foreground">{openConflicts.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>阻断问题</span>
              <span className="font-medium text-foreground">{blockingIssues.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>时间线</span>
              <span className="font-medium text-foreground">{timelineCheck ? getTimelineCheckLabel(timelineCheck.status) : "未检测"}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">当前章节</div>
          <div className="mt-2 text-sm font-medium text-foreground">
            {selectedChapter ? `第${selectedChapter.order}章 ${selectedChapter.title || "未命名章节"}` : "未选择章节"}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {chapterResourceContext?.summary ?? "选中章节后会提示本章可用、需铺垫和不可直接使用的资源。"}
          </div>
        </div>
      </div>

      {isLoadingChapterResourceContext ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-3 text-xs leading-6 text-muted-foreground">
          资源边界读取中。
        </div>
      ) : null}

      <div className="space-y-3">
        <ResourceGroup title="可用资源" items={chapterResourceContext?.availableItems ?? []} emptyText="没有需要特别依赖的可用资源。" />
        <ResourceGroup title="需要铺垫" items={chapterResourceContext?.setupNeededItems ?? []} emptyText="没有必须先铺垫的资源。" />
        <ResourceGroup title="不能提前使用" items={chapterResourceContext?.blockedItems ?? []} emptyText="没有被消耗、丢失或毁坏的关键资源。" />
        <ResourceGroup title="需要留意的已记录资源" items={chapterResourceContext?.highRiskCommittedItems ?? []} emptyText="没有需要额外留意的已记录资源。" />

        {pendingCharacterResourceProposals.length > 0 ? (
          <section className="space-y-3 rounded-lg bg-amber-50/60 p-3 dark:bg-amber-950/20" aria-label="需要判断的资源变更">
            <h3 className="text-sm font-medium">需要判断的资源变更（{pendingCharacterResourceProposals.length}）</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              对照正文核对下方变化。确认会记入资源账本，忽略会保留提案记录；两种操作都不会重写正文。
              {isAutoDirectorMode ? "处理完本章全部待核对提案后，回到本工作区点击“继续自动导演”，接续原任务的状态提交。" : "处理后可从本章原任务入口恢复未完成步骤。"}
            </p>
            <div className="divide-y divide-border/60">
            {pendingCharacterResourceProposals.map((proposal) => {
              const review = buildResourceReviewPresentation(proposal);
              return (
              <div key={proposal.id} className="space-y-3 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 text-sm font-medium leading-5">{typeof proposal.payload.resourceName === "string" ? proposal.payload.resourceName : proposal.summary}</div>
                  <Badge variant="secondary">{["chapter_background_sync", "chapter_artifact_delta"].includes(proposal.sourceType ?? "") ? "自动同步发现" : "资源变化提案"}</Badge>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{review.question}</p>
                {review.ledgerFact || review.chapterFact ? (
                  <dl className="space-y-2 text-xs leading-5">
                    {review.ledgerFact ? <div><dt className="font-medium">已有记录</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{review.ledgerFact}</dd></div> : null}
                    {review.chapterFact ? <div><dt className="font-medium">本章变化</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{review.chapterFact}</dd></div> : null}
                  </dl>
                ) : null}
                <div className="space-y-1 text-xs leading-5">
                  <div className="font-medium">正文证据</div>
                  {proposal.evidence.length > 0 ? proposal.evidence.map((evidence, index) => (
                    <p key={index} className="whitespace-pre-wrap break-words text-muted-foreground">{evidence}</p>
                  )) : <p className="text-muted-foreground">未提供正文证据，请先核对本章正文。</p>}
                </div>
                <details className="text-xs leading-5">
                  <summary className="cursor-pointer text-muted-foreground">查看资源详情与核对说明</summary>
                  <div className="mt-2 space-y-3">
                    {typeof proposal.payload.summary === "string" ? <p>{proposal.payload.summary}</p> : null}
                    {typeof proposal.payload.narrativeImpact === "string" ? <p className="text-muted-foreground">后续影响：{proposal.payload.narrativeImpact}</p> : null}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
                      <dt className="text-muted-foreground">持有人</dt>
                      <dd className="break-words">{proposalText(proposal.payload, "holderCharacterName")}</dd>
                      <dt className="text-muted-foreground">归属类型</dt>
                      <dd>{OWNER_TYPE_LABELS[proposalText(proposal.payload, "ownerType")] ?? proposalText(proposal.payload, "ownerType")}</dd>
                      <dt className="text-muted-foreground">所有者</dt>
                      <dd className="break-words">{proposalText(proposal.payload, "ownerName")}</dd>
                      <dt className="text-muted-foreground">变更后状态</dt>
                      <dd>{RESOURCE_STATUS_LABELS[proposalText(proposal.payload, "statusAfter")] ?? proposalText(proposal.payload, "statusAfter")}</dd>
                    </dl>
                    <p className="text-xs leading-5 text-muted-foreground">持有物品不等于拥有它。确认前请分别核对持有人、所有者及状态。</p>
                    <div className="space-y-1 text-xs leading-5">
                      <div className="font-medium">使用限制</div>
                      {Array.isArray(proposal.payload.constraints) && proposal.payload.constraints.length > 0
                        ? proposal.payload.constraints.filter((item): item is string => typeof item === "string").map((constraint, index) => (
                          <p key={index} className="whitespace-pre-wrap break-words text-muted-foreground">{constraint}</p>
                        ))
                        : <p className="text-muted-foreground">提案未列出使用限制。</p>}
                    </div>
                    <div className="space-y-1 text-xs leading-5">
                      <div className="font-medium">核对原因</div>
                      {review.reasons.length > 0 ? review.reasons.map((note, index) => (
                        <p key={index} className="break-words text-muted-foreground">{note}</p>
                      )) : <p className="text-muted-foreground">请确认正文证据支持这项资源变化。</p>}
                    </div>
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onConfirmCharacterResourceProposal?.(proposal.id)} disabled={confirmingCharacterResourceProposalId === proposal.id || proposal.validationNotes.includes("actual_state:invalid_extraction")}>
                    {confirmingCharacterResourceProposalId === proposal.id ? "确认中..." : "确认"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRejectCharacterResourceProposal?.(proposal.id)}
                    disabled={rejectingCharacterResourceProposalId === proposal.id}
                  >
                    {rejectingCharacterResourceProposalId === proposal.id ? "处理中..." : "忽略"}
                  </Button>
                </div>
              </div>
              );
            })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
