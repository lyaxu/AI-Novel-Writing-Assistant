import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { contractProseAuditSchema, type ContractProseAudit } from "@ai-novel/shared/types/contractProseAudit";
import type { PromptAsset } from "../../../core/promptTypes";

/**
 * Contract-vs-prose audit prompt.
 *
 * The judgment here is a reading judgment, so the instructions spend their effort on the two ways it
 * goes wrong: rewarding word overlap (a chapter can deliver an event without reusing the contract's
 * wording), and letting a scene look busy while nothing changes hands. The prose-level defect fields
 * exist because the same reading that notices an undelivered element also notices padding.
 */

export interface ContractProseAuditSceneInput {
  key: string;
  title: string;
  resistance: string;
  turn: string;
}

export interface ContractProseAuditPromptInput {
  novelTitle: string;
  chapterOrder: number;
  chapterTitle: string;
  requiredElements: string[];
  scenes: ContractProseAuditSceneInput[];
  endingHook: string;
  prose: string;
}

export const contractProseAuditPrompt: PromptAsset<ContractProseAuditPromptInput, ContractProseAudit> = {
  id: "novel.audit.contract_vs_prose",
  version: "v1",
  taskType: "review",
  mode: "structured",
  language: "zh",
  contextPolicy: { maxTokensBudget: 12_000 },
  outputSchema: contractProseAuditSchema,
  render: (input) => [
    new SystemMessage([
      "你是长篇小说的章节验收读者。你只做一件事：拿这一章的合同，对照它的正文，如实说出哪些要求真的写出来了。",
      "只输出严格 JSON，不要 Markdown、不要解释、不要额外字段。",
      "",
      "【最重要的判断原则】",
      "不要用词面重合判断是否落实。正文完全可以用与合同不同的措辞完成同一件事；反过来，把合同里的话原样抄一遍也不算落实。你要判断的是：读者读完这一段，能不能看出这件事确实发生了。",
      "证据必须是你从正文里摘出来的连续原句，不能改写、不能拼接不相邻的句子。找不到支持它的句子时，就如实判 absent，并在 evidence 里写明「正文没有对应内容」。",
      "不要为了让报告好看而抬高判定；也不要因为措辞不同就判缺失。判 partial 时要说清完成了哪一部分、缺了哪一部分。",
      "正文与合同明确冲突时判 contradicted，例如合同写旧茶馆、正文写的是街边摊子。",
      "",
      "【逐条核对 requiredElements】",
      "合同会给出本章的最小事件清单。你要为清单里每一条给出判定，index 用清单里的序号（从 0 开始），数量必须与清单完全一致，不得增删。",
      "delivered＝正文明确写出了这件事；partial＝只写了一部分或只是一笔带过；absent＝正文没有；contradicted＝正文写的是另一回事。",
      "",
      "【逐场核对 sceneCard 的阻力与转折】",
      "每个场景卡都给了 resistance（阻力）与 turn（转折）。resistanceDelivered＝正文里真的出现了这个阻力，而不是只提了一句；turnDelivered＝正文里真的发生了这个转折。",
      "场景在正文里换了名字、地点或呈现方式不算问题，只要阻力与转折本身成立。",
      "",
      "【结尾钩子】",
      "endingHookDelivered＝正文结尾是否真的留下了这个钩子，并能被读者看见。",
      "",
      "【两个写作层缺陷：发现就报，没发现就留空数组】",
      "1) repeatedExchanges：同一件交涉被反复来回、却没有新增信息的段落。典型形态是「劝走—追问—再劝走—再追问」，每一轮说的还是同一件事，读者拿不到新事实、新代价或新选择。只报重复 2 次以上且确实没有新信息的；正常的拉锯、逐轮加码、每次都多给一点信息的交涉不算。subject 写反复争的是什么，repeats 写重复了几轮，fixHint 写该删哪一段、该补什么新信息才能让这一轮成立。",
      "2) unsupportedTurns：某个角色的立场发生了转变，但正文里没有任何新事实、新代价或新处境迫使他改变——转变只是因为情节需要。from/to 写转变前后的立场，fixHint 写需要补上什么具体事件才能让这个转变站得住。",
      "注意：把主角说服对方、或对方自己改主意都算正常，只要正文给出了他改变算计的具体依据。",
      "",
      "【summary】用两三句话概括这一章的合同落实情况，并明确指出最值得改的一处。",
    ].join("\n")),
    new HumanMessage([
      `作品：${input.novelTitle}`,
      `章节：第${input.chapterOrder}章 ${input.chapterTitle}`,
      "",
      "本章最小事件清单（requiredElements）：",
      ...(input.requiredElements.length
        ? input.requiredElements.map((element, index) => `  [${index}] ${element}`)
        : ["  （清单为空——这是确定性检查已经报出的问题；此时 elements 返回空数组，并在 summary 里指出本章没有任何必须发生的事件。）"]),
      "",
      "场景卡的阻力与转折：",
      ...(input.scenes.length
        ? input.scenes.map((scene) => `  [${scene.key}] ${scene.title}\n    阻力：${scene.resistance || "（未写）"}\n    转折：${scene.turn || "（未写）"}`)
        : ["  （无场景卡）"]),
      "",
      `结尾钩子（endingHook）：${input.endingHook || "（未写）"}`,
      "",
      "正文：",
      input.prose,
    ].join("\n")),
  ],
};
