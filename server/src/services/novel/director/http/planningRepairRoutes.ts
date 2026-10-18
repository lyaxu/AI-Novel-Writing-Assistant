import { Router } from "express";
import { z } from "zod";
import { validate } from "../../../../middleware/validate";
import { PlanningRepairRecoveryService } from "../recovery/planningRepair/PlanningRepairRecoveryService";
import { DirectorCommandService } from "../commands/DirectorCommandService";
import { AppError } from "../../../../middleware/errorHandler";
import { isPlanningRepairConfirmationError } from "../recovery/planningRepair/planningRepairRecovery";
import { PlanningRepairAdviceService } from "../recovery/planningRepair/advice/PlanningRepairAdviceService";
import { planningRepairStore, type PlanningRepairStore } from "../../volume/planningRepair/PlanningRepairStore";
import { PlanningRepairReviewExistingService, PlanningRepairInitialContractService } from "../recovery/planningRepair";

const params = z.object({ id: z.string().trim().min(1) });
const abandonBody = z.object({ reason: z.string().trim().max(400).optional() }).strict().optional();
const adviceRequest = z.object({ repairKey: z.string().min(1), idempotencyKey: z.string().min(1).max(128) }).strict();
const adviceSelection = adviceRequest.extend({ adviceId: z.string().min(1), optionId: z.string().min(1) }).strict();
const reviewExistingRequest = adviceRequest.extend({ token: z.string().min(1).max(128) }).strict();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), repairKey: z.string().trim().min(1) }).strict(),
  z.object({
    action: z.literal("retry"), repairKey: z.string().trim().min(1),
    guidance: z.string().trim().min(1).max(4000), idempotencyKey: z.string().trim().min(1).max(128),
    executionMode: z.enum(["repair_then_review", "review_existing"]).optional(),
    affectedChapterIds: z.array(z.string().min(1)).min(1).max(3).optional(),
  }).strict(),
]);

