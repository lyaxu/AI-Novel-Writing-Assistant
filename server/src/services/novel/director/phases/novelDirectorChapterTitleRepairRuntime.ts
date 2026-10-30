import type { DirectorConfirmRequest } from "@ai-novel/shared/types/novelDirector";
import { prisma } from "../../../../db/prisma";
import { getChapterTitleDiversityIssue, isChapterTitleDiversityIssue } from "../../volume/chapterTitleDiversity";
import type { NovelVolumeService } from "../../volume/NovelVolumeService";
import type { NovelWorkflowService } from "../../workflow/NovelWorkflowService";
import {
  buildNovelEditResumeTarget,
  parseSeedPayload,
  parseResumeTarget,
} from "../../workflow/novelWorkflow.shared";
import type { ChapterTitleAutoRecoveryScheduleResult } from "../../workflow/novelWorkflowChapterTitleRecoveryPort";
import {
  buildChapterTitleAutoRepairState,
  CHAPTER_TITLE_AUTO_REPAIR_WARNING_LABEL,
  planChapterTitleAutoRepair,
  readChapterTitleAutoRepairState,
  type ChapterTitleAutoRepairState,
} from "../recovery/chapterTitleAutoRepairPolicy";
import { getDirectorInputFromSeedPayload, getDirectorLlmOptionsFromSeedPayload, type DirectorWorkflowSeedPayload } from "../runtime/novelDirectorHelpers";
import { buildDirectorSessionState } from "../runtime/novelDirectorHelpers";
import { buildChapterTitleDiversityTaskNotice } from "../projections/novelDirectorTaskNotice";
import { repairDirectorChapterTitles } from "./novelDirectorChapterTitleRepair";
import { DIRECTOR_PROGRESS } from "../projections/novelDirectorProgress";

function parseResumeTargetLike(value: unknown) {
  if (typeof value === "string") {
    return parseResumeTarget(value);
  }
  if (value && typeof value === "object") {
    return value as NonNullable<ReturnType<typeof parseResumeTarget>>;
  }
  return null;
}

function mergeResumeTargets(
  primary: ReturnType<typeof parseResumeTarget>,
  fallback: ReturnType<typeof parseResumeTarget>,
) {
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }
  return {
    ...fallback,
    ...primary,
    stage: primary.stage === "basic" && fallback.stage !== "basic"
      ? fallback.stage
      : primary.stage,
    chapterId: primary.chapterId ?? fallback.chapterId ?? null,
    volumeId: primary.volumeId ?? fallback.volumeId ?? null,
  };
}

interface TitleRepairSetup {
  row: NonNullable<Awaited<ReturnType<NovelWorkflowService["getTaskById"]>>>;
  seedPayload: DirectorWorkflowSeedPayload;
  novelId: string;
  targetVolume: Awaited<ReturnType<NovelVolumeService["getVolumes"]>>["volumes"][number];
  repairRequest: DirectorConfirmRequest;
}

export class NovelDirectorChapterTitleRepairRuntime {
  constructor(private readonly deps: {
    workflowService: NovelWorkflowService;
    volumeService: NovelVolumeService;
    buildDirectorSeedPayload: (
      input: DirectorConfirmRequest,
      novelId: string | null,
      extra?: Record<string, unknown>,
    ) => Record<string, unknown>;
    scheduleBackgroundRun: (taskId: string, runner: () => Promise<void>) => void;
    /**
     * Follow-up used by the automatic path: after a successful repair the original
     * director task continues without a user click. Undefined keeps the existing
     * manual "wait for approval" boundary.
     */
    continueTaskAfterRepair?: (taskId: string) => Promise<void>;
    /** Seam over the single repair pass so recovery orchestration stays testable. */
    repairChapterTitles?: typeof repairDirectorChapterTitles;
    /** Seam over the bounded claim write. */
    claimAutoRepairAttempt?: (input: {
      taskId: string;
      expectedUpdatedAt: Date | null;
      expectedSeedPayloadJson: string | null;
      expectedStatus: string;
      nextSeedPayloadJson: string;
    }) => Promise<boolean>;
    now?: () => number;
  }) {}

