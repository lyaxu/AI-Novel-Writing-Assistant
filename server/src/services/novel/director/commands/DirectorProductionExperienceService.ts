import type {
  NovelProductionExperience,
  NovelProductionScope,
  NovelProductionExperienceSelectionResponse,
} from "@ai-novel/shared/types/novelWorkflow";
import { buildFullBookAutopilotExecutionPlan, isDirectorAutoExecutionRunMode } from "@ai-novel/shared/types/novelDirector";
import { buildFullDirectorAutoApprovalConfig } from "@ai-novel/shared/types/autoDirectorApproval";
import { prisma } from "../../../../db/prisma";
import { AppError } from "../../../../middleware/errorHandler";
import { parseSeedPayload } from "../../workflow/novelWorkflow.shared";
import {
  applyDirectorRunModeContract,
  type DirectorWorkflowSeedPayload,
} from "../runtime/novelDirectorHelpers";
import { DirectorCommandService } from "./DirectorCommandService";

export function parseSelectedExperience(seed: DirectorWorkflowSeedPayload): NovelProductionExperience | null {
  return seed.productionExperience === "simple" || seed.productionExperience === "professional"
    ? seed.productionExperience
    : null;
}

/** Takeover authorization is already explicit; choosing an interface cannot replace its range. */
export function getTakeoverProductionPlan(seed: DirectorWorkflowSeedPayload) {
  return seed.takeover && isDirectorAutoExecutionRunMode(seed.directorInput?.runMode)
    ? seed.directorInput?.autoExecutionPlan ?? null : null;
}

export function buildProductionExperienceSeed(
  seed: DirectorWorkflowSeedPayload,
  experience: NovelProductionExperience,
  scope?: NovelProductionScope,
): DirectorWorkflowSeedPayload {
  const directorInput = seed.directorInput;
  if (!directorInput) {
    throw new AppError("自动导演任务缺少继续生产所需的上下文。", 409);
  }
  const authorizedPlan = getTakeoverProductionPlan(seed);
  if (authorizedPlan) {
    if (scope !== undefined) throw new AppError("接管范围已确认，请仅选择创作界面；如需调整范围，请返回 AI 自动导演接管。", 409);
    return { ...seed, productionExperience: experience, productionScope: undefined,
      runMode: directorInput.runMode, autoExecutionPlan: authorizedPlan,
      autoApproval: directorInput.autoApproval, directorInput };
  }
  const selectedScope = scope ?? seed.productionScope ?? "book";
  const nextInput = applyDirectorRunModeContract({
    ...directorInput,
    runMode: "full_book_autopilot" as const,
    autoExecutionPlan: selectedScope === "book" ? buildFullBookAutopilotExecutionPlan() : {
      mode: "chapter_range", startOrder: 1, endOrder: selectedScope === "sample3" ? 3 : 5,
      autoReview: true, autoRepair: true,
    },
    autoApproval: buildFullDirectorAutoApprovalConfig(),
  });
  return {
    ...seed,
    productionExperience: experience,
    productionScope: selectedScope,
    runMode: nextInput.runMode,
    autoExecutionPlan: nextInput.autoExecutionPlan,
    autoApproval: nextInput.autoApproval,
    directorInput: nextInput,
  };
}

export class DirectorProductionExperienceService {
  constructor(private readonly commandService = new DirectorCommandService()) {}

