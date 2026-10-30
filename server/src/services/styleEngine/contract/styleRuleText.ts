import type { StyleContractSectionKey } from "@ai-novel/shared/types/styleEngine";

/**
 * 写法规则的可执行文本渲染。
 *
 * 为什么需要这一层：早期内置写法（金庸、天下霸唱等）把大部分规则存成
 * `legend_arc` / `classical_vernacular` / `medium_fast` 这类枚举 token，
 * 旧编译器原样输出 "narrative.progressionMode: must keep legend_arc"。
 * 模型看到的是配置键而不是写作指导，写法合同因此“像空壳”。
 * 这里把已知枚举翻译成中文执行指令；未知字段仍保留原值，避免丢失自定义规则。
 */

export type StyleRuleSectionKey = "narrative" | "character" | "language" | "rhythm";
export type StyleRulesSectionKey = "narrativeRules" | "characterRules" | "languageRules" | "rhythmRules";

export const STYLE_RULE_SECTION_LABELS: Record<StyleRuleSectionKey, string> = {
  narrative: "叙事写法",
  character: "人物写法",
  language: "语言写法",
  rhythm: "节奏写法",
};

export const STYLE_CONTRACT_SECTION_TITLES: Record<StyleContractSectionKey, string> = {
  narrative: "叙事写法合同",
  character: "人物写法合同",
  language: "语言写法合同",
  rhythm: "节奏写法合同",
  antiAi: "反 AI 底线",
  selfCheck: "正文完成前自查",
};

const FIELD_LABELS: Record<StyleRuleSectionKey, Record<string, string>> = {
  narrative: {
    summary: "总体要求",
    progressionMode: "叙事推进",
    sceneUnitPattern: "场景单元",
    multiPov: "多视角",
    looping: "循环结构",
    endingStyle: "章末收束",
    povSwitchStyle: "视角切换",
    viewpoint: "叙事视角",
    opening: "开场方式",
    causality: "因果推进",
    detailSelection: "细节选取",
    ending: "章末收束",
  },
  character: {
    summary: "总体要求",
    psychologyMode: "心理描写",
    allowSelfReflection: "直接自省",
    emotionExpression: "情绪表达",
    defenseMechanisms: "防御机制",
    facePriority: "体面与面子",
    dialogueStyle: "对白风格",
    innerVoice: "内心声音",
    agency: "主角能动性",
    supportingPeople: "配角塑造",
  },
  language: {
    summary: "总体要求",
    register: "语言语域",
    roughness: "粗粝度",
    allowIncompleteSentences: "残句使用",
    allowSwearing: "粗口使用",
    sentenceVariation: "句式变化",
    allowUselessDetails: "无功能细节",
    colloquialBoundary: "口语边界",
    metaphor: "比喻使用",
    cleanliness: "文字干净度",
    originalExample: "写法示例（不重命名人名与情节）",
  },
  rhythm: {
    summary: "总体要求",
    pace: "节奏",
    paragraphDensity: "段落密度",
    allowFragmentedFlow: "断裂式段落",
    actionOverExplanation: "动作与解释",
    sceneProgress: "场景推进",
    focus: "篇幅聚焦",
    revision: "润色与修订",
  },
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  progressionMode: {
    time_sequence: "按时间顺序推进，重现实落差，不做总括回顾",
    goal_driven: "围绕目标推进：目标→阻碍→压制→反转收益，尽快兑现局部收益",
    mystery_escalation: "悬念递增：现场细节→异常→误判→新风险，持续制造信息缺口",
    relationship_push_pull: "关系拉扯推进：动作→言外之意→误读→回避，靠错位推进关系",
    multi_thread: "多线交织：不同角色行动线并行、信息交叉流动，视角切换受控",
    scene_immersion: "场景沉浸：以动作、环境、关系反应累积体验，少用事件轰炸",
    fact_driven: "事实驱动：让专业事实、程序与后果承担叙事重量",
    contrast_driven: "反差驱动：现实细节→荒诞偏差→冷反应",
    legend_arc: "传奇式成长弧：主角从微末一步步卷入更大的恩怨与格局，转折要有伏笔",
    expedition_escalation: "探险层层升级：进入险地→规矩与机关→怪象→更大的未知，每解一谜又生更大的谜",
    idea_driven_escalation: "点子驱动升级：设想→奇观→文明抉择→更大危机，尺度不断跃迁",
  },
  endingStyle: {
    unresolved: "不解决问题，收在仍未解决的现实处境上",
    hook: "章末留钩子，把读者推向下一章",
    suspense: "章末留悬念：一个未解释的异象、声音或处境",
    emotional_hook: "章末停在关系错位或情绪未落地处",
    cross_hook: "章末用另一条线的动作或信息制造交叉钩子",
    soft_open: "安静收束，留余味而不是强反转",
    pressure_continue: "章末让压力继续累积，逼出下一步行动",
    bitter_aftertaste: "章末留苦涩余味和反讽，不做升华",
  },
  povSwitchStyle: {
    controlled: "允许切换视角，但每次切换都要有明确目的和边界",
  },
  psychologyMode: {
    action_only: "心理只通过动作、反应和外部细节表现，不直接解释",
    situated_inner_voice: "允许贴近人物口气的内心声音：写具体盘算、误判和犹豫，并影响选择，不写旁白总结",
  },
  emotionExpression: {
    behavior_only: "只用动作、反应和外部细节表现情绪，不直接说明",
    dialogue_and_action: "用对白和动作表现情绪，直接干脆",
    action_and_dialogue: "用动作与对白表现情绪",
    reaction_only: "只写外部反应，让读者自己判断情绪",
    subtext: "写言外之意：停顿、回避、动作和语气，不把情绪说破",
    mixed: "按角色性格混合使用动作、对白与内心，避免所有角色一个腔",
    light_behavior: "用轻动作和生活细节带出情绪，不用高强度戏剧句",
    suppressed: "情绪克制、压住不表，通过选择与代价显现",
    deadpan: "用冷面、平铺的反应写情绪，越平静越有味道",
    behavior_and_banter: "用行为与插科打诨表现情绪",
  },
  dialogueStyle: {
    short_colloquial: "对话短促、口语化，像生活里真说的话",
    direct: "对话直接、目标明确，少绕弯",
    restrained: "对话克制，留白多于解释",
    subtext_heavy: "对话重言外之意，试探、回避和误读多于直说",
    distinct_by_role: "按身份、职业和关系拉开每个角色的说话方式",
    daily_natural: "对话自然日常，不用高强度戏剧腔",
    informational: "对话用于准确传递信息与立场，少抒情",
    deadpan_colloquial: "对话口语化、冷面，笑点藏在反差里",
    classic_terse: "对白文白相间、简洁，寥寥数语显身份与机锋",
    colloquial_banter: "对白口语化、带调侃；用行话、绰号塑造圈子感",
  },
  register: {
    colloquial: "口语化白话，可用俚语和生活词",
    direct: "直接清楚，少修饰",
    restrained: "克制、精确，少形容词堆叠",
    natural: "自然白话，允许留白",
    flexible: "按角色与场景调整语域，不强求统一腔调",
    professional: "专业、准确，允许行业术语但必须服务叙事",
    classical_vernacular: "文白相间、不掉书袋",
    colloquial_northern: "北方口语，敢用俚语糙话但要有分寸和幽默",
    precise_restrained: "冷峻、精确、克制，工程师式理性",
  },
  sentenceVariation: {
    high: "长短句变化明显，避免句式整齐",
    medium_high: "长短句有明显变化，允许部分整齐句",
    medium: "句式自然，保持基本变化",
  },
  pace: {
    fast: "快节奏：事件密集、险情接踵，几乎不留水段",
    medium_fast: "中快节奏：推进为主，关键处放慢",
    medium: "中速：推进与停顿均衡",
    balanced: "张弛均衡：铺垫与爆点交替",
    medium_slow: "中慢：给关系和情绪留反应空间",
    slow: "慢节奏：以生活质感和沉浸为主，但避免空转",
  },
  paragraphDensity: {
    high: "段落密实、偏短，信息密度高",
    medium_high: "段落偏短偏密",
    medium: "中等分段，随场景与对话自然切分",
  },
};