  private async resolveRepairSetup(taskId: string, input?: {
    volumeId?: string | null;
  }): Promise<TitleRepairSetup> {
    const row = await this.deps.workflowService.getTaskById(taskId);
    if (!row) {
      throw new Error("当前自动导演任务不存在。");
    }
    if (row.lane !== "auto_director") {
      throw new Error("只有自动导演任务支持 AI 修复章节标题。");
    }
    const seedPayload = parseSeedPayload<DirectorWorkflowSeedPayload>(row.seedPayloadJson) ?? {};
    const directorInput = getDirectorInputFromSeedPayload(seedPayload);
    const novelId = row.novelId ?? seedPayload.novelId ?? null;
    if (!directorInput || !novelId) {
      throw new Error("当前自动导演任务缺少恢复 AI 修复所需的上下文。");
    }

    const notice = seedPayload.taskNotice;
    const requestedVolumeId = input?.volumeId?.trim() || null;
    const resumeTarget = mergeResumeTargets(
      parseResumeTarget(row.resumeTargetJson),
      parseResumeTargetLike(seedPayload.resumeTarget),
    );
    const targetVolumeId = requestedVolumeId
      || notice?.action?.volumeId?.trim()
      || resumeTarget?.volumeId?.trim()
      || null;
    const workspace = await this.deps.volumeService.getVolumes(novelId);
    const targetVolume = targetVolumeId
      ? workspace.volumes.find((volume) => volume.id === targetVolumeId)
      : workspace.volumes.find((volume) => getChapterTitleDiversityIssue(volume.chapters.map((chapter) => chapter.title)));
    if (!targetVolume) {
      throw new Error("当前任务没有可直接 AI 修复的重复章节标题。");
    }
    const taskHasTitleWarning = notice?.code === "CHAPTER_TITLE_DIVERSITY"
      || isChapterTitleDiversityIssue(row.lastError)
      || Boolean(getChapterTitleDiversityIssue(targetVolume.chapters.map((chapter) => chapter.title)));
    if (!taskHasTitleWarning) {
      throw new Error("当前任务没有可直接 AI 修复的章节标题提醒。");
    }

    const boundLlm = getDirectorLlmOptionsFromSeedPayload(seedPayload);
    const repairRequest: DirectorConfirmRequest = {
      ...directorInput,
      provider: boundLlm?.provider ?? directorInput.provider,
      model: boundLlm?.model ?? directorInput.model,
      temperature: typeof boundLlm?.temperature === "number"
        ? boundLlm.temperature
        : directorInput.temperature,
    };
    return {
      row,
      seedPayload,
      novelId,
      targetVolume,
      repairRequest,
    };
  }

  private async startRepairRun(input: {
    taskId: string;
    setup: TitleRepairSetup;
    itemLabel: string;
  }): Promise<void> {
    const { row, seedPayload, novelId, targetVolume, repairRequest } = input.setup;
    const directorSession = buildDirectorSessionState({
      runMode: repairRequest.runMode,
      phase: "structured_outline",
      isBackgroundRunning: true,
    });
    const resumeTargetForRepair = buildNovelEditResumeTarget({
      novelId,
      taskId: input.taskId,
      stage: "structured",
      volumeId: targetVolume.id,
    });
    await this.deps.workflowService.bootstrapTask({
      workflowTaskId: input.taskId,
      novelId,
      lane: "auto_director",
      title: repairRequest.candidate.workingTitle,
      seedPayload: this.deps.buildDirectorSeedPayload(repairRequest, novelId, {
        directorSession,
        resumeTarget: resumeTargetForRepair,
        taskNotice: null,
      }),
    });
    await this.deps.workflowService.markTaskRunning(input.taskId, {
      stage: "structured_outline",
      itemKey: "chapter_list",
      itemLabel: input.itemLabel,
      progress: DIRECTOR_PROGRESS.chapterList,
      clearCheckpoint: true,
    });
    void row;
    void seedPayload;
  }

  async repairChapterTitles(taskId: string, input?: {
    volumeId?: string | null;
  }): Promise<void> {
    const setup = await this.resolveRepairSetup(taskId, input);
    const { novelId, targetVolume, repairRequest } = setup;
    await this.startRepairRun({
      taskId,
      setup,
      itemLabel: `正在 AI 修复第 ${targetVolume.sortOrder} 卷章节标题`,
    });
    this.deps.scheduleBackgroundRun(taskId, async () => {
      await repairDirectorChapterTitles({
        taskId,
        novelId,
        targetVolumeId: targetVolume.id,
        request: repairRequest,
        volumeService: this.deps.volumeService,
        workflowService: this.deps.workflowService,
        buildDirectorSeedPayload: (request, targetNovelId, extra) => (
          this.deps.buildDirectorSeedPayload(request, targetNovelId, extra)
        ),
      });
    });
  }

