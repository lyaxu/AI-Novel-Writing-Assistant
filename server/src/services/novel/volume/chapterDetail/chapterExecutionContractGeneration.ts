import type {
  VolumeBeatSheet,
  VolumePlan,
  VolumePlanDocument,
} from "@ai-novel/shared/types/novel";
import { assessChapterExecutionContractShape } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import type { ChapterExecutionContractQualityCandidate } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import type { VolumeChapterDetailPromptInput } from "../../../../prompting/prompts/novel/volume/shared";
import {
  ChapterScenePlanNormalizationError,
  normalizeChapterScenePlan,
  serializeChapterScenePlan,
} from "@ai-novel/shared/types/chapterLengthControl";
import { runStructuredPrompt } from "../../../../prompting/core/promptRunner";
import { PLANNING_OUTPUT_TOKEN_BUDGET } from "../../../../prompting/prompts/novel/promptBudgetProfiles";
import { volumeChapterExecutionContractPrompt } from "../../../../prompting/prompts/novel/volume/chapterDetail.prompts";
import { buildVolumeChapterDetailContextBlocks } from "../../../../prompting/prompts/novel/volume/contextBlocks";
import { appendStoryCraftContractBlock } from "../../../settings/storyCraftContractContext";
import type { StoryMacroPlanService } from "../../storyMacro/StoryMacroPlanService";
import {
  ChapterTaskSheetQualityGateService,
  ChapterTaskSheetQualityGateError,
} from "../ChapterTaskSheetQualityGateService";
import { evaluateCandidateCapacity, resolveCandidateCapacityPlan } from "./chapterCapacityGate";
import { logChapterCapacityEvent, recordChapterCapacityAuditSafely } from "./chapterCapacityLog";
import {
  findMissingForeshadowActions,
  formatForeshadowToken,
} from "@ai-novel/shared/types/storyPlanningFramework";
import type {
  VolumeGenerateOptions,
  VolumeGenerationNovel,
  VolumeWorkspace,
} from "../volumeModels";
import { loadPlanningWrittenEvidence } from "../writtenEvidence";
import { recordChapterContractGuardEvent } from "./chapterContractGuardTrace";
import { loadSelectedPlanningDirection, projectPlanningHorizon } from "../planningPromises";

/** Reusing complete text is not reusing a semantic approval from an unknown source. */
export async function reviewExistingExecutionContract(input: {
  novelId: string; volumeId: string; chapter: VolumePlan["chapters"][number];
  workspace: Pick<VolumePlanDocument, "volumes"> & Partial<Pick<VolumePlanDocument, "beatSheets">>;
  options: Pick<VolumeGenerateOptions, "provider" | "model" | "taskId" | "entrypoint" | "signal" | "chapterTaskSheetQualityMode">;
  writtenEvidence?: import("@ai-novel/shared/types/novel/writtenEvidence").PlanningWrittenEvidence;
  selectedPlanningDirection?: import("@ai-novel/shared/types/novel/planningPromises").SelectedPlanningDirection;
}) {
  const writtenEvidence = input.writtenEvidence ?? await loadPlanningWrittenEvidence(input.novelId, input.chapter.chapterOrder);
  const selectedPlanningDirection = input.selectedPlanningDirection ?? await loadSelectedPlanningDirection(input.novelId, input.options.taskId);
  await new ChapterTaskSheetQualityGateService().assertCanEnterExecution({
    ...input.chapter, novelId: input.novelId, volumeId: input.volumeId,
    chapterId: input.chapter.id, chapterOrder: input.chapter.chapterOrder,
  }, { ...input.options, mode: input.options.chapterTaskSheetQualityMode,
    reviewContextJson: JSON.stringify({ writtenEvidence, selectedPlanningDirection, planningCandidate: input.chapter,
      ...projectPlanningHorizon(input.workspace, input.volumeId, [input.chapter.id]),
      planningContext: { targetVolume: input.workspace.volumes.find((volume) => volume.id === input.volumeId) ?? null },
    }) });
  const latestEvidence = await loadPlanningWrittenEvidence(input.novelId, input.chapter.chapterOrder);
  const latestDirection = await loadSelectedPlanningDirection(input.novelId, input.options.taskId);
  if (latestEvidence.sourceFingerprint !== writtenEvidence.sourceFingerprint
    || JSON.stringify(latestDirection) !== JSON.stringify(selectedPlanningDirection)) {
    throw new Error("Written evidence or selected planning direction changed during contract review; reload before execution.");
  }
}

