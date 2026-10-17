import { applyCharacterCastIdentity } from "./application/applyCharacterCastIdentity";
import { renameCharacterCastMember, readCastAliases, type RenameCharacterCastMemberInput } from "./application/renameCharacterCastMember";
import { queueRagUpsert } from "../novelCoreSupport";
import { generateCharacterCastOptionsDraft, persistCharacterCastOptionsDraft } from "./characterCastGeneration";
import { developCharacterCastBatch } from "./application/developCharacterCastBatch";
import { parseCastCoverage } from "./domain/characterCastCoverage";
import type {
  CharacterCastApplyResult,
  CharacterCastOption,
  CharacterCastOptionClearResult,
  CharacterCastOptionDeleteResult,
  CharacterCastQualityAssessment,
  CharacterCastRole,
  CharacterWorldFocusHints,
  CharacterRelation,
  SupplementalCharacterApplyResult,
  SupplementalCharacterCandidate,
  SupplementalCharacterGenerateInput,
  SupplementalCharacterGenerationResult,
} from "@ai-novel/shared/types/novel";
import type { LLMProvider } from "@ai-novel/shared/types/llm";
import { prisma } from "../../../db/prisma";
import { NovelContextService } from "../NovelContextService";
import {
  CharacterVisibleProfileService,
  type CharacterVisibleProfileGenerateOptions,
} from "../characterProfile/CharacterVisibleProfileService";
import { CharacterDynamicsService } from "../dynamics/CharacterDynamicsService";
import { CharacterMindService } from "../characterMind/CharacterMindService";
import { CharacterPreparationSupplementalService } from "./characterPreparationSupplemental";
import {
  parseCharacterProhibitionsJson,
} from "../characters/characterHardFacts";
import {
  assessCharacterCastBatch,
  buildCharacterCastBlockedMessage,
  type CharacterCastBatchAssessment,
} from "./characterCastQuality";
import { WorldContextGateway } from "../worldContext/WorldContextGateway";

interface CharacterPrepOptions {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  storyInput?: string;
  useWorldContext?: boolean;
  worldFocusHints?: CharacterWorldFocusHints;
}

interface CharacterCastApplyOptions {
  overrideQualityGate?: boolean;
  visibleProfileGeneration?: CharacterVisibleProfileGenerateOptions;
  postApplyMode?: "sync" | "background" | "deferred";
}

