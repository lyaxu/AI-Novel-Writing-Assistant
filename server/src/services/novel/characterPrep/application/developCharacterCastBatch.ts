import type { CharacterCastCoveragePlan, CharacterCastCoverageRole } from "@ai-novel/shared/types/novel";
import { prisma } from "../../../../db/prisma";
import { runStructuredPrompt } from "../../../../prompting/core/promptRunner";
import { characterCastDevelopBatchPrompt } from "../../../../prompting/prompts/novel/characterPreparation.development.prompts";
import type { CharacterCastOptionParsed } from "../../../../prompting/prompts/novel/characterPreparation.promptSchemas";
import { loadCastGenerationContext, type CharacterPrepOptions } from "../characterCastGeneration";
import { parseCastCoverage, selectCastBatch } from "../domain/characterCastCoverage";

type Member = CharacterCastOptionParsed["members"][number];
export interface CastDevelopmentSnapshot { plan: CharacterCastCoveragePlan; members: unknown[]; }
export interface CastDevelopmentDependencies {
  load(): Promise<CastDevelopmentSnapshot>;
  generate(role: CharacterCastCoverageRole, snapshot: CastDevelopmentSnapshot): Promise<Member>;
  save(identityKey: string, member: Member): Promise<void>;
}

/** Each member is a durable boundary. A later failure never rolls back earlier profiles. */
export async function developCastBatchWorkflow(deps: CastDevelopmentDependencies, identityKeys?: string[]) {
  const initial = await deps.load();
  const selected = selectCastBatch(initial.plan, identityKeys).map((role) => role.identityKey);
  for (const identityKey of selected) {
    const snapshot = await deps.load();
    const role = snapshot.plan.roles.find((item) => item.identityKey === identityKey);
    if (!role || role.detailStatus === "completed") continue;
    const member = await deps.generate(role, snapshot);
    if (member.identityKey !== identityKey) throw new Error("人物补全返回了不同身份，已保留此前完成的档案。");
    await deps.save(identityKey, member);
  }
}

const activeCastDevelopments = new Set<string>();

/** Single-process cost guard, not a durable execution lease or an exactly-once promise. */
export async function withCastDevelopmentFlight<T>(novelId: string, optionId: string, run: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([novelId, optionId]);
  if (activeCastDevelopments.has(key)) throw new Error("这套人物方案正在完善，请等待本次结果后再继续。");
  activeCastDevelopments.add(key);
  try { return await run(); } finally { activeCastDevelopments.delete(key); }
}

export async function developCharacterCastBatch(novelId: string, optionId: string, options: CharacterPrepOptions & { identityKeys?: string[] }) {
  return withCastDevelopmentFlight(novelId, optionId, () => developCharacterCastBatchOnce(novelId, optionId, options));
}

async function developCharacterCastBatchOnce(novelId: string, optionId: string, options: CharacterPrepOptions & { identityKeys?: string[] }) {
  // Context is loaded only for planned identities and refreshed between durable boundaries.
  await developCastBatchWorkflow({
    load: async () => {
      const option = await prisma.characterCastOption.findFirst({ where: { id: optionId, novelId }, include: { members: true } });
      const plan = parseCastCoverage(option?.coveragePlanJson);
      if (!option || !plan) throw new Error("这套方案尚无全书人物计划，请先生成包含全书覆盖的阵容。");
      return { plan, members: option.members };
    },
    generate: async (role, snapshot) => {
      const context = await loadCastGenerationContext(novelId, options);
      const result = await runStructuredPrompt({
        asset: characterCastDevelopBatchPrompt,
        promptInput: { planJson: JSON.stringify(snapshot.plan), identities: [{ identityKey: role.identityKey, name: role.name }], existingMembersJson: JSON.stringify(snapshot.members) },
        contextBlocks: context.contextBlocks,
        options: { provider: options.provider, model: options.model, temperature: options.temperature ?? 0.5, novelId },
      });
      return result.output.members[0];
    },
    save: async (identityKey, incoming) => {
      await prisma.$transaction(async (tx) => {
        const option = await tx.characterCastOption.findFirst({ where: { id: optionId, novelId }, include: { members: true } });
        const plan = parseCastCoverage(option?.coveragePlanJson);
        const role = plan?.roles.find((item) => item.identityKey === identityKey);
        if (!option || !plan || !role) throw new Error("人物方案已变动，请刷新后继续完善。");
        if (role.detailStatus === "completed") return;
        const existing = option.members.find((member) => member.identityKey === identityKey);
        // Reject stale prose in the profile instead of replacing names inside AI-authored text.
        const currentName = existing?.nameLocked ? existing.name : role.name;
        if (incoming.name !== currentName) throw new Error("人物姓名在完善期间已修改，请刷新后继续完善；此前完成的档案会保留。");
        const { prohibitions, ...profile } = incoming;
        const data = { ...profile, identityKey, name: currentName,
          nameLocked: existing?.nameLocked || role.nameLocked || false,
          aliasesJson: existing?.aliasesJson ?? JSON.stringify(role.aliases ?? []),
          prohibitionsJson: JSON.stringify(prohibitions ?? []) };
        if (existing) await tx.characterCastOptionMember.update({ where: { id: existing.id }, data });
        else await tx.characterCastOptionMember.create({ data: { ...data, optionId, sortOrder: option.members.length } });
        role.detailStatus = "completed";
        const changed = await tx.characterCastOption.updateMany({ where: { id: optionId, novelId, updatedAt: option.updatedAt }, data: { coveragePlanJson: JSON.stringify(plan), updatedAt: new Date(Math.max(Date.now(), option.updatedAt.getTime() + 1)) } });
        if (changed.count !== 1) throw new Error("人物方案被同时修改，请刷新后继续，已完成批次会保留。");
      });
    },
  }, options.identityKeys);
}
