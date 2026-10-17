import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PromptAsset } from "../../core/promptTypes";
import { characterResourceExtractionOutputSchema } from "./characterResource.promptSchemas";

export interface CharacterResourceExtractionPromptInput {
  novelTitle: string;
  chapterOrder: number;
  chapterTitle: string;
  chapterContent: string;
  rosterText: string;
  existingResourceText: string;
}

const CHARACTER_RESOURCE_EXAMPLE = {
  updates: [
    {
      resourceName: "后门铜钥匙",
      resourceType: "credential",
      updateType: "acquired",
      holderCharacterName: "程秩",
      ownerType: "character",
      ownerName: "程秩",
      statusAfter: "available",
      readerKnows: true,
      holderKnows: true,
      knownByCharacterNames: ["程秩"],
      narrativeFunction: "key",
      summary: "程秩拿到能打开后门的铜钥匙。",
      narrativeImpact: "后续可以从后门潜入，但不能凭空进入正门禁区。",
      expectedFutureUse: "潜入库房或逃离追捕。",
      constraints: ["钥匙只能解释后门通行，不能替代其他权限。"],
      evidence: ["程秩把后门铜钥匙收进袖中。"],
      confidence: 0.86,
      riskLevel: "low",
      riskReason: "",
      reviewQuestion: null,
      ledgerFact: null,
      chapterFact: "程秩已把后门铜钥匙收进袖中。",
    },
  ],
  continuityRisks: [],
};

export const characterResourceExtractionPrompt: PromptAsset<
  CharacterResourceExtractionPromptInput,
  z.infer<typeof characterResourceExtractionOutputSchema>
> = {
  id: "novel.character_resource.extract_updates",
  version: "v3",
  taskType: "fact_extraction",
  mode: "structured",
  language: "zh",
  contextPolicy: {
    maxTokensBudget: 0,
  },
  repairPolicy: {
    maxAttempts: 1,
  },
  structuredOutputHint: {
    example: CHARACTER_RESOURCE_EXAMPLE,
    note: [
      "只输出章节中有明确证据的关键资源变化。",
      "不要把比喻、普通日用品或一次性环境物误判为长期资源。",
      "临时角色资源只有跨章复用、影响冲突、绑定伏笔或被主角带走时才进入 updates。",
      "confidence 必须是 0-1 数字；拿不准就省略。",
    ].join(" "),
  },
  outputSchema: characterResourceExtractionOutputSchema,
  render: (input) => [
    new SystemMessage([
      "你是长篇小说角色资源账本提取器。",
      "你的任务是从单章正文中提取会影响后续写作、审阅、修复或重规划的角色关键资源变化。",
      "",
      "只输出一个合法 JSON 对象，不要输出 Markdown、解释、注释或代码块。",
      "顶层固定格式为 {\"updates\":[],\"continuityRisks\":[]}。",
      "",
      "抽取范围：",
      "1. 主角和长期角色的关键物品、线索、凭证、底牌、能力代价、关系信物、可消耗资源。",
      "2. 反派或对手掌握的隐藏资源、陷阱、证据、控制权。",
      "3. 临时角色提供并会跨章影响后续的线索或资源。",
      "",
      "不要抽取：",
      "1. 普通吃穿用品、纯环境摆设、无后续影响的一次性小物。",
      "2. 比喻性表达，例如“他握住了命运的钥匙”。",
      "3. 输入中没有证据的新物品、新角色或新能力。",
      "",
      "判断规则：",
      "1. 所有 updates 必须有 evidence。",
      "2. holderCharacterName 必须优先使用已知角色名单中的名称；拿不准可以省略，但不要编造姓名。",
      "3. 正文明确发生的销毁、消耗、丢失、损坏、转交或底牌揭示，若与已有账本一致且证据充分，可为 low；事件严重、物品危险或情节重要不等于事实入账有疑问。",
      "4. 对后续剧情的影响写入 narrativeImpact/constraints；只有事实、证据、身份或归属存在具体疑问才提高 riskLevel。",
      "5. 明显连续性问题放入 continuityRisks，例如未获得却使用、已消耗却复用、读者未知却被当作已铺垫。",
      "6. updates 最多输出 8 条；优先保留会跨章影响行动边界、伏笔兑现或资源归属的变化。",
      "7. riskLevel/riskReason 评估把变化写入事实账本的风险，不是物品对人物的危险程度。危险物品、神秘线索和未知用途本身不构成 high；剧情危险写入 constraints/narrativeImpact。high 必须说明证据不足、人物/归属矛盾、状态冲突或未发生能力被当事实等具体问题。",
      "8. 只记录正文已发生的变化；任务目标、未来用途、传言与角色猜测不证明事实。持有不等于所有权或已掌握隐藏能力；未知归属保持 unknown，警告只记录为所见/所知，不写成已生效规则。",
      "9. 需要作者核对时，reviewQuestion 写一个具体可回答的问题，ledgerFact 写输入中的旧账本依据（没有就留空），chapterFact 写本章证据实际支持的变化；riskReason 解释两者为何冲突或哪项证据不足。不要只写‘请核对归属/状态’，不得编造旧账或让作者判断与本次入账无关的剧情危险。常规明确变化 reviewQuestion 留空。",
    ].join("\n")),
    new HumanMessage([
      `小说：${input.novelTitle}`,
      `章节：第${input.chapterOrder}章《${input.chapterTitle}》`,
      "",
      "已知角色：",
      input.rosterText,
      "",
      "已有角色资源账本摘要：",
      input.existingResourceText || "暂无已有关键资源。",
      "",
      "章节正文：",
      input.chapterContent,
    ].join("\n")),
  ],
  postValidate: (output) => {
    for (const update of output.updates) {
      if (update.evidence.length === 0) {
        throw new Error(`资源变化缺少证据：${update.resourceName}`);
      }
      if (
        update.expectedUseStartChapterOrder
        && update.expectedUseEndChapterOrder
        && update.expectedUseStartChapterOrder > update.expectedUseEndChapterOrder
      ) {
        throw new Error(`资源 ${update.resourceName} 的使用窗口非法。`);
      }
    }
    return output;
  },
};
