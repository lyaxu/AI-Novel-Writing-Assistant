import type { RuntimeDynamicCharacterOverview } from "@ai-novel/shared/types/chapterRuntime";

type PlannerCharacterSeed = {
  id: string;
  name: string;
  role: string;
  currentGoal: string | null;
  currentState: string | null;
};

interface ResolveChapterPlanParticipantsInput {
  outputParticipants?: string[] | null;
  characters: PlannerCharacterSeed[];
  characterDynamicsOverview?: RuntimeDynamicCharacterOverview | null;
  chapterOrder: number;
  limit?: number;
}

function compactText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function normalizeName(value: string | null | undefined): string {
  return compactText(value).toLocaleLowerCase("zh-Hans-CN");
}

export function resolveChapterPlanParticipants(
  input: ResolveChapterPlanParticipantsInput,
): string[] {
  const limit = Math.max(1, input.limit ?? 6);
  const rosterByName = new Map(
    input.characters.map((character) => [normalizeName(character.name), compactText(character.name)]),
  );
  const pendingCandidateNames = new Set(
    (input.characterDynamicsOverview?.candidates ?? []).map((candidate) => normalizeName(candidate.proposedName)),
  );
  const selected: string[] = [];
  const selectedNames = new Set<string>();

  const pushParticipant = (value: string | null | undefined) => {
    const normalized = normalizeName(value);
    if (!normalized || selectedNames.has(normalized) || pendingCandidateNames.has(normalized)) {
      return;
    }
    const matchedName = rosterByName.get(normalized);
    if (!matchedName) {
      return;
    }
    selectedNames.add(normalized);
    selected.push(matchedName);
  };

  for (const participant of input.outputParticipants ?? []) {
    pushParticipant(participant);
  }

  return selected.slice(0, limit);
}
