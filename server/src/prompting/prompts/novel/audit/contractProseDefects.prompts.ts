import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { contractProseDefectsSchema, type ContractProseDefects } from "@ai-novel/shared/types/contractProseAudit";
import type { PromptAsset } from "../../../core/promptTypes";

/**
 * Writing-layer defect pass, asked on its own.
 *
 * Why this is separate from `novel.audit.contract_vs_prose`: asked inside one JSON with six sections,
 * the model returned both defect arrays empty for a chapter whose unsupported turn a focused
 * single-question probe identified immediately. Delivery checking and defect hunting are different
 * readings; batching them made the second one silently produce nothing.
 *
 * The question is deliberately concrete — "did a character state a position and then act against it
 * without new grounds" — because a vague "is this well written" produces vague output.
 */

export interface ContractProseDefectsPromptInput {
  novelTitle: string;
  chapterOrder: number;
  chapterTitle: string;
  prose: string;
}

export const contractProseDefectsPrompt: PromptAsset<ContractProseDefectsPromptInput, ContractProseDefects> = {
  id: "novel.audit.prose_defects",
  version: "v1",
  taskType: "review",
  mode: "structured",
  language: "zh",
  contextPolicy: { maxTokensBudget: 12_000 },
  outputSchema: contractProseDefectsSchema,
  render: (input) => [
    new SystemMessage([
      "你是资深长篇小说文字编辑，专门挑这一章写作层面的毛病。只输出严格 JSON，不要 Markdown、不要解释、不要额外字段。",
      "没有发现就留空数组，不要为了交差硬凑。宁可两个数组都空，也不要报一个其实站得住的段落。",
      "",
      "【要找的第一类：说出口的立场被推翻，却没有新依据】",
      "判定的重点是「说出口又被推翻」这个组合，三步都要成立才算：",
      "  一、某个角色把立场明确说了出来，有原话，例如「我帮不了」「我不认识」「你走吧」「这事我不管」。",
      "  二、之后他做了与那句话相反的举动，例如拿出东西、答应帮忙、改变安排。",
      "  三、正文没有给出新的具体依据。新依据可以是新情报、新代价、新处境，也可以是他对自己处境或道义的重新评估——但必须写得出来，读者要能指出是哪一句让他改了主意。",
      "如果角色一开始只是含糊、冷淡、推诿，后来逐步改口，**不报**；逐步松动是正常写法。",
      "如果正文用一句台词交代了理由（例如「因为你爷爷」），但没有任何具体内容支撑这句话，**要报**，并在 fixHint 里写清需要补什么才能让这一跳站得住。",
      "from/to 写转变前后的立场，尽量引用他的原话。character 写角色名。",
      "",
      "【要找的第二类：同一件交涉反复来回、却没有新增信息】",
      "典型形态是劝走—追问—再劝走—再追问，每一轮说的还是同一件事，读者拿不到新事实、新代价或新选择。",
      "判定要严：逐轮加码、每轮都多给一点信息的交涉**不算**，哪怕它来回很多次、篇幅也不短。多轮交涉本身不是缺陷。",
      "只报重复 2 次以上且确实没有新信息的。subject 写反复争的是什么，repeats 写重复了几轮。",
      "",
      "【重要】超出目标字数不等于拖沓。篇幅与信息收获相称就不算问题，不要因为字数多就判拖沓。",
      "",
      "【biggestWeakness】如果你认为这一章最该改的地方不属于上面两类，写在这里，一句话说清是什么、在哪一段。没有就留空字符串。",
      "【summary】两三句话概括这一章写作层面的整体状况。",
    ].join("\n")),
    new HumanMessage([
      `作品：${input.novelTitle}`,
      `章节：第${input.chapterOrder}章 ${input.chapterTitle}`,
      "",
      "正文：",
      input.prose,
    ].join("\n")),
  ],
};
