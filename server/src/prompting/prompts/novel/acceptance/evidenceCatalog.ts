import { createHash } from "node:crypto";

export interface EvidenceCatalogInput {
  chapterId?: string;
  chapterOrder: number;
  content: string;
  establishedProse?: Array<{ chapterId: string; order: number; content: string }>;
}

export interface EvidenceCatalogEntry {
  id: string;
  source: "current_prose" | "established_context";
  sourceId: string;
  quote: string;
  /** UTF-16 offsets in the unmodified source; end is exclusive. */
  start: number;
  end: number;
}

export interface EvidenceCatalog {
  snapshotId: string;
  entries: EvidenceCatalogEntry[];
  byId: Map<string, EvidenceCatalogEntry>;
  rendered: string;
}

type CatalogSource = Pick<EvidenceCatalogEntry, "source" | "sourceId"> & {
  order: number;
  content: string;
};

const MAX_QUOTE_LENGTH = 180;
const SENTENCE_END = new Set(["。", "！", "？", ".", "!", "?", "；", ";", "\r", "\n"]);
const SENTENCE_CLOSER = new Set(["。", "！", "？", ".", "!", "?", "；", ";", "”", "’", '"', "'", "」", "』", "）", ")", "】", "]", "\r", "\n"]);

/** Reject ambiguous chapter identities instead of silently selecting one manuscript. */
function catalogSources(input: EvidenceCatalogInput): CatalogSource[] {
  if (!Number.isSafeInteger(input.chapterOrder) || typeof input.content !== "string") {
    throw new Error("证据目录需要有效的章节序号与完整正文。");
  }
  const currentId = input.chapterId ?? "current";
  if (!currentId) throw new Error("证据目录的当前章节编号不能为空。");
  const candidates = new Map<string, { chapterId: string; order: number; content: string }>();
  const conflicted = new Set<string>();
  for (const chapter of input.establishedProse ?? []) {
    if (!chapter.chapterId || chapter.chapterId === currentId) continue;
    const previous = candidates.get(chapter.chapterId);
    if (previous && (previous.order !== chapter.order || previous.content !== chapter.content)) {
      conflicted.add(chapter.chapterId);
    }
    candidates.set(chapter.chapterId, chapter);
  }
  const previous = [...candidates.values()]
    .filter((chapter) => !conflicted.has(chapter.chapterId)
      && Number.isSafeInteger(chapter.order) && chapter.order < input.chapterOrder
      && typeof chapter.content === "string")
    .sort((a, b) => a.order - b.order || (a.chapterId < b.chapterId ? -1 : a.chapterId > b.chapterId ? 1 : 0));
  return [
    { source: "current_prose", sourceId: currentId, order: input.chapterOrder, content: input.content },
    ...previous.map((chapter): CatalogSource => ({
      source: "established_context", sourceId: chapter.chapterId, order: chapter.order, content: chapter.content,
    })),
  ];
}

/** Segment punctuation mechanically; never normalize, omit text or infer story semantics. */
function slices(content: string): Array<{ quote: string; start: number; end: number }> {
  const result: Array<{ quote: string; start: number; end: number }> = [];
  let start = 0;
  while (start < content.length) {
    let limit = Math.min(start + MAX_QUOTE_LENGTH, content.length);
    // A length cap cannot divide a valid surrogate pair.
    if (limit < content.length && /[\uD800-\uDBFF]/u.test(content[limit - 1])
      && /[\uDC00-\uDFFF]/u.test(content[limit])) limit--;
    let end = limit;
    for (let index = start; index < limit; index++) {
      if (!SENTENCE_END.has(content[index])) continue;
      end = index + 1;
      while (end < limit && SENTENCE_CLOSER.has(content[end])) end++;
      break;
    }
    const previous = result.at(-1);
    const quote = content.slice(start, end);
    if (!quote.trim() && previous && end - previous.start <= MAX_QUOTE_LENGTH) {
      previous.quote += quote;
      previous.end = end;
    } else {
      result.push({ quote, start, end });
    }
    start = end;
  }
  return result;
}

/** Build snapshot-scoped reference IDs from exact, ordered manuscript sources. */
export function buildEvidenceCatalog(input: EvidenceCatalogInput): EvidenceCatalog {
  const sources = catalogSources(input);
  const snapshotId = createHash("sha256").update(JSON.stringify({ version: 1, sources })).digest("hex");
  const entries: EvidenceCatalogEntry[] = [];
  const renderedParts: string[] = [];
  for (const source of sources) {
    renderedParts.push(`来源 source=${source.source} sourceId=${JSON.stringify(source.sourceId)} chapterOrder=${source.order}`);
    for (const slice of slices(source.content)) {
      // Whitespace is preserved in the rendering but cannot support a review finding.
      if (!slice.quote.trim()) {
        renderedParts.push(slice.quote);
        continue;
      }
      const entry: EvidenceCatalogEntry = {
        id: `ev_${snapshotId.slice(0, 12)}_${entries.length + 1}`,
        source: source.source, sourceId: source.sourceId, ...slice,
      };
      entries.push(entry);
      renderedParts.push(`[${entry.id}] ${entry.quote}`);
    }
  }
  const rendered = renderedParts.join("\n");
  return { snapshotId, entries, byId: new Map(entries.map((entry) => [entry.id, entry])), rendered };
}

/** Resolve only an ID from this snapshot, supplying canonical prose rather than model copies. */
export function resolveEvidenceReference(catalog: EvidenceCatalog, reference: { evidenceId: string }) {
  const entry = catalog.byId.get(reference.evidenceId);
  if (!entry) {
    throw new Error(`证据编号 ${JSON.stringify(reference.evidenceId)} 不属于本次正文证据目录。请从本次目录选择原有 evidenceId；不要自编编号或沿用其他正文版本的编号。`);
  }
  return {
    source: entry.source, sourceId: entry.sourceId, quote: entry.quote,
    evidenceId: entry.id, evidenceSnapshotId: catalog.snapshotId, start: entry.start, end: entry.end,
  };
}
