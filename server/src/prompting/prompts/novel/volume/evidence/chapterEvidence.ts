export interface EvidenceQuote { sourcePath: string; quote: string }
type Node = Record<string, unknown>;
const normalize = (text: string) => text.replace(/\s+/g, "");

export function buildChapterEvidenceIndex(candidate: unknown) {
  const leaves = new Map<string, string>();
  const groups = new Map<string, string[]>();
  const prerequisites = new Map<string, Node[]>();
  const add = (path: string, value: unknown): void => {
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === "object") { add(path, parsed); return; }
      } catch { /* An ordinary text leaf. */ }
      if (leaves.has(path)) throw new Error(`Ambiguous evidence source path: ${path}`);
      leaves.set(path, value);
    } else if (Array.isArray(value)) {
      groups.set(path, []);
      value.forEach((item, index) => {
        const before = new Set(leaves.keys());
        add(`${path}[${index}]`, item);
        groups.get(path)!.push(...[...leaves.keys()].filter((key) => !before.has(key)));
      });
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => add(path ? `${path}.${key}` : key, child));
    }
  };
  const root = candidate && typeof candidate === "object" ? candidate as Node : {};
  for (const [key, value] of Object.entries(root)) if (key !== "sceneCards") add(key, value);
  let cards = root.sceneCards;
  if (typeof cards === "string") { try { cards = JSON.parse(cards); } catch { add("sceneCards", cards); } }
  if (cards && typeof cards === "object") {
    const object = cards as Node;
    for (const [key, value] of Object.entries(object)) if (key !== "scenes") add(key, value);
    if (Array.isArray(object.scenes)) for (const [position, item] of object.scenes.entries()) {
      const scene = item as Node;
      const scenePath = typeof scene.key === "string" && scene.key.trim() ? scene.key : `scenes[${position}]`;
      for (const [key, value] of Object.entries(scene)) {
        if (key === "causality" && value && typeof value === "object") {
          for (const [field, child] of Object.entries(value)) {
            add(`${scenePath}.${field}`, child);
            if (field === "prerequisites" && Array.isArray(child)) prerequisites.set(`${scenePath}.${field}`, child as Node[]);
          }
        } else if (key !== "key") add(`${scenePath}.${key}`, value);
      }
    }
  }
  return { leaves, groups, prerequisites };
}

export function matchesChapterEvidence(index: ReturnType<typeof buildChapterEvidenceIndex>, evidence: string | EvidenceQuote): boolean {
  const exactAt = (path: string, quote: string) => {
    const text = index.leaves.get(path);
    return Boolean(normalize(quote) && text !== undefined && normalize(text).includes(normalize(quote)));
  };
  if (typeof evidence !== "string") return exactAt(evidence.sourcePath, evidence.quote);
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
