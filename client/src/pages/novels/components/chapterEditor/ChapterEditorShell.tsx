import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ChapterEditorDiagnosticCard,
  ChapterEditorOperation,
  ChapterEditorRecommendedTask,
  ChapterEditorRevisionScope,
  ChapterEditorTargetRange,
} from "@ai-novel/shared/types/novel";
import { createNovelSnapshot, previewChapterAiRevision, updateNovelChapter } from "@/api/novel";
import { queryKeys } from "@/api/queryKeys";
import { toast } from "@/components/ui/toast";
import { useLocalDB } from "@/hooks/useLocalDB";
import { useLLMStore } from "@/store/llmStore";
import ChapterEditorDirectorPanel from "./ChapterEditorDirectorPanel";
import ChapterEditorSidebar from "./ChapterEditorSidebar";
import ChapterTextEditor from "./ChapterTextEditor";
import SelectionAIFloatingToolbar from "./SelectionAIFloatingToolbar";
import type {
  ChapterEditorSelectionRange,
  ChapterEditorSessionState,
  ChapterEditorShellProps,
  SelectionToolbarPosition,
} from "./chapterEditorTypes";
import {
  CHAPTER_EDITOR_OPERATION_LABELS,
  applyCandidateToContent,
  buildAiRevisionRequest,
  countEditorWords,
  getSaveStatusLabel,
  normalizeChapterContent,
} from "./chapterEditorUtils";

const EMPTY_SESSION: ChapterEditorSessionState = {
  sessionId: "",
  scope: "selection",
  targetRange: {
    from: 0,
    to: 0,
    text: "",
  },
  candidates: [],
  activeCandidateId: null,
  status: "idle",
  viewMode: "block",
};

const CHAPTER_DRAFT_STORAGE_PREFIX = "chapter-editor-draft";

interface ChapterEditorLocalDraft {
  content: string;
  savedContent: string;
  serverUpdatedAt?: string | null;
  updatedAt: number;
}

function toSelectionFromRange(
  content: string,
  range?: Pick<ChapterEditorTargetRange, "from" | "to"> | null,
): ChapterEditorSelectionRange | null {
  if (!range) {
    return null;
  }
  if (range.from < 0 || range.to <= range.from || range.to > content.length) {
    return null;
  }
  const text = content.slice(range.from, range.to);
  if (!text.trim()) {
    return null;
  }
  return {
    from: range.from,
    to: range.to,
    text,
  };
}

