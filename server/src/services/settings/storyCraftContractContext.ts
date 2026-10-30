import {
  STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS,
  hasEnabledStoryCraftRules,
  type StoryCraftCharacterPlanning,
  type StoryCraftDefaults,
} from "@ai-novel/shared/types/storyCraft";
import { createContextBlock } from "../../prompting/core/contextBudget";
import type { PromptContextBlock } from "../../prompting/core/promptTypes";
import { getStoryCraftDefaults } from "./StoryCraftSettingsService";

export type StoryCraftContractScope = "planning" | "review" | "writing";

const SCOPE_HEADERS: Record<StoryCraftContractScope, string> = {
  planning: "【通用创作规则｜规划元规则】",
  review: "【通用创作规则｜规划复核元规则】",
  writing: "【通用创作规则｜正文写作底线】",
};

const SCOPE_INSTANTIATION_LINES: Record<StoryCraftContractScope, string> = {
  planning: "以上是题材无关的元规则，不替代本书设定。请先结合本书的题材、世界观、角色关系和已写正文，把每条规则实例化成具体安排，再用于本轮规划；不要把其他书或其他题材的具体设定直接搬进来。",
  review: "以上是题材无关的元规则，不替代本书设定。复核时按本书题材、设定和已写正文判断候选计划是否达到这些底线，不要求候选出现任何特定题材元素。",
  writing: "以上是题材无关的元规则，不替代本书设定。请按本书题材、设定、本章任务单和已写正文把规则实例化为本章的具体写法，不要照搬其他题材的桥段。",
};

function renderPressureContract(settings: StoryCraftDefaults): string[] {
  const contract = settings.pressureContract;
  if (!contract.enabled) {
    return [];
  }
  const lines = ["一、压力契约"];
  if (contract.pressureAdvancesEveryChapter) {
    lines.push(
      `- 每章都必须推进中心压力与故事时钟。压力源按本书题材实例化（例如：${contract.pressureSourceHint}），故事时钟不能只在卷首卷尾出现。`,
    );
  } else {
    lines.push("- 中心压力按本书节奏推进，但每个阶段都要让读者看见压力在接近。");
  }
  lines.push(
    `- 每 ${contract.escalationIntervalChapters} 章至少安排一次不可逆升级：让风险、对手、代价或世界规则跨过一道回不去的线。`,
  );
  if (contract.visibleCostEveryChapter) {
    lines.push("- 每章至少写到一个可见代价：损失、暴露、关系恶化、资源消耗或机会关闭；不能只有收益。");
  }
  if (contract.forbidPureSetupChapters) {
    lines.push("- 禁止纯铺垫章：没有推进压力、没有代价、没有变化的章节不应占用正文篇幅。");
  }
  lines.push("- 压力必须来自故事内已存在的人、规则或时限，不得凭空新增无来源的压力。");
  if (contract.notes) {
    lines.push(`- 补充要求：${contract.notes}`);
  }
  return lines;
}

function renderChapterObligations(settings: StoryCraftDefaults): string[] {
  const obligations = settings.chapterObligations;
  if (!obligations.enabled) {
    return [];
  }
  const lines = ["二、章节义务"];
  if (obligations.openingHook) {
    lines.push("- 开篇钩子：尽早让读者知道本章要解决什么、失败会怎样。");
  }
  if (obligations.goalObstacleTurnResult) {
    lines.push("- 目标-阻力-转折-结果：本章主行动至少完整走一次这条链路。");
  }
  if (obligations.irreversibleChange) {
    lines.push("- 本章不可逆变化：结束时人物处境、关系、认知或外部局面至少一项回不去。");
  }
  if (obligations.externalThreatOrRelationshipEscalation) {
    lines.push("- 外部威胁升级或重要关系升级至少发生一项。");
  }
  if (obligations.rewardOrNewHook) {
    lines.push("- 结尾给出本章回报，或留下能被下一章承接的新钩子。");
  }
  if (obligations.forbidRepeatedSceneLoop) {
    lines.push("- 避免连续同场景循环：连续谈判、经营、会议、日常生产等同类场景必须更换冲突维度，不能靠重复流程推进。");
  }
  if (obligations.notes) {
    lines.push(`- 补充要求：${obligations.notes}`);
  }
  return lines;
}

function renderCharacterPlanning(planning: StoryCraftCharacterPlanning): string[] {
  const lines = ["三、人物规划"];
  const scaleLine = planning.scaleWithChapterCount
    ? "按本书预计章节数规划金字塔规模：章节数越多越靠上限，越少越靠下限。"
    : "按下面的人数规划金字塔规模。";
  lines.push(
    `- ${scaleLine}主角 ${planning.protagonists} 人；核心圈约 ${planning.coreCircle} 人；跨卷对手约 ${planning.crossVolumeAntagonists} 人；每卷卷级配角约 ${planning.volumeSupportingPerVolume} 人；每卷有名 NPC ${planning.namedNpcMinPerVolume}-${planning.namedNpcMaxPerVolume} 人。`,
  );
  if (planning.rolloutAndRetirePerVolume) {
    lines.push("- 每卷安排新角色投放与旧角色退场，不允许在开篇一次投放全书角色规模。");
  }
  lines.push("- 每个角色写清：功能、秘密、成长线、可用范围（从哪章到哪章、什么条件能出场）。只有姓名和标签的角色不进入规划。");
  lines.push("- 后续人物分批完善，但不得突破上面的总量范围。");
  if (planning.notes) {
    lines.push(`- 补充要求：${planning.notes}`);
  }
  return lines;
}

