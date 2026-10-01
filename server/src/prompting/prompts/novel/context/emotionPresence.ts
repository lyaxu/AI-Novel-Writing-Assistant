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
