import type { Prisma } from "@prisma/client";
import type { CharacterIdentityRecord } from "./CharacterIdentityIndex";

export async function attachCharacterIdentityAliases<T extends CharacterIdentityRecord>(
  db: Pick<Prisma.TransactionClient, "characterCastOptionMember">, novelId: string, characters: T[],
): Promise<Array<T & { aliases: string[] }>> {
  if (!characters.length) return [];
  const bindings = await db.characterCastOptionMember.findMany({
    where: { option: { novelId }, appliedCharacterId: { in: characters.map((item) => item.id) } },
    select: { appliedCharacterId: true, name: true, aliasesJson: true },
  });
  const names = new Map<string, Set<string>>();
  for (const binding of bindings) {
    if (!binding.appliedCharacterId) continue;
    const aliases = names.get(binding.appliedCharacterId) ?? new Set<string>();
    aliases.add(binding.name);
    try {
      const parsed: unknown = JSON.parse(binding.aliasesJson || "[]");
      if (Array.isArray(parsed)) for (const alias of parsed) if (typeof alias === "string" && alias.trim()) aliases.add(alias);
    } catch { /* A malformed legacy alias list cannot authorize an identity match. */ }
    names.set(binding.appliedCharacterId, aliases);
  }
  return characters.map((character) => ({ ...character,
    aliases: [...new Set([...(character.aliases ?? []), ...(names.get(character.id) ?? [])])].filter((name) => name !== character.name) }));
}
