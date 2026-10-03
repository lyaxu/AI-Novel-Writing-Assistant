/** Shared typography contract for chapter prose.
 *
 * Web-novel readability depends on paragraph rhythm as much as on wording: a wall of text is the
 * most common "looks AI-written / exhausting to read" symptom, and mixed dialogue attribution is
 * the most common source of reader confusion. These rules are deterministic and genre-neutral —
 * they say nothing about style, only about how the text is laid out on the page.
 *
 * Deliberately NOT here: any rule that bans emotion words, forbids short paragraphs outright, or
 * fixes a per-chapter shape. A quiet scene may legitimately be one long paragraph; a tense one may
 * be all fragments.
 */
export const CHAPTER_TYPOGRAPHY_RULES = [
  "段落之间空一行。不要把整段叙述写成一个不分行的长块。",
  "普通叙述段控制在 40-120 个汉字之间。明显长于这个区间的段落要按意思拆开，而不是靠删字硬压。",
  "单段不得超过 160 个汉字。超过就必须拆段，宁可在对话或动作处断开。",
  "说话人一换就必须换段：每一句对白独立成段，对白与它前后的叙述也各自成段。同一段里不要混进两个人的话。",
  "对话密集的段落里，用动作、停顿或称呼变化标清是谁在说，不要让读者数引号猜测说话人。",
];

/** Audit-side phrasing of the same contract, for the acceptance and repair prompts. */
export const CHAPTER_TYPOGRAPHY_AUDIT_RULES = [
  "检查排版：是否存在超过 160 汉字的未拆分长段、多段叙述挤在一个不分行的长块、或对话与叙述混排。证据要指出具体段落。",
  "检查说话人归属：同一段是否混入了两个人的对白，或出现读者无法判断谁在说话的连续对白。引用该段原文。",
  "排版问题属于可局部修复的正文质量问题：给出具体段落与拆分位置即可，不因排版问题升级为全局重写或停止。",
  "不要因段落偏短、场景安静或对白稀少而判罚；判断依据是版式是否让读者吃力，不是段落数量或长度分布是否整齐。",
];
