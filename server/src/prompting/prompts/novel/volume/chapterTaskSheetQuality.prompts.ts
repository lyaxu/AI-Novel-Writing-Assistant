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
  chapterPlanningPromiseCheckSchema,
  chapterPlanningHandoffStatusSchema,
  chapterTaskSheetQualityIssueSchema,
} from "@ai-novel/shared/types/chapterTaskSheetQuality";
import type { PromptAsset } from "../../../core/promptTypes";
import { buildChapterEvidenceIndex } from "./evidence/chapterEvidence";
import { projectValidatedIssueChecks } from "./evidence/issueCheckProjection";
import { planningPromiseEvidenceContext, validatePlanningPromiseEvidence } from "./evidence/planningPromiseEvidence";

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
    "writtenEvidence中的实际已写正文与可核验事实高于计划描述。selectedPlanningDirection来自用户确认的候选，是尚待履行的创作承诺，不是已经发生的事实，也不能用后来生成的大纲替代原始确认来源。",
    "逐项检查 selectedPromiseSourceIds：原选卖点、人物路径、开篇关系推进、earlyPayoff与openingChain中的回报价值是否贯穿当前细化。为每个sourceId输出一条promiseChecks。preserved=有证据保留，adapted=表现手段/落点改写但关系及回报价值等效，deferred=有理由延期且给出具体承接，dropped=承诺被丢弃，insufficient=证据不足。不要把纯追逃、重复受压当成原先关系变化或阶段回报的等价替代。",
    "scope区分current_chapter、opening_sequence、book_arc，由原始来源与实际安排判断，不按某个固定章序强锁动作。开篇原型允许合理拆合与移动，但延期须引用contextEvidence中实际承接章节的具体内容并说明回报何时如何落实；不能仅说后面再写。全书或前30章承诺不是本章必须全部兑现的清单；尚未到期的book_arc可以deferred并说明范围，不能据此无故阻塞当前章。",
    "承接证据可直接来自只读后续章节与节奏板，不要求当前章合同重复抄录相同安排。若后续计划实际覆盖该承诺，不能仅因当前章仍写待确认就判承接不存在；另行核对是否有真实冲突或遗漏。读取或引用窗口外已有计划不等于修改窗口外章节。",
    "promiseChecks字段：sourceId、scope、status、handoffStatus、sourceEvidence、candidateEvidence、contextEvidence、explanation（600字以内）、repairHint（600字以内，无缺口可为空）。handoffStatus必填：非deferred只能not_needed；deferred只能covered（所有相关功能与回报有具体承接且符合原期限）、partial（仅覆盖部分）、missing（无承接）、conflicting（承接与期限/已写事实/硬约束冲突）。contextEvidence非空不等于covered，必须判断引用是否真正覆盖该承诺，而不是仅完成前置动作或其他承诺。三组Evidence均用{sourcePath,quote}且每组最多3条；sourceEvidence至少1条引用对应原始来源；candidateEvidence引用当前候选；contextEvidence引用真实已有计划或前文，原选承诺本身不能当兑现证据。",
    "为完整覆盖所有承诺，每组证据优先选1条20至80字的最短充分引用，explanation与repairHint各用1句说明；只有确实需多条证据时才增加，不能将上限当目标铺满或重复整段原文。",
    "dropped、insufficient及开篇/本章无具体承接的deferred是待修缺口，应输出repair_contract和具体repairGuidance；可在当前授权窗口补齐的交给自动修复器，不要求新手手写。若只能牺牲用户硬约束或改窗口外章节，明确冲突交给既有方向确认，不能静默降低承诺。按实际selectedPromiseSourceIds完整覆盖；列表为空才promiseChecks=[]。旧数据有卖点而无原型时仍检查已有卖点，不补造开篇。",
    "openingChain与earlyPayoff的scope不能降为book_arc来免除承接检查。openingChain只要求逐项审查原型当前及过去的节点，未来节点保留供边界参考而不提前索取兑现。earlyPayoff可能覆盖整个开篇，当前章只需贡献相应进展；未到期的部分可通过readonlyOpeningRoutes中的实际安排说明承接，不强求当前章完成所有回报。",
    "同次确认的hookStrategy、progressionLoop与storyPrototype需一起理解；顺序不同应依据整体叙事功能、已写事实与明确回报窗口判断合理拆合，不把原型章序当同号实际章的硬截止。readonlyPlanningHorizon是实际已有只读节拍，不扩大修改权限。有后续节拍不等于满足期限：前三章等明确时限不得因较后节拍提及事件就判covered；期限冲突用conflicting，部分兑现用partial，保留未兑现部分进入修复。",
    "对 previousIssues 的每个 id 输出恰好一条 issueChecks：resolved、partially_resolved、unresolved 或 insufficient_context，引用当前候选原文并解释判断。只核对该历史问题原有范围，不把另一承诺或新缺口扩进旧问题；新问题单列。resolved必须有至少一条准确原文，不得再把同id列入issues。未解旧问题以issueChecks为准，程序保留原ID及修复方向，issues无需重复；issues只列新问题或额外缺口，不能用新命名替换旧问题状态。上下文不足应明确，不把不确定推断写成事实。没有历史问题则issueChecks=[]。",
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
    "顶层只能输出 verdict、safeToSync、loadRisk、recommendedHandling、summary、issues、repairGuidance、confidence、issueChecks、promiseChecks。",
    "issueChecks每项包含issueId、status、candidateEvidence（最多3个{sourcePath,quote}）、explanation（400字以内）。sourcePath须选candidateEvidenceIndex真实叶路径；quote是该值中240字以内连续准确原文，不带标签、不拼接字段。无可引用原文用空数组，不伪造。issueChecks须完整覆盖全部previousIssues，不受新问题上限限制。issues最多8项普通问题加contract_overloaded、selected_direction_drift两项，不重复堆放历史问题。",
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
    "  \"issueChecks\": [],",
    "  \"promiseChecks\": []",
    "}",
  ].join("\n");
}

