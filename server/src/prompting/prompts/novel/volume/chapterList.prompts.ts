import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { PromptAsset } from "../../../core/promptTypes";
import { renderSelectedContextBlocks } from "../../../core/renderContextBlocks";
import { createVolumeChapterBeatBlockSchema } from "../../../../services/novel/volume/volumeGenerationSchemas";
import { type VolumeChapterListPromptInput } from "./shared";
import { buildVolumeChapterListContextBlocks } from "./contextBlocks";
import { NOVEL_PROMPT_BUDGETS } from "../promptBudgetProfiles";
import {
  getChapterTitleCollisionIssue,
  getChapterTitleDiversityIssue,
  isBlockingChapterTitleQualityIssue,
  isChapterTitleDuplicateIssue,
  isChapterTitleDiversityIssue,
} from "../../../../services/novel/volume/chapterTitleDiversity";

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function buildRetryDirective(reason?: string | null): string {
  const normalizedReason = reason?.trim();
  if (!normalizedReason) {
    return "";
  }

  return [
    "上一次输出没有通过业务校验，本次必须优先修正：",
    normalizedReason,
    "先判断失败类型：标题结构、标题基础质量、章节功能、摘要推进、结尾牵引。",
    "不要只替换被点名的一章；如果问题来自标题同构或章节功能重复，必须重排整组标题骨架和章节功能分配。",
  ].join("\n");
}

function classifyChapterListRetryIssue(reason: string): string {
  if (isChapterTitleDiversityIssue(reason)) {
    return "标题结构：重排整组标题骨架，混用动作推进型、冲突压迫型、异常发现型、结果兑现型、决断转向型和问题钩子型。";
  }
  if (isBlockingChapterTitleQualityIssue(reason)) {
    return "标题基础质量：标题必须短促客观，不能第一人称、不能过长、不能写成完整剧情句。";
  }
  if (reason.includes("必须声明主角的主动行动与本章交付")) {
    return "章节功能：为被点名的每一章补上 protagonistAction（这一章主角主动做了什么）和 chapterPayoff（这一章交付了什么推进或转折），写具体动作与结果，不要复述摘要。";
  }
  if (reason.includes("声明了同一个主动行动") || reason.includes("声明了同一个推进")) {
    return "章节功能：相邻两章不能重复同一个动作或同一个结果，请重新分配每章职责，使推进逐章向前。";
  }
  if (reason.includes("摘要写的是同一件事")) {
    return "摘要推进：相邻两章必须写不同的事，每章 summary 要写出新增信息、局面变化、冲突推进、关系变化、资源得失或风险转向。";
  }
  return "综合质量：按失败原因重排标题、章节功能和摘要推进，保证每章都有新增变化。";
}

function resolvePromptConfig(
  input:
    | number
    | {
      targetChapterCount: number;
      targetBeatKey?: string;
      targetBeatLabel?: string | null;
      isBookFinale?: boolean;
      reservedChapterTitles?: string[];
      },
): {
  targetChapterCount: number;
  targetBeatKey: string;
  targetBeatLabel: string;
  isBookFinale: boolean;
  reservedChapterTitles: string[];
} {
  if (typeof input === "number") {
    return {
      targetChapterCount: input,
      targetBeatKey: "target_beat",
      targetBeatLabel: "目标节奏段",
      isBookFinale: false,
      reservedChapterTitles: [],
    };
  }

  return {
    targetChapterCount: input.targetChapterCount,
    targetBeatKey: input.targetBeatKey?.trim() || "target_beat",
    targetBeatLabel: input.targetBeatLabel?.trim() || "目标节奏段",
    isBookFinale: input.isBookFinale === true,
    reservedChapterTitles: input.reservedChapterTitles ?? [],
  };
}

/**
 * 轻量章节功能质量检测。
 *
 * 目的：
 * - 不代替 LLM Critic；
 * - 只拦截最常见的低质量章节块：
 *   1. 连续多章只是调查/发现/意识到；
 *   2. summary 大量空泛；
 *   3. 缺少主角行动；
 *   4. 结尾章没有兑现/转向/钩子。
 *
 * 后续可以把这个函数升级成：
 * - chapterFunctionDiversity.ts
 * - 或一个独立 LLM quality critic 节点。
 */
