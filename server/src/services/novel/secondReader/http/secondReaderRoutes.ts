import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../../../middleware/auth";
import { AppError } from "../../../../middleware/errorHandler";
import { validate } from "../../../../middleware/validate";
import { SecondReaderService } from "../SecondReaderService";

const router = Router();
const service = new SecondReaderService();
const active = new Set<string>();
router.use(authMiddleware);
router.post("/:novelId", validate({ body: z.object({
  startOrder: z.number().int().positive(), endOrder: z.number().int().positive(),
}).refine(x => x.endOrder >= x.startOrder, "章节范围无效。") }), async (req, res, next) => {
  const id = String(req.params.novelId);
  if (active.has(id)) return next(new AppError("本书的第二读者正在复核，请等待结果。", 409));
  active.add(id);
  try {
    const data = await service.read(id, req.body.startOrder, req.body.endOrder);
    res.json({ success: true, data });
  } catch (error) { next(error); }
  finally { active.delete(id); }
});
export default router;
