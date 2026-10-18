import { z } from "zod";
import { chapterStateClaimsSchema, contextStateClaimsWireSchema, sceneOwnedStateTransitionWireSchema, sceneStateTransitionSchema,
  type ChapterStateClaim, type SceneOwnedStateTransitionWire } from "@ai-novel/shared/types/novel/sceneCausality";
import { restorePrimaryProseCitations, InvalidPrimaryProseCitationError } from "./primaryProseCitationCatalog";

export interface ContractRelationshipIssue {
  path: string;
  claimId?: string;
  expected: string;
  actual: unknown;
}

/** Complete graph diagnostics for a bounded correction of the same response. */
export class ContractRelationshipError extends Error {
  readonly code = "CHAPTER_CONTRACT_RELATIONSHIP_INVALID";
  constructor(readonly issues: ContractRelationshipIssue[]) {
    super(`Chapter contract relationships are invalid: ${JSON.stringify(issues)}`);
    this.name = "ContractRelationshipError";
  }
}

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

const canonicalSceneReferencesSchema = z.array(z.object({
  key: z.string().min(1),
  causality: z.object({
    prerequisites: z.array(z.object({ claimIds: z.array(z.string().min(1)).min(1).max(6) }).passthrough()).max(6),
    stateTransition: sceneStateTransitionSchema,
  }).passthrough(),
}).passthrough());

/** Validate persisted/projected contracts without reinterpreting them as generation wire or rewriting text. */
export function validateCanonicalStateClaims(
  output: { stateClaims: unknown; sceneCards: unknown }, reviewContextJson: string | undefined, chapterOrder: number,
): void {
  const issues: ContractRelationshipIssue[] = [];
  const parsed = z.object({ stateClaims: chapterStateClaimsSchema, sceneCards: canonicalSceneReferencesSchema }).safeParse(output);
  if (!parsed.success) throw new ContractRelationshipError(parsed.error.issues.map(issue => ({
    path: issue.path.join("."), expected: issue.message, actual: { code: issue.code },
  })));
  const { stateClaims: claims, sceneCards: scenes } = parsed.data;
  const byId = new Map<string, ChapterStateClaim>();
  const sceneOrder = new Map<string, number>();
  claims.forEach((claim, index) => {
    if (byId.has(claim.id)) issues.push({ path: `stateClaims[${index}].id`, claimId: claim.id,
      expected: "A unique chapter-wide claim ID", actual: "duplicate" });
    else byId.set(claim.id, claim);
    const source = claim.source;
    if ((source.kind === "written_prose" && claim.temporalScope !== "prior")
      || (source.kind === "planned_scene" && claim.temporalScope !== "planned")) {
      issues.push({ path: `stateClaims[${index}].temporalScope`, claimId: claim.id,
        expected: "Written prose describes prior context; scene sources describe planned states", actual: claim.temporalScope });
    }
    if (source.kind === "written_prose") {
      try { restorePrimaryProseCitations(source.evidenceIds.map(evidenceId => ({ evidenceId })), reviewContextJson, chapterOrder); }
      catch (error) {
        if (!(error instanceof InvalidPrimaryProseCitationError)) throw error;
        issues.push({ path: `stateClaims[${index}].source`, claimId: claim.id,
          expected: "Current eligible earlier prose evidence", actual: error.message });
      }
    }
  });
  scenes.forEach((scene, index) => {
    if (sceneOrder.has(scene.key)) issues.push({ path: `sceneCards[${index}].key`, expected: "A unique scene key", actual: scene.key });
    else sceneOrder.set(scene.key, index);
  });
  scenes.forEach((scene, index) => {
    const transition = scene.causality.stateTransition;
    const path = `sceneCards[${index}].causality`;
    for (const [field, phase] of [["beforeClaimIds", "entry"], ["actionClaimIds", "action"], ["afterClaimIds", "exit"]] as const) {
      const ids = transition[field];
      if (!ids.length || new Set(ids).size !== ids.length) issues.push({ path: `${path}.stateTransition.${field}`,
        expected: "Nonempty unique claim references", actual: ids });
      ids.forEach((id, refIndex) => {
        const claim = byId.get(id), refPath = `${path}.stateTransition.${field}[${refIndex}]`;
        if (!claim) { issues.push({ path: refPath, claimId: id, expected: "An existing claim", actual: "missing" }); return; }
        const source = claim.source;
        if (field === "beforeClaimIds") {
          if (source.kind === "planned_scene" && (sceneOrder.get(source.sceneKey) === undefined
            || sceneOrder.get(source.sceneKey)! > index || (source.sceneKey === scene.key && source.phase !== "entry"))) {
            issues.push({ path: refPath, claimId: id, expected: "Prior context, an earlier scene claim, or this scene's entry claim", actual: source });
          }
        } else if (source.kind !== "planned_scene" || source.sceneKey !== scene.key || source.phase !== phase) {
          issues.push({ path: refPath, claimId: id, expected: `This scene's own ${phase} claim`, actual: source });
        }
      });
    }
    const prerequisiteIds = scene.causality.prerequisites.flatMap(item => item.claimIds);
    if (prerequisiteIds.length > 6 || new Set(prerequisiteIds).size !== prerequisiteIds.length) {
      issues.push({ path: `${path}.prerequisites`, expected: "At most six unique prerequisite references", actual: prerequisiteIds });
    }
    prerequisiteIds.forEach(id => {
      if (!byId.has(id) || !transition.beforeClaimIds.includes(id)) issues.push({ path: `${path}.prerequisites`, claimId: id,
        expected: "An existing entrance claim of this scene", actual: transition.beforeClaimIds });
    });
  });
  claims.forEach((claim, index) => {
    if (claim.source.kind !== "planned_scene") return;
    const source = claim.source, sceneIndex = sceneOrder.get(source.sceneKey);
    const field = source.phase === "entry" ? "beforeClaimIds" : source.phase === "action" ? "actionClaimIds" : "afterClaimIds";
    if (sceneIndex === undefined || !scenes[sceneIndex].causality.stateTransition[field].includes(claim.id)) {
      issues.push({ path: `stateClaims[${index}].source`, claimId: claim.id,
        expected: "A present owning scene that binds this claim in its declared phase", actual: source });
    }
  });
  if (issues.length) throw new ContractRelationshipError(issues);
}

