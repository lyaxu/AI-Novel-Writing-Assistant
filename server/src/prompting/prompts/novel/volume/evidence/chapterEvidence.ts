export interface EvidenceQuote { sourcePath: string; quote: string }
type Node = Record<string, unknown>;
const normalize = (text: string) => text.replace(/\s+/g, "");

export function buildChapterEvidenceIndex(candidate: unknown) {
  const leaves = new Map<string, string>();
  const groups = new Map<string, string[]>();
  const prerequisites = new Map<string, Node[]>();
  const aliases = new Map<string, string>();
  // A JSON string field is parsed so its children can be cited as leaves. The parsed-field
  // membership is kept separately so a citation against the field container itself still proves
  // that the quote belongs to that field, without accepting unrelated text from elsewhere.
  const containerLeaves = new Map<string, string[]>();
  // Serialized source of parsed JSON containers. A review may cite a fragment of that exact
  // serialization (for example a property name plus an evidence id); it is still candidate text.
  const containerText = new Map<string, string>();
  const aliasSubtree = (canonical: string, alias: string) => {
    for (const leaf of leaves.keys()) {
      if (leaf !== canonical && !leaf.startsWith(`${canonical}.`) && !leaf.startsWith(`${canonical}[`)) continue;
      const sourcePath = alias + leaf.slice(canonical.length);
      if (aliases.has(sourcePath) && aliases.get(sourcePath) !== leaf) throw new Error(`Ambiguous evidence source path: ${sourcePath}`);
      aliases.set(sourcePath, leaf);
    }
  };
  const add = (path: string, value: unknown): void => {
    if (typeof value === "number" || typeof value === "boolean") {
      // A structured review may legitimately cite a numeric capacity/limit field. Expose its exact
      // serialized value as a leaf; this is not a field-name allowance or topic heuristic.
      leaves.set(path, String(value));
    } else if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === "object") { containerText.set(path, value); add(path, parsed); return; }
      } catch { /* An ordinary text leaf. */ }
      // The chapter object and its parsed sceneCards share one root namespace, so a field that
      // exists in both reaches the same path twice — `requiredElements` is one, because it is part
      // of the chapter contract and also carried inside the scene plan.
      //
      // Identical text at the same path is not ambiguous: the path still resolves to exactly one
      // value, which is all evidence matching needs. Differing text is genuinely ambiguous and
      // still throws, because that is the case this guard exists for.
      const existing = leaves.get(path);
      if (existing !== undefined && existing !== value) throw new Error(`Ambiguous evidence source path: ${path}`);
      leaves.set(path, value);
    } else if (Array.isArray(value)) {
      groups.set(path, []);
      value.forEach((item, index) => {
        const before = new Set(leaves.keys());
        add(`${path}[${index}]`, item);
        groups.get(path)!.push(...[...leaves.keys()].filter((key) => !before.has(key)));
      });
    } else if (value && typeof value === "object") {
      const before = new Set(leaves.keys());
      Object.entries(value).forEach(([key, child]) => add(path ? `${path}.${key}` : key, child));
      containerLeaves.set(path, [...leaves.keys()].filter((key) => !before.has(key)));
    }
  };
  const root = candidate && typeof candidate === "object" ? candidate as Node : {};
  for (const [key, value] of Object.entries(root)) if (key !== "sceneCards") add(key, value);
  let cards = root.sceneCards;
  if (typeof cards === "string") {
    const serialized = cards;
    try { cards = JSON.parse(cards); containerText.set("sceneCards", serialized); } catch { add("sceneCards", cards); }
  }
  if (cards && typeof cards === "object") {
    const before = new Set(leaves.keys());
    const object = cards as Node;
    for (const [key, value] of Object.entries(object)) if (key !== "scenes") add(key, value);
    if (Array.isArray(object.scenes)) for (const [position, item] of object.scenes.entries()) {
      const scene = item as Node;
      const scenePath = typeof scene.key === "string" && scene.key.trim() ? scene.key : `scenes[${position}]`;
      for (const [key, value] of Object.entries(scene)) {
        if (key === "causality" && value && typeof value === "object") {
          for (const [field, child] of Object.entries(value)) {
            add(`${scenePath}.${field}`, child);
            // Both the scene-key projection and the actual scene-card tree name the same leaf.
            aliasSubtree(`${scenePath}.${field}`, `${scenePath}.causality.${field}`);
            aliasSubtree(`${scenePath}.${field}`, `sceneCards.scenes[${position}].causality.${field}`);
            if (field === "prerequisites" && Array.isArray(child)) prerequisites.set(`${scenePath}.${field}`, child as Node[]);
          }
        } else if (key !== "key") {
          add(`${scenePath}.${key}`, value);
          aliasSubtree(`${scenePath}.${key}`, `sceneCards.scenes[${position}].${key}`);
        }
      }
    }
    containerLeaves.set("sceneCards", [...leaves.keys()].filter((key) => !before.has(key)));
  }
  for (const [alias, canonical] of aliases) {
    if (leaves.has(alias) && alias !== canonical) throw new Error(`Ambiguous evidence source path: ${alias}`);
  }
  return { leaves, groups, prerequisites, aliases, containerLeaves, containerText };
}

