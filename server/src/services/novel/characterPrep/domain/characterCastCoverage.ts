import { randomUUID } from "node:crypto";
import type { CharacterCastCoveragePlan } from "@ai-novel/shared/types/novel";
import { characterCastCoveragePlanSchema, type CharacterCastOptionParsed } from "../../../../prompting/prompts/novel/characterPreparation.promptSchemas";

export function parseCastCoverage(raw: string | null | undefined): CharacterCastCoveragePlan | null {
  if (!raw) return null;
  try { return characterCastCoveragePlanSchema.parse(JSON.parse(raw)); } catch { return null; }
}

export function prepareCastForPersistence(option: CharacterCastOptionParsed) {
  const coveragePlan = option.coveragePlan ? structuredClone(option.coveragePlan) : null;
  if (coveragePlan) {
    const keys = coveragePlan.roles.map((role) => role.identityKey);
    if (new Set(keys).size !== keys.length) throw new Error("全书人物计划包含重复身份，请重新整理人物覆盖。");
  }
  const members = option.members.map((member) => {
    const role = coveragePlan?.roles.find((item) => item.identityKey === member.identityKey);
    if (coveragePlan && !role) throw new Error(`核心人物 ${member.name} 未关联全书人物计划。`);
    if (role) { role.name = member.name; role.detailStatus = "completed"; }
    return { ...member, identityKey: member.identityKey || randomUUID() };
  });
  if (new Set(members.map((member) => member.identityKey)).size !== members.length) {
    throw new Error("人物身份重复，不能保存阵容。");
  }
  if (coveragePlan) {
    const completed = new Set(members.map((member) => member.identityKey));
    coveragePlan.roles.forEach((role) => {
      role.detailStatus = completed.has(role.identityKey) ? "completed" : "planned";
      // Only the explicit user rename command may create a user lock.
      role.nameLocked = false;
    });
  }
  return { members, coveragePlan };
}

export function selectCastBatch(plan: CharacterCastCoveragePlan, requested?: string[]) {
  const requestedKeys = requested ? new Set(requested) : null;
  if (requestedKeys && [...requestedKeys].some((key) => !plan.roles.some((role) => role.identityKey === key))) {
    throw new Error("选择的人物不在这套全书计划中，请刷新方案。");
  }
  return plan.roles.filter((role) => role.detailStatus !== "completed" && (!requestedKeys || requestedKeys.has(role.identityKey))).slice(0, 6);
}

/** Bound assets are authoritative even when an old candidate still carries a user lock. */
export function buildCastIdentityContext(options: Array<{
  id: string; coveragePlanJson: string | null;
  members: Array<{ identityKey: string | null; name: string; aliasesJson: string; appliedCharacterId: string | null; nameLocked: boolean }>;
}>, characters: Array<{ id: string; name: string }>) {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  return options.map((option) => {
    const members = option.members.map((member) => {
      const name = member.appliedCharacterId ? names.get(member.appliedCharacterId) ?? member.name : member.name;
      let aliases: string[] = [];
      try { const parsed: unknown = JSON.parse(member.aliasesJson); if (Array.isArray(parsed)) aliases = parsed.filter((value): value is string => typeof value === "string"); } catch { /* Old malformed aliases are not identity evidence. */ }
      if (name !== member.name) aliases.push(member.name);
      return { ...member, name, aliases: [...new Set(aliases)].filter((alias) => alias !== name) };
    });
    const plan = parseCastCoverage(option.coveragePlanJson);
    if (plan) plan.roles = plan.roles.map((role) => {
      const member = members.find((item) => item.identityKey === role.identityKey);
      return member ? { ...role, name: member.name, nameLocked: member.nameLocked,
        aliases: [...new Set([...(role.aliases ?? []), ...member.aliases, ...(role.name !== member.name ? [role.name] : [])])].filter((name) => name !== member.name) } : role;
    });
    return { optionId: option.id, members, coveragePlan: plan };
  });
}
