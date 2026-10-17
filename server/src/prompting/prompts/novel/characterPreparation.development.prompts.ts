import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PromptAsset } from "../../core/promptTypes";
import { renderSelectedContextBlocks } from "../../core/renderContextBlocks";
import { characterCastDevelopBatchSchema } from "./characterPreparation.promptSchemas";

export const characterCastDevelopBatchPrompt: PromptAsset<{
  planJson: string;
  identities: Array<{ identityKey: string; name: string }>;
  existingMembersJson: string;
}, z.infer<typeof characterCastDevelopBatchSchema>> = {
  id: "novel.character.castDevelopBatch", version: "v1", taskType: "planner", mode: "structured", language: "zh",
  management: { productPrompt: true, editModes: ["readonly"] },
  contextPolicy: { maxTokensBudget: 0, requiredGroups: ["idea_seed", "output_policy"] },
  repairPolicy: { maxAttempts: 1 }, semanticRetryPolicy: { maxAttempts: 1 },
  outputSchema: characterCastDevelopBatchSchema,
  render: (input, context) => [
    new SystemMessage("你是小说人物策划师。只完善指定 identityKey 的人物档案，返回 {members:[完整档案]}。不得新增身份、换名或把别名当新人。用户姓名与已有身份是硬约束。按全书覆盖的角色层级、职责、入场阶段补齐具体人物的动机、性格、背景、发展及关系位置；不得改变全书规模，不强制提前出场。gender 与 castRole 使用规定枚举，人物完整字段遵循输出 schema。"),
    new HumanMessage([renderSelectedContextBlocks(context), `全书覆盖：${input.planJson}`, `本次身份（姓名逐字保留）：${JSON.stringify(input.identities)}`, `已完成人物：${input.existingMembersJson}`].join("\n\n")),
  ],
  postValidate: (output, input) => {
    if (output.members.length !== input.identities.length) throw new Error("人物补全结果与指定身份数量不同。");
    const expected = new Map(input.identities.map((item) => [item.identityKey, item.name]));
    const seen = new Set<string>();
    for (const member of output.members) {
      if (seen.has(member.identityKey) || expected.get(member.identityKey) !== member.name) throw new Error("人物补全更改了指定身份或姓名。");
      seen.add(member.identityKey);
    }
    return output;
  },
};