function serializeCharacterCastOption(row: {
  id: string;
  novelId: string;
  coveragePlanJson?: string | null;
  title: string;
  summary: string;
  whyItWorks: string | null;
  recommendedReason: string | null;
  status: string;
  sourceStoryInput: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: Array<{
    id: string;
    optionId: string;
    identityKey?: string | null;
    appliedCharacterId?: string | null;
    aliasesJson?: string;
    nameLocked?: boolean;
    sortOrder: number;
    name: string;
    role: string;
    gender: string;
    castRole: string;
    relationToProtagonist: string | null;
    storyFunction: string;
    shortDescription: string | null;
    personality: string | null;
    background: string | null;
    development: string | null;
    identityLabel: string | null;
    factionLabel: string | null;
    stanceLabel: string | null;
    powerLevel: string | null;
    realm: string | null;
    currentLocation: string | null;
    availability: string | null;
    prohibitionsJson: string;
    outerGoal: string | null;
    innerNeed: string | null;
    fear: string | null;
    wound: string | null;
    misbelief: string | null;
    secret: string | null;
    moralLine: string | null;
    firstImpression: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  relations: Array<{
    id: string;
    optionId: string;
    sortOrder: number;
    sourceIdentityKey?: string | null;
    targetIdentityKey?: string | null;
    sourceName: string;
    targetName: string;
    surfaceRelation: string;
    hiddenTension: string | null;
    conflictSource: string | null;
    secretAsymmetry: string | null;
    dynamicLabel: string | null;
    nextTurnPoint: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): CharacterCastOption {
  return {
    coveragePlan: parseCastCoverage(row.coveragePlanJson),
    id: row.id,
    novelId: row.novelId,
    title: row.title,
    summary: row.summary,
    whyItWorks: row.whyItWorks,
    recommendedReason: row.recommendedReason,
    status: row.status,
    sourceStoryInput: row.sourceStoryInput,
    members: row.members.map((member) => ({
      identityKey: member.identityKey,
      appliedCharacterId: member.appliedCharacterId,
      aliases: readCastAliases(member.aliasesJson),
      nameLocked: member.nameLocked ?? false,
      id: member.id,
      optionId: member.optionId,
      sortOrder: member.sortOrder,
      name: member.name,
      role: member.role,
      gender: member.gender as CharacterCastOption["members"][number]["gender"],
      castRole: member.castRole as CharacterCastRole,
      relationToProtagonist: member.relationToProtagonist,
      storyFunction: member.storyFunction,
      shortDescription: member.shortDescription,
      personality: member.personality,
      background: member.background,
      development: member.development,
      identityLabel: member.identityLabel,
      factionLabel: member.factionLabel,
      stanceLabel: member.stanceLabel,
      powerLevel: member.powerLevel,
      realm: member.realm,
      currentLocation: member.currentLocation,
      availability: member.availability,
      prohibitions: parseCharacterProhibitionsJson(member.prohibitionsJson),
      prohibitionsJson: member.prohibitionsJson,
      outerGoal: member.outerGoal,
      innerNeed: member.innerNeed,
      fear: member.fear,
      wound: member.wound,
      misbelief: member.misbelief,
      secret: member.secret,
      moralLine: member.moralLine,
      firstImpression: member.firstImpression,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    })),
    relations: row.relations.map((relation) => ({
      id: relation.id,
      optionId: relation.optionId,
      sortOrder: relation.sortOrder,
      sourceIdentityKey: relation.sourceIdentityKey,
      targetIdentityKey: relation.targetIdentityKey,
      sourceName: relation.sourceName,
      targetName: relation.targetName,
      surfaceRelation: relation.surfaceRelation,
      hiddenTension: relation.hiddenTension,
      conflictSource: relation.conflictSource,
      secretAsymmetry: relation.secretAsymmetry,
      dynamicLabel: relation.dynamicLabel,
      nextTurnPoint: relation.nextTurnPoint,
      createdAt: relation.createdAt.toISOString(),
      updatedAt: relation.updatedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildCastOptionQualityAssessment(option: CharacterCastOption): CharacterCastQualityAssessment {
  const assessment = assessCharacterCastBatch([option], option.sourceStoryInput ?? "");
  const optionAssessment = assessment.options[0];
  return {
    autoApplicable: optionAssessment?.autoApplicable ?? true,
    blockingReasons: assessment.blockingReasons,
    issues: optionAssessment?.issues ?? [],
  };
}

function serializeCharacterCastOptionWithQuality(
  row: Parameters<typeof serializeCharacterCastOption>[0],
): CharacterCastOption {
  const option = serializeCharacterCastOption(row);
  return {
    ...option,
    qualityAssessment: buildCastOptionQualityAssessment(option),
  };
}

export class CharacterPreparationService {
  private readonly novelContextService = new NovelContextService();
  private readonly characterDynamicsService = new CharacterDynamicsService();
  private readonly characterMindService = new CharacterMindService();
  private readonly characterVisibleProfileService = new CharacterVisibleProfileService();
  private readonly worldContextGateway = new WorldContextGateway();
  private readonly supplementalService = new CharacterPreparationSupplementalService(
    this.novelContextService,
    this.characterDynamicsService,
    this.worldContextGateway,
  );

  private async runPostApplyEnhancements(input: {
    novelId: string;
    optionId: string;
    characterIds: string[];
    visibleProfileGeneration?: CharacterVisibleProfileGenerateOptions;
  }): Promise<void> {
    const logContext = {
      novelId: input.novelId,
      optionId: input.optionId,
      characterIds: input.characterIds,
    };

    try {
      await this.characterDynamicsService.rebuildDynamics(input.novelId, {
        sourceType: "cast_option_projection",
      });
    } catch (error) {
      console.warn("[character-cast-apply] 角色动态投影后台补齐失败", {
        ...logContext,
        stage: "character_dynamics",
        error,
      });
    }

    try {
      await this.characterVisibleProfileService.autoCompleteVisibleProfilesForCharacters(
        input.novelId,
        input.characterIds,
        input.visibleProfileGeneration,
      );
    } catch (error) {
      console.warn("[character-cast-apply] 外显资料后台补齐失败", {
        ...logContext,
        stage: "visible_profile",
        error,
      });
    }

    try {
      await this.characterMindService.bootstrapMindStates(
        input.novelId,
        input.characterIds,
        input.visibleProfileGeneration,
      );
    } catch (error) {
      console.warn("[character-cast-apply] 角色思路线补齐失败", {
        ...logContext,
        stage: "character_mind",
        error,
      });
    }
  }

  async runDeferredEnhancements(
    novelId: string,
    visibleProfileGeneration?: CharacterVisibleProfileGenerateOptions,
  ): Promise<void> {
    const [appliedOption, characters] = await Promise.all([
      prisma.characterCastOption.findFirst({
        where: { novelId, status: "applied" },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      }),
      prisma.character.findMany({
        where: { novelId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
    ]);
    if (!appliedOption || characters.length === 0) {
      return;
    }
    await this.runPostApplyEnhancements({
      novelId,
      optionId: appliedOption.id,
      characterIds: characters.map((character) => character.id),
      visibleProfileGeneration,
    });
  }

  assessCharacterCastOptions(
    castOptions: CharacterCastOption[],
    storyInput: string,
  ): CharacterCastBatchAssessment {
    return assessCharacterCastBatch(castOptions, storyInput);
  }

  listCharacterCastOptions(novelId: string): Promise<CharacterCastOption[]> {
    return prisma.characterCastOption.findMany({
      where: { novelId },
      include: {
        members: { orderBy: { sortOrder: "asc" } },
        relations: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
    }).then((rows) => rows.map((row) => serializeCharacterCastOptionWithQuality(row)));
  }

  async listCharacterRelations(novelId: string): Promise<CharacterRelation[]> {
    const rows = await prisma.characterRelation.findMany({
      where: { novelId },
      include: {
        sourceCharacter: { select: { name: true } },
        targetCharacter: { select: { name: true } },
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
    });

    return rows.map((row) => ({
      id: row.id,
      novelId: row.novelId,
      sourceCharacterId: row.sourceCharacterId,
      targetCharacterId: row.targetCharacterId,
      sourceCharacterName: row.sourceCharacter.name,
      targetCharacterName: row.targetCharacter.name,
      surfaceRelation: row.surfaceRelation,
      hiddenTension: row.hiddenTension,
      conflictSource: row.conflictSource,
      secretAsymmetry: row.secretAsymmetry,
      dynamicLabel: row.dynamicLabel,
      nextTurnPoint: row.nextTurnPoint,
      trustScore: row.trustScore,
      conflictScore: row.conflictScore,
      intimacyScore: row.intimacyScore,
      dependencyScore: row.dependencyScore,
      evidence: row.evidence,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async generateSupplementalCharacters(
    novelId: string,
    options: SupplementalCharacterGenerateInput = {},
  ): Promise<SupplementalCharacterGenerationResult> {
    return this.supplementalService.generateSupplementalCharacters(novelId, options);
  }

  async generateCharacterCastOptions(
    novelId: string,
    options: CharacterPrepOptions = {},
  ): Promise<CharacterCastOption[]> {
    const generated = await generateCharacterCastOptionsDraft(novelId, options);
    await persistCharacterCastOptionsDraft(novelId, generated.storyInput, generated.parsed);
    return this.listCharacterCastOptions(novelId);
  }

  async developCharacterCastBatch(novelId: string, optionId: string, options: CharacterPrepOptions & { identityKeys?: string[] } = {}): Promise<CharacterCastOption> {
    await developCharacterCastBatch(novelId, optionId, options);
    const result = (await this.listCharacterCastOptions(novelId)).find((option) => option.id === optionId);
    if (!result) throw new Error("人物方案不存在。");
    return result;
  }

  async applyCharacterCastOption(
    novelId: string,
    optionId: string,
    options: CharacterCastApplyOptions = {},
  ): Promise<CharacterCastApplyResult> {
    const option = await prisma.characterCastOption.findFirst({
      where: { id: optionId, novelId },
      include: {
        members: { orderBy: { sortOrder: "asc" } },
        relations: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!option) {
      throw new Error("Character cast option not found.");
    }

    const assessment = assessCharacterCastBatch([serializeCharacterCastOption(option)], option.sourceStoryInput ?? "");
    const hasQualityRisk = assessment.autoApplicableOptionIndex === null;
    if (hasQualityRisk && !options.overrideQualityGate) {
      throw new Error(buildCharacterCastBlockedMessage(assessment));
    }

    const applied = await applyCharacterCastIdentity(novelId, optionId, option.updatedAt);
    const uniqueCharacterIds = applied.characterIds;
    uniqueCharacterIds.forEach((id) => queueRagUpsert("character", id));
    const postApplyInput = {
      novelId,
      optionId: option.id,
      characterIds: uniqueCharacterIds,
      visibleProfileGeneration: options.visibleProfileGeneration,
    };
    if (options.postApplyMode === "deferred") {
      // 快速开篇把增强资料延后到首章正文完成后，由持久化副作用任务补齐。
    } else if (options.postApplyMode === "background") {
      void this.runPostApplyEnhancements(postApplyInput).catch((error) => {
        console.warn("[character-cast-apply] 阵容应用后台补齐任务失败", {
          novelId,
          optionId: option.id,
          characterIds: uniqueCharacterIds,
          stage: "post_apply_enhancements",
          error,
        });
      });
    } else {
      await this.runPostApplyEnhancements(postApplyInput);
    }

    return {
      ...applied,
      qualityOverrideApplied: hasQualityRisk && Boolean(options.overrideQualityGate),
      qualityWarnings: assessment.blockingReasons,
    };
  }

  async renameCharacterCastMember(novelId: string, optionId: string, input: RenameCharacterCastMemberInput): Promise<CharacterCastOption> {
    await renameCharacterCastMember(novelId, optionId, input);
    const result = (await this.listCharacterCastOptions(novelId)).find((item) => item.id === optionId);
    if (!result) throw new Error("人物方案不存在。");
    return result;
  }
  async deleteCharacterCastOption(
    novelId: string,
    optionId: string,
  ): Promise<CharacterCastOptionDeleteResult> {
    const option = await prisma.characterCastOption.findFirst({
      where: { id: optionId, novelId },
      select: { id: true, status: true },
    });

    if (!option) {
      throw new Error("Character cast option not found.");
    }

    await prisma.characterCastOption.delete({
      where: { id: option.id },
    });

    const remainingOptionCount = await prisma.characterCastOption.count({
      where: { novelId },
    });

    return {
      deletedOptionId: option.id,
      deletedAppliedOption: option.status === "applied",
      remainingOptionCount,
    };
  }

  async clearCharacterCastOptions(novelId: string): Promise<CharacterCastOptionClearResult> {
    const options = await prisma.characterCastOption.findMany({
      where: { novelId },
      select: { status: true },
    });

    if (options.length === 0) {
      return {
        deletedCount: 0,
        deletedAppliedCount: 0,
        remainingOptionCount: 0,
      };
    }

    const deletedAppliedCount = options.filter((option) => option.status === "applied").length;
    await prisma.characterCastOption.deleteMany({ where: { novelId } });

    return {
      deletedCount: options.length,
      deletedAppliedCount,
      remainingOptionCount: 0,
    };
  }

  async applySupplementalCharacter(
    novelId: string,
    candidate: SupplementalCharacterCandidate,
  ): Promise<SupplementalCharacterApplyResult> {
    return this.supplementalService.applySupplementalCharacter(novelId, candidate);
  }
}
