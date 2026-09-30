import type {
  AiChapterTaskSheetQualityAssessment,
  ChapterExecutionContractQualityCandidate,
  ChapterTaskSheetQualityGateResult,
  ChapterTaskSheetQualityMode,
  ChapterTaskSheetQualityIssue,
  ChapterPlanningIssueCheck,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";
import {
  assessChapterExecutionContractShape,
  formatChapterTaskSheetQualityFailure,
  mapSemanticAssessmentToQualityGate,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";
import type { LLMProvider } from "@ai-novel/shared/types/llm";
import { selectedPlanningPromiseIds, type SelectedPlanningDirection } from "@ai-novel/shared/types/novel/planningPromises";
import { runStructuredPrompt } from "../../../prompting/core/promptRunner";
import {
  chapterTaskSheetQualityPrompt,
} from "../../../prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts";

export interface ChapterTaskSheetQualityGateOptions {
  mode?: ChapterTaskSheetQualityMode;
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  taskId?: string;
  entrypoint?: string;
  signal?: AbortSignal;
  /** Actual book/window evidence, distinct from the candidate's claims. */
  reviewContextJson?: string;
  previousIssues?: ChapterTaskSheetQualityIssue[];
  priorIssueDecisions?: ChapterPlanningIssueCheck[];
  omittedResolvedIssueCount?: number;
}

export type ChapterTaskSheetSemanticAssessor = (input: {
  candidate: ChapterExecutionContractQualityCandidate;
  mode: ChapterTaskSheetQualityMode;
  options: ChapterTaskSheetQualityGateOptions;
}) => Promise<AiChapterTaskSheetQualityAssessment>;

function normalizeQualityMode(mode?: ChapterTaskSheetQualityMode): ChapterTaskSheetQualityMode {
  return mode ?? "ai_copilot";
}

/** Project the reviewed revision into duplicate current-plan slots, never into original promises/prose. */
export function projectCurrentQualityCandidate(
  candidate: ChapterExecutionContractQualityCandidate,
  reviewContextJson?: string,
): string | undefined {
  if (!reviewContextJson) return reviewContextJson;
  let context: Record<string, any>;
  try { context = JSON.parse(reviewContextJson); } catch { return reviewContextJson; }
  if (!context || typeof context !== "object" || Array.isArray(context)) return reviewContextJson;
  const replaceCurrent = (chapters: unknown) => Array.isArray(chapters)
    ? chapters.map((chapter) => chapter && (chapter.id === candidate.chapterId || chapter.chapterId === candidate.chapterId)
      ? { ...chapter, ...candidate, authority: "current_review_candidate_not_written_prose" }
      : chapter)
    : chapters;
  if (context.planningContext?.targetVolume?.chapters) {
    context.planningContext.targetVolume.chapters = replaceCurrent(context.planningContext.targetVolume.chapters);
  }
  if (context.readonlyOpeningRoutes) context.readonlyOpeningRoutes = replaceCurrent(context.readonlyOpeningRoutes);
  return JSON.stringify(context);
}

function ensureFailureResult(result: ChapterTaskSheetQualityGateResult): ChapterTaskSheetQualityGateResult {
  if (!result.canEnterExecution || result.status !== "passed") {
    return result;
  }
  return {
    ...result,
    status: "passed",
  };
}

export class ChapterTaskSheetQualityGateError extends Error {
  constructor(readonly result: ChapterTaskSheetQualityGateResult) {
    super(formatChapterTaskSheetQualityFailure(result));
    this.name = "ChapterTaskSheetQualityGateError";
  }
}

/** An invalid review is not a finding about the contract being reviewed. */
export class ChapterTaskSheetQualityReviewError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : "章节合同审查输出无效。");
    this.name = "ChapterTaskSheetQualityReviewError";
  }
}

export class ChapterTaskSheetQualityGateService {
  constructor(private readonly semanticAssessor?: ChapterTaskSheetSemanticAssessor) {}

  async evaluate(
    candidate: ChapterExecutionContractQualityCandidate,
    options: ChapterTaskSheetQualityGateOptions = {},
  ): Promise<ChapterTaskSheetQualityGateResult> {
    options = { ...options, reviewContextJson: projectCurrentQualityCandidate(candidate, options.reviewContextJson) };
    const mode = normalizeQualityMode(options.mode);
    const shapeResult = assessChapterExecutionContractShape(candidate);
    if (!shapeResult.canEnterExecution) {
      return shapeResult;
    }

    const assessment = this.semanticAssessor
      ? await this.semanticAssessor({ candidate, mode, options })
      : await this.runSemanticAssessment(candidate, mode, options);
    return ensureFailureResult(mapSemanticAssessmentToQualityGate(assessment, mode));
  }

  async assertCanEnterExecution(
    candidate: ChapterExecutionContractQualityCandidate,
    options: ChapterTaskSheetQualityGateOptions = {},
  ): Promise<ChapterTaskSheetQualityGateResult> {
    const result = await this.evaluate(candidate, options);
    if (!result.canEnterExecution) {
      throw new ChapterTaskSheetQualityGateError(result);
    }
    return result;
  }

  private async runSemanticAssessment(
    candidate: ChapterExecutionContractQualityCandidate,
    mode: ChapterTaskSheetQualityMode,
    options: ChapterTaskSheetQualityGateOptions,
  ): Promise<AiChapterTaskSheetQualityAssessment> {
    let promiseCount = 0;
    try {
      const context = JSON.parse(options.reviewContextJson || "{}");
      promiseCount = selectedPlanningPromiseIds(context?.selectedPlanningDirection as SelectedPlanningDirection | undefined, candidate.chapterOrder).length;
    } catch { /* Unknown original direction does not invent checks. */ }
    let validationFeedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const generated = await runStructuredPrompt({
          asset: chapterTaskSheetQualityPrompt,
          promptInput: {
            candidate,
            mode,
            reviewContextJson: options.reviewContextJson,
            previousIssues: options.previousIssues,
            priorIssueDecisions: options.priorIssueDecisions,
            omittedResolvedIssueCount: options.omittedResolvedIssueCount,
            validationFeedback,
          },
          options: {
            provider: options.provider,
            model: options.model,
            temperature: options.temperature ?? 0.1,
            // Bounded output headroom; invalid review output may be reissued once for this same candidate.
            maxTokens: Math.min(16000, 4000 + promiseCount * 600 + (options.previousIssues?.length ?? 0) * 500),
            taskId: options.taskId,
            entrypoint: options.entrypoint,
            novelId: candidate.novelId,
            volumeId: candidate.volumeId ?? undefined,
            chapterId: candidate.chapterId,
            stage: "chapter_task_sheet_quality",
            itemKey: "chapter_detail_bundle",
            scope: "chapter_detail",
            triggerReason: "chapter_task_sheet_quality_gate",
            signal: options.signal,
          },
        });
        return generated.output;
      } catch (error) {
        const kind = (error as { promptQualityFailureKind?: unknown } | null)?.promptQualityFailureKind;
        if (kind !== "post_validate_failed" && kind !== "schema_repair_failed") throw error;
        if (attempt > 0 || options.signal?.aborted) throw new ChapterTaskSheetQualityReviewError(error);
        validationFeedback = error instanceof Error ? error.message : "审查输出未通过结构或引用校验。";
      }
    }
    throw new Error("章节合同审查未完成。");
  }
}
