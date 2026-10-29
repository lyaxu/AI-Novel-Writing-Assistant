import { buildDirectorCompletionProfile } from "@ai-novel/shared/types/directorCompletion";
import { DEFAULT_ESTIMATED_CHAPTER_COUNT } from "@ai-novel/shared/types/planningScale";
import { prisma } from "../../../../db/prisma";
import { plannerService } from "../../../planner/PlannerService";
import { ChapterPlanJITService, type ChapterPlanJITDeps } from "../../planning/ChapterPlanJITService";
import { ChapterRouteWindowService } from "../../planning/ChapterRouteWindowService";
import type { ChapterRuntimeRequestInput } from "../../runtime/chapterRuntimeSchema";
import { NovelVolumeService } from "../../volume/NovelVolumeService";
import { buildChapterExecutionContractHash, type ChapterExecutionContractHashInput } from "../../../planner/plannerPersistence";
import { currentProductionSession, productionStep } from "../reliability";
import { assertPreviousChapterStateReady } from "./PreviousChapterStateGuard";

export interface ChapterExecutionPreparationResult {
  status: "ready";
  mode: NonNullable<ChapterRuntimeRequestInput["controlPolicy"]>["advanceMode"];
  planId: string | null;
  effectiveContract: { hash: string; fields: ChapterExecutionContractHashInput; source: "reviewed_planning" | "saved_prose" };
  preparedArtifacts: Array<"chapter_execution_contract" | "chapter_plan">;
}

export interface ChapterExecutionPreparationServiceDeps {
  chapterPlanJITService: Pick<ChapterPlanJITService, "ensureExecutionReady">;
  planner: Pick<typeof plannerService, "ensureChapterPlan" | "getChapterPlan">;
  loadChapter: (novelId: string, chapterId: string) => Promise<(ChapterExecutionContractHashInput & { content: string | null }) | null>;
  loadEstimatedChapterCount: (novelId: string) => Promise<number | null>;
}

/** Owns every planning write that must finish before context assembly starts. */
export class ChapterExecutionPreparationService {
  constructor(private readonly deps: ChapterExecutionPreparationServiceDeps) {}

  assertPreviousStateReady(novelId: string, chapterId: string): Promise<void> {
    return assertPreviousChapterStateReady(novelId, chapterId);
  }

  async prepare(
    novelId: string,
    chapterId: string,
    request: ChapterRuntimeRequestInput,
  ): Promise<ChapterExecutionPreparationResult> {
    const mode = request.controlPolicy?.advanceMode ?? "manual";
    const isAutopilot = mode === "full_book_autopilot";
    const preparedArtifacts: ChapterExecutionPreparationResult["preparedArtifacts"] = [];
    const original = await this.deps.loadChapter(novelId, chapterId);
    if (!original) throw new Error("章节不存在。");
    const hasSavedProse = Boolean(original.content?.trim());
    if (!hasSavedProse) {
      const estimatedChapterCount = isAutopilot
        ? await this.deps.loadEstimatedChapterCount(novelId)
        : null;
      await productionStep("prepare.execution_contract", async () => {
        await this.deps.chapterPlanJITService.ensureExecutionReady(novelId, chapterId, {
          endOrder: request.controlPolicy?.autoExecutionRange?.end ?? undefined,
          min: 3,
          target: 5,
          provider: request.provider,
          model: request.model,
          temperature: request.temperature,
          taskId: request.workflowTaskId,
          prepareRouteWindow: isAutopilot,
          completionProfile: isAutopilot ? buildDirectorCompletionProfile(estimatedChapterCount ?? DEFAULT_ESTIMATED_CHAPTER_COUNT) : undefined,
        });
        await currentProductionSession()?.bindPrepared({ stage: "execution_contract" });
      }, true);
      preparedArtifacts.push("chapter_execution_contract");
    }
    const beforePlan = await this.deps.loadChapter(novelId, chapterId);
    if (!beforePlan) throw new Error("章节不存在。");
    const plan = hasSavedProse
      ? await this.deps.planner.getChapterPlan(novelId, chapterId)
      : await productionStep("prepare.chapter_plan", () => this.deps.planner.ensureChapterPlan(novelId, chapterId, request), true);
    if (plan) preparedArtifacts.push("chapter_plan");
    const chapter = await this.deps.loadChapter(novelId, chapterId);
    if (!chapter) throw new Error("章节不存在。");
    if (buildChapterExecutionContractHash(beforePlan) !== buildChapterExecutionContractHash(chapter)
      || (beforePlan.content ?? "") !== (chapter.content ?? "")) {
      throw Object.assign(new Error("本章执行约定在准备期间发生变化，请核对后继续。"), { code: "CHAPTER_PRODUCTION_CONFLICT" });
    }
    const { content: _content, ...fields } = chapter;
    return {
      status: "ready",
      mode,
      planId: plan?.id ?? null,
      effectiveContract: { hash: buildChapterExecutionContractHash(fields), fields, source: hasSavedProse ? "saved_prose" : "reviewed_planning" },
      preparedArtifacts,
    };
  }
}

export function createChapterExecutionPreparationService(input: {
  ensureChapterExecutionContract?: ChapterPlanJITDeps["ensureChapterExecutionContract"];
} = {}): ChapterExecutionPreparationService {
  const volumeService = new NovelVolumeService();
  const routeWindowService = new ChapterRouteWindowService(volumeService);
  const chapterPlanJITService = new ChapterPlanJITService({
    ensureChapterExecutionContract: input.ensureChapterExecutionContract ?? ((novelId, chapterId, options) => (
      volumeService.ensureChapterExecutionContract(novelId, chapterId, options)
    )),
    ensureRouteWindow: (novelId, fromChapterOrder, options) => (
      routeWindowService.ensureRouteWindow(novelId, fromChapterOrder, options)
    ),
  });
  return new ChapterExecutionPreparationService({
    chapterPlanJITService,
    planner: plannerService,
    loadChapter: (novelId, chapterId) => prisma.chapter.findFirst({
      where: { id: chapterId, novelId },
      select: { content: true, expectation: true, targetWordCount: true, conflictLevel: true,
        revealLevel: true, mustAvoid: true, taskSheet: true, sceneCards: true, hook: true },
    }),
    loadEstimatedChapterCount: async (novelId) => {
      const novel = await prisma.novel.findUnique({
        where: { id: novelId },
        select: { estimatedChapterCount: true },
      });
      return novel?.estimatedChapterCount ?? null;
    },
  });
}
