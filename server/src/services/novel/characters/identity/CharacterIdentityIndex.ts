export interface CharacterIdentityRecord { id: string; name: string; aliases?: string[] }

export function normalizeCharacterIdentityName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

/** Exact names and explicitly persisted aliases only; ambiguity never chooses a person. */
export function buildCharacterIdentityIndex<T extends CharacterIdentityRecord>(characters: T[]) {
  const groups = new Map<string, Map<string, T>>();
  for (const character of characters) {
    for (const name of [character.name, ...(character.aliases ?? [])]) {
      const key = normalizeCharacterIdentityName(name);
      if (!key) continue;
      const group = groups.get(key) ?? new Map<string, T>();
      group.set(character.id, character); groups.set(key, group);
    }
  }
  const unique = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const [key, group] of groups) {
    if (group.size === 1) unique.set(key, group.values().next().value!);
    else ambiguous.add(key);
  }
  return { unique, ambiguous, resolve: (name: string | null | undefined) => unique.get(normalizeCharacterIdentityName(name)) ?? null,
    isAmbiguous: (name: string | null | undefined) => ambiguous.has(normalizeCharacterIdentityName(name)) };
}
