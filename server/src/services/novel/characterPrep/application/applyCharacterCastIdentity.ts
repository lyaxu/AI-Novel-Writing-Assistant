import { prisma } from "../../../../db/prisma";
import { readCastAliases } from "./renameCharacterCastMember";
import { attachCharacterIdentityAliases, buildCharacterIdentityIndex } from "../../characters/identity";

/** Persist the character and its candidate binding in one transaction, so retries cannot create a second person. */
export async function applyCharacterCastIdentity(novelId: string, optionId: string, expectedUpdatedAt: Date) {
  return prisma.$transaction(async (tx) => {
    const option = await tx.characterCastOption.findFirst({ where: { id: optionId, novelId },
      include: { members: { orderBy: { sortOrder: "asc" } }, relations: true } });
    if (!option || option.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new Error("人物方案有新的修改，请刷新并确认后再应用。");
    }
    const locked = await tx.characterCastOption.updateMany({ where: { id: optionId, novelId, updatedAt: expectedUpdatedAt },
      data: { updatedAt: new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1)) } });
    if (locked.count !== 1) throw new Error("人物方案有新的修改，请刷新并确认后再应用。");
    const existing = await attachCharacterIdentityAliases(tx, novelId, await tx.character.findMany({ where: { novelId } }));
    const hadExistingCharacters = existing.length > 0;
    const byIdentity = new Map<string, string>();
    const nameBindings: Array<{ id: string; name: string; aliases: string[] }> = [];
    const characterIds: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    for (const member of option.members) {
      const identityKey = member.identityKey || member.id;
      const existingIndex = buildCharacterIdentityIndex(existing);
      if (!member.appliedCharacterId && existingIndex.isAmbiguous(member.name)) {
        throw new Error(`角色库有多个“${member.name}”称呼，请先在角色资产中核对身份。`);
      }
      const matches = member.appliedCharacterId
        ? existing.filter((item) => item.id === member.appliedCharacterId)
        : [existingIndex.resolve(member.name)].filter((item): item is typeof existing[number] => Boolean(item));
      if (matches.length > 1) throw new Error(`角色库有多个“${member.name}”，请先在角色资产中核对身份。`);
      if (member.appliedCharacterId && !matches.length) throw new Error(`“${member.name}”关联的角色资产不存在，请核对后再应用。`);
      if (!member.appliedCharacterId && !member.identityKey && hadExistingCharacters && !matches.length) {
        throw new Error(`“${member.name}”的旧方案缺少身份关联，请先在角色资产核对，避免重复建人。`);
      }
      const matched = matches[0];
      if (matched && characterIds.includes(matched.id)) throw new Error("这套方案中有多位候选指向同一角色，请核对人物身份后再应用。");
      let character = matched;
      if (!matched) {
        const created = await tx.character.create({ data: {
          novelId, name: member.name, role: member.role, gender: member.gender, castRole: member.castRole,
          storyFunction: member.storyFunction, relationToProtagonist: member.relationToProtagonist,
          personality: member.personality, background: member.background, development: member.development,
          identityLabel: member.identityLabel, factionLabel: member.factionLabel, stanceLabel: member.stanceLabel,
          powerLevel: member.powerLevel, realm: member.realm, currentLocation: member.currentLocation,
          availability: member.availability, prohibitionsJson: member.prohibitionsJson,
          outerGoal: member.outerGoal, innerNeed: member.innerNeed, fear: member.fear, wound: member.wound,
          misbelief: member.misbelief, secret: member.secret, moralLine: member.moralLine,
          firstImpression: member.firstImpression, currentGoal: member.outerGoal, currentState: "等待进入正文",
        } });
        character = { ...created, aliases: [] };
        existing.push(character);
        createdCount += 1;
      } else {
        // Existing asset names and authored details win over every older candidate, even after an asset rename.
        const fields = ["personality", "background", "development", "identityLabel", "factionLabel", "stanceLabel",
          "powerLevel", "realm", "currentLocation", "availability", "storyFunction", "relationToProtagonist",
          "outerGoal", "innerNeed", "fear", "wound", "misbelief", "secret", "moralLine", "firstImpression"] as const;
        const fill = Object.fromEntries(fields.filter((key) => !matched[key]?.trim() && member[key]?.trim())
          .map((key) => [key, member[key]]));
        if (Object.keys(fill).length) {
          character = { ...await tx.character.update({ where: { id: matched.id }, data: fill }), aliases: matched.aliases };
          updatedCount += 1;
        }
      }
      characterIds.push(character.id);
      byIdentity.set(identityKey, character.id);
      nameBindings.push({ id: character.id, name: character.name, aliases: [member.name, ...readCastAliases(member.aliasesJson)] });
      await tx.characterCastOptionMember.update({ where: { id: member.id },
        data: { identityKey, appliedCharacterId: character.id } });
    }
    let relationCount = 0;
    const names = buildCharacterIdentityIndex(nameBindings);
    const seen = new Set<string>();
    for (const relation of option.relations) {
      if ((!relation.sourceIdentityKey && names.isAmbiguous(relation.sourceName))
        || (!relation.targetIdentityKey && names.isAmbiguous(relation.targetName))) {
        throw new Error("人物关系中的称呼对应多位角色，请核对人物身份后再应用。");
      }
      const sourceCharacterId = relation.sourceIdentityKey ? byIdentity.get(relation.sourceIdentityKey) : names.resolve(relation.sourceName)?.id;
      const targetCharacterId = relation.targetIdentityKey ? byIdentity.get(relation.targetIdentityKey) : names.resolve(relation.targetName)?.id;
      if (!sourceCharacterId || !targetCharacterId || sourceCharacterId === targetCharacterId) continue;
      const key = `${sourceCharacterId}:${targetCharacterId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.characterRelation.upsert({ where: { novelId_sourceCharacterId_targetCharacterId: { novelId, sourceCharacterId, targetCharacterId } },
        create: { novelId, sourceCharacterId, targetCharacterId, surfaceRelation: relation.surfaceRelation,
          hiddenTension: relation.hiddenTension, conflictSource: relation.conflictSource, secretAsymmetry: relation.secretAsymmetry,
          dynamicLabel: relation.dynamicLabel, nextTurnPoint: relation.nextTurnPoint },
        update: {}, // Runtime relationship history belongs to the character workspace, not the old cast draft.
      });
      relationCount += 1;
    }
    await tx.characterCastOption.updateMany({ where: { novelId, status: "applied", id: { not: option.id } }, data: { status: "draft" } });
    await tx.characterCastOption.update({ where: { id: option.id }, data: { status: "applied" } });
    return { optionId, createdCount, updatedCount, relationCount, characterIds: [...new Set(characterIds)], primaryCharacterId: characterIds[0] ?? null };
  });
}
