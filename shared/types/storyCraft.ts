import { z } from "zod";

/**
 * 通用创作规则（故事工程默认值）。
 *
 * 这里是“题材无关的元规则”：只规定压力、章节义务、人物规模、特殊能力的工程底线，
 * 不写死末世、修仙、都市等任何具体题材。具体压力源、能力形式、角色身份由 AI 在
 * 当前书的题材、设定和已写正文里实例化。
 *
 * 设置保存在 AppSetting（key: STORY_CRAFT_DEFAULTS_SETTING_KEY），对所有书生效。
 */
export const STORY_CRAFT_DEFAULTS_SETTING_KEY = "storyCraftDefaults";

export const STORY_CRAFT_CONTRACT_BLOCK_ID = "story_craft_contract";
export const STORY_CRAFT_CONTRACT_BLOCK_GROUP = "story_craft_contract";

const shortNoteSchema = z.string().trim().max(240).default("");

export const storyCraftPressureContractSchema = z.object({
  /** 是否启用这一组元规则。 */
  enabled: z.boolean().default(true),
  /** 每章都必须推进中心压力/故事时钟，而不是只在卷首卷尾推进。 */
  pressureAdvancesEveryChapter: z.boolean().default(true),
  /** 每 N 章安排一次不可逆升级（N 由用户设置，AI 按本书节奏实例化）。 */
  escalationIntervalChapters: z.number().int().min(1).max(50).default(5),
  /** 每章至少一个可见代价：损失、暴露、关系恶化、资源消耗或机会关闭。 */
  visibleCostEveryChapter: z.boolean().default(true),
  /** 禁止纯铺垫章：没有推进、没有代价、没有变化的章节不进入正文。 */
  forbidPureSetupChapters: z.boolean().default(true),
  /** 题材无关的压力源示例，供 AI 结合本书题材选择并持续登记。 */
  pressureSourceHint: z.string().trim().max(200).default(
    "倒计时、线索期限、关系期限、威胁等级、资源耗尽等",
  ),
  notes: shortNoteSchema,
});

export const storyCraftChapterObligationSchema = z.object({
  enabled: z.boolean().default(true),
  /** 开篇钩子：尽快让读者知道本章要解决什么、失败会怎样。 */
  openingHook: z.boolean().default(true),
  /** 目标-阻力-转折-结果：本章主行动必须走完整链路。 */
  goalObstacleTurnResult: z.boolean().default(true),
  /** 本章不可逆变化：结束时人物处境/关系/认知或外部局面至少一项回不去了。 */
  irreversibleChange: z.boolean().default(true),
  /** 外部威胁升级或重要关系升级至少发生一项。 */
  externalThreatOrRelationshipEscalation: z.boolean().default(true),
  /** 结尾给出本章回报，或留下能被下一章承接的新钩子。 */
  rewardOrNewHook: z.boolean().default(true),
  /** 避免连续同场景循环：连续谈判、经营、会议、日常生产等同类场景要换冲突维度。 */
  forbidRepeatedSceneLoop: z.boolean().default(true),
  notes: shortNoteSchema,
});

export const namedNpcRangeMessage = "每卷有名 NPC 下限不能大于上限。";

export const storyCraftCharacterPlanningSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** 主角人数（通常 1 人；双主角题材可设 2）。 */
    protagonists: z.number().int().min(1).max(2).default(1),
    /** 核心圈人数：贯穿全书、长期参与主线决策的角色。 */
    coreCircle: z.number().int().min(1).max(10).default(4),
    /** 跨卷对手人数：能持续制造多卷压力的主要对抗者。 */
    crossVolumeAntagonists: z.number().int().min(1).max(8).default(3),
    /** 每卷卷级配角人数：在单卷内承担功能、冲突或关系推进。 */
    volumeSupportingPerVolume: z.number().int().min(1).max(10).default(4),
    /** 每卷有名 NPC 下限：有姓名、有功能，但不进入主线核心圈。 */
    namedNpcMinPerVolume: z.number().int().min(0).max(30).default(4),
    /** 每卷有名 NPC 上限。 */
    namedNpcMaxPerVolume: z.number().int().min(1).max(40).default(12),
    /** 按预计章节数缩放金字塔：章节越少取下限，越多取上限。 */
    scaleWithChapterCount: z.boolean().default(true),
    /** 每卷安排新角色投放与旧角色退场，而不是开局一次投放完。 */
    rolloutAndRetirePerVolume: z.boolean().default(true),
    notes: shortNoteSchema,
  })
  .refine((value) => value.namedNpcMinPerVolume <= value.namedNpcMaxPerVolume, {
    message: namedNpcRangeMessage,
    path: ["namedNpcMaxPerVolume"],
  });

export const STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS = [
  {
    value: "gradual",
    label: "慢热铺垫",
    description: "先写征兆、限制和代价，能力在中段逐步兑现，适合长线悬念。",
  },
  {
    value: "staged",
    label: "分阶段揭示",
    description: "按卷分批展示能力、代价、升级和反制，兼顾期待与信息量。",
  },
  {
    value: "early",
    label: "尽早亮相",
    description: "开篇不久就展示能力，但代价与限制必须同时出现。",
  },
] as const;

export type StorySpecialAbilityRevealPacing =
  (typeof STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS)[number]["value"];

