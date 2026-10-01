/** Q11 — Minimum emotion implementation.
 *
 * Emotion must shape HOW a character acts, speaks, and chooses — not appear as
 * decoration ("他心中一紧") or as a separate summary paragraph. These rules are
 * genre-neutral: they describe causal structure, not emotional flavour.
 *
 * Shared across the writer and acceptance/repair prompts so the same contract
 * applies to both generation and post-hoc review.
 */
export const CHAPTER_EMOTION_RULES = [
  "情绪是行动与选择的驱动力，不是装饰标签。写到人物情绪时，必须在同一段落内呈现它如何改变了说话方式（措辞、语气、停顿）、动作选择（加速或抑制行动）或判断（接受/拒绝/误判信息）。仅写'他心里一紧'或'她感到担忧'而后继续另一件事，不构成情绪落地。",
  "每个出场人物所处的处境压力（时限、代价、身体状态、信息缺口）须在其说话或行动中有可见痕迹。不要用旁白总结压力，而要让压力通过人物行为让读者感受到。",
  "情绪在本章不需要被解决或明确命名：悬而未决的恐惧、压抑的愤怒、未说出口的期待，都可以只体现在行为选择上，不必旁白说明。",
  "不要为情绪单独开段并堆砌同义词（'愤怒、焦虑、迷茫、痛苦'并列）。情绪的厚度来自细节和后果，不来自词汇密度。",
];

/** Audit rules for acceptance/review prompts.
 *
 * Same semantic contract as CHAPTER_EMOTION_RULES, but phrased to guide
 * assessment rather than generation. Used in chapterAcceptance and repair
 * prompts so reviewers apply the same standard as writers.
 */
export const CHAPTER_EMOTION_AUDIT_RULES = [
  "审查情绪落地：每处情绪标签（'他紧张''她愤怒''内心一凛'）之后，正文是否有该情绪改变说话方式、动作选择或判断的具体呈现？仅有标签而无行为后果的，计为情绪悬空，属 voice 类缺陷。",
  "审查处境压力可见性：每个关键出场人物的处境压力（时限、代价、身体状态、信息缺口）是否通过其言语或行动体现？若压力只出现在旁白总结而不影响行为，指出具体段落。",
  "不要因情绪未被命名或未被解决而判罚：克制、嘴硬、矛盾的情绪表达可以通过行为让读者感受，不要求旁白明说。判断标准是情绪是否影响了选择与行动，不是是否有情绪词。",
  "不把情绪词密度当质量指标：同义情绪词堆砌（'愤怒、焦虑、迷茫、痛苦'并列）是退化迹象，但稀少的情绪词不是问题；问题在于情绪与行为之间的因果链是否成立。",
];

