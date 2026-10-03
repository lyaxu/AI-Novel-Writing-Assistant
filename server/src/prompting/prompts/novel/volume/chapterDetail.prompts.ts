import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { PromptAsset } from "../../../core/promptTypes";
import { renderSelectedContextBlocks } from "../../../core/renderContextBlocks";
import {
  createChapterBoundarySchema,
  createChapterExecutionContractSchema,
  createChapterPurposeSchema,
  createChapterTaskSheetSchema,
} from "../../../../services/novel/volume/volumeGenerationSchemas";
import { type VolumeChapterDetailPromptInput } from "./shared";
import { buildVolumeChapterDetailContextBlocks } from "./contextBlocks";
import { NOVEL_PROMPT_BUDGETS } from "../promptBudgetProfiles";

const selectedDirectionRule = "selectedPlanningDirection是用户确认的创作承诺，writtenEvidence的实际已写事实高于计划。细化必须承接原选卖点、人物路径、openingChain的关系变化与earlyPayoff；可改编动作或调整拆章，但须保留同等关系/回报价值，在purpose、mustAdvance、readerExperience或继承钩子写明具体承接。不能把关系建立或可见回报静默换成重复追逃/受压，也不能因后来生成的摘要遗漏而认定用户放弃。全书长期承诺不要求本章全部兑现；开篇承诺延期须有明确落点。来源缺失时标明未知，不编造原始选择；若与已写事实或受保护边界冲突，交由现有规划审查修复，不擅改事实。";

const progressionRule = "先对照writtenEvidence已写正文：哪些事件已经发生、人物已经知道什么、前章结尾具体决定去做什么。purpose与readerExperience.netChange必须说明本章相对这些事实的新结果；场景必须实际执行、受阻改变或有依据地改选该行动，不能整章重复铺垫后又仅决定去做。重复行动若带来新线索、代价、关系变化或认识重释可保留，并在mustAdvance中明确增量。回顾、哀悼、慢热日常可承担情绪或关系上的真实变化，不强求胜利、打斗、固定反转数或每章兑现长期目标。细腻是把篇幅用在有意义的观察、选择与结果上，不是重复求生、赶路、盘点和已知感想。先压缩无效重复，再在已有授权范围内调整职责；旧计划若要求重复已完成事件，不得把它当成仍必须完成的新事件，交给规划审查纠正。不得伪造前文或占用只读邻章独占事件。";

const TITLE_EVENT_ANCHOR_HINTS = [
  "激活",
  "入手",
  "兑现",
  "暴露",
  "发现",
  "转向",
  "升级",
  "查账",
  "接管",
  "请缨",
  "破局",
  "反压",
  "发难",
  "露白",
  "启动",
  "异响",
  "得手",
  "松动",
];

