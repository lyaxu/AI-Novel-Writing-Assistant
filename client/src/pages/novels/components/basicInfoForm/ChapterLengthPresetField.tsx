import { useRef, useState } from "react";
import {
  CHAPTER_LENGTH_PRESETS,
  CUSTOM_CHAPTER_LENGTH_PRESET_ID,
  findChapterLengthPresetByCount,
  formatEstimatedTotalWords,
  resolveChapterLengthPresetId,
  type ChapterLengthPresetId,
} from "@ai-novel/shared/types/planningScale";
import { cn } from "@/lib/utils";
import type { NovelBasicFormState } from "../../novelBasicInfo.shared";
import { FieldLabel } from "./BasicInfoFormPrimitives";

const MAX_ESTIMATED_CHAPTER_COUNT = 2000;

interface ChapterLengthPresetFieldProps {
  basicForm: NovelBasicFormState;
  onFormChange: (patch: Partial<NovelBasicFormState>) => void;
  inputId: string;
  inputClassName?: string;
  hint?: string;
}

function clampChapterCount(value: number): number {
  if (!Number.isFinite(value)) {
    return basicFormFallback();
  }
  return Math.max(1, Math.min(MAX_ESTIMATED_CHAPTER_COUNT, Math.round(value)));
}

function basicFormFallback(): number {
  return CHAPTER_LENGTH_PRESETS.find((preset) => preset.recommended)?.chapterCount ?? 100;
}

/**
 * 开书基础信息里的篇幅选择：短篇 / 中篇 / 长篇 / 超长篇 + 自定义章节数。
 * 默认选中长篇 100 章；手填章节数不匹配预设时自动展示为自定义。
 */
export default function ChapterLengthPresetField({
  basicForm,
  onFormChange,
  inputId,
  inputClassName,
  hint,
}: ChapterLengthPresetFieldProps) {
  const [chapterCountDraft, setChapterCountDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedPresetId = resolveChapterLengthPresetId(basicForm.estimatedChapterCount);
  const matchedPreset = findChapterLengthPresetByCount(basicForm.estimatedChapterCount);

  const handlePresetSelect = (presetId: ChapterLengthPresetId) => {
    if (presetId === CUSTOM_CHAPTER_LENGTH_PRESET_ID) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    const preset = CHAPTER_LENGTH_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setChapterCountDraft(null);
    onFormChange({ estimatedChapterCount: preset.chapterCount });
  };

  return (
    <div className="space-y-3">
      <FieldLabel htmlFor={inputId} hint={hint ?? "决定全书大纲、分卷和章纲的规划规模，后续仍可调整。"}>
        篇幅规模
      </FieldLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CHAPTER_LENGTH_PRESETS.map((preset) => {
          const selected = selectedPresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePresetSelect(preset.id)}
              className={cn(
                "rounded-lg px-3 py-2.5 text-left transition ring-1",
                selected
                  ? "bg-primary/8 ring-primary/35"
                  : "bg-background/70 ring-border/20 hover:bg-background hover:ring-primary/25",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{preset.label}</span>
                <span className="text-xs text-muted-foreground">{preset.chapterCount} 章</span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{preset.summary}</div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => handlePresetSelect(CUSTOM_CHAPTER_LENGTH_PRESET_ID)}
          className={cn(
            "rounded-lg px-3 py-2.5 text-left transition ring-1",
            selectedPresetId === CUSTOM_CHAPTER_LENGTH_PRESET_ID
              ? "bg-primary/8 ring-primary/35"
              : "bg-background/70 ring-border/20 hover:bg-background hover:ring-primary/25",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">自定义</span>
            <span className="text-xs text-muted-foreground">
              {matchedPreset ? "手填" : `${basicForm.estimatedChapterCount} 章`}
            </span>
          </div>
          <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
            已有明确篇幅计划时，直接填写全书章节数。
          </div>
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">全书章节数</span>
          <input
            ref={inputRef}
            id={inputId}
            type="number"
            min={1}
            max={MAX_ESTIMATED_CHAPTER_COUNT}
            className={cn(
              "h-9 w-28 rounded-md border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              inputClassName,
            )}
            value={chapterCountDraft ?? String(basicForm.estimatedChapterCount)}
            onChange={(event) => {
              const draft = event.target.value;
              setChapterCountDraft(draft);
              const numeric = Number(draft);
              if (draft.trim() !== "" && Number.isFinite(numeric) && numeric >= 1) {
                onFormChange({ estimatedChapterCount: clampChapterCount(numeric) });
              }
            }}
            onBlur={() => {
              setChapterCountDraft(null);
              onFormChange({ estimatedChapterCount: clampChapterCount(basicForm.estimatedChapterCount) });
            }}
          />
          <span className="text-sm text-muted-foreground">章</span>
        </div>
        <div className="text-xs leading-5 text-muted-foreground">
          {formatEstimatedTotalWords(basicForm.estimatedChapterCount, basicForm.defaultChapterLength)}
        </div>
      </div>
      <div className="text-xs leading-5 text-muted-foreground">
        规划时会按约 50 章一卷安排分卷预算；不确定时保持推荐的长篇 100 章即可。
      </div>
    </div>
  );
}
