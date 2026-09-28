import { z } from "zod";

export const planningRepairAdviceOutputSchema = z.object({
  summary: z.string().min(1).max(1200),
  recommendedOptionId: z.string().min(1),
  options: z.array(z.object({
    id: z.string().min(1).max(60), title: z.string().min(1).max(100), reason: z.string().min(1).max(1000),
    changes: z.array(z.string().max(500)).min(1).max(6),
    preserves: z.array(z.string().max(500)).min(1).max(6),
    tradeoffs: z.array(z.string().max(500)).max(6),
    diagnosis: z.enum(["real_gap", "review_disagreement", "missing_information", "creative_tradeoff"]),
    affectedChapterIds: z.array(z.string().min(1)).min(1).max(3),
    changesHardConstraints: z.boolean(), requiresSourceEdit: z.boolean(),
    guidance: z.object({
      intent: z.string().min(1).max(500),
      actions: z.array(z.string().min(1).max(400)).min(1).max(5),
      preserve: z.array(z.string().min(1).max(300)).max(4),
      verification: z.array(z.string().min(1).max(300)).min(1).max(4),
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
}
export interface PlanningRepairAdviceStatus {
  status: "none" | "running" | "ready" | "stale" | "failed" | "uncertain";
  adviceId?: string; requestId?: string; summary?: string; recommendedOptionId?: string;
  options?: PlanningRepairAdviceOption[]; error?: string;
}
