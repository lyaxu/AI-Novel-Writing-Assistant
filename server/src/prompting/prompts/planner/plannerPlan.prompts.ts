import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StoryPlanLevel } from "@ai-novel/shared/types/novel";
import type { PromptAsset } from "../../core/promptTypes";
import { normalizePlannerOutput, type PlannerOutput } from "../../../services/planner/plannerOutputNormalization";
import { plannerOutputSchema } from "../../../services/planner/plannerSchemas";
import { validateChapterPayoffDecisions, type ChapterPayoffValidationInput } from "../../../services/planner/payoff";

interface PlannerPlanPromptInput {
  scopeLabel: string;
  payoffValidation?: ChapterPayoffValidationInput;
}

function buildPlannerPlanAsset(input: {
  id: string;
  version: string;
  planLevel: StoryPlanLevel;
  includeScenes: boolean;
  maxTokensBudget: number;
}): PromptAsset<PlannerPlanPromptInput, PlannerOutput> {
  return {
    id: input.id,
    version: input.version,
    taskType: "planner",
    mode: "structured",
    language: "zh",
    contextPolicy: {
      maxTokensBudget: input.maxTokensBudget,
      requiredGroups:
        input.planLevel === "chapter"
          ? ["novel_overview", "chapter_target", "outline_source", "state_snapshot"]
          : undefined,
      preferredGroups:
        input.planLevel === "chapter"
          ? ["book_plan", "arc_plans", "volume_summary", "story_mode"]
          : ["story_mode", "book_bible"],
      dropOrder: [
        "recent_decisions",
        "character_dynamics",
        "plot_beats",
        "recent_summaries",
        "arc_plans",
        "book_plan",
        "volume_summary",
      ],
    },
    semanticRetryPolicy:
      input.planLevel === "chapter"
        ? { maxAttempts: 1 }
        : undefined,
    outputSchema: plannerOutputSchema,
    structuredOutputHint: {
      example: {
        title: "示例标题",
        objective: "示例目标",
        participants: ["示例参与方"],
        reveals: ["示例揭露"],
        riskNotes: ["示例风险"],
        hookTarget: "示例悬念",
        planRole: input.planLevel === "chapter" ? "progress" : "",
        phaseLabel: "示例阶段",
        mustAdvance: ["示例推进项"],
        mustPreserve: ["示例保留项"],
        ...(input.planLevel === "chapter" ? { payoffDecisions: [] } : {}),
        scenes: input.includeScenes
          ? [{
            title: "示例场景",
            objective: "示例场景目标",
            conflict: "示例冲突",
            reveal: "示例变化",
            emotionBeat: "示例情绪节拍",
          }]
          : [],
      },
      note: input.includeScenes
        ? "当前层级必须返回可执行的 scenes 示例。"
        : "当前层级的 scenes 必须保持为空数组。",
    },
    render: (promptInput, context) => {
      const contextText = context.blocks.map((block) => block.content).join("\n\n");

      const systemPrompt = [
        "你是长篇小说规划助手，负责把当前层级的故事需求整理成可直接进入下一步写作或细化流程的结构化规划结果。",
        "",
        "只输出严格 JSON，不要输出 Markdown、解释、注释、代码块或额外文本。",
        `当前规划层级：${input.planLevel}。`,
        "",
        "输出必须包含以下字段：",
        "title、objective、participants、reveals、riskNotes、hookTarget、planRole、phaseLabel、mustAdvance、mustPreserve、scenes。",
        input.includeScenes
          ? "scenes 必须是非空数组，且每一项都必须包含：title、objective、conflict、reveal、emotionBeat。"
          : "scenes 必须返回空数组。",
        input.planLevel === "chapter"
          ? "当规划层级为 chapter 时，planRole 必填，且只能是：setup、progress、pressure、turn、payoff、cooldown。"
          : "当规划层级为 book 或 arc 时，planRole 可为空字符串，但不得乱填无效值。",
        "",
        "全局硬规则：",
        "1. 所有内容必须使用简体中文。",
        "2. 只能基于给定上下文规划，不得补写上下文之外的关键设定、人物关系或重大剧情。",
        "3. 输出必须服务于后续创作执行，而不是写分析说明。",
        "4. 各字段之间必须自洽，不得互相冲突。",
        "5. mustAdvance 和 mustPreserve 必须简短、具体、可直接用于后续写作。",
        ...(input.planLevel === "chapter" ? [
          "6. reference_candidates_not_chapter_obligations中的全局冲突和人物阶段只是待判断背景。结合已写正文、当前章目标及明确执行合同，选择本章相关事项并具体化后才写入mustAdvance/mustPreserve；不直接抄内部问题代码或远期阶段标签。未选背景不等于本章缺项，用户和当前章的明确硬约束仍必须遵守。participants只包含本章实际需要的参与者，不为凑人数添加全书角色，也不强制每章出现主角。",
          "6a. 章级输出必须含payoffDecisions数组，没有提供候选时可为空。对payoffCandidates结合当前章合同、前文与未来章节规划决定seed/touch/pressure/partial_reveal/payoff/forbid/defer/out_of_scope/requires_replan，不按逾期状态机械施压或强制兑现。每个提供的bounded payoffCandidates须恰好一项决定，只有候选为空时可空数组。无关候选用out_of_scope并依据当前合同解释无关，不强行塞入本章；不得把本章相关到期回报伪装无关。每项含ledgerKey、operation、reason、authorizedScope及contractEvidence:{sourcePath:expectation|taskSheet|sceneCards|hook|mustAvoid,quote:当前合同原文}、followUp:null。payoff_planning_evidence块是回报引用的唯一权威，不使用摘要替代。quote与planningQuote必须是该块对应来源中一段连续、逐字一致的原文，保留编号、换行与标点；可以只摘短句，不得拼接不同条目、删除中间编号、改写或修改句号。defer必须提供followUp；到期/逾期候选选择seed/touch/pressure同样未兑现，也必须提供followUp:{chapterOrder:后续明确章序,expectedChange:具体兑现变化,planningQuote:未来规划原文}，说明当前为何不兑现以及如何承接，禁止空泛后面再说。若当前合同禁止回报且未来规划没有合法承接落点，用requires_replan和明确reason，followUp为null；不能编造未来引文或用pressure无期限拖延。partial_reveal须另填remainingObligation与有未来规划原文的followUp，明确余下交付，不能不断给一点作为拖延。partial_reveal/payoff说明本章可兑现多少，不以旧账本日期突破合同范围、保护信息或世界设定。获得能力可以是书已确认的突然获得，不强制苦练、额外付费或悲壮代价。",
        ] : []),
        "",
        "字段要求：",
        ...(input.planLevel === "chapter" ? ["followUp只可指向planningWindow里实际提供的未来chapterOrder，账本的目标日期不代表该章已拆出。尚未到期且仅seed/touch/pressure的铺垫可以followUp:null，不为完整性虚构后续安排；到期未兑、defer、partial_reveal仍须实际承接证据。"] : []),
        ...(input.planLevel === "chapter" ? ["回报与秘密分开判断：可以本章获得奖励而暂不揭示奖励来源。账本提及某个秘密不等于整个回报禁止推进；forbid只用于明确禁止的事项，在authorizedScope写清该事项。受保护信息仍须遵守，不用‘保密’取消已授权的收益。"] : []),
        ...(input.planLevel === "chapter" ? ["回报与秘密分开判断：可以本章获得奖励而暂不揭示奖励来源。账本提及某个秘密不等于整个回报禁止推进；forbid只用于明确禁止的事项，在authorizedScope写清该事项。受保护信息仍须遵守，不用‘保密’取消已授权的收益。"] : []),
        "1. title：写当前层级规划条目的标题，简洁明确，不要占位词。",
        "2. objective：必须明确说明这一层规划最核心的推进目标，不能写成泛泛摘要。",
        "3. participants：只列关键人物、关键势力或关键关系参与方，不要把所有人都塞进去。",
        "4. reveals：只写重要信息揭露、结构转折或关键认知变化，不要写普通过程。",
        "5. riskNotes：写最容易失焦、变平、失真、跑偏或违背约束的风险点，必须具体。",
        "6. hookTarget：写阶段尾部或章节尾部要留给读者的悬念、张力、期待或情绪牵引，不要写成空话。",
        "7. phaseLabel：用短语概括当前阶段，例如“试探压迫期”“关系绑定期”“身份松动期”，不要太长。",
        "8. mustAdvance：列出本层级绝不能缺席的推进项，必须是动作性、结果性或结构性推进。",
        "9. mustPreserve：列出不能破坏的连续性、世界规则、角色状态、语气边界或模式约束。",
        input.includeScenes
          ? "10. scenes 必须按顺序组织，且每一项都要能直接给写作阶段使用，不要写成概念标签。"
          : "10. 由于当前层级不要求场景细化，scenes 必须为空数组。",
        "",
        "故事模式规则：",
        "1. 当上下文存在故事模式约束时，primary mode 视为硬约束，secondary mode 只能作为轻量风味层。",
        "2. 不得突破故事模式给出的冲突上限。",
        "3. 不得依赖被明确禁止的冲突形式。",
        "",
        "质量要求：",
        "1. 输出必须像“可直接交给下一环节执行的规划结果”，而不是概念备忘录。",
        "2. 避免空泛表达，如“推进剧情”“增加冲突”“深化人物”。",
        "3. 所有数组项应使用短语或短句，避免冗长分析。",
      ].join("\n");

      const userPrompt = [
        promptInput.scopeLabel,
        "",
        "上下文：",
        contextText || "无",
        "",
        "输出要求：",
        "1. objective 必须明确回答“这一层现在到底要推进什么”。",
        "2. participants 只保留真正影响这一层推进的人物、势力或关系主体。",
        "3. reveals 只写关键揭露，不要把过程细节混进去。",
        "4. riskNotes 要优先指出最容易让这一层写坏的地方。",
        "5. hookTarget 要能直接服务读者追更，而不是抽象写“制造悬念”。",
        "6. phaseLabel 必须短、准、可识别。",
        "7. mustAdvance 必须列出不可缺席的推进项。",
        "8. mustPreserve 必须列出不能破坏的连续性、语气和硬约束。",
        input.includeScenes
          ? "9. scenes 必须顺序清晰，且每个 scene 都应体现具体动作、冲突或变化。"
          : "9. scenes 返回空数组。",
      ].join("\n");

      return [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)];
    },
    postValidate: (output, promptInput) => {
      const normalized = normalizePlannerOutput(output);

      if (!normalized.title?.trim()) {
        throw new Error("Planner output is missing title.");
      }

      if (!normalized.objective?.trim()) {
        throw new Error("Planner output is missing objective.");
      }

      if (!normalized.phaseLabel?.trim()) {
        throw new Error("Planner output is missing phaseLabel.");
      }

      if ((normalized.mustAdvance ?? []).length === 0) {
        throw new Error("Planner output is missing mustAdvance.");
      }

      if ((normalized.mustPreserve ?? []).length === 0) {
        throw new Error("Planner output is missing mustPreserve.");
      }

      if (input.planLevel === "chapter") {
        if (!Array.isArray(normalized.payoffDecisions)) {
          throw new Error(`Chapter planner output is missing payoffDecisions. planLevel=${input.planLevel}; 实际收到 ${Array.isArray(normalized.payoffDecisions) ? "数组" : typeof normalized.payoffDecisions}，需要为本章给出给付决策数组。`);
        }
        if (promptInput?.payoffValidation) {
          validateChapterPayoffDecisions({ ...promptInput.payoffValidation, decisions: normalized.payoffDecisions }, { allowReplan: true });
        }
        if (!normalized.planRole) {
          throw new Error(`Chapter planner output is missing planRole. planLevel=${input.planLevel}; 实际值 ${JSON.stringify(normalized.planRole ?? null)}。`);
        }
        if (!["setup", "progress", "pressure", "turn", "payoff", "cooldown"].includes(normalized.planRole)) {
          throw new Error(`Chapter planner output has invalid planRole: 实际值 ${JSON.stringify(normalized.planRole)}，允许值 setup / progress / pressure / turn / payoff / cooldown。`);
        }
        if ((normalized.scenes ?? []).length === 0) {
          throw new Error(`Chapter planner output is missing scenes. planLevel=${input.planLevel}; scenes 实际长度 ${(normalized.scenes ?? []).length}，本章至少需要一个场景。`);
        }
      }

      if (!input.includeScenes && (normalized.scenes ?? []).length > 0) {
        throw new Error(`Planner output should not include scenes for this plan level. planLevel=${input.planLevel}; includeScenes=${input.includeScenes}，但实际返回了 ${(normalized.scenes ?? []).length} 个场景。`);
      }

      if (input.includeScenes) {
        for (const [index, scene] of (normalized.scenes ?? []).entries()) {
          if (!scene.title?.trim()) {
            throw new Error(`Planner scene is missing title. 第 ${index + 1} 个场景；实际值 ${JSON.stringify(scene.title ?? null)}。`);
          }
          if (!scene.objective?.trim()) {
            throw new Error(`Planner scene is missing objective. 第 ${index + 1} 个场景（title=${JSON.stringify(scene.title ?? null)}）；实际值 ${JSON.stringify(scene.objective ?? null)}。`);
          }
          if (!scene.conflict?.trim()) {
            throw new Error(`Planner scene is missing conflict. 第 ${index + 1} 个场景（title=${JSON.stringify(scene.title ?? null)}）；实际值 ${JSON.stringify(scene.conflict ?? null)}。`);
          }
          if (!scene.reveal?.trim()) {
            throw new Error(`Planner scene is missing reveal. 第 ${index + 1} 个场景（title=${JSON.stringify(scene.title ?? null)}）；实际值 ${JSON.stringify(scene.reveal ?? null)}。`);
          }
          if (!scene.emotionBeat?.trim()) {
            throw new Error(`Planner scene is missing emotionBeat. 第 ${index + 1} 个场景（title=${JSON.stringify(scene.title ?? null)}）；实际值 ${JSON.stringify(scene.emotionBeat ?? null)}。`);
          }
        }
      }

      return normalized;
    },
  };
}
export const plannerBookPlanPrompt = buildPlannerPlanAsset({
  id: "planner.book.plan",
  version: "v2",
  planLevel: "book",
  includeScenes: false,
  maxTokensBudget: 1800,
});

export const plannerArcPlanPrompt = buildPlannerPlanAsset({
  id: "planner.arc.plan",
  version: "v2",
  planLevel: "arc",
  includeScenes: false,
  maxTokensBudget: 1800,
});

export const plannerChapterPlanPrompt = buildPlannerPlanAsset({
  id: "planner.chapter.plan",
  version: "v5",
  planLevel: "chapter",
  includeScenes: true,
  maxTokensBudget: 2400,
});
