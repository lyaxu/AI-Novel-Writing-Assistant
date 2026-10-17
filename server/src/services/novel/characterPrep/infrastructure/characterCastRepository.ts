import { prisma } from "../../../../db/prisma";
import type { CharacterCastOptionResponseParsed } from "../../../../prompting/prompts/novel/characterPreparation.promptSchemas";
import { serializeCharacterProhibitions } from "../../characters/characterHardFacts";
import { prepareCastForPersistence } from "../domain/characterCastCoverage";
function toOptionalText(value: string | null | undefined): string | null { return value?.trim() || null; }

export async function persistCharacterCastOptionsDraft(
  novelId: string,
  storyInput: string,
  parsed: CharacterCastOptionResponseParsed,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Keep prior candidates and completed batches; regeneration creates alternatives.
    for (const option of parsed.options) {
      const prepared = prepareCastForPersistence(option);
      await tx.characterCastOption.create({
        data: {
          novelId,
          coveragePlanJson: prepared.coveragePlan ? JSON.stringify(prepared.coveragePlan) : null,
          title: option.title,
          summary: option.summary,
          whyItWorks: toOptionalText(option.whyItWorks),
          recommendedReason: toOptionalText(option.recommendedReason),
          sourceStoryInput: toOptionalText(storyInput),
          members: {
            create: prepared.members.map((member, index) => ({
              sortOrder: index,
              identityKey: member.identityKey,
              name: member.name,
              role: member.role,
              gender: member.gender,
              castRole: member.castRole,
              relationToProtagonist: toOptionalText(member.relationToProtagonist),
              storyFunction: member.storyFunction,
              shortDescription: toOptionalText(member.shortDescription),
              personality: toOptionalText(member.personality),
              background: toOptionalText(member.background),
              development: toOptionalText(member.development),
              identityLabel: toOptionalText(member.identityLabel),
              factionLabel: toOptionalText(member.factionLabel),
              stanceLabel: toOptionalText(member.stanceLabel),
              powerLevel: toOptionalText(member.powerLevel),
              realm: toOptionalText(member.realm),
              currentLocation: toOptionalText(member.currentLocation),
              availability: toOptionalText(member.availability),
              prohibitionsJson: serializeCharacterProhibitions(member.prohibitions),
              outerGoal: toOptionalText(member.outerGoal),
              innerNeed: toOptionalText(member.innerNeed),
              fear: toOptionalText(member.fear),
              wound: toOptionalText(member.wound),
              misbelief: toOptionalText(member.misbelief),
              secret: toOptionalText(member.secret),
              moralLine: toOptionalText(member.moralLine),
              firstImpression: toOptionalText(member.firstImpression),
            })),
          },
          relations: {
            create: option.relations.map((relation, index) => ({
              sortOrder: index,
              sourceIdentityKey: prepared.members.find((member) => member.name === relation.sourceName)?.identityKey,
              targetIdentityKey: prepared.members.find((member) => member.name === relation.targetName)?.identityKey,
              sourceName: relation.sourceName,
              targetName: relation.targetName,
              surfaceRelation: relation.surfaceRelation,
              hiddenTension: toOptionalText(relation.hiddenTension),
              conflictSource: toOptionalText(relation.conflictSource),
              secretAsymmetry: toOptionalText(relation.secretAsymmetry),
              dynamicLabel: toOptionalText(relation.dynamicLabel),
              nextTurnPoint: toOptionalText(relation.nextTurnPoint),
            })),
          },
        },
      });
    }
  });
}