function renderSpecialAbility(settings: StoryCraftDefaults): string[] {
  const ability = settings.specialAbility;
  if (!ability.enabled) {
    return [];
  }
  const pacing = STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS.find((item) => item.value === ability.revealPacing)
    ?? STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS[1];
  const lines = ["四、特殊能力/金手指"];
  if (ability.requireVisibleCost) {
    lines.push("- 每次使用都要有可见代价（消耗、损耗、关系或风险），不能无成本改变局面。");
  }
  if (ability.requireCooldownOrLimit) {
    lines.push("- 能力有冷却、次数或使用条件限制，不能连续无限使用。");
  }
  if (ability.requireFailureRisk) {
    lines.push("- 能力可能失败或反噬，关键时刻不能当稳定按钮。");
  }
  if (ability.requireUpgradePath) {
    lines.push("- 有明确升级条件与阶段收益，禁止一步到位。");
  }
  if (ability.requireCounterplay) {
    lines.push("- 有反制手段：对手、世界规则或环境能限制它。");
  }
  if (ability.informationNotFreeResources) {
    lines.push("- 信息优势不能直接兑换成物资、战力或人脉，必须经过行动与代价。");
  }
  if (ability.bindToTraumaOrFlaw) {
    lines.push("- 能力来源与角色的创伤、缺陷或执念绑定，使用能力时同时暴露人物弱点。");
  }
  lines.push(`- 揭示节奏：${pacing.label}——${pacing.description}`);
  if (ability.notes) {
    lines.push(`- 补充要求：${ability.notes}`);
  }
  return lines;
}

/**
 * 专有名词投放：能力、功法、势力、组织、特殊物品、称号等作者设定名，
 * 必须先让读者在正文里知道这个名字从哪来，再直接使用。
 *
 * 复核 scope 把同一底线改成复核口径，规划 scope 要求把首次命名安排写进任务单；
 * 具体渠道和名字由 AI 按本书题材、叙述方式与已写正文实例化，渲染文本不出现任何题材设定。
 */
function renderTerminologyIntroduction(
  settings: StoryCraftDefaults,
  scope: "planning" | "review",
): string[] {
  const terminology = settings.terminologyIntroduction;
  if (!terminology.enabled) {
    return [];
  }
  const lines = ["五、专有名词投放"];
  if (scope === "review") {
    lines.push(
      "- 复核候选计划时，检查每个关键专有名词第一次进入正文是否已经安排正文内的名称来源；没有来源就要在候选里直接使用设定名，按缺陷退回修改计划。",
    );
  } else {
    lines.push(
      "- 规划阶段先为关键专有名词安排首次命名：在章节任务单或执行合同里写清名称第一次进入正文的章节、由谁、通过什么渠道说出或出现。",
    );
  }
  if (terminology.requireInStoryNameSource) {
    lines.push(
      "- 能力、功法、势力、组织、特殊物品、称号等专有名词，必须先让读者在正文里看到名称的来源，再使用这个名称。名称来源包括：人物当场命名、他人告知、系统或界面提示、铭文/记录/告示、传闻等。",
    );
  }
  if (terminology.allowFunctionBeforeName) {
    lines.push(
      "- 名称还没在正文里建立时，只能写它的功能、现象或代称（例如“这双眼睛”“那股寒意”），不能直接使用作者设定里的名字。",
    );
  }
  if (terminology.firstNamingNeedsSceneOrChannel) {
    lines.push("- 第一次给出名称要落在具体场景动作或信息渠道上，不能靠旁白术语突然点出。");
  }
  if (terminology.nameSourceHint) {
    lines.push(`- 名称来源参考：${terminology.nameSourceHint}；只作示例，按本书题材与叙述方式实例化。`);
  }
  lines.push(
    "- 名称来源必须写在正文里：规划、大纲、任务书和作者设定只能说明“要有这个名字”，不能当作读者已经知道的依据。",
    "- 作者或题材确有特例时，在补充要求里写清允许的讲述方式；没有明确说明时按默认规则处理。",
  );
  if (terminology.notes) {
    lines.push(`- 补充要求：${terminology.notes}`);
  }
  return lines;
}

