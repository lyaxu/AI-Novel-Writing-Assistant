/**
 * One display convention for "字数" across reading, chapter queue and execution panels.
 *
 * Reading mode counts CJK characters plus Latin/number words, excluding punctuation and
 * whitespace. Displaying raw UTF-16 content length elsewhere made the same chapter look
 * hundreds of characters longer in the execution queue than in the reader.
 */
export function countChapterDisplayWords(content: string | null | undefined): number {
  const text = content?.trim() ?? "";
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const words = text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}

export function formatDisplayWordCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
