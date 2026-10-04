import { Router } from "express";
import type { ApiResponse } from "@ai-novel/shared/types/api";
import { authMiddleware } from "../middleware/auth";
import { describeRuntimeIdentity, readRuntimeIdentity, type RuntimeIdentity } from "../runtime/runtimeIdentity";

const router = Router();

router.use(authMiddleware);

router.get("/", (_req, res) => {
  // Runtime identity rides along with health so "the fix is not live yet" is answerable without
  // shelling into the machine: `stale` true means source files changed after this process started.
  const runtime = readRuntimeIdentity();
  const response: ApiResponse<{ status: string; timestamp: string; runtime: RuntimeIdentity }> = {
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      runtime,
    },
    message: describeRuntimeIdentity(runtime),
  };
  res.status(200).json(response);
});

export default router;