/** Whitespace- and punctuation-insensitive comparison, for spotting a declared repeat. */
function sameChapterFunctionText(left: string | undefined, right: string | undefined): boolean {
  const normalize = (value: string | undefined) =>
    (value ?? "").replace(/[\s，。、；：！？“”‘’（）()【】\[\],.;:!?"']+/g, "");
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && a === b;
}

/**
 * Structural checks on the chapter function the model declares.
 *
 * This replaced six Chinese keyword tables that guessed "is this chapter active enough" from the
 * summary text. Deciding that from a word list is a reading judgement performed by fixed string
 * rules, which this project forbids, and the verdict was unreliable in both directions: a summary can
 * describe a decisive choice without using any listed verb, and it can contain one while the chapter
 * is still passive.
 *
 * The model now states, per chapter, what the protagonist actively does and what the chapter
 * delivers. Code checks only that the statement exists and that neighbours are not declaring the
 * same thing — which the keyword tables could not see at all, and which is exactly the repetition
 * that reached a finished chapter in a real run.
 */
function getChapterFunctionQualityIssue(
  chapters: Array<{
    title: string;
    summary: string;
    beatKey: string;
    protagonistAction?: string;
    chapterPayoff?: string;
  }>,
): string | null {
  if (!chapters.length) {
    return "章节列表不能为空。";
  }

  const incomplete = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ chapter }) => !(chapter.protagonistAction ?? "").trim() || !(chapter.chapterPayoff ?? "").trim());
  if (incomplete.length) {
    const named = incomplete.slice(0, 6).map(({ chapter, index }) => {
      const missing = [
        (chapter.protagonistAction ?? "").trim() ? null : "protagonistAction（主角这一章主动做了什么）",
        (chapter.chapterPayoff ?? "").trim() ? null : "chapterPayoff（这一章交付了什么推进或转折）",
      ].filter(Boolean).join("、");
      return `第${index + 1}章《${chapter.title}》缺 ${missing}`;
    }).join("；");
    return `每章都必须声明主角的主动行动与本章交付，不能只写摘要：${named}。`;
  }

  for (let index = 1; index < chapters.length; index += 1) {
    const previous = chapters[index - 1];
    const current = chapters[index];
    if (sameChapterFunctionText(previous.protagonistAction, current.protagonistAction)) {
      return `第${index}章《${previous.title}》与第${index + 1}章《${current.title}》声明了同一个主动行动（${(current.protagonistAction ?? "").trim()}）：相邻两章不能重复同一个动作。`;
    }
    if (sameChapterFunctionText(previous.chapterPayoff, current.chapterPayoff)) {
      return `第${index}章《${previous.title}》与第${index + 1}章《${current.title}》声明了同一个推进（${(current.chapterPayoff ?? "").trim()}）：相邻两章不能交付同一个结果。`;
    }
  }

  for (let index = 1; index < chapters.length; index += 1) {
    if (sameChapterFunctionText(chapters[index - 1].summary, chapters[index].summary)) {
      return `第${index}章《${chapters[index - 1].title}》与第${index + 1}章《${chapters[index].title}》的摘要写的是同一件事：相邻两章必须有不同的内容。`;
    }
  }

  return null;
}

function isChapterFunctionQualityIssue(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("章节中主角或核心视角角色的主动行动不足") ||
    message.includes("连续多章呈现被动推进") ||
    message.includes("当前节奏段缺少阶段性兑现") ||
    message.includes("结尾章缺少当前 beat") ||
    message.includes("过多章节摘要偏空泛")
  );
}

export function createVolumeChapterListPrompt(
  input:
    | number
    | {
        targetChapterCount: number;
        targetBeatKey?: string;
        targetBeatLabel?: string | null;
        isBookFinale?: boolean;
        reservedChapterTitles?: string[];
      },
): PromptAsset<
  VolumeChapterListPromptInput,
  ReturnType<typeof createVolumeChapterBeatBlockSchema>["_output"]