  /**
   * Automatic recovery of a chapter-title diversity warning.
   *
   * Bounded on purpose: one persisted attempt per task + volume. The repair itself
   * is delegated to `repairDirectorChapterTitles`, then the original director task
   * continues automatically. A residual warning is kept as a visible notice while
   * the task continues; a failure downgrades to the existing bounded manual pause
   * with the quick-repair action still available.
   */
  async autoRepairAndContinue(taskId: string, input: {
    volumeId?: string | null;
    issue?: string | null;
  } = {}): Promise<ChapterTitleAutoRecoveryScheduleResult> {
    let setup: TitleRepairSetup;
    try {
      setup = await this.resolveRepairSetup(taskId, { volumeId: input.volumeId });
    } catch {
      return "unavailable";
    }
    const { row, seedPayload, novelId, targetVolume, repairRequest } = setup;
    if (row.cancelRequestedAt || row.status === "cancelled" || row.status === "succeeded") {
      return "unavailable";
    }
    const issue = (input.issue?.trim()
      || row.lastError?.trim()
      || getChapterTitleDiversityIssue(targetVolume.chapters.map((chapter) => chapter.title))
      || "").trim();
    if (!issue) {
      return "unavailable";
    }
    const decision = planChapterTitleAutoRepair({
      issue,
      runMode: repairRequest.runMode ?? seedPayload.runMode,
      autoExecutionEnabled: seedPayload.autoExecution?.enabled,
      volumeId: targetVolume.id,
      state: readChapterTitleAutoRepairState(seedPayload),
    });
    if (decision.action !== "auto_repair") {
      return "already_attempted";
    }

    const attemptedAt = new Date(this.deps.now?.() ?? Date.now()).toISOString();
    const marker = buildChapterTitleAutoRepairState({
      issue,
      volumeId: targetVolume.id,
      attemptedAt,
    });
    const nextSeed = JSON.parse(row.seedPayloadJson?.trim() || "{}") as Record<string, unknown>;
    const nextSeedPayloadJson = JSON.stringify({ ...nextSeed, chapterTitleAutoRepair: marker });
    const claim = this.deps.claimAutoRepairAttempt
      ?? ((claimInput) => this.claimAutoRepairAttempt(claimInput));
    const claimed = await claim({
      taskId,
      expectedUpdatedAt: row.updatedAt,
      expectedSeedPayloadJson: row.seedPayloadJson,
      expectedStatus: row.status,
      nextSeedPayloadJson,
    }).catch(() => false);
    if (!claimed) {
      // A concurrent reader may already have started the same bounded attempt.
      const current = await this.deps.workflowService.getTaskByIdWithoutHealing(taskId).catch(() => null);
      const currentMarker = readChapterTitleAutoRepairState(
        parseSeedPayload<DirectorWorkflowSeedPayload>(current?.seedPayloadJson),
      );
      return current?.status === "running" || currentMarker?.attempts
        ? "scheduled"
        : "already_attempted";
    }

    await this.startRepairRun({
      taskId,
      setup,
      itemLabel: `正在自动修复第 ${targetVolume.sortOrder} 卷章节标题`,
    });

    this.deps.scheduleBackgroundRun(taskId, async () => {
      try {
        await this.runRepairThenContinue({
          taskId,
          novelId,
          targetVolumeId: targetVolume.id,
          repairRequest,
          issue,
          marker,
        });
      } catch (error) {
        await this.persistBoundedFailure({
          taskId,
          volumeId: targetVolume.id,
          issue,
          marker,
          error,
        }).catch(() => undefined);
      }
    });
    return "scheduled";
  }

