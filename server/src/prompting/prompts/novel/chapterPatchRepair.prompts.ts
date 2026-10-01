import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CAPABILITY_AUTHORIZATION_RULES } from "./context/capabilityAuthorization";
import type { ChapterPatchRepairPlan } from "@ai-novel/shared/types/chapterPatchRepair";
import { chapterPatchRepairPlanSchema, chapterPatchIssueResolutionSchema } from "@ai-novel/shared/types/chapterPatchRepair";
import { z } from "zod";
import type { PromptAsset } from "../../core/promptTypes";
import { renderSelectedContextBlocks } from "../../core/renderContextBlocks";
import { NOVEL_PROMPT_BUDGETS } from "./promptBudgetProfiles";

export interface ChapterPatchRepairPromptInput {
  novelTitle: string;
  chapterTitle: string;
  chapterContent: string;
  issuesJson: string;
  modeHint?: string;
  expectedIssueIds?: string[];
}

/** Validate links only; AI decides whether a claim is supported or needs planning changes. */
export function validatePatchIssueCoverage(plan: ChapterPatchRepairPlan, expected: string[]): void {
  const rows = plan.issueResolutions ?? [];
  const ids = new Set(expected);
  if (new Set(expected).size !== expected.length || rows.length !== expected.length
    || new Set(rows.map(row => row.issueId)).size !== expected.length
    || rows.some(row => !ids.has(row.issueId))) {
    throw new Error("issueResolutions must cover every supplied issue exactly once, including deferred issues.");
  }
  const patches = new Map(plan.patches.map(patch => [patch.id, patch]));
  if (patches.size !== plan.patches.length) throw new Error("Patch ids must be unique.");
  for (const row of rows) {
    if (row.disposition === "patched") {
      if (!row.patchIds.length || new Set(row.patchIds).size !== row.patchIds.length
        || row.patchIds.some(id => !patches.get(id)?.issueIds.includes(row.issueId))) {
        throw new Error(`Patched issue ${row.issueId} must link existing patches that cite it.`);
      }
    } else if (row.patchIds.length) throw new Error(`Unpatched issue ${row.issueId} cannot claim applied patches.`);
  }
  for (const patch of plan.patches) {
    if (!patch.issueIds.length || patch.issueIds.some(id => !rows.some(row => row.issueId === id
      && row.disposition === "patched" && row.patchIds.includes(patch.id)))) {
      throw new Error(`Patch ${patch.id} must link supplied issues with matching receipts.`);
    }
  }
}

export const chapterPatchRepairPrompt: PromptAsset<
  ChapterPatchRepairPromptInput,
  ChapterPatchRepairPlan