export default function ChapterEditorShell(props: ChapterEditorShellProps) {
  const {
    novelId,
    chapter,
    workspace,
    workspaceStatus,
    onBack,
    onOpenVersionHistory,
  } = props;
  const llm = useLLMStore();
  const queryClient = useQueryClient();
  const { getItem, setItem, removeItem } = useLocalDB();
  const lastPreviewRequestRef = useRef<ReturnType<typeof buildAiRevisionRequest> | null>(null);
  const activeChapterIdRef = useRef<string | null>(chapter?.id ?? null);
  const latestDraftRef = useRef("");
  const latestSavedContentRef = useRef("");
  const latestServerContentRef = useRef("");
  const normalizedChapterContent = useMemo(() => normalizeChapterContent(chapter?.content ?? ""), [chapter?.content]);
  const draftStorageKey = useMemo(
    () => (chapter?.id ? `${CHAPTER_DRAFT_STORAGE_PREFIX}:${novelId}:${chapter.id}` : ""),
    [chapter?.id, novelId],
  );

  const [contentDraft, setContentDraft] = useState(normalizedChapterContent);
  const [savedContent, setSavedContent] = useState(normalizedChapterContent);
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selection, setSelection] = useState<ChapterEditorSelectionRange | null>(null);
  const [selectionToolbarPosition, setSelectionToolbarPosition] = useState<SelectionToolbarPosition | null>(null);
  const [session, setSession] = useState<ChapterEditorSessionState>(EMPTY_SESSION);
  const [revisionScope, setRevisionScope] = useState<ChapterEditorRevisionScope>("selection");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState<string | null>(null);

  useEffect(() => {
    latestDraftRef.current = contentDraft;
  }, [contentDraft]);

  useEffect(() => {
    latestSavedContentRef.current = savedContent;
  }, [savedContent]);

  useEffect(() => {
    if (!chapter?.id || !draftStorageKey) {
      setIsDraftReady(false);
      return;
    }

    let isCancelled = false;
    const activeChapterId = chapter.id;
    const serverContent = normalizedChapterContent;

    activeChapterIdRef.current = activeChapterId;
    latestServerContentRef.current = serverContent;
    latestDraftRef.current = serverContent;
    latestSavedContentRef.current = serverContent;
    setIsDraftReady(false);
    setContentDraft(serverContent);
    setSavedContent(serverContent);
    setSaveStatus("idle");
    setSelection(null);
    setSelectionToolbarPosition(null);
    setSession(EMPTY_SESSION);
    setRevisionInstruction("");
    setRevisionScope("selection");
    lastPreviewRequestRef.current = null;

    void getItem<ChapterEditorLocalDraft>(draftStorageKey)
      .then((storedDraft) => {
        if (isCancelled || activeChapterIdRef.current !== activeChapterId) {
          return;
        }
        const hasCurrentLocalEdits = latestDraftRef.current !== latestSavedContentRef.current;
        if (!hasCurrentLocalEdits && typeof storedDraft?.content === "string" && storedDraft.content !== serverContent) {
          latestDraftRef.current = storedDraft.content;
          setContentDraft(storedDraft.content);
          setSaveStatus("idle");
          toast.info("已恢复本地未保存草稿。");
        }
      })
      .catch(() => {
        if (!isCancelled) {
          toast.error("本地草稿读取失败，当前显示服务端已保存正文。");
        }
      })
      .finally(() => {
        if (!isCancelled && activeChapterIdRef.current === activeChapterId) {
          setIsDraftReady(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [chapter?.id, draftStorageKey, getItem]);

  useEffect(() => {
    if (!chapter?.id || activeChapterIdRef.current !== chapter.id) {
      return;
    }

    const nextServerContent = normalizedChapterContent;
    if (latestServerContentRef.current === nextServerContent) {
      return;
    }

    latestServerContentRef.current = nextServerContent;
    const hasLocalChanges = latestDraftRef.current !== latestSavedContentRef.current;
    latestSavedContentRef.current = nextServerContent;
    setSavedContent(nextServerContent);

    if (!hasLocalChanges) {
      latestDraftRef.current = nextServerContent;
      setContentDraft(nextServerContent);
      setSaveStatus("idle");
      return;
    }

    toast.warning("服务端章节已刷新，已保留你的本地未保存草稿。");
  }, [chapter?.id, normalizedChapterContent]);

  useEffect(() => {
    if (!workspace) {
      setSelectedDiagnosticId(null);
      return;
    }
    if (selectedDiagnosticId && !workspace.diagnosticCards.some((card) => card.id === selectedDiagnosticId)) {
      setSelectedDiagnosticId(null);
    }
  }, [selectedDiagnosticId, workspace]);

  const isDirty = contentDraft !== savedContent;
  const wordCount = useMemo(() => countEditorWords(contentDraft), [contentDraft]);

  useEffect(() => {
    if (!draftStorageKey || !isDraftReady) {
      return;
    }

    if (!isDirty) {
      void removeItem(draftStorageKey);
      return;
    }

    const draft: ChapterEditorLocalDraft = {
      content: contentDraft,
      savedContent,
      serverUpdatedAt: chapter?.updatedAt ?? null,
      updatedAt: Date.now(),
    };
    const timerId = window.setTimeout(() => {
      void setItem(draftStorageKey, draft);
    }, 250);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [chapter?.updatedAt, contentDraft, draftStorageKey, isDirty, isDraftReady, removeItem, savedContent, setItem]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  const activeCandidate = useMemo(
    () => session.candidates?.find((candidate) => candidate.id === session.activeCandidateId) ?? null,
    [session.activeCandidateId, session.candidates],
  );
  const selectedDiagnosticCard = useMemo(
    () => workspace?.diagnosticCards.find((card) => card.id === selectedDiagnosticId) ?? null,
    [selectedDiagnosticId, workspace],
  );
  const selectedDiagnosticSelection = useMemo(
    () => toSelectionFromRange(contentDraft, selectedDiagnosticCard?.anchorRange ?? null),
    [contentDraft, selectedDiagnosticCard?.anchorRange],
  );
  const recommendedTaskSelection = useMemo(
    () => toSelectionFromRange(contentDraft, workspace?.recommendedTask?.anchorRange ?? null),
    [contentDraft, workspace?.recommendedTask?.anchorRange],
  );

  const invalidateChapterQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.novels.detail(novelId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.novels.chapterEditorWorkspace(novelId, chapter?.id ?? "none") }),
      queryClient.invalidateQueries({ queryKey: queryKeys.novels.snapshots(novelId) }),
      chapter?.id
        ? queryClient.invalidateQueries({ queryKey: queryKeys.novels.chapterPlan(novelId, chapter.id) })
        : Promise.resolve(),
      chapter?.id
        ? queryClient.invalidateQueries({ queryKey: queryKeys.novels.chapterAuditReports(novelId, chapter.id) })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: queryKeys.novels.latestStateSnapshot(novelId) }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (nextContent: string) => {
      if (!chapter) {
        throw new Error("当前未选中章节。");
      }
      return updateNovelChapter(novelId, chapter.id, { content: nextContent });
    },
    onMutate: () => {
      setSaveStatus("saving");
    },
    onSuccess: async (_response, nextContent) => {
      setSavedContent(nextContent);
      setSaveStatus("saved");
      if (draftStorageKey) {
        await removeItem(draftStorageKey);
      }
      await invalidateChapterQueries();
      toast.success("章节正文已保存。");
    },
    onError: (error) => {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "章节保存失败。");
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (request: ReturnType<typeof buildAiRevisionRequest>) => {
      if (!chapter) {
        throw new Error("当前未选中章节。");
      }
      return previewChapterAiRevision(novelId, chapter.id, request);
    },
    onMutate: (request) => {
      lastPreviewRequestRef.current = request;
      const label = request.source === "freeform"
        ? (request.scope === "chapter" ? "正在生成整章自然语言修正方案" : "正在按你的意见改写片段")
        : request.presetOperation
          ? `正在生成${CHAPTER_EDITOR_OPERATION_LABELS[request.presetOperation]}方案`
          : "正在生成修正方案";
      setSession((current) => ({
        ...current,
        status: "loading",
        requestLabel: label,
        customInstruction: request.instruction,
        scope: request.scope,
        targetRange: request.selection ?? {
          from: 0,
          to: contentDraft.length,
          text: contentDraft,
        },
        candidates: [],
        activeCandidateId: null,
        errorMessage: undefined,
      }));
    },
    onSuccess: (response) => {
      const data = response.data;
      if (!data) {
        setSession((current) => ({
          ...current,
          status: "error",
          errorMessage: "AI 未返回改写结果，请重试。",
        }));
        return;
      }
      setSession((current) => ({
        ...data,
        status: "ready",
        viewMode: "block",
        requestLabel: current.requestLabel,
        errorMessage: undefined,
      }));
      setSelection(null);
      setSelectionToolbarPosition(null);
    },
    onError: (error) => {
      setSession((current) => ({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "AI 修正失败，请重试。",
      }));
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!chapter || !activeCandidate || !session.targetRange) {
        throw new Error("当前没有可应用的候选版本。");
      }
      const label = `chapter-editor:${chapter.order}:${session.scope}:${Date.now()}`;
      const nextContent = applyCandidateToContent(contentDraft, session.targetRange, activeCandidate.content);
      await createNovelSnapshot(novelId, {
        triggerType: "manual",
        label,
      });
      await updateNovelChapter(novelId, chapter.id, {
        content: nextContent,
      });
      return nextContent;
    },
    onSuccess: async (nextContent) => {
      setContentDraft(nextContent);
      setSavedContent(nextContent);
      setSaveStatus("saved");
      setSession(EMPTY_SESSION);
      setRevisionInstruction("");
      if (draftStorageKey) {
        await removeItem(draftStorageKey);
      }
      await invalidateChapterQueries();
      toast.success("已应用候选版本，并创建 AI 修改前快照。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "应用候选版本失败。");
    },
  });

  const previewPayload = session.status === "loading" && session.targetRange?.text
    ? {
      mode: "loading" as const,
      from: session.targetRange.from,
      to: session.targetRange.to,
      originalText: session.targetRange.text,
    }
    : session.status === "ready" && activeCandidate && session.targetRange
      ? {
        mode: session.viewMode,
        from: session.targetRange.from,
        to: session.targetRange.to,
        diffChunks: activeCandidate.diffChunks,
        originalText: session.targetRange.text,
        candidateText: activeCandidate.content,
      }
      : null;

  if (!chapter) {
    return (
      <div className="rounded-3xl border border-dashed border-border/70 bg-muted/10 p-10 text-center text-sm text-muted-foreground">
        请选择一个章节后开始编辑正文。
      </div>
    );
  }

  const getSelectionTarget = (
    overrideSelection?: ChapterEditorSelectionRange | null,
    task?: ChapterEditorRecommendedTask | null,
  ) => overrideSelection
    ?? selection
    ?? selectedDiagnosticSelection
    ?? toSelectionFromRange(contentDraft, task?.anchorRange ?? null)
    ?? recommendedTaskSelection
    ?? null;

  const runRevision = (
    source: "preset" | "freeform",
    scope: ChapterEditorRevisionScope,
    options?: {
      presetOperation?: ChapterEditorOperation;
      instruction?: string;
      selectionOverride?: ChapterEditorSelectionRange | null;
      task?: ChapterEditorRecommendedTask | null;
    },
  ) => {
    const resolvedSelection = scope === "selection"
      ? getSelectionTarget(options?.selectionOverride, options?.task)
      : null;

    if (scope === "selection" && !resolvedSelection) {
      toast.error("请先选中正文片段，或先从问题卡定位到对应片段。");
      return;
    }

    const request = buildAiRevisionRequest({
      source,
      scope,
      presetOperation: options?.presetOperation,
      instruction: options?.instruction,
      selection: resolvedSelection,
      content: contentDraft,
      provider: llm.provider,
      model: llm.model,
      temperature: llm.temperature,
    });
    previewMutation.mutate(request);
  };

  const handleRunOperation = (operation: ChapterEditorOperation, customInstruction?: string) => {
    runRevision(
      operation === "custom" ? "freeform" : "preset",
      "selection",
      {
        presetOperation: operation === "custom" ? undefined : operation,
        instruction: customInstruction,
        selectionOverride: selection,
      },
    );
  };

  const handleRegenerate = () => {
    if (!lastPreviewRequestRef.current) {
      return;
    }
    previewMutation.mutate(lastPreviewRequestRef.current);
  };

  const handleReject = () => {
    setSession(EMPTY_SESSION);
  };

  const handleFocusDiagnostic = (card: ChapterEditorDiagnosticCard) => {
    if (selectedDiagnosticId === card.id) {
      setSelectedDiagnosticId(null);
      return;
    }
    setSelectedDiagnosticId(card.id);
    setSelection(null);
    setSelectionToolbarPosition(null);
  };

  const handleRunDiagnostic = (card: ChapterEditorDiagnosticCard) => {
    setSelectedDiagnosticId(card.id);
    runRevision("preset", card.recommendedScope, {
      presetOperation: card.recommendedAction,
      selectionOverride: toSelectionFromRange(contentDraft, card.anchorRange ?? null),
    });
  };

  const handleRunRecommended = () => {
    if (!workspace?.recommendedTask) {
      return;
    }
    runRevision("preset", workspace.recommendedTask.recommendedScope, {
      presetOperation: workspace.recommendedTask.recommendedAction,
      task: workspace.recommendedTask,
    });
  };

  const handleRunSelectedDiagnostic = () => {
    if (!selectedDiagnosticCard) {
      return;
    }
    handleRunDiagnostic(selectedDiagnosticCard);
  };

  const handleRunFreeform = () => {
    runRevision("freeform", revisionScope, {
      instruction: revisionInstruction.trim(),
    });
  };

  const currentTargetDescription = revisionScope === "chapter"
    ? "整章正文"
    : selection
      ? "你手动选中的正文片段"
      : selectedDiagnosticCard?.paragraphLabel
        ? `${selectedDiagnosticCard.paragraphLabel} 对应片段`
        : workspace?.recommendedTask?.paragraphLabel
          ? `${workspace.recommendedTask.paragraphLabel} 对应片段`
          : "尚未选中片段";
  const canRunSelectionRevision = Boolean(getSelectionTarget());
  const headerSaveLabel = getSaveStatusLabel(saveStatus, isDirty);
  const gridClassName = "xl:grid-cols-[320px_minmax(0,1fr)_400px]";
  const confirmLeaveWithUnsavedChanges = () => (
    !isDirty || window.confirm("当前章节有未保存修改，确定离开吗？")
  );
  const handleBack = onBack
    ? () => {
      if (confirmLeaveWithUnsavedChanges()) {
        onBack();
      }
    }
    : undefined;
  const handleOpenVersionHistory = onOpenVersionHistory
    ? () => {
      if (confirmLeaveWithUnsavedChanges()) {
        onOpenVersionHistory();
      }
    }
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className={`grid min-h-0 flex-1 gap-4 overflow-hidden ${gridClassName}`}>
        <ChapterEditorSidebar
          chapter={chapter}
          workspace={workspace}
          workspaceStatus={workspaceStatus}
          wordCount={wordCount}
          saveStatusLabel={headerSaveLabel}
          isDirty={isDirty}
          isSaving={saveMutation.isPending}
          selectedDiagnosticId={selectedDiagnosticId}
          onBack={handleBack}
          onOpenVersionHistory={handleOpenVersionHistory}
          onSave={() => saveMutation.mutate(contentDraft)}
          onFocusDiagnostic={handleFocusDiagnostic}
          onRunDiagnostic={handleRunDiagnostic}
        />

        <div className="relative min-h-0 overflow-hidden">
          <ChapterTextEditor
            value={contentDraft}
            readOnly={session.status !== "idle"}
            onChange={(next) => {
              setContentDraft(next);
              setSaveStatus("idle");
            }}
            onSelectionChange={(nextSelection, position) => {
              setSelection(nextSelection);
              setSelectionToolbarPosition(position);
              if (nextSelection) {
                setSelectedDiagnosticId(null);
              }
            }}
            preview={previewPayload}
            focusRange={session.status === "idle"
              ? selection
                ? { from: selection.from, to: selection.to }
                : selectedDiagnosticCard?.anchorRange ?? null
              : null}
          />
          <SelectionAIFloatingToolbar
            visible={Boolean(selection && session.status === "idle")}
            position={selectionToolbarPosition}
            disabled={previewMutation.isPending}
            onRunOperation={handleRunOperation}
          />
        </div>

        <div className="min-h-0 overflow-hidden">
          <ChapterEditorDirectorPanel
            workspace={workspace}
            workspaceStatus={workspaceStatus}
            selectedDiagnosticCard={selectedDiagnosticCard}
            session={session}
            activeCandidate={activeCandidate}
            revisionScope={revisionScope}
            revisionInstruction={revisionInstruction}
            canRunSelectionRevision={canRunSelectionRevision}
            currentTargetDescription={currentTargetDescription}
            isGenerating={previewMutation.isPending}
            isApplying={acceptMutation.isPending}
            onInstructionChange={setRevisionInstruction}
            onScopeChange={setRevisionScope}
            onRunRecommended={handleRunRecommended}
            onRunSelectedDiagnostic={handleRunSelectedDiagnostic}
            onRunFreeform={handleRunFreeform}
            onSelectCandidate={(candidateId) => setSession((current) => ({ ...current, activeCandidateId: candidateId }))}
            onChangeViewMode={(mode) => setSession((current) => ({ ...current, viewMode: mode }))}
            onAccept={() => acceptMutation.mutate()}
            onReject={handleReject}
            onRegenerate={handleRegenerate}
          />
        </div>
      </div>
    </div>
  );
}
