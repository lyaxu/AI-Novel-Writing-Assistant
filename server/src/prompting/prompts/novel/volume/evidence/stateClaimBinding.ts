import { chapterStateClaimsSchema, type ChapterStateClaim, type SceneStateTransition } from "@ai-novel/shared/types/novel/sceneCausality";
import { restorePrimaryProseCitations } from "./primaryProseCitationCatalog";

/** Source validity only. Whether a passage supports the asserted predicate remains an AI review. */
export function resolveChapterStateClaims(raw: unknown, reviewContextJson: string | undefined, chapterOrder: number): ChapterStateClaim[] {
  const claims = chapterStateClaimsSchema.parse(raw);
  if (new Set(claims.map(claim => claim.id)).size !== claims.length) throw new Error("State claim IDs must be unique within the chapter.");
  return claims.map(claim => {
    if (claim.source.kind === "written_prose") {
      if (claim.temporalScope !== "prior") throw new Error(`Written-prose claim ${claim.id} must describe prior context, not a planned outcome.`);
      return { ...claim, source: { ...claim.source, evidence: restorePrimaryProseCitations(
        claim.source.evidenceIds.map(evidenceId => ({ evidenceId })), reviewContextJson, chapterOrder,
      ) } };
    }
    if (claim.source.kind === "planned_scene" && claim.temporalScope !== "planned") {
      throw new Error(`Planned claim ${claim.id} cannot establish an earlier fact.`);
    }
    return claim;
  });
}

interface BoundSceneInput {
  key: string;
  causality: {
    prerequisites: Array<{ claimIds: string[] }>;
    stateTransition: SceneStateTransition;
  };
}

/** Restore legacy-readable prerequisite text from one claim source rather than letting the model rewrite it. */
export function bindStateClaimContract<T extends { stateClaims: unknown; sceneCards: BoundSceneInput[] }>(
  output: T, reviewContextJson: string | undefined, chapterOrder: number,
) {
  const stateClaims = resolveChapterStateClaims(output.stateClaims, reviewContextJson, chapterOrder);
  const byId = new Map(stateClaims.map(claim => [claim.id, claim]));
  const sceneOrder = new Map(output.sceneCards.map((scene, index) => [scene.key, index]));
  if (sceneOrder.size !== output.sceneCards.length) throw new Error("State-bound scenes require unique scene keys.");
  for (const claim of stateClaims) {
    if (claim.source.kind === "planned_scene" && !sceneOrder.has(claim.source.sceneKey)) {
      throw new Error(`State claim ${claim.id} cites an absent planned scene.`);
    }
  }
  const get = (id: string) => {
    const claim = byId.get(id);
    if (!claim) throw new Error(`Unknown state claim ID: ${id}`);
    return claim;
  };
  const sceneCards = output.sceneCards.map((scene, index) => {
    const transition = scene.causality.stateTransition;
    for (const ids of [transition.beforeClaimIds, transition.actionClaimIds, transition.afterClaimIds]) {
      if (new Set(ids).size !== ids.length) throw new Error(`Repeated state claim reference in scene ${scene.key}.`);
      ids.forEach(get);
    }
    for (const id of transition.beforeClaimIds) {
      const claim = get(id);
      if (claim.source.kind === "planned_scene") {
        const origin = sceneOrder.get(claim.source.sceneKey)!;
        if (origin > index || (origin === index && claim.source.phase !== "entry")) {
          throw new Error(`Scene ${scene.key} consumes claim ${id} before its planned establishment.`);
        }
      }
    }
    for (const [ids, phase] of [[transition.actionClaimIds, "action"], [transition.afterClaimIds, "exit"]] as const) {
      if (!ids.some(id => {
        const source = get(id).source;
        return source.kind === "planned_scene" && source.sceneKey === scene.key && source.phase === phase;
      })) throw new Error(`Scene ${scene.key} must bind its own ${phase} claim.`);
      for (const id of ids) {
        const source = get(id).source;
        if (source.kind === "planned_scene" && (sceneOrder.get(source.sceneKey)! > index
          || (source.sceneKey === scene.key && source.phase !== phase))) {
          throw new Error(`Scene ${scene.key} uses claim ${id} at the wrong stage.`);
        }
      }
    }
    const prerequisiteIds = scene.causality.prerequisites.flatMap(item => item.claimIds);
    if (new Set(prerequisiteIds).size !== prerequisiteIds.length || prerequisiteIds.length > 6) {
      throw new Error(`Scene ${scene.key} requires at most six unique prerequisite claims.`);
    }
    const prerequisites = prerequisiteIds.map(id => {
      if (!transition.beforeClaimIds.includes(id)) throw new Error(`Prerequisite ${id} is not in scene ${scene.key}'s before state.`);
      const claim = get(id);
      const source = claim.source;
      return { claimIds: [id], condition: `${claim.subject}：${claim.predicate}`,
        sourceKind: source.kind === "written_prose" ? "established_in_context" as const
          : source.kind === "planned_scene" ? "establish_in_scene" as const : "unresolved" as const,
        reference: source.kind === "written_prose" ? (source.evidence ?? []).map(item => item.sourcePath).join("；")
          : source.kind === "planned_scene" ? `${source.sceneKey}.${source.phase}` : source.reason,
      };
    });
    return { ...scene, causality: { ...scene.causality, prerequisites } };
  });
  return { ...output, stateClaims, sceneCards };
}