> = {
  id: "novel.review.patch",
  version: "v6",
  taskType: "repair",
  mode: "structured",
  language: "zh",
  contextPolicy: {
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterRepair,
    preferredGroups: [
      "repair_issues",
      "chapter_mission",
      "reader_experience",
      "repair_boundaries",
      "world_rules",
    ],
    dropOrder: [
      "recent_chapters",
      "participant_subset",
      "continuation_constraints",
    ],
  },
  outputSchema: chapterPatchRepairPlanSchema.extend({
    patches: chapterPatchRepairPlanSchema.shape.patches.removeDefault().max(4),
    issueResolutions: z.array(chapterPatchIssueResolutionSchema.omit({ inputEvidence: true })),
  }),
  postValidate: (output, input) => {
    validatePatchIssueCoverage(output, input.expectedIssueIds ?? []);
    return output;
  },
  slots: [
    {
      kind: "append" as const,
      key: "patch.customConstraints",
      label: "自定义补丁补充要求",
      description: "追加对局部补丁生成的额外约束，作为上下文块注入。留空则不追加。",
      anchor: "repair_issues",
      default: "",
      maxLength: 2000,
      placeholderHint: "例如：每个补丁块不得超过 3 句；优先修复节奏问题，结构问题标记但不修……",
    },
  ],
  render: (input, context) => [
    new SystemMessage([
      "你是网络小说局部修文编辑。",
      "当前任务不是整章重写，而是输出可以被程序安全应用的局部补丁计划。",
      "只输出严格 JSON，不要 Markdown、解释或正文全文。",
      "",
      "【补丁原则】",
      ...CAPABILITY_AUTHORIZATION_RULES,
      "1. strategy 默认必须是 patch_first。",
      "2. patches 中每个 targetExcerpt 必须逐字摘自当前正文，并且应足够长，确保在正文里只出现一次。",
      "3. replacement 只替换 targetExcerpt 对应片段，不要改写无关段落；如果修复目标是删除重复片段，replacement 可以是空字符串。",
      "4. 优先修复问题清单中影响主线推进、连续性、人物动机、节奏和结尾钩子的关键问题。",
      "4b. 最多输出 4 个最高价值补丁；每个补丁保持 targetExcerpt、replacement、reason 简洁，避免重复描述问题。",
      "4d. issueCatalog 是完整问题清单，issueResolutions 必须对每个 id 恰好回执一次：patched（本轮有对应补丁）、deferred（限额或证据不足暂留）、not_supported（原文不支持该指控）、plan_conflict（需改规划而非局部补文）。每项写 issueId、disposition、patchIds、reason；patched 必须双向对应 patches.issueIds，其余 patchIds 为空。最多4个补丁不等于只报告4个问题，不能遗漏未修问题或声称已经解决。回执只是本轮处理声明，修好与否仍须正文复核。",
      "4e. 前章证据只证明过去事实，当前正文才是补丁目标。知道订单内容但不知物品位置、读者知道但人物不知，是不同判断。审查指控也可能错：先逐项核对对应章的实际原文，再决定补丁或 not_supported；不要用前章桥段指控当前章，也不要为旧合同重复已兑现事件。",
      "4f. 若问题代码含 action_state（如 action_state_unearned_* 或 action_state_contradicted_*），在输出补丁前先核查：行动者执行该动作时，是否持有所需物品、是否已到达所在位置、是否具备所需知识或能力？如果前提尚未在正文中建立，补丁必须先补写使前提成立的过渡（取物/移动/获得信息），再写行动及其后果，不能只替换行动后果片段而跳过前提。前提已在正文中建立（originalText 中有对应句段）时，直接修正结果段即可。无法定位前提建立点时，输出 plan_conflict，说明需要在规划层调整前提来源，而非局部补丁能修复。",
      "4c. 重复前章事件或认识、上一章行动目标仍只被再次决定时，先核对实际正文证据与本章职责。修复要压缩无增量重复并让行动产生可见的新后果，保留有功能的细腻描写、慢热情绪和关系变化，不能只加一句‘终于有所进展’。若本章合同本身强制无效重复或有效推进需改邻章职责，说明规划冲突，不能偷偷改合同、追加救场设定或把整章结构重排包装成局部补丁。",
      "4a. 若问题涉及读者体验合同，只修改能补齐 promisedReward、主角主动性、关键转折、净变化或旧钩子承接的必要片段，并保留已经有效的读者回报。",
      "5. 不得新增重大设定、核心角色或与章节任务冲突的剧情转向。",
      "6. 局部补丁只处理正文中能定位到完整句段的问题；审校系统不可用、结构化判断缺失、评分不足等系统风险不属于正文片段修复。",
      "7. targetExcerpt 必须是正文里的完整短句或段落，不得是单个词语、称谓、标点或过短短语。",
      "8. 如果找不到至少 6 个字符且在正文中唯一出现的原文片段，不要输出 patch；requiresFullRewrite 设为 true，并说明 escalationReason。",
      "9. 如果确实无法用局部补丁安全修复，requiresFullRewrite 设为 true，并说明 escalationReason。",
      input.modeHint ? `10. 修复重点：${input.modeHint}` : "",
    ].join("\n")),
    new HumanMessage([
      `小说：${input.novelTitle}`,
      `章节：${input.chapterTitle}`,
      "",
      "【分层上下文】",
      renderSelectedContextBlocks(context),
      "",
      "【当前正文】",
      input.chapterContent,
      "",
      "【问题清单】",
      input.issuesJson,
      `本轮必须逐项回执的 issueId：${JSON.stringify(input.expectedIssueIds ?? [])}`,
      "",
      "请输出局部补丁 JSON。",
    ].join("\n")),
  ],
};
