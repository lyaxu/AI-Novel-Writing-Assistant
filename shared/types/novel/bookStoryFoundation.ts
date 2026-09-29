import { z } from "zod";

const foundationText = z.string().trim().min(1).max(600);
const conciseText = z.string().trim().min(1).max(300);

/**
 * 跨题材的书级构思。结局表达可以轻松、日常，不强制宏大命题、悲剧或牺牲。
 * 世界规则不适用时须明确说明；作者掌握的结局不等于角色已知或开篇应揭露。
 */
export const bookStoryFoundationSchema = z.object({
  throughline: z.object({
    centralQuestion: foundationText,
    thematicAnswer: foundationText,
    endingChoice: foundationText,
    choiceCost: foundationText,
    resolution: foundationText,
    setupPayoffs: z.array(z.object({
      setup: conciseText,
      payoff: conciseText,
    })).min(1).max(4),
  }),
  worldBoundary: z.object({
    baseline: foundationText,
    crossingRules: foundationText,
    knowledgeBoundary: foundationText,
    hardLimits: z.array(conciseText).min(1).max(5),
  }),
  characterDynamics: z.array(z.object({
    role: conciseText,
    independentGoal: conciseText,
    mainlineEffect: conciseText,
    relationshipChange: conciseText,
  })).min(1).max(5),
  viewpoint: z.object({
    anchor: foundationText,
    scopeConnection: foundationText,
  }),
  progression: z.object({
    escalationLogic: foundationText,
    emotionalMovement: foundationText,
  }),
});

export type BookStoryFoundation = z.infer<typeof bookStoryFoundationSchema>;
