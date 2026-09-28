import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type {
  AiChapterTaskSheetQualityAssessment,
  ChapterExecutionContractQualityCandidate,
  ChapterTaskSheetQualityIssue,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";
import {
  aiChapterTaskSheetQualityAssessmentSchema,
  chapterPlanningIssueCheckSchema,
  chapterPlanningEvidenceQuoteSchema,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";
import type { PromptAsset } from "../../../core/promptTypes";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./evidence/chapterEvidence";

export interface ChapterTaskSheetQualityPromptInput {
  candidate: ChapterExecutionContractQualityCandidate;
  mode: "full_book_autopilot" | "ai_copilot" | "manual";
  reviewContextJson?: string;
  previousIssues?: ChapterTaskSheetQualityIssue[];
}

function renderNullable(value: string | number | string[] | null | undefined): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(" | ") : "none";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return value?.trim() || "none";
}

function renderCandidate(candidate: ChapterExecutionContractQualityCandidate): string {
  return [
    `novelId: ${candidate.novelId}`,
    `volumeId: ${renderNullable(candidate.volumeId)}`,
    `chapterId: ${candidate.chapterId}`,
    `chapterOrder: ${candidate.chapterOrder}`,
    `title: ${candidate.title}`,
    `summary: ${renderNullable(candidate.summary)}`,
    `purpose: ${renderNullable(candidate.purpose)}`,
    `exclusiveEvent: ${renderNullable(candidate.exclusiveEvent)}`,
    `endingState: ${renderNullable(candidate.endingState)}`,
    `nextChapterEntryState: ${renderNullable(candidate.nextChapterEntryState)}`,
    `conflictLevel: ${renderNullable(candidate.conflictLevel)}`,
    `revealLevel: ${renderNullable(candidate.revealLevel)}`,
    `targetWordCount: ${renderNullable(candidate.targetWordCount)}`,
    `mustAvoid: ${renderNullable(candidate.mustAvoid)}`,
    `payoffRefs: ${renderNullable(candidate.payoffRefs ?? [])}`,
    "",
    "taskSheet:",
    renderNullable(candidate.taskSheet),
    "",
    "sceneCards:",
    renderNullable(candidate.sceneCards),
  ].join("\n");
}

function createSystemPrompt(mode: ChapterTaskSheetQualityPromptInput["mode"]): string {
  const modeRule = mode === "full_book_autopilot"
    ? "当前是全书自动模式。你要判断系统能否自动修好并继续，不能把普通写作质量问题交给新手用户。"
    : "当前是 AI 副驾或手动模式。你要指出是否需要用户确认，避免把不可靠合同静默同步到正文执行链。";
  return [
    "你是网文章节执行合同质量评估器。",
    "你的任务是判断 purpose、章节边界、taskSheet、readerExperience 和 sceneCards 是否足以交给正文生成器执行。",
    modeRule,
    "只评估当前章节合同，不扩写正文，不改写任务单。",
    "这是写前规划复核：判断已安排的动作与因果桥梁是否可执行，不要求规划提供尚未创作的正文。必须通读 taskSheet、mustAdvance 和 causality；若具体检查、建立或代价动作已安排在使用之前，不得因另一字段未重复描述而判定缺失。",
    "reviewContext 提供书级约束、原始与当前章节和邻章边界。历史评审只是待核实的意见，不能当作事实；以当前候选原文判断修复效果，不得机械复述上轮问题。未知前文不能自行编造。",
    "对 previousIssues 的每个 id 输出恰好一条 issueChecks：resolved、partially_resolved、unresolved 或 insufficient_context，引用当前候选原文 candidateEvidence 并解释判断。resolved 必须有至少一条准确原文，不得再把同 id 列入 issues；仍存在的问题沿用原 id。若上下文不足，说明缺的证据，不要把不确定推断写成已发生事实。没有历史问题则 issueChecks=[]。新问题须说明具体的执行或因果缺口，不能把可选文风偏好升级为阻塞。",
    "可用合同必须满足：本章目标清晰、边界不越章、任务单可执行、读者体验合同明确本章问题、可见回报、主角欲望、主要阻力、关键转折、净变化和钩子责任，场景卡覆盖整章推进并为每场提供阻力、转折、情绪位移和读者价值。",
    "readerExperience.rewardLevel 表示本章计划提供的可见回报强度，只能使用 setup、partial、major；它不是正文完成度、承诺兑现比例或事后结果评级。",
    "逐场审查 causality：选择是否出于角色具体动机；前置物品、信息、权限、能力或信任是否有真实来源；阻力方是否合理回应；outcomeMechanism 是否解释了结果怎样发生，而非重述结果；身体、时间、资源及关系限制是否延续并影响后续选择。必须引用 sceneKey 和具体缺口，不以字段齐全代替语义判断。",
    "established_in_context 只是规划者的来源声明，必须对照已给证据核实；若未提供对应原文/事实，不得凭声明认证成立。establish_in_scene 必须安排在使用之前；unresolved 仍是待修缺口，应修正本章方案或补充可验证的建立动作，不能编造前文。",
    "检查连续场景是否消费上一场的新状态和代价；拒绝、误解、情绪变化和失败也是有效结果，不强求战斗或胜利。不要求每场增加伤亡/损失；但已声明的能力限制不可凭空消失。普通本章因果缺口走 repair_contract，只有影响相邻章节边界才按既有范围规则选择 replan_window。",
    "即使正文完整兑现了 promisedReward，也不要建议把 rewardLevel 改为 full、complete 或其他值；只有本章计划的回报强度本身与章节职责不匹配时，才建议在 setup、partial、major 之间调整。",
    "还要判断本章是否被塞入过多彼此争夺篇幅的必达义务；如果任务单显示当前章职责已经过载，loadRisk=overloaded，recommendedHandling=replan_window。",
    "如果问题仍可在本章合同内收口，recommendedHandling=repair_contract；只有合同已经足够稳时才用 use_as_is。",
    "如果存在问题，给出面向自动修复器的具体 repairGuidance。",
    "",
    "输出严格 JSON，不要 Markdown、注释、解释或额外字段。",
    "顶层只能输出 verdict、safeToSync、loadRisk、recommendedHandling、summary、issues、repairGuidance、confidence、issueChecks。",
    "issueChecks 每项包含 issueId、status、candidateEvidence（最多3个对象，每个包含sourcePath和quote）、explanation（400字以内）。sourcePath必须逐字选择candidateEvidenceIndex的一个叶路径；quote为该路径值中240字以内的连续准确原文，不带路径标签，不拼接多个字段。没有可引用的原文时用空数组，不能伪造引用。最多覆盖8项原问题和1项合成职责过载问题，必须逐项覆盖全部previousIssues。",
    "verdict 只能使用 usable、repairable、unusable。",
    "loadRisk 只能使用 normal、overloaded。",
    "recommendedHandling 只能使用 use_as_is、repair_contract、replan_window。",
    "issues 每项只能包含 id、severity、target、summary、repairHint。",
    "issues.severity 只能使用 low、medium、high。",
    "issues.target 只能使用 purpose、boundary、task_sheet、scene_cards、semantic；节奏、重复、职责过载、主动性不足、义务冲突都归入 semantic。",
    "confidence 必须是 0 到 1 之间的小数，不要输出百分制数字。",
    "不得输出 pass、accepted、ok、blocked、pacing、plot、load 等自定义枚举值。",
    "",
    "JSON 形状示例：",
    "{",
    "  \"verdict\": \"repairable\",",
    "  \"safeToSync\": false,",
    "  \"loadRisk\": \"normal\",",
    "  \"recommendedHandling\": \"repair_contract\",",
    "  \"summary\": \"章节合同目标清楚，但场景卡缺少结尾钩子。\",",
    "  \"issues\": [",
    "    {",
    "      \"id\": \"scene_cards_missing_hook\",",
    "      \"severity\": \"medium\",",
    "      \"target\": \"scene_cards\",",
    "      \"summary\": \"场景卡没有覆盖章末阅读牵引。\",",
    "      \"repairHint\": \"补充最后一个场景的离场状态和下一章入口压力。\"",
    "    }",
    "  ],",
    "  \"repairGuidance\": [\"补齐最后一个场景的钩子和离场状态。\"],",
    "  \"confidence\": 0.82,",
    "  \"issueChecks\": []",
    "}",
  ].join("\n");
}

export const chapterTaskSheetQualityPrompt: PromptAsset<
  ChapterTaskSheetQualityPromptInput,
  AiChapterTaskSheetQualityAssessment
> = {
  id: "novel.volume.chapter_task_sheet_quality",
  version: "v5",
  taskType: "review",
  mode: "structured",
  language: "zh",
  contextPolicy: {
    maxTokensBudget: 4200,
  },
  outputSchema: aiChapterTaskSheetQualityAssessmentSchema.extend({
    issueChecks: z.array(chapterPlanningIssueCheckSchema.extend({
      candidateEvidence: z.array(chapterPlanningEvidenceQuoteSchema).max(3),
    })).max(9),
  }),
  render: (input) => [
    new SystemMessage(createSystemPrompt(input.mode)),
    new HumanMessage([
      `mode: ${input.mode}`,
      "",
      "chapter execution contract candidate:",
      renderCandidate(input.candidate),
      "candidateEvidenceIndex (valid leaf sourcePath; quote its corresponding exact text in the candidate above):",
      JSON.stringify([...buildChapterEvidenceIndex(input.candidate).leaves.keys()]),
      "",
      "reviewContext (current source and repair history):",
      input.reviewContextJson || "No additional context supplied. Do not invent prior facts.",
      "previousIssues:",
      JSON.stringify(input.previousIssues ?? []),
    ].join("\n")),
  ],
  postValidate: (output, input) => {
    const expected = new Set((input.previousIssues ?? []).map((issue) => issue.id));
    const checks = output.issueChecks ?? [];
    if (checks.length !== expected.size || new Set(checks.map((check) => check.issueId)).size !== checks.length
      || checks.some((check) => !expected.has(check.issueId))) {
      throw new Error("issueChecks must cover each previous issue exactly once.");
    }
    const source = buildChapterEvidenceIndex(input.candidate);
    for (const check of checks) {
      if (check.candidateEvidence.some((quote) => !matchesChapterEvidence(source, quote))) {
        throw new Error(`issueChecks ${check.issueId} contains evidence absent from the current candidate.`);
      }
      if (check.status === "resolved") {
        if (!check.candidateEvidence.length || output.issues.some((issue) => issue.id === check.issueId)) {
          throw new Error(`Resolved issue ${check.issueId} requires evidence and must not remain in issues.`);
        }
      } else if (!output.issues.some((issue) => issue.id === check.issueId)) {
        throw new Error(`Unresolved issue ${check.issueId} must retain its id in issues.`);
      }
    }
    return output;
  },
};