  async select(
    taskId: string,
    experience: NovelProductionExperience,
    scope?: NovelProductionScope,
  ): Promise<NovelProductionExperienceSelectionResponse> {
    const task = await prisma.novelWorkflowTask.findUnique({ where: { id: taskId } });
    if (!task || task.lane !== "auto_director") {
      throw new AppError("自动导演任务不存在。", 404);
    }
    if (!task.novelId) {
      throw new AppError("自动导演任务还没有绑定小说项目。", 409);
    }

    const seed = parseSeedPayload<DirectorWorkflowSeedPayload>(task.seedPayloadJson) ?? {};
    const selected = parseSelectedExperience(seed);
    const authorizedPlan = getTakeoverProductionPlan(seed);
    if (authorizedPlan && scope !== undefined) throw new AppError("接管范围已确认，请仅选择创作界面；如需调整范围，请返回 AI 自动导演接管。", 409);
    if (selected && scope && scope !== (seed.productionScope ?? "book")) {
      throw new AppError("请从章节执行范围中确认后续写作范围；切换界面不会扩大试写范围。", 409);
    }
    const productionScope = authorizedPlan ? undefined : scope ?? seed.productionScope ?? "book";
    if (selected && selected !== experience) {
      const nextSeed = { ...seed, productionExperience: experience };
      await prisma.$transaction(async (tx) => {
        const updated = await tx.novelWorkflowTask.updateMany({
          where: { id: task.id, seedPayloadJson: task.seedPayloadJson },
          data: { seedPayloadJson: JSON.stringify(nextSeed) },
        });
        if (updated.count === 0) {
          throw new AppError("写作任务刚刚发生变化，请刷新后再切换界面。", 409);
        }
        await tx.novel.update({
          where: { id: task.novelId! },
          data: { creationExperience: experience },
        });
      });
      return {
        productionScope,
        autoExecutionPlan: authorizedPlan ?? undefined,
        experience,
        workflowTaskId: task.id,
        novelId: task.novelId,
        targetRoute: experience === "simple" ? `/novels/${task.novelId}/simple` : `/novels/${task.novelId}/edit`,
        backgroundStarted: task.status === "queued" || task.status === "running",
      };
    }

    if (!selected) {
      if (task.checkpointType !== "production_experience_required") {
        throw new AppError("自动导演还没有完成正文生产前的准备。", 409);
      }
      const nextSeed = buildProductionExperienceSeed(seed, experience, productionScope);

      const claimed = await prisma.$transaction(async (tx) => {
        const updated = await tx.novelWorkflowTask.updateMany({
          where: {
            id: task.id,
            checkpointType: "production_experience_required",
            seedPayloadJson: task.seedPayloadJson,
          },
          data: {
            seedPayloadJson: JSON.stringify(nextSeed),
            status: "waiting_approval",
            currentStage: "chapter_execution",
            currentItemKey: "chapter_batch_ready",
            currentItemLabel: authorizedPlan ? "准备按确认范围继续写作" : productionScope === "book" ? "准备开始全书生产" : "准备生成开篇样章",
            checkpointType: "chapter_batch_ready",
            checkpointSummary: authorizedPlan ? "AI 将按接管时确认的范围继续写作，保留已有正文。" : productionScope === "book" ? "章节执行资源已准备完成，AI 将开始全书生产。" : `仅试写前${productionScope === "sample3" ? 3 : 5}章，完成后等待试读，不自动扩写整本。`,
            pendingManualRecovery: false,
          },
        });
        if (updated.count === 0) {
          return false;
        }
        await tx.novel.update({
          where: { id: task.novelId! },
          data: { creationExperience: experience },
        });
        return true;
      });

      if (!claimed) {
        return this.select(taskId, experience, scope);
      }
    }

    const shouldEnqueue = !selected || (
      task.status === "waiting_approval"
      && task.checkpointType === "chapter_batch_ready"
    );
    const command = shouldEnqueue
      ? await this.commandService.enqueueContinueCommand(task.id, {
        continuationMode: "auto_execute_range",
        forceResume: true,
      })
      : null;
    return {
      productionScope,
      autoExecutionPlan: authorizedPlan ?? undefined,
      experience,
      workflowTaskId: task.id,
      novelId: task.novelId,
      targetRoute: experience === "simple" ? `/novels/${task.novelId}/simple` : `/novels/${task.novelId}/edit`,
      backgroundStarted: true,
      commandId: command?.commandId,
    };
  }
}
