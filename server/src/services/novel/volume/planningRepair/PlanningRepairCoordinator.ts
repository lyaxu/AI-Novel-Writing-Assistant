import type { VolumeChapterPlan, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import type { ChapterTaskSheetQualityGateResult } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { runStructuredPrompt } from "../../../../prompting/core/promptRunner";
import { planningRepairPrompt, planningRepairReviewPrompt } from "../../../../prompting/prompts/novel/volume/planningRepair.prompts";
import { ChapterTaskSheetQualityGateService } from "../ChapterTaskSheetQualityGateService";
import { buildVolumeWorkspaceDocument } from "../volumeWorkspaceDocument";
import type { VolumeGenerateOptions } from "../volumeModels";
import { PlanningRepairStore, type RepairSession } from "./PlanningRepairStore";
import { applyPlanningRepairCandidate, planningRepairOutputSchema } from "./planningRepairDomain";
import { projectPlanningHorizon } from "../planningPromises";
import { buildReviewIssueHistory } from "./domain/reviewIssueHistory";

const committedDocuments = new WeakSet<object>();
const flights = new Map<string, { taskId: string; chapterId: string; promise: Promise<VolumePlanDocument> }>();

export function isCommittedPlanningRepairDocument(value: unknown): boolean {
  return typeof value === "object" && value !== null && committedDocuments.has(value);
}

export class PlanningRepairConfirmationRequired extends Error {
  readonly code = "PLANNING_REPAIR_CONFIRMATION_REQUIRED";
  constructor(message: string) { super(message); this.name = "PlanningRepairConfirmationRequired"; }
}

interface ReviewSet {
  chapters: Record<string, ChapterTaskSheetQualityGateResult>;
  window?: { usable: boolean; safeToSync: boolean; requiresUserDecision: boolean; summary: string; issues: string[] };
}

export interface PlanningRepairInput {
  writtenEvidence?: import("@ai-novel/shared/types/novel/writtenEvidence").PlanningWrittenEvidence;
  document: VolumePlanDocument;
  volumeId: string;
  chapterId: string;
  options: VolumeGenerateOptions & { taskId: string };
  context: unknown;
  generateInitial: (beforeModelCall: () => Promise<void>) => Promise<Partial<VolumeChapterPlan>>;
}

export function passedPlanningReview(result: ChapterTaskSheetQualityGateResult): boolean {
  return result.status === "passed" && result.verdict === "usable" && result.safeToSync === true;
}

function chaptersOf(document: VolumePlanDocument, volumeId: string) {
  const volume = document.volumes.find(v => v.id === volumeId);
  if (!volume) throw new Error("规划卷不存在。");
  return volume.chapters;
}

function refreshDerived(document: VolumePlanDocument): VolumePlanDocument {
  const derived = buildVolumeWorkspaceDocument(document);
  return { ...document, readiness: derived.readiness, derivedOutline: derived.derivedOutline,
    derivedStructuredOutline: derived.derivedStructuredOutline };
}

function currentEvidenceHistory(session: RepairSession): unknown[] {
  let boundary = -1;
  for (let index = session.state.history.length - 1; index >= 0; index -= 1) {
    if ((session.state.history[index] as { kind?: string }).kind === "evidence_refresh") { boundary = index; break; }
  }
  return session.state.history.slice(boundary + 1);
}

// This service owns draft/review/commit; neither the model nor a warning may bypass the gate.
export class PlanningRepairCoordinator {
  constructor(
    private readonly store = new PlanningRepairStore(),
    private readonly gate = new ChapterTaskSheetQualityGateService(),
    private readonly invoke = runStructuredPrompt,
  ) {}

  run(input: PlanningRepairInput): Promise<VolumePlanDocument> {
    const key = input.document.novelId;
    const existing = flights.get(key);
    if (existing) {
      if (existing.taskId !== input.options.taskId) return Promise.reject(new Error("本书的规划修正由另一任务执行，请等待完成。"));
      if (existing.chapterId !== input.chapterId) return Promise.reject(new Error("本书正在调整另一章节规划，请等待完成。"));
      return existing.promise;
    }
    const promise = this.runUnlocked(input).finally(() => { flights.delete(key); });
    flights.set(key, { taskId: input.options.taskId, chapterId: input.chapterId, promise });
    return promise;
  }

  private async runUnlocked(input: PlanningRepairInput): Promise<VolumePlanDocument> {
    const session = await this.store.begin({
      novelId: input.document.novelId, taskId: input.options.taskId,
      document: input.document, volumeId: input.volumeId, chapterId: input.chapterId,
      expectedWrittenSourceFingerprint: input.writtenEvidence?.sourceFingerprint,
      selectedPlanningDirection: (input.context as { novel?: { selectedPlanningDirection?: import("@ai-novel/shared/types/novel/planningPromises").SelectedPlanningDirection } } | null)?.novel?.selectedPlanningDirection,
    });
    if (session.state.phase === "committed") {
      committedDocuments.add(session.candidate ?? input.document);
      return session.candidate ?? input.document;
    }
    if (session.state.chapterId !== input.chapterId) {
      throw new PlanningRepairConfirmationRequired("请先处理本书上一个未完成的规划修正，再推进其他章节。");
    }
    if (["waiting_confirmation", "uncertain"].includes(session.state.phase)) {
      throw new PlanningRepairConfirmationRequired(session.state.summary ?? "规划修正需要确认。");
    }
    if (session.state.pendingOperation) {
      return this.pause(session, "上次模型调用的返回状态不确定，请确认后再追加修正，避免重复扣费。", true);
    }
    if (!session.eligibleChapterIds.includes(input.chapterId)) {
      return this.pause(session, "当前章已有正文或受保护，不能自动调整规划。");
    }
    try {
      const pendingOutput = session.state.repairOutputPending;
      const canReplayPendingOutput = pendingOutput?.inputFingerprint === session.inputFingerprint
        && pendingOutput?.round === session.state.rounds;
      if (pendingOutput && !canReplayPendingOutput) await this.save(session, { repairOutputPending: undefined });
      if (session.state.phase === "repairing" || canReplayPendingOutput) {
        const savedRepair = session.state.history.slice().reverse().find((entry) => {
          if (!entry || typeof entry !== "object") return false;
          const item = entry as { kind?: unknown; round?: unknown };
          return item.kind === "repair" && item.round === session.state.rounds;
        }) as { output?: unknown } | undefined;
        // A durable response is already paid for; finish applying it before reviewing or consuming another round.
        if (savedRepair) await this.applyRepairOutput(input, session, savedRepair.output);
        else if (canReplayPendingOutput) return this.pause(session, "已保存的规划修正响应缺失，请确认后继续。");
      }
      if (!session.candidate) {
        // Reusing a persisted contract is local work, not an uncertain paid request.
        const generated = await input.generateInitial(() => this.beforeCall(
          session, "initial_generation", "正在准备待复核的章节任务单",
        ));
        const candidate = structuredClone(input.document);
        const chapter = chaptersOf(candidate, input.volumeId).find(c => c.id === input.chapterId)!;
        // Generation must not purchase more space by changing the agreed chapter length.
        const originalTarget = chapter.targetWordCount;
        const userConflict = chapter.conflictLevelSource === "user"
          ? { conflictLevel: chapter.conflictLevel, conflictLevelSource: chapter.conflictLevelSource }
          : {};
        Object.assign(chapter, generated, { targetWordCount: originalTarget ?? generated.targetWordCount }, userConflict);
        await this.save(session, {
          phase: "reviewing", pendingOperation: undefined,
          affectedChapterIds: [input.chapterId], quality: { chapters: {} },
          summary: `正在复核第${chapter.chapterOrder}章任务单`,
        }, refreshDerived(candidate));
      }
      if (session.state.recoveryAction?.mode === "repair_then_review") {
        if (session.state.recoveryAction.paidRound !== undefined) {
          return this.pause(session, "已授权修复的保存响应无法确认，请检查保存结果后继续，避免重复调用。");
        }
        if (session.state.rounds >= session.state.maxRounds) return this.pause(session, "修复预算不足，请确认修复方向后继续。");
        const ids = session.state.recoveryAction.affectedChapterIds ?? session.state.affectedChapterIds ?? [input.chapterId];
        if (!ids.includes(input.chapterId) || ids.some(id => !session.eligibleChapterIds.includes(id))) {
          return this.pause(session, "已确认方向的可修改窗口已变化，请重新确认方案。");
        }
        if (ids.length > 1) await this.inheritWindowBudgets(input, session, ids);
        const nextRound = session.state.rounds + 1;
        await this.save(session, { rounds: nextRound, phase: "repairing", affectedChapterIds: ids,
          recoveryAction: { ...session.state.recoveryAction, paidRound: nextRound } });
        await this.beforeCall(session, "repair", "正在按已确认方向修改候选，完成后复核");
        const repaired = await this.invoke({ asset: planningRepairPrompt,
          promptInput: { contextJson: this.context(input, session, (session.state.quality ?? { chapters: {} }) as ReviewSet) },
          options: this.modelOptions(input, "planning_repair", 12000) });
        await this.save(session, { pendingOperation: undefined,
          repairOutputPending: { inputFingerprint: session.inputFingerprint, round: session.state.rounds },
          history: [...session.state.history, { round: session.state.rounds, kind: "repair", output: repaired.output,
            recoveryRequestId: session.state.recoveryAction?.requestId }] });
        await this.applyRepairOutput(input, session, repaired.output);
      }
      while (true) {
        const reviews = await this.review(input, session);
        if (!currentEvidenceHistory(session).some(entry => {
          const item = entry as { kind?: string; round?: number };
          return item.kind === "assessment" && item.round === session.state.rounds;
        })) {
          await this.save(session, { history: [...session.state.history,
            { kind: "assessment", round: session.state.rounds, result: structuredClone(reviews) }] });
        }
        const passed = Object.values(reviews.chapters).every(passedPlanningReview)
          && reviews.window?.usable && reviews.window.safeToSync && !reviews.window.requiresUserDecision;
        if (passed) {
          await this.save(session, { phase: "ready", recoveryAction: undefined, summary: "规划复核通过，正在提交" });
          const document = await this.store.commit(session, session.candidate!);
          committedDocuments.add(document);
          return document;
        }
        if (session.state.recoveryAction?.mode === "review_existing") {
          await this.save(session, { recoveryAction: undefined });
          return this.pause(session, "原候选复核仍未通过，请选择具体修复方向或确认规划来源。");
        }
        if (reviews.window?.requiresUserDecision) {
          return this.pause(session, reviews.window.summary);
        }
        if (session.state.rounds >= session.state.maxRounds) {
          return this.pause(session, `已完成${session.state.rounds}轮修正，规划仍未通过复核。${reviews.window?.summary ?? ""}`);
        }
        const useWindow = Object.values(reviews.chapters).some(r => r.recommendedHandling === "replan_window")
          || (!!reviews.window && (!reviews.window.usable || !reviews.window.safeToSync));
        const ids = useWindow ? session.eligibleChapterIds : (session.state.affectedChapterIds ?? [input.chapterId]);
        if (useWindow) await this.inheritWindowBudgets(input, session, ids);
        await this.save(session, {
          rounds: session.state.rounds + 1, phase: "repairing", affectedChapterIds: ids,
          summary: `正在调整第${session.state.chapterOrder}章起的任务单，第${session.state.rounds + 1}/${session.state.maxRounds}轮`,
        });
        await this.beforeCall(session, "repair", session.state.summary!);
        const repaired = await this.invoke({
          asset: planningRepairPrompt,
          promptInput: { contextJson: this.context(input, session, reviews) },
          options: this.modelOptions(input, "planning_repair", 12000),
        });
        await this.save(session, {
          pendingOperation: undefined,
          repairOutputPending: { inputFingerprint: session.inputFingerprint, round: session.state.rounds },
          history: [...session.state.history, { round: session.state.rounds, kind: "repair", output: repaired.output }],
        });
        await this.applyRepairOutput(input, session, repaired.output);
      }
    } catch (error) {
      if ((error as { code?: string })?.code === "PLANNING_REPAIR_CONFIRMATION_REQUIRED") throw error;
      const completed = (error as { completedPromptResponse?: { promptId: string; output: unknown } })?.completedPromptResponse;
      if (completed && session.state.pendingOperation) {
        // A received but rejected response is evidence, never an approved candidate or a lost request.
        await this.save(session, {
          phase: "waiting_confirmation", pendingOperation: undefined,
          technicalError: error instanceof Error ? error.message : String(error),
          summary: "模型已返回，但规划响应未通过格式或合同校验；已保留响应与轮次，请修复后复核。",
          history: [...session.state.history, { kind: "rejected_response", round: session.state.rounds, ...completed }],
        });
        throw new PlanningRepairConfirmationRequired(session.state.summary!);
      }
      // Preserve the pending operation: an interrupted HTTP response is not permission to spend again.
      await this.save(session, {
        phase: "technical_failed", technicalError: error instanceof Error ? error.message : String(error),
        summary: "规划修正调用或保存失败，已保留候选与轮次。",
      }).catch(() => undefined);
      throw error;
    }
  }

  private async inheritWindowBudgets(input: PlanningRepairInput, session: RepairSession, ids: readonly string[]): Promise<void> {
    const candidate = structuredClone(session.candidate!);
    const inherited = session.effectiveDefaultChapterLength ?? (input.context as { novel?: { defaultChapterLength?: number | null } } | null)
      ?.novel?.defaultChapterLength ?? 2800;
    const changed = new Set<string>();
    for (const chapter of chaptersOf(candidate, input.volumeId)) {
      if (!ids.includes(chapter.id) || chapter.targetWordCount != null) continue;
      if (!Number.isSafeInteger(inherited) || inherited < 3) {
        return this.pause(session, "小说默认章节字数无效，请确认后继续。");
      }
      chapter.targetWordCount = inherited;
      changed.add(chapter.id);
    }
    if (!changed.size) return;
    const quality = session.state.quality as ReviewSet | undefined;
    await this.save(session, {
      affectedChapterIds: [...ids],
      quality: { chapters: Object.fromEntries(Object.entries(quality?.chapters ?? {})
        .filter(([id]) => !changed.has(id))) },
    }, refreshDerived(candidate));
  }

  private async applyRepairOutput(input: PlanningRepairInput, session: RepairSession, output: unknown): Promise<void> {
    const parsed = planningRepairOutputSchema.safeParse(output);
    if (!parsed.success) return this.rejectRepairOutput(session, "已保存的规划修正输出无效，请确认后继续。");
    if (parsed.data.requiresUserDecision) return this.rejectRepairOutput(session, parsed.data.reason);
    if (!session.candidate) return this.rejectRepairOutput(session, "已保存的规划修正缺少原候选方案，请确认后继续。");
    let candidate: VolumePlanDocument;
    try {
      candidate = applyPlanningRepairCandidate(session.candidate, input.volumeId,
        session.state.affectedChapterIds ?? [input.chapterId], parsed.data);
    } catch (error) {
      return this.rejectRepairOutput(session, error instanceof Error ? error.message : "候选规划未通过边界校验。");
    }
    // Older persisted responses may predate the marker; protect their candidate save too.
    if (!session.state.repairOutputPending) await this.save(session, {
      repairOutputPending: { inputFingerprint: session.inputFingerprint, round: session.state.rounds },
    });
    await this.save(session, {
      phase: "reviewing", repairOutputPending: undefined, quality: { chapters: {} }, obligationMoves: parsed.data.obligationMoves,
      ...(session.state.recoveryAction?.paidRound === session.state.rounds ? { recoveryAction: undefined } : {}),
      summary: `正在复核第${session.state.chapterOrder}章起的规划，第${session.state.rounds}/${session.state.maxRounds}轮`,
    }, refreshDerived(candidate));
  }

  private async rejectRepairOutput(session: RepairSession, summary: string): Promise<never> {
    await this.save(session, { repairOutputPending: undefined });
    return this.pause(session, summary);
  }

  private async review(input: PlanningRepairInput, session: RepairSession): Promise<ReviewSet> {
    const review = (session.state.quality ?? { chapters: {} }) as ReviewSet;
    review.chapters ??= {};
    for (const id of session.state.affectedChapterIds ?? [input.chapterId]) {
      if (review.chapters[id]) continue;
      const chapter = chaptersOf(session.candidate!, input.volumeId).find(c => c.id === id)!;
      const issueHistory = buildReviewIssueHistory(currentEvidenceHistory(session), id);
      await this.beforeCall(session, `review:${id}`, `正在复核第${chapter.chapterOrder}章，第${session.state.rounds}/${session.state.maxRounds}轮`);
      review.chapters[id] = await this.gate.evaluate({
        ...chapter, novelId: input.document.novelId, volumeId: input.volumeId,
        chapterId: id, chapterOrder: chapter.chapterOrder,
      }, { ...input.options, mode: "ai_copilot", temperature: 0.1,
        reviewContextJson: this.context(input, session, review),
        ...issueHistory,
      });
      await this.save(session, { phase: "reviewing", pendingOperation: undefined, quality: review });
    }
    // A failed chapter already contains the structured repair direction; do not pay for a premature window review.
    if (!Object.values(review.chapters).every(passedPlanningReview)) return review;
    if (!review.window) {
      await this.beforeCall(session, "window_review", "正在复核章节职责、伏笔与前后衔接");
      const result = await this.invoke({
        asset: planningRepairReviewPrompt, promptInput: { contextJson: this.context(input, session, review) },
        options: this.modelOptions(input, "planning_repair_review", 4000),
      });
      review.window = result.output;
      await this.save(session, {
        phase: "reviewing", pendingOperation: undefined, quality: review,
        history: [...session.state.history, { round: session.state.rounds, kind: "review", result: review }],
      });
    }
    return review;
  }

  private context(input: PlanningRepairInput, session: RepairSession, review: ReviewSet): string {
    const ids = session.state.affectedChapterIds ?? [input.chapterId];
    const baseline = session.baselineDocument ?? input.document;
    const all = baseline.volumes.flatMap(v => v.chapters).sort((a, b) => a.chapterOrder - b.chapterOrder);
    const target = all.find(c => c.id === input.chapterId)!;
    const last = all.filter(c => ids.includes(c.id)).at(-1) ?? target;
    const original = baseline.volumes.find(v => v.id === input.volumeId)!;
    const firstAssessment = currentEvidenceHistory(session).find(entry => (entry as { kind?: string }).kind === "assessment") as { result?: unknown } | undefined;
    return JSON.stringify({
      ...projectPlanningHorizon(session.candidate ?? input.document, input.volumeId, ids),
      writtenEvidence: input.writtenEvidence ?? { coverage: { complete: false, unknown: ["未提供已写正文来源，不能将规划视为历史事实。"] } },
      selectedPlanningDirection: (input.context as { novel?: { selectedPlanningDirection?: unknown } } | null)?.novel?.selectedPlanningDirection ?? null,
      bookConstraints: input.context, volume: { ...original, chapters: undefined },
      strategyPlan: input.document.strategyPlan,
      beatSheet: input.document.beatSheets.find(b => b.volumeId === input.volumeId),
      allowedChapterIds: ids, originalChapters: original.chapters.filter(c => ids.includes(c.id)),
      candidateChapters: chaptersOf(session.candidate!, input.volumeId).filter(c => ids.includes(c.id)),
      readonlyPrevious: all.find(c => c.chapterOrder === target.chapterOrder - 1) ?? null,
      readonlyNext: all.find(c => c.chapterOrder === last.chapterOrder + 1) ?? null,
      assessment: { original: firstAssessment?.result ?? review, current: review }, obligationMoves: session.state.obligationMoves ?? [],
      issueHistoryByChapter: Object.fromEntries(ids.map(id => [id,
        buildReviewIssueHistory(currentEvidenceHistory(session), id)])),
      guidance: [input.options.guidance, session.state.guidance].filter(Boolean).join("\n"),
    });
  }

  private modelOptions(input: PlanningRepairInput, stage: string, maxTokens: number) {
    return { provider: input.options.provider, model: input.options.model, temperature: stage === "planning_repair_review" ? 0.1 : 0.3,
      maxTokens, taskId: input.options.taskId, novelId: input.document.novelId, volumeId: input.volumeId,
      chapterId: input.chapterId, stage, entrypoint: input.options.entrypoint, signal: input.options.signal };
  }

  private async beforeCall(session: RepairSession, kind: string, summary: string) {
    await this.save(session, { summary, pendingOperation: { kind, startedAt: new Date().toISOString() } });
  }

  private async save(session: RepairSession, patch: Partial<RepairSession["state"]>, candidate?: VolumePlanDocument) {
    await this.store.save(session, { ...session.state, ...patch }, candidate);
    if (["waiting_confirmation", "uncertain"].includes(session.state.phase)
      && !["waiting_confirmation", "uncertain"].includes(patch.phase ?? "")) {
      throw new PlanningRepairConfirmationRequired(session.state.summary ?? "规划源已变化，请确认后继续。");
    }
  }

  private async pause(session: RepairSession, summary: string, uncertain = false): Promise<never> {
    await this.save(session, { phase: uncertain ? "uncertain" : "waiting_confirmation", summary });
    throw new PlanningRepairConfirmationRequired(summary);
  }
}
