import { prisma } from "../../../../db/prisma";
import { parseCastCoverage } from "../domain/characterCastCoverage";

export interface RenameCharacterCastMemberInput {
  identityKey: string;
  name: string;
  expectedUpdatedAt: string;
}

export function readCastAliases(raw: string | null | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  } catch { return []; }
}

/** Only candidate metadata changes here. Applied character records and manuscripts are outside this command. */
export async function renameCharacterCastMember(novelId: string, optionId: string, input: RenameCharacterCastMemberInput) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("姓名需要填写 1—80 个字符。");
  const expected = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new Error("方案版本无效，请刷新后重试。");
  await prisma.$transaction(async (tx) => {
    const option = await tx.characterCastOption.findFirst({ where: { id: optionId, novelId }, include: { members: true, relations: true } });
    if (!option) throw new Error("人物方案不存在。");
    if (option.updatedAt.getTime() !== expected.getTime()) throw new Error("人物方案有新的修改，请刷新后再保存姓名。");
    const coverage = parseCastCoverage(option.coveragePlanJson);
    const member = option.members.find((item) => (item.identityKey || item.id) === input.identityKey);
    const role = coverage?.roles.find((item) => item.identityKey === input.identityKey);
    if (!member && !role) throw new Error("人物不在这套方案中，请刷新后重试。");
    if (member?.appliedCharacterId || (option.status === "applied" && member && !member.identityKey)) {
      throw new Error("这位人物已进入角色资产，请从角色档案修改姓名并核对已有正文中的称呼。");
    }
    if (member && !member.identityKey && (await tx.character.findMany({ where: { novelId }, select: { id: true } })).length) {
      throw new Error("旧方案缺少人物身份关联，请先从角色档案核对，避免改名后重复创建同一人物。");
    }
    const oldName = member?.name ?? role!.name;
    if (option.members.some((item) => item.id !== member?.id && item.name === name)
      || coverage?.roles.some((item) => item.identityKey !== input.identityKey && item.name === name)) {
      throw new Error("这套方案中已有同名人物，请使用能区分身份的姓名或称呼。");
    }
    const aliases = [...new Set([...(member ? readCastAliases(member.aliasesJson) : role?.aliases ?? []), oldName])]
      .filter((item) => item !== name);
    if (role) Object.assign(role, { name, nameLocked: true, aliases });
    const locked = await tx.characterCastOption.updateMany({
      where: { id: optionId, novelId, updatedAt: expected },
      data: { updatedAt: new Date(Math.max(Date.now(), expected.getTime() + 1)),
        ...(coverage ? { coveragePlanJson: JSON.stringify(coverage) } : {}) },
    });
    if (locked.count !== 1) throw new Error("人物方案有新的修改，请刷新后再保存姓名。");
    if (member) await tx.characterCastOptionMember.update({ where: { id: member.id }, data: {
      identityKey: member.identityKey || member.id, name, nameLocked: true, aliasesJson: JSON.stringify(aliases),
    } });
    for (const relation of option.relations) {
      const source = relation.sourceIdentityKey === input.identityKey || (!relation.sourceIdentityKey && relation.sourceName === oldName);
      const target = relation.targetIdentityKey === input.identityKey || (!relation.targetIdentityKey && relation.targetName === oldName);
      if (source || target) await tx.characterCastOptionRelation.update({ where: { id: relation.id }, data: {
        ...(source ? { sourceIdentityKey: input.identityKey, sourceName: name } : {}),
        ...(target ? { targetIdentityKey: input.identityKey, targetName: name } : {}),
      } });
    }
  });
}