type StoryMacroPlanResult = Awaited<ReturnType<StoryMacroPlanService["getPlan"]>> | null;

export function shouldRetryChapterExecutionContract(error: unknown, attempt: number): boolean {
  if (attempt > 0 || (error as { code?: string } | null)?.code === "LLM_OUTPUT_LIMIT"
    || (error as { category?: string } | null)?.category === "output_limit") {
    return false;
  }
  if (error instanceof ChapterScenePlanNormalizationError) {
    return true;
  }
  if (error instanceof ChapterTaskSheetQualityGateError) {
    return error.result.verdict === "repairable" && error.result.recommendedHandling === "repair_contract";
  }
  return Boolean(
    error
    && typeof error === "object"
    && (error as { promptQualityFailureKind?: unknown }).promptQualityFailureKind === "post_validate_failed"
  );
}

/** A rejected answer is correction material, never a usable or approved candidate. */
export interface InitialRejectedContractResponse {
  output: unknown;
  validationError: string;
}

export function buildRejectedContractFeedback(input: InitialRejectedContractResponse, error?: unknown): string {
  const cause = (error as { cause?: { issues?: unknown } } | undefined)?.cause;
  return JSON.stringify({
    kind: "rejected_contract_correction",
    rejectedResponse: input.output,
    validationError: input.validationError,
    relationshipIssues: cause?.issues ?? (error as { issues?: unknown } | undefined)?.issues ?? [],
  });
}

/** The parser only attaches this private receipt after a definite stop, never on truncation. */
export function preserveCompletedContractParseFailure(error: unknown): unknown {
  const failure = error as { name?: string; category?: string; rejectedOutput?: { rawContent?: unknown; finishReason?: string } };
  if (!(error instanceof Error) || failure.name !== "StructuredOutputError"
    || !["schema_mismatch", "malformed_json", "incomplete_json", "thinking_pollution"].includes(failure.category ?? "")
    || failure.rejectedOutput?.finishReason !== "stop" || typeof failure.rejectedOutput.rawContent !== "string") return error;
  const preserved = Object.assign(new Error(error.message, { cause: error }), {
    name: "ContractResponseValidationError", code: "PROMPT_POST_VALIDATION_FAILED",
    promptQualityFailureKind: "post_validate_failed",
  });
  Object.defineProperty(preserved, "completedPromptResponse", { value: {
    promptId: volumeChapterExecutionContractPrompt.id, promptVersion: volumeChapterExecutionContractPrompt.version,
    output: failure.rejectedOutput.rawContent, validationError: error.message,
    // This asset's raw envelope does not buy parser repair or runner semantic retries.
    repairAttempts: 0, semanticRetryAttempts: 0, maxSemanticRetryAttempts: 0,
  } });
  return preserved;
}

export function canReuseChapterExecutionContract(input: {
  novelId: string;
  volumeId: string;
  chapter: VolumePlan["chapters"][number];
}): boolean {
  const shape = assessChapterExecutionContractShape({
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapter.id,
    chapterOrder: input.chapter.chapterOrder,
    title: input.chapter.title,
    summary: input.chapter.summary,
    purpose: input.chapter.purpose,
    exclusiveEvent: input.chapter.exclusiveEvent,
    endingState: input.chapter.endingState,
    nextChapterEntryState: input.chapter.nextChapterEntryState,
    conflictLevel: input.chapter.conflictLevel,
    revealLevel: input.chapter.revealLevel,
    targetWordCount: input.chapter.targetWordCount,
    mustAvoid: input.chapter.mustAvoid,
    payoffRefs: input.chapter.payoffRefs,
    taskSheet: input.chapter.taskSheet,
    sceneCards: input.chapter.sceneCards,
  });
  if (!shape.canEnterExecution) return false;
  // Legacy contracts without a capacity plan stay reusable (readable); a contract that does carry
  // one must still pass the deterministic capacity gate before it can reach the writer.
  const capacity = evaluateCandidateCapacity({
    targetWordCount: input.chapter.targetWordCount,
    exclusiveEvent: input.chapter.exclusiveEvent,
    sceneCards: input.chapter.sceneCards,
  }, { allowDeferable: true });
  return !(capacity.capacityPlanPresent && !capacity.passed);
}