const BOOLEAN_LABELS: Record<string, { yes: string; no: string }> = {
  multiPov: { yes: "允许多视角叙述", no: "只跟单一视角，不切多线" },
  looping: { yes: "允许循环式重复推进（同一困境反复）", no: "避免循环重复，每轮必须推进新变化" },
  allowSelfReflection: {
    yes: "允许人物直接自省，但要具体、服务选择",
    no: "少写直白自省，靠动作、对白和反应显情绪",
  },
  facePriority: { yes: "人物先顾体面、面子和人情", no: "人物可以放下体面，先算利弊" },
  allowIncompleteSentences: { yes: "允许不完整句和短促口语", no: "句子保持完整，少用残缺句" },
  allowSwearing: { yes: "允许符合身份的轻度粗口", no: "避免粗口" },
  allowUselessDetails: { yes: "允许保留生活噪音和看似无用的细节", no: "删除无功能细节，信息要服务情节" },
  allowFragmentedFlow: { yes: "允许断裂式短段流动", no: "段落衔接完整，不要碎片化跳断" },
  actionOverExplanation: { yes: "动作、事实和场面优先于解释", no: "允许解释和内心说明，但仍要落到人物处境" },
};

export function styleRuleSectionLabel(section: StyleRuleSectionKey): string {
  return STYLE_RULE_SECTION_LABELS[section];
}

export function styleRuleFieldLabel(section: StyleRuleSectionKey, field: string): string {
  return FIELD_LABELS[section][field] ?? field;
}

export function resolveStyleRuleDirective(weight: number): string {
  if (weight >= 0.85) {
    return "必须";
  }
  if (weight >= 0.65) {
    return "优先";
  }
  return "自然使用";
}

function formatScalar(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value ?? "").trim();
}

