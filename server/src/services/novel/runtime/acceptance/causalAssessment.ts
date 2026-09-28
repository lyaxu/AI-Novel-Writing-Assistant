import type { ChapterAcceptancePromptInput, ChapterAcceptanceAssessmentOutput } from "../../../../prompting/prompts/novel/chapterAcceptance.prompts";
import type { ChapterAcceptanceAssessmentInput } from "../ChapterAcceptanceAssessmentService";
import { projectActionStateAssessment } from "./actionStateProjection";

/** Both invocation and cache identity must use the same requested scene coverage. */
export function buildAcceptancePromptInput(input: ChapterAcceptanceAssessmentInput): ChapterAcceptancePromptInput {
  return {
    chapterId: input.chapterId,
    novelTitle: input.novelTitle,
    chapterTitle: input.chapterTitle,
    chapterOrder: input.chapterOrder,
    targetWordCount: input.targetWordCount ?? null,
    content: input.content,
    expectedSceneKeys: input.contextPackage.chapterReviewContext?.scenePlan?.scenes
      .filter((scene) => scene.causality).map((scene) => scene.key) ?? [],
    establishedProse: input.contextPackage.chapterReviewContext?.writtenEvidence?.chapters
      .filter((chapter) => chapter.order < input.chapterOrder && chapter.chapterId !== input.chapterId)
      .map(({ chapterId, order, content }) => ({ chapterId, order, content })) ?? [],
  };
}

/** Reserve a bounded evidence allowance; a larger cap does not itself generate more tokens. */
export function acceptanceOutputBudget(sceneCount: number): number {
  return 4224 + Math.min(8, Math.max(0, Math.floor(sceneCount))) * 1536;
}

/** Deterministic projection of the AI verdict, never a second semantic classifier. */
export function projectCausalAssessment(output: ChapterAcceptanceAssessmentOutput): ChapterAcceptanceAssessmentOutput {
  output = projectActionStateAssessment(output);
  const failures = (output.sceneCausalityVerdicts ?? []).filter((row) => row.verdict !== "earned");
  if (!failures.length) return output;
  const blockingIssues = [...output.blockingIssues];
  const repairDirectives = [...output.repairDirectives];
  const riskTags = [...output.riskTags];
  for (const row of failures) {
    const code = `scene_causality_${row.verdict}_${row.sceneKey}`;
    riskTags.push(code);
    if (!blockingIssues.some((issue) => issue.code === code)) {
      blockingIssues.push({
        code,
        severity: row.verdict === "contradicted" ? "high" : "medium",
        category: "plot",
        evidence: [
          `场景 ${row.sceneKey}：${row.explanation}`,
          ...row.prerequisiteEvidence,
          row.choiceAndResistanceEvidence,
          row.outcomeMechanismEvidence,
          ...row.constraintEvidence,
        ].filter(Boolean).join("\n"),
        fixSuggestion: row.verdict === "insufficient_evidence"
          ? `核对场景 ${row.sceneKey} 缺失的来源与前文证据，不得通过虚构已发生事实填空。${row.explanation}`
          : `修正场景 ${row.sceneKey} 的选择、前提、阻力与结果之间的关系，保留已有合理推进。${row.explanation}`,
      });
    }
    // Unknown context is visible debt, not permission to invent a corrective scene.
    if (row.verdict !== "insufficient_evidence" && !repairDirectives.some((item) => item.instruction.includes(code))) {
      repairDirectives.push({ mode: "patch", target: "plot", instruction: `${code}：${row.explanation}。保留可信的事件结果，补齐或调整使其成立的因果桥；不得临时编造既有资源、知识或康复。` });
    }
  }
  const onlyUnknown = failures.every((row) => row.verdict === "insufficient_evidence");
  return {
    ...output,
    status: output.status === "accepted" ? (onlyUnknown ? "continue_with_risk" : "repairable") : output.status,
    continuePolicy: output.status === "accepted" ? (onlyUnknown ? "continue" : "repair_once") : output.continuePolicy,
    blockingIssues,
    repairDirectives,
    riskTags: [...new Set(riskTags)],
  };
}