export function createPlanningRepairRouter(
  recovery: Pick<PlanningRepairRecoveryService, "status" | "statusByNovel" | "grant"> = new PlanningRepairRecoveryService(),
  commands: Pick<DirectorCommandService, "enqueuePlanningRepairRecoveryCommand"> = new DirectorCommandService(),
  advice: Pick<PlanningRepairAdviceService, "status" | "request" | "select"> = new PlanningRepairAdviceService(recovery),
  store: Pick<PlanningRepairStore, "abandon"> = planningRepairStore,
  reviewExisting: Pick<PlanningRepairReviewExistingService, "status" | "grant"> = new PlanningRepairReviewExistingService(),
  initialContract: Pick<PlanningRepairInitialContractService, "status" | "grant"> = new PlanningRepairInitialContractService(),
) {
  const router = Router();
  router.get("/:id/planning-repair/initial-contract", validate({ params }), async (req, res, next) => {
    try { res.json({ success: true, data: await initialContract.status(String(req.params.id)) }); }
    catch (error) { next(error); }
  });
  router.post("/:id/planning-repair/initial-contract", validate({ params, body: reviewExistingRequest }), async (req, res, next) => {
    try {
      const taskId = String(req.params.id), input = req.body as z.infer<typeof reviewExistingRequest>;
      const grant = await initialContract.grant(taskId, input);
      const command = await commands.enqueuePlanningRepairRecoveryCommand(taskId, input.repairKey, input.idempotencyKey);
      res.status(202).json({ success: true, data: { ...grant, command } });
    } catch (error) {
      next(isPlanningRepairConfirmationError(error) ? new AppError(error instanceof Error ? error.message : "保留响应已变化，请刷新核对。", 409) : error);
    }
  });
  router.get("/:id/planning-repair/resume-policy", validate({ params }), async (req, res, next) => {
    try { res.json({ success: true, data: await reviewExisting.status(String(req.params.id), "resume_existing_policy") }); }
    catch (error) { next(error); }
  });
  router.post("/:id/planning-repair/resume-policy", validate({ params, body: reviewExistingRequest }), async (req, res, next) => {
    try {
      const taskId = String(req.params.id);
      const input = req.body as z.infer<typeof reviewExistingRequest>;
      const grant = await reviewExisting.grant(taskId, input, "resume_existing_policy");
      const command = await commands.enqueuePlanningRepairRecoveryCommand(taskId, input.repairKey, input.idempotencyKey);
      res.status(202).json({ success: true, data: { ...grant, command } });
    } catch (error) {
      next(isPlanningRepairConfirmationError(error) ? new AppError(error instanceof Error ? error.message : "规划位置已变化，请刷新后核对。", 409) : error);
    }
  });
  router.get("/:id/planning-repair/review-existing", validate({ params }), async (req, res, next) => {
    try { res.json({ success: true, data: await reviewExisting.status(String(req.params.id)) }); }
    catch (error) { next(error); }
  });
  router.post("/:id/planning-repair/review-existing", validate({ params, body: reviewExistingRequest }), async (req, res, next) => {
    try {
      const taskId = String(req.params.id);
      const input = req.body as z.infer<typeof reviewExistingRequest>;
      const grant = await reviewExisting.grant(taskId, input);
      const command = await commands.enqueuePlanningRepairRecoveryCommand(taskId, input.repairKey, input.idempotencyKey);
      res.status(202).json({ success: true, data: { ...grant, command } });
    } catch (error) {
      next(isPlanningRepairConfirmationError(error) ? new AppError(error instanceof Error ? error.message : "复核位置已变化，请刷新后核对。", 409) : error);
    }
  });
  router.get("/:id/planning-repair/advice", validate({ params }), async (req, res, next) => {
    try { res.json({ success: true, data: await advice.status(String(req.params.id)) }); }
    catch (error) { next(error); }
  });
  router.post("/:id/planning-repair/advice", validate({ params, body: adviceRequest }), async (req, res, next) => {
    try { res.status(202).json({ success: true, data: await advice.request(String(req.params.id), req.body) }); }
    catch (error) { next(error); }
  });
  router.post("/:id/planning-repair/advice/select", validate({ params, body: adviceSelection }), async (req, res, next) => {
    try {
      const taskId = String(req.params.id);
      const grant = await advice.select(taskId, req.body);
      const command = await commands.enqueuePlanningRepairRecoveryCommand(taskId, req.body.repairKey, grant.idempotencyKey);
      res.status(202).json({ success: true, data: { ...grant, command } });
    } catch (error) {
      next(isPlanningRepairConfirmationError(error) ? new AppError(error instanceof Error ? error.message : "规划源已变化，请重新获取建议。", 409) : error);
    }
  });
  router.get("/novels/:novelId/planning-repair", validate({ params: z.object({ novelId: z.string().trim().min(1) }) }), async (req, res, next) => {
    try {
      res.json({ success: true, data: await recovery.statusByNovel(String(req.params.novelId)) });
    } catch (error) { next(error); }
  });
  router.get("/:id/planning-repair", validate({ params }), async (req, res, next) => {
    try {
      res.json({ success: true, data: await recovery.status(String(req.params.id)) });
    } catch (error) { next(error); }
  });
  /**
   * Give up on this task's repair session.
   *
   * Separate from `actions/retry` on purpose: retrying asks the same stuck session for another
   * attempt, which is what the user has already done several times by the point they reach for this.
   * This ends the session so the novel stops being blocked by it.
   */
  router.post("/:id/planning-repair/abandon", validate({ params, body: abandonBody }), async (req, res, next) => {
    try {
      const state = await store.abandon({
        taskId: String(req.params.id),
        reason: (req.body as { reason?: string } | undefined)?.reason,
      });
      res.json({
        success: true,
        data: { phase: state.phase, abandonedAt: state.abandonedAt, abandonedRounds: state.abandonedRounds },
      });
    } catch (error) { next(error); }
  });
  router.post("/:id/planning-repair/actions", validate({ params, body: action }), async (req, res, next) => {
    try {
      const input = req.body as z.infer<typeof action>;
      const taskId = String(req.params.id);
      const grant = await recovery.grant(taskId, input);
      const command = input.action === "retry" && grant.granted
        ? await commands.enqueuePlanningRepairRecoveryCommand(taskId, input.repairKey, input.idempotencyKey)
        : null;
      res.status(command ? 202 : 200).json({ success: true, data: { ...grant, command } });
    } catch (error) {
      next(isPlanningRepairConfirmationError(error)
        ? new AppError(error instanceof Error ? error.message : "规划源已变化，请检查后再确认。", 409)
        : error);
    }
  });
  return router;
}