export const STORY_SPECIAL_ABILITY_REVEAL_PACING_VALUES = STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS
  .map((item) => item.value) as [StorySpecialAbilityRevealPacing, ...StorySpecialAbilityRevealPacing[]];

export const storyCraftSpecialAbilitySchema = z.object({
  enabled: z.boolean().default(true),
  /** 每次使用都必须付出可见代价（消耗、损耗、寿命、关系或风险）。 */
  requireVisibleCost: z.boolean().default(true),
  /** 有冷却、次数或使用条件限制，不能无限连发。 */
  requireCooldownOrLimit: z.boolean().default(true),
  /** 有失败概率或反噬，能力不是稳定按钮。 */
  requireFailureRisk: z.boolean().default(true),
  /** 有明确升级条件与阶段收益，避免一步到位。 */
  requireUpgradePath: z.boolean().default(true),
  /** 有反制手段：对手、世界规则或环境能限制该能力。 */
  requireCounterplay: z.boolean().default(true),
  /** 信息优势不能直接兑换成物资、战力或人脉，必须经过行动与代价。 */
  informationNotFreeResources: z.boolean().default(true),
  /** 能力来源与推进与角色的创伤、缺陷或执念绑定。 */
  bindToTraumaOrFlaw: z.boolean().default(true),
  /** 揭示节奏。 */
  revealPacing: z.enum(STORY_SPECIAL_ABILITY_REVEAL_PACING_VALUES).default("staged"),
  notes: shortNoteSchema,
});

/**
 * 专有名词投放：能力、功法、势力、组织、特殊物品、称号等作者设定名，
 * 必须先让读者在正文内看到名称来源，再直接使用这个名称。
 *
 * 只规定“名称怎么进入读者视野”的工程底线，不规定具体名字或题材；
 * 具体渠道由 AI 按本书题材、叙述方式和已写正文实例化。
 */
export const storyCraftTerminologyIntroductionSchema = z.object({
  /** 是否启用这一组元规则。 */
  enabled: z.boolean().default(true),
  /** 关键专有名词首次进入正文前，必须先建立正文内名称来源。 */
  requireInStoryNameSource: z.boolean().default(true),
  /** 名称未建立前只能写功能、现象或代称，不能直接使用作者设定名。 */
  allowFunctionBeforeName: z.boolean().default(true),
  /** 首次命名要落在场景动作或信息渠道上，不能靠旁白术语突然点出。 */
  firstNamingNeedsSceneOrChannel: z.boolean().default(true),
  /** 题材无关的名称来源示例，供 AI 结合本书题材与叙述方式选择。 */
  nameSourceHint: z.string().trim().max(200).default(
    "人物命名、他人告知、系统/界面提示、铭文/记录/告示、传闻等",
  ),
  /** 作者或题材特例说明；留空时只使用上面的通用规则。 */
  notes: shortNoteSchema,
});

export const storyCraftDefaultsSchema = z.object({
  /** 总开关：关闭后，所有规划和写作提示都不再注入这组元规则。 */
  enabled: z.boolean().default(true),
  pressureContract: storyCraftPressureContractSchema.default(() => storyCraftPressureContractSchema.parse({})),
  chapterObligations: storyCraftChapterObligationSchema.default(() => storyCraftChapterObligationSchema.parse({})),
  characterPlanning: storyCraftCharacterPlanningSchema.default(() => storyCraftCharacterPlanningSchema.parse({})),
  specialAbility: storyCraftSpecialAbilitySchema.default(() => storyCraftSpecialAbilitySchema.parse({})),
  terminologyIntroduction: storyCraftTerminologyIntroductionSchema.default(() => storyCraftTerminologyIntroductionSchema.parse({})),
});

export type StoryCraftPressureContract = z.infer<typeof storyCraftPressureContractSchema>;
export type StoryCraftChapterObligations = z.infer<typeof storyCraftChapterObligationSchema>;
export type StoryCraftCharacterPlanning = z.infer<typeof storyCraftCharacterPlanningSchema>;
export type StoryCraftSpecialAbility = z.infer<typeof storyCraftSpecialAbilitySchema>;
export type StoryCraftTerminologyIntroduction = z.infer<typeof storyCraftTerminologyIntroductionSchema>;
export type StoryCraftDefaults = z.infer<typeof storyCraftDefaultsSchema>;

/** 默认值直接来自 schema 默认项，保证“未保存”和“恢复默认”是同一份规则。 */
export const DEFAULT_STORY_CRAFT_DEFAULTS: StoryCraftDefaults = storyCraftDefaultsSchema.parse({});

/** 旧数据或损坏数据一律回落到默认值，不能因为一条设置坏了就阻断创作。 */
export function normalizeStoryCraftDefaults(input: unknown): StoryCraftDefaults {
  const parsed = storyCraftDefaultsSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_STORY_CRAFT_DEFAULTS;
}

/** 判断设置里是否有任何一组规则真正启用。 */
export function hasEnabledStoryCraftRules(settings: StoryCraftDefaults): boolean {
  return settings.enabled && (
    settings.pressureContract.enabled
    || settings.chapterObligations.enabled
    || settings.characterPlanning.enabled
    || settings.specialAbility.enabled
    || settings.terminologyIntroduction.enabled
  );
}
