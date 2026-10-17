import { prisma } from "../../../../db/prisma";
import { attachCharacterIdentityAliases, buildCharacterIdentityIndex } from "../../characters/identity";
import type { ConfirmCandidateInput } from "../characterDynamicsSchemas";

/** No model call: resolve an explicit persisted identity or atomically create and bind a genuinely new candidate. */
export async function confirmCharacterCandidateIdentity(novelId: string, candidateId: string,
  input: Partial<ConfirmCandidateInput> = {}, automatic = false) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.characterCandidate.findFirst({ where: { id: candidateId, novelId } });
    if (!candidate) throw new Error("角色候选不存在。");
    const characters = await attachCharacterIdentityAliases(tx, novelId, await tx.character.findMany({ where: { novelId } }));
    if (candidate.status !== "pending") {
      const character = characters.find((item) => item.id === candidate.matchedCharacterId);
      if (candidate.status === "confirmed" && character) return { character, created: false };
      if (automatic) return null;
      throw new Error("该候选已处理，请刷新角色资产查看结果。");
    }
    const index = buildCharacterIdentityIndex(characters);
    if (index.isAmbiguous(candidate.proposedName)) {
      if (automatic) return null;
      throw new Error("这个称呼对应多位角色，请在待确认人物中选择正确的角色进行合并。");
    }
    let character = index.resolve(candidate.proposedName);
    const created = !character;
    if (!character) {
      const row = await tx.character.create({ data: { novelId, name: candidate.proposedName,
        role: input.role?.trim() || candidate.proposedRole?.trim() || "新角色", castRole: input.castRole,
        relationToProtagonist: input.relationToProtagonist?.trim() || undefined,
        currentState: input.currentState?.trim() || undefined, currentGoal: input.currentGoal?.trim() || undefined,
        background: input.summary?.trim() || candidate.summary?.trim() || undefined } });
      character = { ...row, aliases: [] };
    }
    const saved = await tx.characterCandidate.updateMany({ where: { id: candidateId, novelId, status: "pending" },
      data: { matchedCharacterId: character.id, status: "confirmed" } });
    if (saved.count !== 1) throw new Error("候选人物正在处理，请刷新后查看结果。");
    return { character, created };
  });
}