export async function generateChapterTaskSheetDetail(params: {
  promptInput: {
    writtenEvidence?: import("@ai-novel/shared/types/novel/writtenEvidence").PlanningWrittenEvidence;
    novel: VolumeGenerationNovel;
    workspace: VolumeWorkspace;
    storyMacroPlan: StoryMacroPlanResult;
    strategyPlan: VolumePlanDocument["strategyPlan"];
    targetVolume: VolumePlan;
    targetBeatSheet: VolumeBeatSheet | null;
    targetChapter: VolumePlan["chapters"][number];
    guidance?: string;
    detailMode: "task_sheet";
  };
  options: VolumeGenerateOptions;
  onBeforeModelCall?: () => Promise<void>;
  /** An explicit recovery grant buys exactly one correction, not a fresh two-attempt bundle. */
  initialRejectedResponse?: InitialRejectedContractResponse;
}): Promise<{
  purpose: string;
  exclusiveEvent: string;
  endingState: string;
  nextChapterEntryState: string;
  conflictLevel: number;
  revealLevel: number;
  targetWordCount: number;
  mustAvoid: string;
  payoffRefs: string[];
  /** Chapter-level minimum event list, mirrored into the persisted scene plan when produced. */
  requiredElements?: string[];
  taskSheet: string;
  sceneCards: string;
}> {
  const existingChapter = params.promptInput.targetChapter;
  if (
    !params.initialRejectedResponse
    && !params.promptInput.guidance?.trim()
    && canReuseChapterExecutionContract({
      novelId: params.promptInput.workspace.novelId,
      volumeId: params.promptInput.targetVolume.id,
      chapter: existingChapter,
    })
  ) {
    if (!params.options.planningRepairManaged) await reviewExistingExecutionContract({
      novelId: params.promptInput.workspace.novelId, volumeId: params.promptInput.targetVolume.id,
      chapter: existingChapter, options: params.options, writtenEvidence: params.promptInput.writtenEvidence,
      workspace: params.promptInput.workspace,
      selectedPlanningDirection: params.promptInput.novel.selectedPlanningDirection,
    });
    const scenePlan = normalizeChapterScenePlan(
      JSON.parse(existingChapter.sceneCards!),
      existingChapter.targetWordCount,
    );
    return {
      purpose: existingChapter.purpose?.trim() || existingChapter.summary.trim(),
      exclusiveEvent: existingChapter.exclusiveEvent?.trim() || existingChapter.summary.trim(),
      endingState: existingChapter.endingState?.trim() || "本章完成当前章节任务，并为下一章留下明确入口。",
      nextChapterEntryState: existingChapter.nextChapterEntryState?.trim() || existingChapter.endingState?.trim() || "下一章承接本章结果继续推进。",
      // Reuse is allowed only after the shape guard verified both numeric levels.
      conflictLevel: existingChapter.conflictLevel!,
      revealLevel: existingChapter.revealLevel!,
      targetWordCount: existingChapter.targetWordCount ?? 2200,
      mustAvoid: existingChapter.mustAvoid?.trim() || "避免偏离本章任务单和卷节奏。",
      payoffRefs: existingChapter.payoffRefs,
      requiredElements: scenePlan.requiredElements,
      taskSheet: existingChapter.taskSheet?.trim() ?? "",
      sceneCards: serializeChapterScenePlan(scenePlan),
    };
  }

  let lastError: Error | null = null;
  let qualityFeedback: string | null = params.initialRejectedResponse
    ? buildRejectedContractFeedback(params.initialRejectedResponse) : null;
  let previousCandidate: ChapterExecutionContractQualityCandidate | null = null;
  const qualityGate = new ChapterTaskSheetQualityGateService();

  const maxAttempts = params.initialRejectedResponse ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let receivedOutput: unknown;
    try {
      const promptInput: VolumeChapterDetailPromptInput = qualityFeedback
        ? {
          ...params.promptInput,
          contractRepairFeedback: qualityFeedback,
          guidance: [
            params.promptInput.guidance?.trim(),
            `上一版章节执行合同未通过质量门禁：${qualityFeedback}`,
          ].filter(Boolean).join("\n"),
        }
        : params.promptInput;
      await params.onBeforeModelCall?.();
      const generated = await runStructuredPrompt({
        asset: volumeChapterExecutionContractPrompt,
        promptInput,
        contextBlocks: await appendStoryCraftContractBlock(
          buildVolumeChapterDetailContextBlocks(promptInput),
          "planning",
        ),
        options: {
          provider: params.options.provider,
          model: params.options.model,
          temperature: params.options.temperature ?? 0.35,
          // The contract includes all scene cards, not just the task-sheet summary.
          maxTokens: PLANNING_OUTPUT_TOKEN_BUDGET,
          // The coordinator reserves each attempt durably. Hidden provider/strategy retries
          // would spend outside that reservation and erase the uncertainty boundary.
          disableFallbackModel: true,
          disableStrategyFallback: true,
          transportRetryCount: 0,
          taskId: params.options.taskId,
          entrypoint: params.options.entrypoint,
          novelId: promptInput.workspace.novelId,
          volumeId: promptInput.targetVolume.id,
          chapterId: promptInput.targetChapter.id,
          stage: "chapter_execution_contract",
          itemKey: "chapter_detail_bundle",
          scope: "chapter_detail",
          triggerReason: "chapter_detail_generation",
          signal: params.options.signal,
        },
      });
      receivedOutput = generated.output;
      if (params.options.planningRepairManaged && promptInput.targetChapter.targetWordCount) {
        generated.output.targetWordCount = promptInput.targetChapter.targetWordCount;
      }
      const capacityPlan = resolveCandidateCapacityPlan({
        capacityPlan: (generated.output as { capacityPlan?: unknown }).capacityPlan,
        targetWordCount: generated.output.targetWordCount ?? promptInput.targetChapter.targetWordCount,
      });
      if (!capacityPlan) {
        throw Object.assign(
          new Error("章节执行合同缺少容量计划（coreEvent/keyTurn/mustDeliver/deferable/seedOnly）。新合同必须同时给出容量计划后重新生成。"),
          {
            name: "ChapterCapacityPlanMissingError",
            code: "PROMPT_POST_VALIDATION_FAILED",
            promptQualityFailureKind: "post_validate_failed",
          },
        );
      }
      const scenePlan = normalizeChapterScenePlan(
        {
          scenes: generated.output.sceneCards,
          stateClaims: generated.output.stateClaims,
          readerExperience: generated.output.readerExperience,
          requiredElements: generated.output.requiredElements,
          capacityPlan,
        },
        generated.output.targetWordCount ?? promptInput.targetChapter.targetWordCount,
      );
      const candidate: ChapterExecutionContractQualityCandidate = {
        novelId: promptInput.workspace.novelId,
        volumeId: promptInput.targetVolume.id,
        chapterId: promptInput.targetChapter.id,
        chapterOrder: promptInput.targetChapter.chapterOrder,
        title: promptInput.targetChapter.title,
        summary: promptInput.targetChapter.summary,
        purpose: generated.output.purpose,
        exclusiveEvent: generated.output.exclusiveEvent,
        endingState: generated.output.endingState,
        nextChapterEntryState: generated.output.nextChapterEntryState,
        conflictLevel: generated.output.conflictLevel,
        revealLevel: generated.output.revealLevel,
        targetWordCount: generated.output.targetWordCount,
        mustAvoid: generated.output.mustAvoid,
        payoffRefs: generated.output.payoffRefs,
        // Omit rather than set undefined: the candidate is JSON round-tripped through the repair
        // feedback, and an explicit undefined key would not survive that trip.
        ...(generated.output.requiredElements ? { requiredElements: generated.output.requiredElements } : {}),
        capacityPlan,
        taskSheet: generated.output.taskSheet,
        sceneCards: serializeChapterScenePlan(scenePlan),
      };
      previousCandidate = candidate;
      // 伏笔动作是结构化规划义务：只在 requiredElements/taskSheet/场景 mustAdvance 中找
      // `[伏笔:Fxx]` 规划标记，不做正文关键词扫描。缺失时按“输出无效”退回一次修复，
      // 不把缺项静默降级成质量债，也不阻塞整条生产链。
      const missingForeshadowActions = promptInput.storyMacroPlan?.foreshadowSchedule?.length
        ? findMissingForeshadowActions({
          schedule: promptInput.storyMacroPlan.foreshadowSchedule,
          chapterOrder: promptInput.targetChapter.chapterOrder,
          plannedTexts: [
            ...(generated.output.requiredElements ?? []),
            generated.output.taskSheet,
            ...(generated.output.sceneCards ?? []).flatMap((scene) => [scene.purpose, ...(scene.mustAdvance ?? [])]),
          ],
        })
        : [];
      if (missingForeshadowActions.length > 0) {
        const missingDetail = missingForeshadowActions
          .map((action) => `${formatForeshadowToken(action.entry.id)}（${action.actions.join("/")}：${action.entry.question}）`)
          .join("；");
        throw Object.assign(
          new Error(`本章伏笔动作未在章纲中安排：${missingDetail}。请把这些动作写入 requiredElements，并以对应 [伏笔:Fxx] 标记开头。`),
          {
            name: "ChapterForeshadowCoverageError",
            code: "PROMPT_POST_VALIDATION_FAILED",
            promptQualityFailureKind: "post_validate_failed",
          },
        );
      }
      if (!params.options.planningRepairManaged) await qualityGate.assertCanEnterExecution(candidate, {
        mode: params.options.chapterTaskSheetQualityMode,
        provider: params.options.provider,
        model: params.options.model,
        taskId: params.options.taskId,
        entrypoint: params.options.entrypoint,
        signal: params.options.signal,
        // A freshly generated one-chapter contract must carry a capacity plan and may not push
        // deferred duties into nowhere; redistribution is the planning repair's job.
        requireCapacityPlan: true,
        allowDeferable: false,
        reviewContextJson: JSON.stringify({ writtenEvidence: promptInput.writtenEvidence ?? null,
          selectedPlanningDirection: promptInput.novel.selectedPlanningDirection ?? null,
          ...projectPlanningHorizon(promptInput.workspace, promptInput.targetVolume.id, [promptInput.targetChapter.id]),
          planningContext: { novel: promptInput.novel, targetVolume: promptInput.targetVolume } }),
      });
      // Record what the model actually declared, so an accepted contract can be read back
      // later. Without this, "the chapter is clean" cannot be told apart from "the guard had to
      // rewrite a self-contradictory contract before it was accepted".
      await recordChapterContractGuardEvent({
        novelId: promptInput.workspace.novelId,
        chapterId: promptInput.targetChapter.chapterId ?? promptInput.targetChapter.id,
        outcome: "accepted",
        attempt: attempt + 1,
        declaredConflicts: (generated.output.mustAvoidConflicts ?? []).length,
        declaredNeighborPreemptions: (generated.output.neighborEventUse ?? [])
          .filter((use) => use.consumesExclusiveEvent).length,
      }).catch(() => { /* Telemetry must never fail contract generation. */ });
      // 可延期职责不是“本章不做就算了”：记录数量，方便用户在运行日志/章节历史里
      // 看到这章被拆走了什么、由后续章节承接。
      if (capacityPlan.deferable.length > 0) {
        const detail = {
          novelId: promptInput.workspace.novelId,
          chapterOrder: promptInput.targetChapter.chapterOrder,
          deferable: capacityPlan.deferable,
        };
        logChapterCapacityEvent("redistributed", detail);
        await recordChapterCapacityAuditSafely({
          novelId: promptInput.workspace.novelId,
          chapterId: promptInput.targetChapter.chapterId ?? promptInput.targetChapter.id,
          chapterOrder: promptInput.targetChapter.chapterOrder,
          event: "deferred_duties",
          summary: `本章可延期职责 ${capacityPlan.deferable.length} 条，交给后续未写章节承接：${capacityPlan.deferable.join("；")}`,
        });
      }
      return {
        purpose: generated.output.purpose.trim(),
        exclusiveEvent: generated.output.exclusiveEvent.trim(),
        endingState: generated.output.endingState.trim(),
        nextChapterEntryState: generated.output.nextChapterEntryState.trim(),
        conflictLevel: generated.output.conflictLevel,
        revealLevel: generated.output.revealLevel,
        targetWordCount: generated.output.targetWordCount,
        mustAvoid: generated.output.mustAvoid.trim(),
        payoffRefs: generated.output.payoffRefs,
        ...(generated.output.requiredElements ? { requiredElements: generated.output.requiredElements } : {}),
        taskSheet: generated.output.taskSheet.trim(),
        sceneCards: serializeChapterScenePlan(scenePlan),
      };
    } catch (caught) {
      const error = preserveCompletedContractParseFailure(caught);
      lastError = error instanceof Error ? error : new Error("章节执行合同生成失败。");
      // The contract guard is otherwise invisible after the fact: the prompt runner only keeps
      // `semantic_retry_start` in an in-process Map that dies with the server. Recording the
      // rejection here is what makes "the guard actually fired" answerable after the fact.
      await recordChapterContractGuardEvent({
        novelId: params.promptInput.workspace.novelId,
        chapterId: params.promptInput.targetChapter.chapterId ?? params.promptInput.targetChapter.id,
        outcome: "rejected",
        reason: lastError.message,
        attempt: attempt + 1,
      }).catch(() => { /* Telemetry must never fail contract generation. */ });
      const capacityResult = lastError instanceof ChapterTaskSheetQualityGateError
        ? lastError.result.capacity
        : undefined;
      if (capacityResult && !capacityResult.passed) {
        logChapterCapacityEvent("rejected", {
          novelId: params.promptInput.workspace.novelId,
          chapterOrder: params.promptInput.targetChapter.chapterOrder,
          attempt: attempt + 1,
          violations: capacityResult.violations.map((violation) => ({
            code: violation.code,
            items: violation.items,
          })),
          requiresWindowReplan: capacityResult.requiresWindowReplan,
        });
        await recordChapterCapacityAuditSafely({
          novelId: params.promptInput.workspace.novelId,
          chapterId: params.promptInput.targetChapter.chapterId ?? params.promptInput.targetChapter.id,
          chapterOrder: params.promptInput.targetChapter.chapterOrder,
          event: capacityResult.requiresWindowReplan ? "rejected_needs_redistribution" : "rejected",
          summary: lastError.message,
          decision: capacityResult,
          extra: capacityResult.deferableItems.length ? `deferable=${capacityResult.deferableItems.join("；")}` : null,
        });
      }
      const completed = (error as { completedPromptResponse?: InitialRejectedContractResponse })?.completedPromptResponse;
      const rejectedResponse = completed ?? (receivedOutput === undefined ? undefined : {
        output: receivedOutput, validationError: lastError.message,
      });
      if (attempt + 1 >= maxAttempts || !shouldRetryChapterExecutionContract(error, attempt)) {
        throw lastError;
      }
      // Transport/unknown output must never become a new generation disguised as correction.
      if (!(error instanceof ChapterTaskSheetQualityGateError) && !rejectedResponse) throw lastError;
      qualityFeedback = error instanceof ChapterTaskSheetQualityGateError
        ? JSON.stringify({
          instruction: "修复上一候选的已核验问题，保留其有效设计；只返回完整修订合同，仍须重新通过写前审查。",
          previousCandidate,
          qualityResult: error.result,
        })
        : buildRejectedContractFeedback(rejectedResponse!, error);
    }
  }

  throw lastError ?? new Error("章节执行合同生成失败。");
}
