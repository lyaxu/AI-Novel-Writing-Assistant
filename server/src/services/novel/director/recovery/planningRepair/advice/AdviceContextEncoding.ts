type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export class AdviceContextCapacityError extends Error {}

/** Exact JSON equality only. Source definitions form a DAG, never semantic summaries. */
export function encodeAdviceContext(input: unknown) {
  const original = JSON.stringify(input);
  const value = JSON.parse(original) as Json;
  const counts = new Map<string, number>();
  const keys = new Set<string>();
  const visit = (node: Json) => {
    const serialized = JSON.stringify(node);
    if (serialized.length >= 256) counts.set(serialized, (counts.get(serialized) ?? 0) + 1);
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.entries(node).forEach(([key, child]) => { keys.add(key); visit(child); });
  };
  visit(value);
  let referenceKey = "$adviceSourceRef";
  while (keys.has(referenceKey)) referenceKey += "_";
  const sources: Record<string, Json> = {};
  const ids = new Map<string, string>();
  let references = 0;
  const children = (node: Json): Json => Array.isArray(node) ? node.map(encode)
    : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).map(([key, child]) => [key, encode(child)])) : node;
  const encode = (node: Json): Json => {
    const serialized = JSON.stringify(node);
    if ((counts.get(serialized) ?? 0) < 2) return children(node);
    let id = ids.get(serialized);
    if (!id) {
      id = `source_${ids.size + 1}`;
      ids.set(serialized, id);
      sources[id] = children(node);
    }
    references++;
    return { [referenceKey]: id };
  };
  // Keep the sole current candidate readable in place, even when identical to another
  // version. Deduplication remains exact and lossless for all other source material.
  const plainKeys = new Set(["candidateAuthority", "candidateWindow", "candidateEvidencePaths"]);
  const context = value && !Array.isArray(value) && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainKeys.has(key) ? child : encode(child)]))
    : encode(value);
  const encoded = {
    encoding: "exact_source_references_v1", referenceKey, context, sources,
    coverage: { lossless: true, omittedTextCount: 0, sourceCount: ids.size, referenceCount: references,
      note: "完全相同的原文或结构仅保存一次。遇到仅含 referenceKey 字段的对象，按字段值查 sources，并递归读取其完整原文；引用不是缺失或摘要。原始字段路径以 context 为根展开引用后读取，来源权限及候选/基线身份由引用所在位置决定。" },
  };
  const compact = JSON.stringify(encoded);
  // A tiny or unique context should not pay for an unnecessary envelope.
  return compact.length < original.length ? compact : original;
}

/**
 * Guard against a runaway payload, not a model limit.
 *
 * Raised from 160000 after a real run needed 197336: the guidance is not to shrink the planning
 * material to save tokens, so the ceiling moves instead of the content. Kept in step with the
 * advice prompts' 96000-token context budget (tokens are estimated as length / 4, so 96000 tokens
 * is 384000 characters): if this guard were lower than the token budget, it would stop calls that
 * the prompt could actually have taken, and if it were much higher the broker would silently drop
 * context blocks instead.
 */
export const ADVICE_CONTEXT_MAX_CHARS = 400_000;

export function prepareAdviceContext(input: unknown): string {
  const contextJson = encodeAdviceContext(input);
  if (contextJson.length > ADVICE_CONTEXT_MAX_CHARS) {
    // State the actual size. Without it the message says only "too large", which cannot be acted on:
    // the earlier incident of this kind needed the real number before anyone could tell whether the
    // payload was genuinely big or the encoding was duplicating text.
    throw new AdviceContextCapacityError(
      `相关规划与审查资料超出单次建议容量（本次 ${contextJson.length} 字符，上限 ${ADVICE_CONTEXT_MAX_CHARS}），本次未调用模型。`
      + "请保持暂停，可将此运行记录交给支持人员检查。已有内容与修复轮次保留。",
    );
  }
  return contextJson;
}