/** Bounded local diagnostics: where the quote actually lives inside this source, never a guess. */
export function findChapterEvidencePaths(index: ReturnType<typeof buildChapterEvidenceIndex>, quote: string, limit = 3): string[] {
  const normalized = normalize(quote);
  if (!normalized || !Number.isSafeInteger(limit) || limit < 1) return [];
  const found: string[] = [];
  for (const [path, text] of index.leaves) {
    if (!normalize(text).includes(normalized)) continue;
    found.push(path);
    if (found.length >= limit) break;
  }
  return found;
}

function evidenceQuoteVariants(quote: string): string[] {
  const normalized = normalize(quote);
  if (!normalized) return [];
  // Models sometimes add a quotation mark when they start mid-sentence (or preserve the
  // closing quote), so the cited fragment is one character longer than the real prose.
  // Strip only quote wrappers; do not strip arbitrary punctuation or paraphrase text.
  const unwrapped = normalized.replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, "");
  return unwrapped && unwrapped !== normalized ? [normalized, unwrapped] : [normalized];
}

export function matchesChapterEvidence(index: ReturnType<typeof buildChapterEvidenceIndex>, evidence: string | EvidenceQuote): boolean {
  const exactAt = (path: string, quote: string) => {
    const text = index.leaves.get(index.aliases.get(path) ?? path);
    return text !== undefined && evidenceQuoteVariants(quote).some((variant) => normalize(text).includes(variant));
  };
  // A parsed JSON field may be cited as its own container (for example "sceneCards"). The quote
  // must still appear inside that field, so an imprecise-but-correct field name cannot smuggle
  // in unrelated text, while a merely coarse path no longer discards an otherwise valid answer.
  const containerAt = (path: string, quote: string) => {
    const variants = evidenceQuoteVariants(quote);
    const members = index.containerLeaves.get(path);
    if (!variants.length || !members) return false;
    // A fragment of the parsed field's own serialization is still inside this container.
    const serialized = index.containerText.get(path);
    if (serialized !== undefined && variants.some((variant) => normalize(serialized).includes(variant))) return true;
    return members.some((member) => {
      const text = index.leaves.get(member);
      return text !== undefined && variants.some((variant) => normalize(text).includes(variant));
    });
  };
  if (typeof evidence !== "string") {
    return exactAt(evidence.sourcePath, evidence.quote) || containerAt(evidence.sourcePath, evidence.quote);
  }
  if (!normalize(evidence)) return false;
  // Historical bare quotes remain valid. Structured fresh output always specifies its leaf path.
  if ([...index.leaves.values()].some((text) => normalize(text).includes(normalize(evidence)))) return true;
  // Prefixes must name a real field; no arbitrary colon stripping or punctuation removal.
  for (const path of [...index.leaves.keys(), ...index.groups.keys()]) {
    for (const separator of ["：", ":"]) {
      if (!evidence.startsWith(path + separator)) continue;
      const quote = evidence.slice(path.length + separator.length).trim();
      if (exactAt(path, quote) || (index.groups.get(path) ?? []).some((leaf) => exactAt(leaf, quote))) return true;
      // A legacy prerequisite citation may serialize three fields of ONE actual prerequisite.
      // Construct that serialization from the source; never split a quote and search pieces globally.
      return (index.prerequisites.get(path) ?? []).some((item) =>
        typeof item.condition === "string" && typeof item.sourceKind === "string" && typeof item.reference === "string"
        && normalize(quote) === normalize(`${item.condition}，sourceKind=${item.sourceKind}，reference=${item.reference}`));
    }
  }
  return false;
}