  private async runRepairThenContinue(input: {
    taskId: string;
    novelId: string;
    targetVolumeId: string;
    repairRequest: DirectorConfirmRequest;
    issue: string;
    marker: ChapterTitleAutoRepairState;
  }): Promise<void> {
    const repair = this.deps.repairChapterTitles ?? repairDirectorChapterTitles;
    await repair({
      taskId: input.taskId,
      novelId: input.novelId,
      targetVolumeId: input.targetVolumeId,
      request: input.repairRequest,
      volumeService: this.deps.volumeService,
      workflowService: this.deps.workflowService,
      buildDirectorSeedPayload: (request, targetNovelId, extra) => (
        this.deps.buildDirectorSeedPayload(request, targetNovelId, extra)
      ),
    });
    const workspace = await this.deps.volumeService.getVolumes(input.novelId);
    const repairedVolume = workspace.volumes.find((volume) => volume.id === input.targetVolumeId);
    const residualIssue = repairedVolume
      ? getChapterTitleDiversityIssue(repairedVolume.chapters.map((chapter) => chapter.title))
      : null;
    if (residualIssue) {
      // Warning retained, execution continues: never block twice on the same warning.
      await this.deps.workflowService.markTaskRunning(input.taskId, {
        stage: "structured_outline",
        itemKey: "chapter_list",
        itemLabel: CHAPTER_TITLE_AUTO_REPAIR_WARNING_LABEL,
        progress: DIRECTOR_PROGRESS.chapterList,
        clearCheckpoint: true,
        volumeId: input.targetVolumeId,
        seedPayload: {
          taskNotice: buildChapterTitleDiversityTaskNotice({
            issue: residualIssue,
            volumeId: input.targetVolumeId,
          }),
          chapterTitleAutoRepair: {
            ...input.marker,
            status: "completed_with_warning",
            warningSummary: residualIssue,
          },
        },
      });
    } else {
      await this.deps.workflowService.markTaskRunning(input.taskId, {
        stage: "structured_outline",
        itemKey: "chapter_list",
        itemLabel: "章节标题已自动修复，继续原任务",
        progress: DIRECTOR_PROGRESS.chapterList,
        clearCheckpoint: true,
        volumeId: input.targetVolumeId,
        seedPayload: {
          taskNotice: null,
          chapterTitleAutoRepair: { ...input.marker, status: "completed" },
        },
      });
    }
    if (this.deps.continueTaskAfterRepair) {
      await this.deps.continueTaskAfterRepair(input.taskId);
    }
  }

  private async persistBoundedFailure(input: {
    taskId: string;
    volumeId: string;
    issue: string;
    marker: ChapterTitleAutoRepairState;
    error: unknown;
  }): Promise<void> {
    const message = input.error instanceof Error
      ? input.error.message.trim()
      : "章节标题自动修复未完成。";
    await this.deps.workflowService.markTaskWaitingApproval(input.taskId, {
      stage: "structured_outline",
      itemKey: "chapter_list",
      itemLabel: "章节标题自动修复未完成，可继续或手动修复",
      progress: DIRECTOR_PROGRESS.chapterList,
      clearCheckpoint: true,
      checkpointType: "step_review_required",
      checkpointSummary: message || "章节标题自动修复未完成。",
      volumeId: input.volumeId,
      seedPayload: {
        taskNotice: buildChapterTitleDiversityTaskNotice({
          issue: input.issue,
          volumeId: input.volumeId,
        }),
        chapterTitleAutoRepair: {
          ...input.marker,
          status: "failed",
          error: message || null,
        },
      },
    });
  }

  /** Bounded claim: only the first reader may start the single automatic attempt. */
  private async claimAutoRepairAttempt(input: {
    taskId: string;
    expectedUpdatedAt: Date | null;
    expectedSeedPayloadJson: string | null;
    expectedStatus: string;
    nextSeedPayloadJson: string;
  }): Promise<boolean> {
    if (!input.expectedUpdatedAt) {
      return false;
    }
    const updated = await prisma.novelWorkflowTask.updateMany({
      where: {
        id: input.taskId,
        updatedAt: input.expectedUpdatedAt,
        seedPayloadJson: input.expectedSeedPayloadJson,
        status: input.expectedStatus as never,
        cancelRequestedAt: null,
      },
      data: {
        seedPayloadJson: input.nextSeedPayloadJson,
        heartbeatAt: new Date(this.deps.now?.() ?? Date.now()),
      },
    });
    return updated.count === 1;
  }
}
