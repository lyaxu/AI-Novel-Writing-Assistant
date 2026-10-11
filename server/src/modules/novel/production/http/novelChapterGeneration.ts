import type { Router } from "express";
import { z } from "zod";
import { streamToSSE } from "../../../../llm/streaming";
import { validate } from "../../../../middleware/validate";
import type { ChapterRuntimeCoordinator } from "../../../../services/novel/runtime/ChapterRuntimeCoordinator";
import { chapterRuntimeRequestSchema } from "../../../../services/novel/runtime/chapterRuntimeSchema";
import { stepModuleRunner } from "../../../../services/novel/director/workflowStepRuntime/StepModuleRunner";
import { DIRECTOR_EXECUTION_STEP_IDS } from "../../../../services/novel/director/workflowStepRuntime/directorWorkflowStepIds";
import { createDefaultChapterProductionJournal } from "../../../../services/novel/production/reliability";

type ChapterStreamResult = Awaited<ReturnType<ChapterRuntimeCoordinator["createChapterStream"]>>;

interface RegisterNovelChapterGenerationRoutesInput {
  router: Router;
  chapterParamsSchema: z.ZodType<{
    id: string;
    chapterId: string;
  }>;
  forwardBusinessError: (error: unknown, next: (err?: unknown) => void) => boolean;
}

export function registerNovelChapterGenerationRoutes(input: RegisterNovelChapterGenerationRoutesInput): void {
  const {
    router,
    chapterParamsSchema,
    forwardBusinessError,
  } = input;

  // Inspection never acquires an execution lease or heals/restarts a task.
  router.get(
    "/:id/chapters/:chapterId/runtime/recovery",
    validate({ params: chapterParamsSchema }),
    async (req, res, next) => {
      try {
        const { id, chapterId } = req.params as z.infer<typeof chapterParamsSchema>;
        const recovery = await createDefaultChapterProductionJournal().inspect({ novelId: id, chapterId });
        res.json({ success: true, data: recovery });
      } catch (error) { next(error); }
    },
  );

  router.post(
    "/:id/chapters/:chapterId/runtime/recovery/resume",
    validate({ params: chapterParamsSchema, body: z.object({ operationId: z.string().min(1).max(200) }) }),
    async (req, res, next) => {
      try {
        const { id, chapterId } = req.params as z.infer<typeof chapterParamsSchema>;
        const saved = await createDefaultChapterProductionJournal().readResumeRequest({ novelId: id, chapterId, operationId: req.body.operationId });
        const { entry, ...options } = saved;
        // Parent tasks own their cancellation, retry budget and manual recovery boundary.
        // A chapter endpoint must not silently take over a director execution.
        if (entry !== "stream" && entry !== "repair") throw new Error("请回到原任务的源工作区恢复章节执行。");
        const result = await stepModuleRunner.runStep<ChapterStreamResult>(
          entry === "repair" ? DIRECTOR_EXECUTION_STEP_IDS.chapter_repair : DIRECTOR_EXECUTION_STEP_IDS.chapter_execution,
          {
            novelId: id, mode: "manual", targetType: "chapter", targetChapterId: chapterId,
            stepInput: entry === "repair"
              ? { ...options, productionOperationId: req.body.operationId }
              : { options: { ...options, productionOperationId: req.body.operationId }, runtimeStream: true },
          },
        );
        await streamToSSE(res, result.stream, result.onDone);
      } catch (error) {
        if (!forwardBusinessError(error, next)) next(error);
      }
    },
  );

  router.post(
    "/:id/chapters/:chapterId/runtime/run",
    validate({ params: chapterParamsSchema, body: chapterRuntimeRequestSchema }),
    async (req, res, next) => {
      try {
        const { id, chapterId } = req.params as z.infer<typeof chapterParamsSchema>;
        const { stream, onDone } = await stepModuleRunner.runStep<ChapterStreamResult>(
          DIRECTOR_EXECUTION_STEP_IDS.chapter_execution,
          {
            novelId: id,
            mode: "manual",
            targetType: "chapter",
            targetChapterId: chapterId,
            stepInput: {
              options: req.body as z.infer<typeof chapterRuntimeRequestSchema>,
              runtimeStream: true,
            },
          },
        );
        await streamToSSE(res, stream, onDone);
      } catch (error) {
        if (forwardBusinessError(error, next)) {
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    "/:id/chapters/:chapterId/generate",
    validate({ params: chapterParamsSchema, body: chapterRuntimeRequestSchema }),
    async (req, res, next) => {
      try {
        const { id, chapterId } = req.params as z.infer<typeof chapterParamsSchema>;
        const { stream, onDone } = await stepModuleRunner.runStep<ChapterStreamResult>(
          DIRECTOR_EXECUTION_STEP_IDS.chapter_execution,
          {
            novelId: id,
            mode: "manual",
            targetType: "chapter",
            targetChapterId: chapterId,
            stepInput: req.body as z.infer<typeof chapterRuntimeRequestSchema>,
          },
        );
        await streamToSSE(res, stream, onDone);
      } catch (error) {
        if (forwardBusinessError(error, next)) {
          return;
        }
        next(error);
      }
    },
  );
}
