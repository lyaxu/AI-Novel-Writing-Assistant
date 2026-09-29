import { renderBookStoryFoundation } from "../../bookFoundation";
import type { StoryMacroPlan } from "@ai-novel/shared/types/storyMacro";
import type { VolumeGenerationNovel } from "../../../../../services/novel/volume/volumeModels";
import type { SelectedPlanningDirection } from "@ai-novel/shared/types/novel/planningPromises";

export function renderSelectedPlanningDirection(source?: SelectedPlanningDirection): string {
  return [
    "用户确认方向（规划来源，不是已写事实）：保留原选卖点、人物关系推进和开篇回报的叙事价值。可合理改编或调整落点，但须明确承接；不得静默删除。earlyPayoff与openingChain是开篇承诺，全书长期目标不必在本章全部兑现。实际已写原文高于计划描述，不能把原型中的未来动作当成已经发生。",
    "同次确认的hookStrategy、progressionLoop与storyPrototype必须一起比较。若旧候选自带互相冲突的兑现节奏，明确指出来源冲突，不把某个原型章序机械当成唯一硬截止，也不静默删掉早期回报。拆合须说明各项叙事价值在实际章节或节奏拍中的承接；无法兼容的取舍进入既有AI方案确认。具体要求前三章兑现的回报，不能仅因卷节奏把它放到中段就当作已满足。",
    source?.status === "available" ? "bookStoryFoundation 为书级构思：持续核对世界边界及人物行动对主线的影响；终局与回收允许延后，不能要求当前章揭底，也不能靠提到名字假装关系推进。" : "",
    JSON.stringify(source ?? { status: "missing", reason: "未提供用户确认方向来源，不得从当前大纲反推。" }),
  ].join("\n");
}

const MAX_DETAILED_CHARACTERS = 12;
const MAX_ROSTER_CHARACTERS = 24;

function text(value: string | null | undefined, limit: number): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)} [excerpt; source continues]`;
}

function list(values: string[] | undefined, count: number, length: number): string[] {
  const items = (values ?? []).map(value => text(value, length)).filter((value): value is string => Boolean(value));
  return [...items.slice(0, count), ...(items.length > count ? [`[${items.length - count} additional source items omitted]`] : [])];
}

/** Render the source fields once; generated future beats are plans, never established facts. */
export function renderMacroPlanningFoundation(plan: StoryMacroPlan): string {
  const expansion = plan.expansion;
  const decomposition = plan.decomposition;
  return [
    "Planning provenance: premise, conflict and constraints guide this plan. Growth, scene seeds, payoffs and ending are future intentions, not events that already happened or permission to reveal secrets early.",
    renderBookStoryFoundation(plan.bookStoryFoundation),
    JSON.stringify({
      progressionPhases: plan.progressionPhases,
      expansion: expansion ? {
        expanded_premise: text(expansion.expanded_premise, 900),
        protagonist_core: text(expansion.protagonist_core, 500),
        conflict_engine: text(expansion.conflict_engine, 500),
        conflict_layers: {
          external: text(expansion.conflict_layers?.external, 280),
          internal: text(expansion.conflict_layers?.internal, 280),
          relational: text(expansion.conflict_layers?.relational, 280),
        },
        mystery_box: text(expansion.mystery_box, 320),
        emotional_line: text(expansion.emotional_line, 400),
        setpiece_seeds: list(expansion.setpiece_seeds, 3, 260),
        tone_reference: text(expansion.tone_reference, 320),
      } : undefined,
      decomposition: decomposition ? {
        selling_point: text(decomposition.selling_point, 200),
        core_conflict: text(decomposition.core_conflict, 320),
        main_hook: text(decomposition.main_hook, 320),
        progression_loop: text(decomposition.progression_loop, 400),
        growth_path: text(decomposition.growth_path, 400),
        major_payoffs: list(decomposition.major_payoffs, 5, 220),
        ending_flavor: text(decomposition.ending_flavor, 220),
      } : undefined,
      constraints: list(plan.constraints, 8, 240),
    }),
  ].join("\n");
}

type PlanningCharacter = VolumeGenerationNovel["characters"][number];

function prohibitions(character: PlanningCharacter): string[] {
  try {
    const parsed: unknown = JSON.parse(character.prohibitionsJson ?? "[]");
    return Array.isArray(parsed) ? list(parsed.filter((value): value is string => typeof value === "string"), 8, 120) : [];
  } catch {
    return ["[Saved prohibitions could not be read; do not infer unrestricted capabilities]"];
  }
}

export function renderCharacterPlanningFoundation(characters: PlanningCharacter[]): string {
  if (!characters.length) return "none";
  // Ranking uses the saved structured role, never name/genre keywords or inferred importance.
  const ordered = characters.map((character, index) => ({ character, index }))
    .sort((left, right) => (
      Number(["protagonist", "antagonist"].includes(right.character.castRole ?? ""))
      - Number(["protagonist", "antagonist"].includes(left.character.castRole ?? ""))
      || left.index - right.index
    ));
  const detailed = ordered.slice(0, MAX_DETAILED_CHARACTERS);
  const roster = ordered.slice(MAX_DETAILED_CHARACTERS, MAX_DETAILED_CHARACTERS + MAX_ROSTER_CHARACTERS);
  return [
    "Character planning context: current fields are saved state; motivations and misbeliefs describe subjective choices, not objective truth. Private secrets are author-only constraints, not character knowledge or permission to reveal. Development is a future possibility, not accomplished history. Omitted details are unknown, not absence of constraints.",
    ...detailed.map(({ character }) => JSON.stringify({
      id: character.id,
      name: text(character.name, 80),
      role: text(character.role, 80),
      castRole: text(character.castRole, 40),
      storyFunction: text(character.storyFunction, 120),
      relationToProtagonist: text(character.relationToProtagonist, 120),
      current: {
        goal: text(character.currentGoal, 160),
        state: text(character.currentState, 200),
        powerLevel: text(character.powerLevel, 80),
        availability: text(character.availability, 80),
        prohibitions: prohibitions(character),
      },
      motivation: {
        outerGoal: text(character.outerGoal, 120), innerNeed: text(character.innerNeed, 120),
        fear: text(character.fear, 120), wound: text(character.wound, 120),
        misbelief: text(character.misbelief, 120), moralLine: text(character.moralLine, 120),
      },
      authorOnlySecret: text(character.secret, 160),
      futureDevelopment: text(character.development, 160),
    })),
    ...roster.map(({ character }) => `Compact roster (other details omitted): ${JSON.stringify({
      id: character.id, name: text(character.name, 80), castRole: text(character.castRole, 40),
      role: text(character.role, 80), goal: text(character.currentGoal || character.outerGoal, 120),
      innerNeed: text(character.innerNeed, 120),
    })}`),
    ...(ordered.length > detailed.length + roster.length
      ? [`[${ordered.length - detailed.length - roster.length} additional characters omitted from this planning projection]`]
      : []),
  ].join("\n");
}