function formatRoughness(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return formatScalar(value);
  }
  return `${value.toFixed(2)}（0 精致—1 粗野；越高越允许口语、杂质和糙话）`;
}

function formatSceneUnitPattern(value: unknown): string {
  const items = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : String(value ?? "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) {
    return "";
  }
  return `按「${items.join(" → ")}」组织场景单元，每个单元至少推进其中一项`;
}

function formatListValue(value: unknown): string {
  const items = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : String(value ?? "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  return items.join("、");
}

/**
 * 把单条写法规则翻译成中文执行指令。未知字段保留原值，避免丢失用户自定义规则。
 */
export function formatStyleRuleValue(
  section: StyleRuleSectionKey,
  field: string,
  value: unknown,
): string {
  if (value == null || value === "") {
    return "";
  }
  if (Array.isArray(value) || (typeof value === "string" && field === "sceneUnitPattern")) {
    return field === "sceneUnitPattern" ? formatSceneUnitPattern(value) : formatListValue(value);
  }
  if (typeof value === "boolean") {
    const labels = BOOLEAN_LABELS[field];
    if (labels) {
      return value ? labels.yes : labels.no;
    }
    return value ? "是" : "否";
  }
  if (typeof value === "number") {
    return field === "roughness" ? formatRoughness(value) : formatScalar(value);
  }
  const text = String(value).trim();
  const enumLabel = VALUE_LABELS[field]?.[text];
  if (enumLabel) {
    return enumLabel;
  }
  return text;
}

export function renderStyleRuleLines(input: {
  section: StyleRuleSectionKey;
  rules: Record<string, unknown>;
  weight: number;
  fieldWeights?: Record<string, number>;
  compatibilityFields?: readonly string[];
}): string[] {
  const { section, rules, weight, fieldWeights, compatibilityFields = [] } = input;
  const compatibility = new Set(compatibilityFields);
  const summary = typeof rules.summary === "string" ? rules.summary.trim() : "";
  const lines: string[] = [];
  if (summary) {
    lines.push(`- 总体要求（${resolveStyleRuleDirective(fieldWeights?.summary ?? weight)}）：${summary}`);
  }
  for (const [field, value] of Object.entries(rules)) {
    if (field === "summary" || value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    const formatted = formatStyleRuleValue(section, field, value);
    if (!formatted) {
      continue;
    }
    const rawWeight = fieldWeights?.[field] ?? weight;
    const effectiveWeight = compatibility.has(field) ? Math.max(0.3, rawWeight - 0.2) : rawWeight;
    lines.push(`- ${styleRuleFieldLabel(section, field)}（${resolveStyleRuleDirective(effectiveWeight)}）：${formatted}`);
  }
  return lines;
}

export function renderStyleSelfCheckLines(input: {
  styleProfile: {
    characterRules: Record<string, unknown>;
    languageRules: Record<string, unknown>;
    rhythmRules: Record<string, unknown>;
  };
}): string[] {
  const { characterRules, languageRules, rhythmRules } = input.styleProfile;
  const languageSummary = typeof languageRules.summary === "string" ? languageRules.summary.trim() : "";
  const rhythmSummary = typeof rhythmRules.summary === "string" ? rhythmRules.summary.trim() : "";
  const psychologyMode = typeof characterRules.psychologyMode === "string" ? characterRules.psychologyMode : "";
  const lines = [
    "- 开工前先按「语言写法合同」和「节奏写法合同」确定本章的句子长短、口语程度、细节密度、比喻用量和段落切分，再展开情节。",
    languageSummary
      ? `- 按语言合同自查：${languageSummary}`
      : "- 按语言合同自查：语域、句式变化、口语与粗粝度是否符合合同。",
    rhythmSummary
      ? `- 按节奏合同自查：${rhythmSummary}`
      : "- 按节奏合同自查：推进速度、段落密度和关键停顿是否符合合同。",
  ];
  if (psychologyMode === "situated_inner_voice") {
    lines.push("- 心理描写：保留人物自己的计算、误判和犹豫；不要用旁白替人物总结情绪，也不要把内心声音写成作者讲道理。");
  } else if (psychologyMode === "action_only") {
    lines.push("- 心理描写：不要直接解释人物心理，用动作、语气、停顿或环境反应让读者看见。");
  } else {
    lines.push("- 心理描写：检查是否用旁白解释心理，而不是通过动作、对白或贴近人物的内心声音呈现。");
  }
  lines.push(
    "- 检查段尾是否总结、升华或说教；检查句式是否过于整齐、平均或模板化。",
    "- 检查是否残留通用网文腔、AI 八股句或与合同风格不符的套话。",
    "- 若有不符合同的段落，先重写那几段再返回正文；不要用解释代替改写。",
  );
  return lines;
}

/** 合同正文的固定执行说明，放在规则之后，提醒模型先对齐风格再动笔。 */
export const STYLE_CONTRACT_EXECUTION_LINE =
  "执行顺序：先按语言与节奏合同确定叙述方式，再展开情节；不得用通用网文腔覆盖本合同。";