function normalizeComparableText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function cleanAnchorFragment(value: string): string {
  return value.replace(/[《》【】「」『』“”"'‘’]/g, "").trim();
}

function extractEventAnchorsFromTitle(title: string | null | undefined): string[] {
  const normalized = normalizeComparableText(title);
  if (!normalized) {
    return [];
  }
  const seen = new Set<string>();
  const fragments = normalized
    .split(/[，,。；;：:、|/\\\-\s（）()]+/g)
    .map((item) => cleanAnchorFragment(item))
    .filter((item) => item.length >= 4 && item.length <= 16)
    .filter((item) => TITLE_EVENT_ANCHOR_HINTS.some((hint) => item.includes(hint)));

  for (const fragment of fragments) {
    seen.add(fragment);
  }
  return [...seen];
}

function buildCurrentChapterContractText(input: VolumeChapterDetailPromptInput): string {
  const { targetChapter } = input;
  return normalizeComparableText([
    targetChapter.title,
    targetChapter.summary,
    targetChapter.purpose,
    targetChapter.exclusiveEvent,
    targetChapter.endingState,
    targetChapter.nextChapterEntryState,
    targetChapter.payoffRefs.join(" "),
  ].filter(Boolean).join("\n"));
}

function validatePurposeDistinct(output: { purpose: string }, input: VolumeChapterDetailPromptInput) {
  const purpose = normalizeComparableText(output.purpose);
  if (
    purpose === normalizeComparableText(input.targetChapter.summary)
    || purpose === normalizeComparableText(input.targetChapter.purpose)
  ) {
    throw new Error("章节目标不能与章节摘要或现有目标完全相同；请改为一句明确的本章推进目标。");
  }
  return output;
}

function validateBoundaryContract(
  output: {
    exclusiveEvent: string;
    endingState: string;
    nextChapterEntryState: string;
    conflictLevel: number;
    revealLevel: number;
    targetWordCount: number;
    mustAvoid: string;
    payoffRefs: string[];
  },
  input: VolumeChapterDetailPromptInput,
): {
  exclusiveEvent: string;
  endingState: string;
  nextChapterEntryState: string;
  conflictLevel: number;
  revealLevel: number;
  targetWordCount: number;
  mustAvoid: string;
  payoffRefs: string[];
} {
  const sortedChapters = input.targetVolume.chapters
    .slice()
    .sort((left, right) => left.chapterOrder - right.chapterOrder);
  const targetIndex = sortedChapters.findIndex((chapter) => chapter.id === input.targetChapter.id);
  if (targetIndex < 0) {
    return output;
  }

  const previousChapter = targetIndex > 0 ? sortedChapters[targetIndex - 1] : null;
  const nextChapter = targetIndex < sortedChapters.length - 1 ? sortedChapters[targetIndex + 1] : null;
  const currentContractText = buildCurrentChapterContractText(input);

  if (
    previousChapter?.exclusiveEvent?.trim()
    && output.exclusiveEvent.includes(previousChapter.exclusiveEvent.trim())
    && !currentContractText.includes(previousChapter.exclusiveEvent.trim())
  ) {
    throw new Error(`当前章独占事件与上一章独占事件「${previousChapter.exclusiveEvent.trim()}」冲突。一次性节点不能跨章重复占用。`);
  }
  const leakedNextAnchor = nextChapter
    ? extractEventAnchorsFromTitle(nextChapter.title).find((anchor) => (
      output.exclusiveEvent.includes(anchor)
      || output.endingState.includes(anchor)
      || output.nextChapterEntryState.includes(anchor)
    ))
    : null;
  if (leakedNextAnchor && !currentContractText.includes(leakedNextAnchor)) {
    throw new Error(`当前章边界合同疑似提前占用了下一章标题中的一次性事件锚点「${leakedNextAnchor}」。`);
  }
  if (normalizeComparableText(output.endingState) === normalizeComparableText(output.nextChapterEntryState)) {
    throw new Error("endingState 与 nextChapterEntryState 不能完全相同。前者是本章结束态，后者是下章入口态，必须体现承接而不是机械重复。");
  }

  return output;
}

function buildTaskSheetSemanticText(output: {
  taskSheet: string;
  sceneCards: Array<{
    title: string;
    purpose: string;
    entryState: string;
    exitState: string;
    mustAdvance: string[];
    forbiddenExpansion: string[];
  }>;
}): string {
  return normalizeComparableText([
    output.taskSheet,
    ...output.sceneCards.flatMap((scene) => [
      scene.title,
      scene.purpose,
      scene.entryState,
      scene.exitState,
      scene.mustAdvance.join(" "),
      scene.forbiddenExpansion.join(" "),
    ]),
  ].join("\n"));
}

function validateAdjacentChapterBoundary<T extends {
    taskSheet: string;
    sceneCards: Array<{
      title: string;
      purpose: string;
      entryState: string;
      exitState: string;
      mustAdvance: string[];
      forbiddenExpansion: string[];
    }>;
  }>(
  output: T,
  input: VolumeChapterDetailPromptInput,
): T {
  const sortedChapters = input.targetVolume.chapters
    .slice()
    .sort((left, right) => left.chapterOrder - right.chapterOrder);
  const targetIndex = sortedChapters.findIndex((chapter) => chapter.id === input.targetChapter.id);
  if (targetIndex < 0) {
    return output;
  }

  const currentContractText = buildCurrentChapterContractText(input);
  const outputText = buildTaskSheetSemanticText(output);
  const adjacentChapters = [
    { label: "上一章", chapter: targetIndex > 0 ? sortedChapters[targetIndex - 1] : null },
    { label: "下一章", chapter: targetIndex < sortedChapters.length - 1 ? sortedChapters[targetIndex + 1] : null },
  ];

  for (const adjacent of adjacentChapters) {
    const chapter = adjacent.chapter;
    if (!chapter) {
      continue;
    }
    const leakedAnchor = extractEventAnchorsFromTitle(chapter.title)
      .find((anchor) => outputText.includes(anchor) && !currentContractText.includes(anchor));
    if (leakedAnchor) {
      throw new Error(
        `${adjacent.label}标题中的一次性事件锚点「${leakedAnchor}」疑似越界进入当前章节执行合同。当前章只能承接相邻章节状态，不能提前、滞后或重复承担相邻章节的关键首次事件。`,
      );
    }
  }

  return output;
}

const intensityScaleRule = "conflictLevel 与 revealLevel 统一采用 0-100 整数尺度，不是 1-5 星级。0 表示无冲突或无新增揭示，20 表示低强度铺垫，50 表示中等阻力或实质线索，80 表示高压对抗或重大揭示，100 表示本书极限。按实际场景的阻力、代价和信息变化评分，不为曲线好看硬造高潮；用户已固定的数值必须保留。";

const sceneCausalityRules = [
  "每个 sceneCard 必须包含 causality：actor（作出关键选择的人）、choice（具体选择）、motive（为什么如此选择）、prerequisites、resistanceResponse（他人/环境如何回应）、outcomeMechanism（回应如何导致结果）、resultingConstraints。不能把目的或预定结果冒充发生机制。",
  "prerequisites 每项包含 condition、sourceKind、reference。sourceKind 只能是 established_in_context（上下文已建立，reference 指向具体来源）、establish_in_scene（本章先建立再使用，reference 指明建立场景与动作）、unresolved（缺少支持，reference 说明缺口）。没有上下文证据不能声称前文已获得物品、信息、信任、能力或通行条件。",
  "resultingConstraints 每项包含 constraint、persistence：写明行动带来的身体、资源、时间、关系或认知限制，以及持续至何时/什么可见事件才能解除；既有伤势或消耗必须实际限制可选行动，不能只作装饰。没有新增限制可返回空数组，不能强行添加伤亡。",
  "因果合同适用于各种题材：拒绝、等待、误解、认知或情绪变化、失败都可以是结果，不要求每场战斗、获胜或反转。对手也应按自身利益和已知能力回应，不能只为预定结果降智。前提最多6项、后续限制最多6项，各文本字段不超过120汉字；无必要前提可用空数组。",
];

function createVolumeDetailSystemPrompt(detailMode: VolumeChapterDetailPromptInput["detailMode"]): string {
  if (detailMode === "purpose") {
    return [
      "你是资深网文章节编辑。",
      "当前任务是收束单章 purpose。",
      selectedDirectionRule,
      progressionRule,
      "只输出严格 JSON，且只包含 purpose 字段。",
      "purpose 必须说明这一章要推进什么，不要复述摘要。",
    ].join("\n");
  }
  if (detailMode === "boundary") {
    return [
      "你是资深网文章节编辑。",
      "当前任务是为单章定义执行边界。",
      selectedDirectionRule,
      progressionRule,
      intensityScaleRule,
      "只输出严格 JSON，且只包含 exclusiveEvent、endingState、nextChapterEntryState、conflictLevel、revealLevel、targetWordCount、mustAvoid、payoffRefs。",
      "exclusiveEvent 表示只能由本章承担的一次性里程碑事件，必须具体，不能写成空泛主题。",
      "endingState 表示本章写完时的稳定局面。",
      "nextChapterEntryState 表示下一章开场时应承接的入口状态，必须与 endingState 强关联但不能逐字重复。",
      "边界合同必须保证：上一章已完成的独占事件不重复，本章独占事件不偷跑到下一章，下一章只承接状态不重演本章里程碑。",
      "各字段必须与当前卷节奏和相邻章节保持一致。",
      "如果 conflict_level_curve 标出用户锚定的 conflictLevel，该数值是硬约束，不得改写。",
    ].join("\n");
  }
  return [
    "你是资深网文章节编辑。",
    "当前任务是生成可直接交给正文生成器的章节执行合同。",
    "只输出严格 JSON，且只包含 taskSheet、readerExperience、sceneCards 三个字段。",
    "taskSheet 是给用户读的简洁执行摘要，需要覆盖情绪基调、冲突对象、关键推进和收尾要求。",
    selectedDirectionRule,
    progressionRule,
    "readerExperience 是本章唯一的读者体验合同，必须包含 readerQuestion、promisedReward、rewardLevel、protagonistWant、primaryResistance、keyTurn、emotionalShift、informationReveal、netChange、inheritedHookResponsibilities、endingHook。",
    "rewardLevel 只能是 setup、partial、major；由本章在卷节奏中的职责决定，不要每章都写成 major。",
    "inheritedHookResponsibilities 必须优先承接相邻章已经提出的问题；没有明确旧钩子时返回空数组，不要编造。",
    "promisedReward 与 netChange 必须是读者在正文中能看见的回报和变化，不能写成作者意图或抽象主题。",
    "sceneCards 必须是 3-8 个场景卡数组，每个场景卡都必须包含 key、title、purpose、mustAdvance、mustPreserve、entryState、exitState、forbiddenExpansion、targetWordCount、resistance、turn、emotionalShift、readerValue。",
    "每个场景都必须有具体阻力和转折；readerValue 要说明该场景给读者带来的推进、揭示、情绪或关系价值。",
    ...sceneCausalityRules,
    "sceneCards 必须完整覆盖整章推进和结尾 hook，不要把整章压成一个场景。",
    "当前章节的 title、summary、purpose、exclusiveEvent、endingState、nextChapterEntryState、conflictLevel、revealLevel、mustAvoid、payoffRefs 共同组成了本章硬边界合同。taskSheet 和 sceneCards 只能执行当前章合同，不能改写或覆盖它。",
    "你必须把 chapter_neighbors 视为相邻章边界提示：上一章已经完成的关键首次事件不能在本章重写一次，下一章标题或摘要中的关键首次事件也不能提前写进本章。",
    "本章结尾只能把局面推到下一章入口，不能直接落完下一章标题所承诺的核心里程碑。",
    "如果相邻章标题已经明确标出一次性节点，例如系统激活、第一笔资源入手、身份暴露、关键查账、正式请缨等，本章不得重复承担该节点，除非当前章自己的合同已经明确要求。",
    "你必须优先识别最近章节执行合同与当前章节之间的叙事重复风险，重点检查开场方式、推进方式、状态变化和结尾钩子是否连续复用。",
    "如果最近章节已经连续使用同类开场或同类推进，本章必须主动切换，不得继续沿用同一路数。",
    "差异化要求必须落实到 taskSheet 和 sceneCards 里，而不是停留在抽象提醒。",
    "首个 sceneCard 必须通过 purpose、entryState 或 forbiddenExpansion 明确避开最近章节的重复开场。",
    "至少一个中段 sceneCard 的 mustAdvance 必须明确要求不同于最近章节的推进结果，例如主动试探、关系建立、资源获得、规则认知或计划转向。",
    "如果最近章节已经连续写成外部压迫或被动逃离，本章不得继续只靠同类压迫推进，必须给出新的推进机制。",
  ].join("\n");
}

function createExecutionContractSystemPromptGarbledBackup(): string {
  return [
    "浣犳槸璧勬繁缃戞枃绔犺妭缂栬緫銆?",
    "褰撳墠浠诲姟鏄竴娆℃€х敓鎴愬彲鐩存帴浜ょ粰鍐欎綔鍣ㄧ殑绔犺妭鎵ц鍚堝悓銆?",
    "鍙緭鍑轰弗鏍?JSON锛屽繀椤诲悓鏃跺寘鍚?purpose銆乪xclusiveEvent銆乪ndingState銆乶extChapterEntryState銆乧onflictLevel銆乺evealLevel銆乼argetWordCount銆乵ustAvoid銆乸ayoffRefs銆乼askSheet銆乻ceneCards銆?",
    "purpose 鐢ㄤ竴鍙ヨ瘽璇存槑鏈珷鍒板簳瑕佹帹杩涗粈涔堬紝涓嶈鍐欐垚鎽樿澶嶈堪銆?",
    "exclusiveEvent / endingState / nextChapterEntryState 绛夊瓧娈典笉鍙己澶憋紝瀹冧滑鏄珷鑺傜殑纭竟鐣屽悎鍚屻€?",
    "taskSheet 鏄粰姝ｆ枃鍐欎綔鍣ㄧ殑绠€娲佹墽琛屾寚浠わ紝sceneCards 鏄?3-8 涓満鏅崱鐨勬墽琛屾媶瑙ｃ€?",
    "taskSheet 鍜?sceneCards 鍙兘鎵ц褰撳墠绔犵殑鍚堝悓锛屼笉寰楁彁鍓嶅崰鐢ㄧ浉閭荤珷鐨勪竴娆℃€т簨浠讹紝涔熶笉寰楅噸鍐欎笂涓€绔犲凡缁忓畬鎴愮殑閲岀▼纰戙€?",
    "濡傛灉鏈€杩戠珷鑺傚凡缁忚繛缁娇鐢ㄧ浉鍚屽紑鍦恒€佺浉鍚屾帹杩涜矾鏁版垨鍚岀被閽╁瓙锛屾湰绔犲繀椤婚€氳繃 sceneCards 涓诲姩鍋氬嚭宸紓鍖栥€?",
  ].join("\n");
}

function createExecutionContractSystemPrompt(): string {
  return [
    "你是资深网文章节编辑。",
    "当前任务是一次性生成可直接交给写作器的章节执行合同。",
    selectedDirectionRule,
    progressionRule,
    intensityScaleRule,
    "只输出严格 JSON，必须同时包含 purpose、exclusiveEvent、endingState、nextChapterEntryState、conflictLevel、revealLevel、targetWordCount、mustAvoid、payoffRefs、taskSheet、readerExperience、sceneCards。",
    "purpose 用一句话说明本章到底要推进什么，不要写成摘要复述。",
    "exclusiveEvent / endingState / nextChapterEntryState 等字段不可缺失，它们是章节的硬边界合同。",
    "taskSheet 是给正文写作器的简洁执行指令，sceneCards 是 3-8 个场景卡的执行拆解。",
    "readerExperience 是本章唯一的读者体验合同，必须完整包含 readerQuestion、promisedReward、rewardLevel、protagonistWant、primaryResistance、keyTurn、emotionalShift、informationReveal、netChange、inheritedHookResponsibilities、endingHook。",
    "rewardLevel 只能使用 setup、partial、major；promisedReward 和 netChange 必须能在正文中被读者直接感知。",
    "sceneCards 除原字段外还必须包含 resistance、turn、emotionalShift、readerValue，确保每个场景都有阻力、转折和读者价值。",
    ...sceneCausalityRules,
    "taskSheet 和 sceneCards 只能执行当前章的合同，不得提前占用相邻章的一次性事件，也不得重写上一章已经完成的里程碑。",
    "payoff_cadence 列出本章到期的账本承诺。每一条都必须在本章合同里有明确落点：purpose、mustAdvance 或 readerExperience 要写出它这一章向前动了哪一步、由谁在什么处境下推动、带来什么可见后果。只写「记得这件事」「准备去办」不算推进。推进不等于兑现，长期承诺不要求本章全部兑现；确实推不动时说明具体阻力或取舍，并不要为凑清单新造能力、道具、人物或提前兑现远期安排。",
    "如果 conflict_level_curve 标出用户锚定的 conflictLevel，该数值是硬约束，不得改写。",
    "如果最近章节已经连续使用相同开场、相同推进路数或同类钩子，本章必须通过 sceneCards 主动做出差异化。",
    "purpose、边界字段和 readerExperience 各字段只写 1 句，单字段不超过 120 个汉字；taskSheet 不超过 300 个汉字。",
    "每个 sceneCard 的文本字段只写执行所需信息，单字段不超过 120 个汉字；不得扩写正文或对白。",
    "targetWordCount 必须沿用当前目标章节的字数预算，范围只能是 200-20000，不能误用全书或全卷字数。",
    "完成最后一个 sceneCard 后立即结束 JSON，禁止续写解释、复读或自我修正。",
  ].join("\n");
}

function buildChapterDetailPrompt(contextText: string, detailMode: VolumeChapterDetailPromptInput["detailMode"]): string {
  return [
    `detail mode: ${detailMode}`,
    "",
    "chapter detail context:",
    contextText,
  ].join("\n");
}

const baseContextPolicy = {
  maxTokensBudget: NOVEL_PROMPT_BUDGETS.volumeChapterDetail,
  requiredGroups: ["book_contract", "target_volume", "chapter_neighbors", "chapter_detail_draft"],
  preferredGroups: ["recent_execution_contracts", "macro_constraints", "target_beat_sheet", "payoff_cadence", "volume_window"],
  dropOrder: ["volume_window"],
};

export const volumeChapterPurposePrompt: PromptAsset<
  VolumeChapterDetailPromptInput,
  ReturnType<typeof createChapterPurposeSchema>["_output"]
> = {
  id: "novel.volume.chapter_purpose",
  version: "v6",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: baseContextPolicy,
  semanticRetryPolicy: {
    maxAttempts: 2,
  },
  outputSchema: createChapterPurposeSchema(),
  render: (input, context) => [
    new SystemMessage(createVolumeDetailSystemPrompt("purpose")),
    new HumanMessage(buildChapterDetailPrompt(renderSelectedContextBlocks(context), input.detailMode)),
  ],
  postValidate: (output, input) => validatePurposeDistinct(output, input),
};

export const volumeChapterBoundaryPrompt: PromptAsset<
  VolumeChapterDetailPromptInput,
  ReturnType<typeof createChapterBoundarySchema>["_output"]
> = {
  id: "novel.volume.chapter_boundary",
  version: "v5",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: baseContextPolicy,
  semanticRetryPolicy: {
    maxAttempts: 2,
  },
  outputSchema: createChapterBoundarySchema(),
  render: (input, context) => [
    new SystemMessage(createVolumeDetailSystemPrompt("boundary")),
    new HumanMessage(buildChapterDetailPrompt(renderSelectedContextBlocks(context), input.detailMode)),
  ],
  postValidate: (output, input) => validateBoundaryContract(output, input),
};

export const volumeChapterTaskSheetPrompt: PromptAsset<
  VolumeChapterDetailPromptInput,
  ReturnType<typeof createChapterTaskSheetSchema>["_output"]
> = {
  id: "novel.volume.chapter_task_sheet",
  version: "v8",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: baseContextPolicy,
  semanticRetryPolicy: {
    maxAttempts: 2,
  },
  outputSchema: createChapterTaskSheetSchema(),
  render: (input, context) => [
    new SystemMessage(createVolumeDetailSystemPrompt("task_sheet")),
    new HumanMessage(buildChapterDetailPrompt(renderSelectedContextBlocks(context), input.detailMode)),
  ],
  postValidate: (output, input) => validateAdjacentChapterBoundary(output, input),
};

export const volumeChapterExecutionContractPrompt: PromptAsset<
  VolumeChapterDetailPromptInput,
  ReturnType<typeof createChapterExecutionContractSchema>["_output"]
> = {
  id: "novel.volume.chapter_execution_contract",
  version: "v9",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: baseContextPolicy,
  outputSchema: createChapterExecutionContractSchema(),
  render: (input, context) => [
    new SystemMessage(createExecutionContractSystemPrompt()),
    new HumanMessage([
      buildChapterDetailPrompt(renderSelectedContextBlocks(context), input.detailMode),
      ...(input.contractRepairFeedback ? ["Contract repair feedback (required; retain valid parts of the previous candidate):", input.contractRepairFeedback] : []),
    ].join("\n\n")),
  ],
  postValidate: (output, input) => {
    validateBoundaryContract(output, input);
    validateAdjacentChapterBoundary(output, input);
    return output;
  },
};

export { buildVolumeChapterDetailContextBlocks };
