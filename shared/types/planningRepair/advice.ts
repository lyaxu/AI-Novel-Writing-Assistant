import { z } from "zod";

export const planningRepairAdviceItemLimit = 8;
export const planningRepairAdviceDiagnoses = ["real_gap", "review_disagreement", "missing_information", "creative_tradeoff"] as const;

export const planningRepairAdviceOutputSchema = z.object({
  summary: z.string().min(1).max(1200),
  recommendedOptionId: z.string().min(1),
  options: z.array(z.object({
    id: z.string().min(1).max(60), title: z.string().min(1).max(100), reason: z.string().min(1).max(1000),
    changes: z.array(z.string().min(1).max(500)).min(1).max(planningRepairAdviceItemLimit),
    preserves: z.array(z.string().min(1).max(500)).min(1).max(planningRepairAdviceItemLimit),
    tradeoffs: z.array(z.string().min(1).max(500)).max(planningRepairAdviceItemLimit),
    diagnosis: z.enum(planningRepairAdviceDiagnoses),
    executionMode: z.enum(["repair_then_review", "review_existing", "source_edit"]),
    blockerResolution: z.object({
      status: z.enum(["complete", "partial", "unknown"]),
      remainingBlockers: z.array(z.string().min(1).max(400)).max(8),
      rationale: z.string().min(1).max(1200),
    }),
    affectedChapterIds: z.array(z.string().min(1)).min(1).max(3),
    changesHardConstraints: z.boolean(), requiresSourceEdit: z.boolean(),
    guidance: z.object({
      intent: z.string().min(1).max(500),
      actions: z.array(z.string().min(1).max(400)).min(1).max(planningRepairAdviceItemLimit),
      preserve: z.array(z.string().min(1).max(300)).max(planningRepairAdviceItemLimit),
      verification: z.array(z.string().min(1).max(300)).min(1).max(planningRepairAdviceItemLimit),
    }),
  })).min(1).max(3),
}).superRefine((value, ctx) => {
  const ids = value.options.map((option) => option.id);
  if (new Set(ids).size !== ids.length || !ids.includes(value.recommendedOptionId)) {
    ctx.addIssue({ code: "custom", message: "Options must have unique ids and a valid recommendation." });
  }
  for (const option of value.options) {
    if (JSON.stringify({ diagnosis: option.diagnosis, affectedChapterIds: option.affectedChapterIds, ...option.guidance }).length > 4000) {
      ctx.addIssue({ code: "custom", message: "Repair guidance exceeds the supported recovery boundary." });
    }
  }
});

export type PlanningRepairAdviceOutput = z.infer<typeof planningRepairAdviceOutputSchema>;
export interface PlanningRepairAdviceOption {
  id: string; title: string; reason: string; changes: string[]; preserves: string[]; tradeoffs: string[];
  canResume: boolean; blockedReason?: string;
  executionMode?: "repair_then_review" | "review_existing" | "source_edit";
}
export interface PlanningRepairAdviceStatus {
  status: "none" | "running" | "ready" | "stale" | "failed" | "uncertain";
  adviceId?: string; requestId?: string; summary?: string; recommendedOptionId?: string;
  options?: PlanningRepairAdviceOption[]; error?: string;
}