> {
  const { targetChapterCount, targetBeatKey, targetBeatLabel, isBookFinale = false, reservedChapterTitles } =
    resolvePromptConfig(input);

  return {
    id: "novel.volume.chapter_list",
    version: "v14",
    taskType: "planner",
    mode: "structured",
    language: "zh",

    contextPolicy: {
      maxTokensBudget: NOVEL_PROMPT_BUDGETS.volumeChapterList,
      // written_evidence is required, not preferred: a chapter list planned without seeing what has
      // already been written schedules scenes the prose has already played. That is how a real book
      // got a fourth chapter whose first half re-ran the second chapter's rent scene — the contract
      // generation downstream then elaborated the repeat faithfully, because its own rule against
      // repeating finished events only had the plan to argue with.
      requiredGroups: ["book_contract", "target_volume", "target_beat_contract", "written_evidence"],
      preferredGroups: [
        "macro_constraints",
        "beat_context_window",
        "previous_beat_chapters",
        "preserved_beat_chapters",
        "adjacent_volumes",
        "soft_future_summary",
      ],
      dropOrder: ["soft_future_summary"],
    },

    semanticRetryPolicy: {
      maxAttempts: 2,
      buildMessages: ({
        attempt,
        baseMessages,
        parsedOutput,
        validationError,
      }) => {
        const normalizedValidationError = validationError?.trim() || "未通过章节列表业务校验。";
        const retryIssueClass = classifyChapterListRetryIssue(normalizedValidationError);
        return [
          ...baseMessages,
          new HumanMessage(
            [
              `上一次章节块通过了 JSON 结构校验，但没有通过业务校验。这是第 ${attempt} 次语义重试。`,
              `失败原因：${normalizedValidationError}`,
              `失败类型：${retryIssueClass}`,
              "",
              "重写要求：",
              "1. 只重写当前节奏段的章节列表，不得越界生成其他节奏段章节。",
              "2. 必须保留原有章节位数，最终 chapters.length 仍然必须等于目标章数。",
              "3. 必须先按失败类型修复：标题结构问题重排整组标题骨架；标题基础质量问题重写所有不合格标题；章节功能问题重排每章职责；摘要推进问题重写所有空泛摘要；结尾牵引问题重写末章的兑现和转向。",
              "4. 不要只局部替换触发校验的一章；需要保证整组章节的标题骨架、章节功能、摘要推进和结尾牵引同时通过。",
              "5. 若失败原因是标题重复或标题骨架集中，必须重写所有命中重复骨架的标题，而不是只局部修补几章。",
              "6. 若失败原因是章节功能重复，必须重新分配章节功能，避免连续多章只做调查、发现、意识到或铺垫。",
              "7. 每章 summary 必须体现新增推进，优先体现核心视角角色的选择、试探、反击、布局、交换、隐忍或承担代价。",
              "8. 明确避免大量使用“X的Y / X中的Y / 在X中Y”骨架。",
              "9. 明确避免整批标题继续塌成“A，B / 四字动作，四字结果”并列模板。",
              "10. 标题必须是客观章名，不用第一人称，不写成完整剧情句，核心字数不超过 16 个。",
              "11. 每章 beatKey 必须保持为当前目标 beatKey。",
              "12. 摘要必须体现本章造成的局面变化，不得空泛复述标题。",
              isBookFinale
                ? "13. 全书终章必须完成结局合同，不得创建必须续写的新主线或下一 beat 钩子。"
                : "13. 最后一章必须完成当前 beat 的 mustDeliver，同时留下阅读牵引，但不得提前兑现下一 beat 的核心事件。",
              "",
              "上一次的 JSON 输出：",
              safeJsonStringify(parsedOutput),
              "",
              "请重新输出完整 JSON 对象。",
            ].join("\n"),
          ),
        ];
      },
    },

    outputSchema: createVolumeChapterBeatBlockSchema({
      exactChapterCount: targetChapterCount,
      expectedBeatKey: targetBeatKey,
      expectedBeatLabel: targetBeatLabel,
    }),

    render: (promptInput, context) => [
      new SystemMessage(
        [
          "你是网文章节拆分规划助手。",
          "你的任务不是写正文，也不是扩写细纲，而是只为当前卷的单个节奏段生成一块可执行的章节列表。",
          "你必须同时满足：结构化输出正确、章节功能清晰、标题像章节名、摘要有真实推进。",
          "",
          "一、任务边界",
          `1. 你当前只能为「${targetBeatLabel}」生成 ${targetChapterCount} 章，数量不得多也不得少。`,
          "2. 只允许覆盖当前目标 beat，不得越界生成相邻 beat 的章节。",
          "3. 不得把两个章节合并成一章摘要，也不得用空泛占位章来凑数。",
          "4. 在精确章数内，从已有矛盾发展具体行动及其后果，不得以保守过渡或重复工作流程填空，也不得发明重大新设定。",
          "每章摘要呈现主角主动做什么、阻力如何回应、选择付出什么、局面具体如何改变。连续章节不能只是重复催促、失误、查资料或增加疑问；至少一次早期回报兑现旧问题并促成新行动。若承接已选开篇事件链，保持其核心选择、后果与回报，不稀释成多章氛围铺垫。",
          "5. 本任务只生成章节列表，不写正文，不写详细场景，不写完整对白。",
          "",
          "二、硬性输出约束",
          "1. 顶层必须输出 beatKey、beatLabel、chapterCount、chapters 四个字段。",
          "2. 每章包含 title、summary、beatKey、protagonistAction、chapterPayoff 五个字段，不得新增其他字段。",
          `3. beatKey 必须严格等于 ${targetBeatKey}。`,
          `4. beatLabel 必须严格等于 ${targetBeatLabel}。`,
          `5. chapterCount 与 chapters.length 必须严格等于 ${targetChapterCount}。`,
          `6. 每章 beatKey 都必须严格等于 ${targetBeatKey}。`,
          "7. 不得输出 Markdown、注释、解释或任何额外文本。",
          "8. 每章 summary 控制在 40-120 个汉字，只写核心行动、阻力和造成的新局面；禁止扩写场景、对白或正文。",
          "9. 写完指定数量的最后一章后立即结束 JSON，不得追加分析、自检过程或候选版本。",
          "",
          "三、章节规划核心原则",
          "1. 章节列表必须严格服从当前卷骨架与当前目标 beat 合同，不能偷跑到相邻 beat。",
          "2. 每章都必须回答：这一章为什么必须存在，它推进了什么，它造成了什么新的局面变化。",
          "3. 当前节奏段的章节拆分要体现网文阅读感，但不能机械平均切分。",
          "4. 章节必须形成连续递进，不能出现只是换说法、没有新增推进的信息重复章。",
          "5. 每章 summary 不只要写“发生了什么”，还要写“因此改变了什么”。",
          "6. protagonistAction 写这一章主角（核心视角角色）主动做的具体动作：选择、试探、反击、布局、交换、隐瞒、承担代价等。不能写“得知”“听说”“意识到”这类被动接受，也不能写成摘要的复述。",
          "7. chapterPayoff 写这一章交付给读者的推进或转折：兑现了什么、反转了什么、付出了什么代价、局面因此向哪边移动。每一章都必须有，不能只在结尾章出现。",
          "8. protagonistAction 与 chapterPayoff 必须逐章不同。相邻两章写同一个动作或同一个结果，等同于没有推进，会被判为失败并要求重排。",
          "9. 这两项是章节功能的正式声明，由你自己判断，不要为了通过检查而套用固定句式；它们必须与 summary 描述的是同一件事。",
          "10. 排章前必须先读 written_evidence（已写正文）：哪些事件已经发生过、哪些人已经知道了什么、上一章结尾具体决定去做什么。已经演过的场面不得再排一次；同一处境要再次出现时，必须写明这一次与上一次不同的阻力、不同的选择或不同的后果，并把增量写进 summary 与 chapterPayoff。",
          "11. 典型错误：前文已经交过房租、已经被人当面追问过钱从哪来，就不要再排一章重新交租、重新被问一遍。读者会认为情节在原地打转。要接着演的是那件事之后的新局面。",
          "",
          "四、章节功能分配要求",
          "1. 生成前必须在脑内把当前 beat 拆成若干章节功能：承接、加压、试探、发现、转折、反击、兑现、余波或钩子。",
          "2. 实际输出时不要暴露这些功能标签，但每章 summary 必须体现清晰功能。",
          "3. 连续章节不能承担完全相同的功能，尤其不能连续多章只做调查、讨论、铺垫、等待、意识到或发现。",
          "4. 若目标章数大于等于 5，至少应包含一次局面加压、一次关键发现或判断反转、一次阶段性兑现或明确转向。",
          "5. 关键推进可以占更多章节，过渡章要短促有力，不要为了凑数制造低信息密度章节。",
          isBookFinale
            ? "6. 全书终章必须完成结局合同中的主冲突、关系变化、核心回报与主题落点，不得留下必须续写的新主线。"
            : "6. 最后一章必须完成当前 beat 的 mustDeliver，同时留下进入下一 beat 的阅读牵引，但不得提前兑现下一 beat 的核心事件。",
          "",
          "五、章节推进质量要求",
          "1. 每章 summary 都要体现核心视角角色的选择、试探、反击、隐忍、交换、布局、揭穿、妥协或承担代价，避免角色只是旁观外部事件。",
          "2. 每章 summary 应包含至少一种有效推进：新情报、风险升级、关系变化、资源得失、误判修正、对手后手、阶段兑现。",
          "3. 不要把章节写成“发现问题—意识到危险—继续调查”的重复链条。",
          "4. 可以制造或利用信息差、误判、反常发现、表面胜利下的暗中代价，但不要把完整因果句塞进标题。",
          "5. 每章结尾应隐含新的问题、威胁、机会、误判或选择压力，使下一章有继续阅读的理由。",
          "6. 当前 beat 内不能所有章节都只做铺垫；必须有实际推进、局面变化或阶段兑现。",
          "",
          "六、标题要求",
          "1. 每章 title 必须像真实章名，优先体现事件锚点、地点、冲突、异常发现、局面变化、阶段兑现、关系异动或问题钩子。",
          "2. 标题默认使用客观表达，不使用“我 / 我的 / 我却 / 我用 / 替我 / 追杀我”等第一人称自述。",
          "3. 在开始写 chapters 之前，先在脑内完成一次“标题句法配比规划”，再按配比输出，不要边想边重复套模板。",
          "4. 同一批标题必须主动混用动作推进型、冲突压迫型、异常发现型、结果兑现型、决断转向型、问题钩子型、关系异动型等不同句法。",
          "5. 标题核心字数不超过 16 个，推荐 4-12 个字；不要写成长句、完整因果句或剧情梗概。",
          "6. 标题可以有反差，但要短促，例如“密令失真”“断魂钉现”“阵眼裂缝”；不要写成“某人做了某事，所以某结果发生”。",
          "7. 避免只有抽象词：风暴、暗流、危机、真相、抉择、变局等，除非标题里同时有具体对象、动作或反差。",
          "8. 若当前节奏段有 6 章及以上：任何单一表层骨架都不要超过一半；不能大量重复“X的Y / X中的Y / 在X中Y”这类骨架，最多只占约三成。",
          "9. 明确避免让大部分标题继续塌成“A，B / 四字动作，四字结果”并列模板。",
          "10. 相邻章节标题不要连续 3 章以上套用同一语法骨架。",
          "11. 标题要有推进感与可读性，避免空泛文学化、抽象抒情化、口号化或模板味过重。",
          "12. 主角主动性、选择和代价主要写在 summary 中，不要为了体现主角行动把标题写成第一人称爽点句。",
          "13. 生成前先自检一遍：是否出现第一人称标题、标题过长、过多“的字结构”、过多逗号并列结构、或连续多章同骨架；若出现，先改再输出。",
          "",
          "七、摘要要求",
          "1. 每章 summary 必须写清本章具体推进了什么，以及它在当前目标 beat 中承担什么作用。",
          "2. summary 必须体现新增信息、局面变化、冲突推进、关系变化、代价上升、风险转向或阶段兑现中的至少一种。",
          "3. summary 必须体现本章造成的不可逆变化：人物判断改变、资源状态改变、敌我关系改变、风险等级改变、计划方向改变或读者认知改变。",
          "4. 不要把 summary 写成空泛口号，也不要写成详细剧情复述。",
          "5. 相邻章节 summary 不能只是同义重复。",
          "6. 不要大量使用“进一步推动剧情”“局势更加复杂”“为后续埋下伏笔”等低信息密度表达。",
          "",
          "八、beat 承接要求",
          "1. 本次只覆盖当前目标 beat，不得为相邻 beats 生成章节。",
          "2. 开头章节要承接前序已生成章节状态，不能把已经发生的推进重新起一遍。",
          "3. 中段章节要围绕当前 beat 的核心矛盾持续加压、试探、转折或兑现。",
          isBookFinale
            ? "4. 全书终章必须完成结局合同，不再要求下一阶段牵引。"
            : "4. 结尾章节要把当前 beat 的 mustDeliver 落到位，但不要提前偷跑下一 beat 的核心兑现。",
          "",
          "九、质量自检要求",
          "1. 输出前在脑内检查：章节数量是否精确、beatKey 是否一致、是否越界、是否有重复功能章。",
          "2. 输出前在脑内检查：标题是否过度同构，summary 是否有真实推进，结尾章是否有阶段兑现或阅读牵引。",
          "3. 若发现章节只是换说法、无新增推进、无主角行动、无局面变化，必须先改再输出。",
          "",
          buildRetryDirective(promptInput.retryReason),
        ]
          .filter(Boolean)
          .join("\n"),
      ),

      new HumanMessage(
        [
          "请基于以下上下文，输出当前节奏段的章节块。",
          "",
          "输出要求：",
          "- 只输出严格 JSON",
          `- beatKey 必须严格等于 ${targetBeatKey}`,
          `- beatLabel 必须严格等于 ${targetBeatLabel}`,
          `- chapterCount 与 chapters.length 必须严格等于 ${targetChapterCount}`,
          "- 每章只能包含 title、summary、beatKey",
          "- 不得生成任何相邻 beat 的章节",
          "- 先在脑内规划章节功能分配与标题骨架配比，再输出完整章节块",
          "- 优先保证章节推进感、节奏承接、标题结构分散、摘要中的角色主动性与结尾牵引",
          "- 标题必须短促客观，不使用第一人称，不写成长句或剧情梗概",
          "",
          "当前卷拆章上下文：",
          renderSelectedContextBlocks(context),
        ].join("\n"),
      ),
    ],

    postValidate: (output) => {
      if (output.beatKey !== targetBeatKey) {
        throw new Error(`beatKey 必须严格等于 ${targetBeatKey}。`);
      }

      if (output.beatLabel !== targetBeatLabel) {
        throw new Error(`beatLabel 必须严格等于 ${targetBeatLabel}。`);
      }

      if (
        output.chapterCount !== targetChapterCount ||
        output.chapters.length !== targetChapterCount
      ) {
        throw new Error(
          `chapterCount 与 chapters.length 必须严格等于 ${targetChapterCount}。`,
        );
      }

      output.chapters.forEach((chapter, index) => {
        if (chapter.beatKey !== targetBeatKey) {
          throw new Error(
            `第 ${index + 1} 条章节的 beatKey 必须严格等于 ${targetBeatKey}。`,
          );
        }
      });

      const titleDiversityIssue = getChapterTitleDiversityIssue(
        output.chapters.map((chapter) => chapter.title),
      );

      if (titleDiversityIssue) {
        throw new Error(titleDiversityIssue);
      }

      const titleCollisionIssue = getChapterTitleCollisionIssue(
        reservedChapterTitles,
        output.chapters.map((chapter) => chapter.title),
      );

      if (titleCollisionIssue) {
        throw new Error(titleCollisionIssue);
      }

      const chapterFunctionQualityIssue = getChapterFunctionQualityIssue(
        output.chapters,
      );

      if (chapterFunctionQualityIssue) {
        throw new Error(chapterFunctionQualityIssue);
      }

      return output;
    },

    postValidateFailureRecovery: ({ rawOutput, validationError }) => {
      if (isBlockingChapterTitleQualityIssue(validationError) || isChapterTitleDuplicateIssue(validationError)) {
        throw new Error(validationError);
      }

      if (isChapterTitleDiversityIssue(validationError) || isChapterFunctionQualityIssue(validationError)) {
        return rawOutput;
      }

      throw new Error(validationError);
    },
  };
}

export { buildVolumeChapterListContextBlocks };