interface BoundSceneInput {
  key: string;
  causality: {
    prerequisites: Array<{ claimIds: string[] }>;
    stateTransition: SceneOwnedStateTransitionWire;
  };
}

/** Scene ownership is written once on the wire. Canonical references and readable states are projections. */
export function bindStateClaimContract<T extends { stateClaims: unknown; sceneCards: BoundSceneInput[] }>(
  output: T, reviewContextJson: string | undefined, chapterOrder: number,
) {
  const issues: ContractRelationshipIssue[] = [];
  const stateClaims: ChapterStateClaim[] = [];
  const byId = new Map<string, ChapterStateClaim>();
  const claimPaths = new Map<string, string>();
  const sceneOrder = new Map<string, number>();
  const add = (claim: ChapterStateClaim, path: string) => {
    if (byId.has(claim.id)) issues.push({ path: `${path}.id`, claimId: claim.id,
      expected: "A unique chapter-wide claim ID", actual: { duplicateOf: claimPaths.get(claim.id) } });
    else { byId.set(claim.id, claim); claimPaths.set(claim.id, path); }
    stateClaims.push(claim);
  };
  contextStateClaimsWireSchema.parse(output.stateClaims).forEach((claim, index) => {
    const path = `stateClaims[${index}]`;
    try { add(resolveChapterStateClaims([claim], reviewContextJson, chapterOrder)[0], path); }
    catch (error) {
      issues.push({ path: `${path}.source`, claimId: claim.id, expected: "Current eligible earlier prose evidence",
        actual: error instanceof Error ? error.message : String(error) });
      add(claim, path);
    }
  });
  output.sceneCards.forEach((scene, index) => {
    const path = `sceneCards[${index}]`;
    if (sceneOrder.has(scene.key)) issues.push({ path: `${path}.key`, expected: "A unique scene key", actual: scene.key });
    else sceneOrder.set(scene.key, index);
    const transition = sceneOwnedStateTransitionWireSchema.parse(scene.causality.stateTransition);
    for (const [field, phase] of [["entryClaims", "entry"], ["actionClaims", "action"], ["afterClaims", "exit"]] as const) {
      transition[field].forEach((claim, claimIndex) => add({ ...claim, temporalScope: "planned",
        source: { kind: "planned_scene", sceneKey: scene.key, phase } }, `${path}.causality.stateTransition.${field}[${claimIndex}]`));
    }
  });
  if (stateClaims.length > 48) issues.push({ path: "stateClaims", expected: "At most 48 context and scene-owned claims in total", actual: stateClaims.length });
  const lookup = (id: string, path: string) => {
    const claim = byId.get(id);
    if (!claim) issues.push({ path, claimId: id, expected: "An existing unique claim ID", actual: "missing" });
    return claim;
  };
  const describe = (claim: ChapterStateClaim) => `${claim.subject}：${claim.predicate}`;
  const sceneCards = output.sceneCards.map((scene, index) => {
    const path = `sceneCards[${index}].causality`;
    const owned = scene.causality.stateTransition;
    const beforeClaimIds = [...owned.beforeClaimIds, ...owned.entryClaims.map(claim => claim.id)];
    const actionClaimIds = owned.actionClaims.map(claim => claim.id);
    const afterClaimIds = owned.afterClaims.map(claim => claim.id);
    if (!beforeClaimIds.length || beforeClaimIds.length > 6 || new Set(beforeClaimIds).size !== beforeClaimIds.length) {
      issues.push({ path: `${path}.stateTransition`, expected: "One to six unique entrance claims: earlier references plus local entry declarations", actual: beforeClaimIds });
    }
    owned.beforeClaimIds.forEach((id, refIndex) => {
      const refPath = `${path}.stateTransition.beforeClaimIds[${refIndex}]`;
      const claim = lookup(id, refPath);
      if (claim?.source.kind === "planned_scene" && sceneOrder.get(claim.source.sceneKey)! >= index) {
        issues.push({ path: refPath, claimId: id, expected: "A context claim or a claim established in an earlier scene; local entry claims are included automatically", actual: claim.source });
      }
    });
    const prerequisiteIds = scene.causality.prerequisites.flatMap(item => item.claimIds);
    if (new Set(prerequisiteIds).size !== prerequisiteIds.length || prerequisiteIds.length > 6) {
      issues.push({ path: `${path}.prerequisites`, expected: "At most six unique prerequisite claim IDs", actual: prerequisiteIds });
    }
    const prerequisites = prerequisiteIds.flatMap((id, refIndex) => {
      const refPath = `${path}.prerequisites[${refIndex}]`;
      const claim = lookup(id, refPath);
      if (!beforeClaimIds.includes(id)) issues.push({ path: refPath, claimId: id, expected: "An entrance claim of this scene", actual: beforeClaimIds });
      if (!claim) return [];
      const source = claim.source;
      return [{ claimIds: [id], condition: describe(claim),
        sourceKind: source.kind === "written_prose" ? "established_in_context" as const
          : source.kind === "planned_scene" ? "establish_in_scene" as const : "unresolved" as const,
        reference: source.kind === "written_prose" ? (source.evidence ?? []).map(item => item.sourcePath).join("；")
          : source.kind === "planned_scene" ? `${source.sceneKey}.${source.phase}` : source.reason,
      }];
    });
    const project = (ids: string[], field: string) => {
      const text = ids.flatMap(id => { const claim = byId.get(id); return claim ? [describe(claim)] : []; }).join("；");
      if (!text || text.length > 240) issues.push({ path: `sceneCards[${index}].${field}`,
        expected: "Projected subject:predicate text must contain 1–240 characters without truncation", actual: { claimIds: ids, length: text.length } });
      return text;
    };
    return { ...scene, entryState: project(beforeClaimIds, "entryState"), exitState: project(afterClaimIds, "exitState"),
      causality: { ...scene.causality, prerequisites, stateTransition: { beforeClaimIds, actionClaimIds, afterClaimIds } } };
  });
  if (issues.length) throw new ContractRelationshipError(issues);
  return { ...output, stateClaims, sceneCards };
}
