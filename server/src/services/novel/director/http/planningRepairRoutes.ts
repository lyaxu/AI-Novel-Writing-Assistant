import { Router } from "express";
import { z } from "zod";
import { validate } from "../../../../middleware/validate";
import { PlanningRepairRecoveryService } from "../recovery/planningRepair/PlanningRepairRecoveryService";
import { DirectorCommandService } from "../commands/DirectorCommandService";
import { AppError } from "../../../../middleware/errorHandler";
import { isPlanningRepairConfirmationError } from "../recovery/planningRepair/planningRepairRecovery";
import { PlanningRepairAdviceService } from "../recovery/planningRepair/advice/PlanningRepairAdviceService";

const params = z.object({ id: z.string().trim().min(1) });
const adviceRequest = z.object({ repairKey: z.string().min(1), idempotencyKey: z.string().min(1).max(128) }).strict();
const adviceSelection = adviceRequest.extend({ adviceId: z.string().min(1), optionId: z.string().min(1) }).strict();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), repairKey: z.string().trim().min(1) }).strict(),
  z.object({
    action: z.literal("retry"), repairKey: z.string().trim().min(1),
    guidance: z.string().trim().min(1).max(4000), idempotencyKey: z.string().trim().min(1).max(128),
  }).strict(),
]);

export function createPlanningRepairRouter(
  recovery: Pick<PlanningRepairRecoveryService, "status" | "statusByNovel" | "grant"> = new PlanningRepairRecoveryService(),
  commands: Pick<DirectorCommandService, "enqueuePlanningRepairRecoveryCommand"> = new DirectorCommandService(),
  advice: Pick<PlanningRepairAdviceService, "status" | "request" | "select"> = new PlanningRepairAdviceService(recovery),
) {
  const router = Router();
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
