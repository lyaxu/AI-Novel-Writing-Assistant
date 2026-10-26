import { Router } from "express";
import type { ApiResponse } from "@ai-novel/shared/types/api";
import { storyCraftDefaultsSchema, type StoryCraftDefaults } from "@ai-novel/shared/types/storyCraft";
import { authMiddleware } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  getStoryCraftDefaults,
  saveStoryCraftDefaults,
} from "../services/settings/StoryCraftSettingsService";

const router = Router();

router.use(authMiddleware);

router.get("/", async (_req, res, next) => {
  try {
    const data = await getStoryCraftDefaults();
    res.status(200).json({
      success: true,
      data,
      message: "通用创作规则已加载。",
    } satisfies ApiResponse<StoryCraftDefaults>);
  } catch (error) {
    next(error);
  }
});

router.put(
  "/",
  validate({ body: storyCraftDefaultsSchema }),
  async (req, res, next) => {
    try {
      const data = await saveStoryCraftDefaults(req.body);
      res.status(200).json({
        success: true,
        data,
        message: data.enabled
          ? "通用创作规则已保存，之后的规划和写作会按这套规则执行。"
          : "通用创作规则已关闭，之后的规划和写作不再注入这组规则。",
      } satisfies ApiResponse<StoryCraftDefaults>);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