/** 写作 scope 只保留能直接指导正文写法的迁移，不重复规划清单。 */
function renderTerminologyWritingLines(settings: StoryCraftDefaults): string[] {
  const terminology = settings.terminologyIntroduction;
  if (!terminology.enabled) {
    return [];
  }
  const lines: string[] = [];
  if (terminology.requireInStoryNameSource) {
    lines.push(
      "- 正文第一次出现能力、功法、势力、组织、特殊物品或称号的名称之前，先让读者在故事里得到这个名称：由人物当场命名、由他人告知、由系统或界面提示、由铭文/记录/告示带出，或由传闻提到。",
    );
  }
  if (terminology.allowFunctionBeforeName) {
    lines.push(
      "- 名称还没在正文里建立时，只写它的功能、现象或代称（例如“这双眼睛”“那股寒意”），不要在叙述里直接使用设定名。",
    );
  }
  if (terminology.firstNamingNeedsSceneOrChannel) {
    lines.push("- 第一次给出名称要落在具体场景动作或信息渠道上，不要用旁白突然点出术语。");
  }
  if (terminology.notes) {
    lines.push(`- 补充要求：${terminology.notes}`);
  }
  return lines;
}

/**
 * 把“通用创作规则”渲染成可直接进入 AI 上下文的文本。
 *
 * 文本只写题材无关的元规则，并要求 AI 按当前书的题材实例化；这里不出现任何
 * 具体题材设定，避免把某一本书的经验写成全部书的硬编码。
 */
export function renderStoryCraftContractText(
  settings: StoryCraftDefaults,
  scope: StoryCraftContractScope = "planning",
): string {
  if (!hasEnabledStoryCraftRules(settings)) {
    return "";
  }

  const sections: string[][] = [];
  if (scope === "writing") {
    // Pressure pacing and chapter-obligation coverage are planning/review contracts. Repeating
    // them as a checklist inside the prose prompt makes the writer satisfy beats mechanically,
    // which reads formulaic and AI-like. Keep only the rules that shape the prose itself.
    sections.push(renderSpecialAbility(settings));
    const writingSection = ["五、写作落地与连续性"];
    writingSection.push(...renderTerminologyWritingLines(settings));
    if (settings.characterPlanning.enabled) {
      writingSection.push(
        "- 正文只使用本章任务单、角色事实和已写正文允许出场的角色，不得擅自新增核心角色、扩大人物规模或让未登记角色承担主线功能。",
      );
    }
    if (settings.specialAbility.enabled && settings.specialAbility.requireVisibleCost) {
      writingSection.push("- 本章使用或展示特殊能力时，必须同时写明代价、限制或风险，不能只写爽点。");
    }
    writingSection.push(
      "- 规划中的压力推进和章节义务用于校准方向，正文要用具体动作、对话和场景变化自然呈现；不要逐条复述成清单式旁白、总结句或模板化情绪。",
      "- 写作前核对本章关键动作的前置条件与物品状态（画符要落笔、容器要能装下、装备/体力/权限要成立），不要跳过必要动作或凭空使用道具。",
      "- 保持与已写正文一致的人物口吻、句式和视角；具体感官细节优先，少用解释性总结。",
    );
    sections.push(writingSection);
  } else {
    sections.push(renderPressureContract(settings));
    sections.push(renderChapterObligations(settings));
    if (settings.characterPlanning.enabled) {
      sections.push(renderCharacterPlanning(settings.characterPlanning));
    }
    sections.push(renderSpecialAbility(settings));
    sections.push(renderTerminologyIntroduction(settings, scope));
  }
  const body = sections.filter((lines) => lines.length > 0);
  if (body.length === 0) {
    return "";
  }

  return [
    SCOPE_HEADERS[scope],
    SCOPE_INSTANTIATION_LINES[scope],
    ...body.map((lines) => lines.join("\n")),
    "本轮输出必须逐条体现上述规则；如果某条与本书题材确实不兼容，写明替代实现，不能直接忽略。",
  ].join("\n\n");
}

/**
 * 读取全局设置并生成 required context block。
 * 设置关闭、没有任何启用规则或读取失败时返回 null：注入失败不能阻断写作。
 */
export async function loadStoryCraftContractBlock(
  scope: StoryCraftContractScope = "planning",
): Promise<PromptContextBlock | null> {
  try {
    const settings = await getStoryCraftDefaults();
    const content = renderStoryCraftContractText(settings, scope);
    if (!content.trim()) {
      return null;
    }
    return createContextBlock({
      id: "story_craft_contract",
      group: "story_craft_contract",
      priority: 106,
      required: true,
      allowSummary: false,
      content,
    });
  } catch (error) {
    console.warn("[story-craft] global rules unavailable; planning and writing continue without them.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 在已有上下文块后追加通用创作规则；失败时原样返回，保证调用方链路不受影响。 */
export async function appendStoryCraftContractBlock(
  blocks: PromptContextBlock[],
  scope: StoryCraftContractScope = "planning",
): Promise<PromptContextBlock[]> {
  const block = await loadStoryCraftContractBlock(scope);
  return block ? [...blocks, block] : blocks;
}