export const chapterTaskSheetQualityPrompt: PromptAsset<
  ChapterTaskSheetQualityPromptInput,
  AiChapterTaskSheetQualityAssessment
> = {
  id: "novel.volume.chapter_task_sheet_quality",
  version: "v8",
  taskType: "review",
  mode: "structured",
  language: "zh",
  contextPolicy: {
    maxTokensBudget: 4200,
  },
  outputSchema: aiChapterTaskSheetQualityAssessmentSchema.extend({
    issues: z.array(chapterTaskSheetQualityIssueSchema).max(10)
      .refine(issues => issues.filter(issue => !["contract_overloaded", "selected_direction_drift"].includes(issue.id)).length <= 8),
    promiseChecks: z.array(chapterPlanningPromiseCheckSchema.extend({ handoffStatus: chapterPlanningHandoffStatusSchema })).max(10),
    issueChecks: z.array(chapterPlanningIssueCheckSchema.extend({
      candidateEvidence: z.array(chapterPlanningEvidenceQuoteSchema).max(3),
    })),
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
      "selectedPromiseSourceIds (each requires one check):",
      JSON.stringify(planningPromiseEvidenceContext(input.reviewContextJson, input.candidate.chapterOrder).sourceIds),
      "selectedPromiseSourceEvidenceIndex:",
      JSON.stringify([...planningPromiseEvidenceContext(input.reviewContextJson).sourceIndex.leaves.keys()]),
      "promiseContextEvidenceIndex (facts or other chapter plans; distinguish their provenance):",
      JSON.stringify([...planningPromiseEvidenceContext(input.reviewContextJson).contextIndex.leaves.keys()]),
      "",
      "reviewContext (current source and repair history):",
      input.reviewContextJson || "No additional context supplied. Do not invent prior facts.",
      "previousIssues:",
      JSON.stringify(input.previousIssues ?? []),
    ].join("\n")),
  ],
  postValidate: (output, input) => {
    validatePlanningPromiseEvidence(output.promiseChecks ?? [], input.candidate, input.reviewContextJson);
    return projectValidatedIssueChecks(output, input.candidate, input.previousIssues);
  },
};
