import type { LLMProvider } from "@ai-novel/shared/types/llm";
import type { DirectorCompletionProfile } from "@ai-novel/shared/types/directorCompletion";
import type { VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { prisma } from "../../../db/prisma";
import { NovelVolumeService, createVolumeGenerationWriteGuard } from "../volume/NovelVolumeService";
import {
  getBeatExpectedChapterCount,
} from "../volume/volumeGenerationHelpers";

export interface ChapterRouteWindowOptions {
  /** Last chapter authorized for this production run; not the book ending. */
  endOrder?: number;
  min?: number;
  target?: number;
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  completionProfile?: DirectorCompletionProfile;
  /** Keeps JIT planning owned by the same auto-director task as chapter execution. */
  taskId?: string;
}

export interface ChapterRouteWindowResult {
  availableRouteCount: number;
  extended: boolean;
}

const routeWindowLocks = new Map<string, Promise<ChapterRouteWindowResult>>();

export class ChapterRouteWindowService {
  constructor(private readonly volumeService = new NovelVolumeService()) {}

  async ensureRouteWindow(
    novelId: string,
    fromChapterOrder: number,
    options: ChapterRouteWindowOptions = {},
  ): Promise<ChapterRouteWindowResult> {
    // A concurrent request can have a different chapter/range. Its result does
    // not satisfy this request; wait for the write owner, then inspect again.
    while (routeWindowLocks.has(novelId)) {
      await routeWindowLocks.get(novelId)!.catch(() => undefined);
    }
    const task = this.ensureRouteWindowUnlocked(novelId, fromChapterOrder, options)
      .finally(() => routeWindowLocks.delete(novelId));
    routeWindowLocks.set(novelId, task);
    return task;
  }

  private async ensureRouteWindowUnlocked(
    novelId: string,
    fromChapterOrder: number,
    options: ChapterRouteWindowOptions,
  ): Promise<ChapterRouteWindowResult> {
    if (!Number.isInteger(fromChapterOrder) || fromChapterOrder < 1
      || (options.endOrder !== undefined && (!Number.isInteger(options.endOrder) || options.endOrder < 1))
      || [options.min, options.target].some(value => value !== undefined && (!Number.isFinite(value) || value <= 0))) {
      throw new Error("章节路线范围无效，请核对已授权的起止章节。");
    }
    const endOrder = typeof options.endOrder === "number" && Number.isFinite(options.endOrder)
      ? Math.floor(options.endOrder)
      : undefined;
    const remainingInRange = endOrder === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, endOrder - fromChapterOrder + 1);
    if (remainingInRange === 0) return { availableRouteCount: 0, extended: false };
    const minimum = Math.min(remainingInRange, Math.max(1, Math.floor(options.min ?? 3)));
    const target = Math.min(remainingInRange, Math.max(minimum, Math.floor(options.target ?? 5)));
    const compactTarget = options.completionProfile?.mode === "compact_book"
      ? options.completionProfile.targetChapterCount
      : null;
    const remaining = compactTarget == null ? null : Math.max(0, compactTarget - fromChapterOrder + 1);
    const closingGuidance = remaining != null && remaining <= 3
      ? `紧凑全书终章倒计时：剩余约 ${remaining} 章。只生成结局合同所需的收束路线，不要创建新的主线或下一阶段钩子。`
      : remaining != null && remaining <= 8
        ? `紧凑全书收束规划：剩余约 ${remaining} 章。优先完成主冲突、关系变化和未兑现回报，不扩展远期世界或新主线。`
        : undefined;
    let availableRouteCount = await this.countAvailableRoute(novelId, fromChapterOrder, endOrder);
    if (availableRouteCount >= minimum) {
      return { availableRouteCount, extended: false };
    }

    const writeGuard = await createVolumeGenerationWriteGuard(novelId, options.taskId);

    let workspace = await this.volumeService.getVolumes(novelId);
    let extended = false;
    const visited = new Set<string>();
    const maximumSteps = Math.max(8, target * 4 + workspace.volumes.length);
    while (availableRouteCount < target) {
      const missingOrder = fromChapterOrder + availableRouteCount;
      if (endOrder !== undefined && missingOrder > endOrder) break;
      const signature = JSON.stringify([missingOrder, workspace.volumes.map(volume => [volume.id,
        volume.chapters.map(chapter => [chapter.id, chapter.chapterOrder])]), workspace.beatSheets]);
      if (visited.has(signature) || visited.size >= maximumSteps) {
        throw new Error(`第 ${missingOrder} 章路线规划未取得进展，已停止重复生成并保留已有章节。`);
      }
      visited.add(signature);
      if (workspace.volumes.some(volume => volume.chapters.some(chapter => chapter.chapterOrder === missingOrder))) {
        // An approved/planned workspace row may simply not have a Chapter row.
        // Sync that exact route without regenerating its beat or touching others.
        await this.syncRoute(novelId, workspace, missingOrder, writeGuard);
        const refreshedCount = await this.countAvailableRoute(novelId, fromChapterOrder, endOrder);
        if (refreshedCount <= availableRouteCount) {
          throw new Error(`第 ${missingOrder} 章已有路线尚未同步到章节执行区，已停止重复规划。`);
        }
        availableRouteCount = refreshedCount;
        extended = true;
        continue;
      }
      const next = this.findNextRouteTarget(workspace, missingOrder);
      if (!next) {
        const expandedWorkspace = await this.extendFutureVolumeSkeleton(
          novelId,
          workspace,
          options,
          writeGuard,
        );
        if (!expandedWorkspace) {
          break;
        }
        workspace = expandedWorkspace;
        extended = true;
        continue;
      }
      if (!next.beatKey) {
        workspace = await this.volumeService.generateVolumes(novelId, {
          writeGuard,
          scope: "beat_sheet",
          targetVolumeId: next.volumeId,
          draftWorkspace: workspace,
          provider: options.provider,
          model: options.model,
          temperature: options.temperature,
          taskId: options.taskId,
          guidance: closingGuidance,
          entrypoint: "jit_route_window",
        });
        workspace = await this.volumeService.updateVolumesWithOptions(novelId, workspace, {
          writeGuard,
          emitEvent: false,
          syncPayoffLedger: false,
          volumeUpdateReason: "chapter_execution_contract_refined",
        });
        continue;
      }

      workspace = await this.volumeService.generateVolumes(novelId, {
        writeGuard,
        scope: "chapter_list",
        targetVolumeId: next.volumeId,
        generationMode: "single_beat",
        targetBeatKey: next.beatKey,
        chapterOrderRange: { startOrder: missingOrder, endOrder: missingOrder },
        draftWorkspace: workspace,
        provider: options.provider,
        model: options.model,
        temperature: options.temperature,
        taskId: options.taskId,
        guidance: closingGuidance,
        entrypoint: "jit_route_window",
      });
      await this.syncRoute(novelId, workspace, missingOrder, writeGuard);
      extended = true;
      availableRouteCount = await this.countAvailableRoute(novelId, fromChapterOrder, endOrder);
    }
    return { availableRouteCount, extended };
  }

  private async extendFutureVolumeSkeleton(
    novelId: string,
    workspace: VolumePlanDocument,
    options: ChapterRouteWindowOptions,
    writeGuard?: Awaited<ReturnType<typeof createVolumeGenerationWriteGuard>>,
  ): Promise<VolumePlanDocument | null> {
    const targetChapterCount = options.completionProfile?.targetChapterCount ?? 0;
    const plannedChapterEnd = Math.max(
      0,
      ...workspace.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.chapterOrder)),
    );
    if (!workspace.strategyPlan || targetChapterCount <= plannedChapterEnd) {
      return null;
    }

    const skeletonVolumeCount = Math.max(
      workspace.volumes.length + 1,
      workspace.strategyPlan.recommendedVolumeCount,
    );
    const generatedSkeleton = await this.volumeService.generateVolumes(novelId, {
      writeGuard,
      scope: "skeleton",
      skeletonVolumeCount,
      draftWorkspace: workspace,
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      taskId: options.taskId,
      entrypoint: "jit_route_window",
      guidance: [
        "滚动生产需要补齐后续卷骨架。",
        "已有卷及其章节已经进入生产，必须视为固定事实；只为尚未创建的后续卷安排承接、升级和兑现。",
        `全书目标约 ${targetChapterCount} 章；当前只补卷级骨架，不拆远期章节。`,
      ].join("\n"),
    });
    const futureVolumes = generatedSkeleton.volumes.slice(workspace.volumes.length);
    if (futureVolumes.length === 0) {
      return null;
    }
    return this.volumeService.updateVolumesWithOptions(novelId, {
      volumes: [...workspace.volumes, ...futureVolumes],
      beatSheets: workspace.beatSheets,
      rebalanceDecisions: workspace.rebalanceDecisions,
    }, {
      writeGuard,
      emitEvent: false,
      syncPayoffLedger: false,
      volumeUpdateReason: "chapter_execution_contract_refined",
    });
  }

  private async countAvailableRoute(novelId: string, fromChapterOrder: number, endOrder?: number): Promise<number> {
    const rows = await prisma.chapter.findMany({
      where: {
        novelId,
        order: { gte: fromChapterOrder, ...(endOrder !== undefined ? { lte: endOrder } : {}) },
      },
      select: { order: true },
      orderBy: { order: "asc" },
    });
    const orders = new Set(rows.map(row => row.order));
    let nextOrder = fromChapterOrder;
    while ((endOrder === undefined || nextOrder <= endOrder) && orders.has(nextOrder)) nextOrder++;
    return nextOrder - fromChapterOrder;
  }

  private async syncRoute(novelId: string, workspace: VolumePlanDocument, order: number,
    writeGuard: Awaited<ReturnType<typeof createVolumeGenerationWriteGuard>>): Promise<void> {
    await this.volumeService.syncVolumeChaptersWithOptions(novelId, {
      volumes: workspace.volumes, preserveContent: true, applyDeletes: false, allowIncompleteExecutionContracts: true,
    }, { writeGuard, emitEvent: false, syncPayoffLedger: false,
      materializationRange: { startOrder: order, endOrder: order },
    });
  }

  private findNextRouteTarget(workspace: VolumePlanDocument, missingOrder: number): { volumeId: string; beatKey: string | null } | null {
    const volumes = workspace.volumes.slice().sort((left, right) => left.sortOrder - right.sortOrder);
    let nextOrder = 1;
    for (const volume of volumes) {
      const beatSheet = workspace.beatSheets.find((sheet) => sheet.volumeId === volume.id);
      if (!beatSheet || beatSheet.beats.length === 0) {
        return { volumeId: volume.id, beatKey: null };
      }
      for (const beat of beatSheet.beats) {
        const endOrder = nextOrder + Math.max(1, getBeatExpectedChapterCount(beat)) - 1;
        if (missingOrder >= nextOrder && missingOrder <= endOrder) {
          return { volumeId: volume.id, beatKey: beat.key };
        }
        nextOrder = endOrder + 1;
      }
    }
    return null;
  }
}
