import { z } from "zod";

/** Explicit one-for-one revisions preserve required duties; there is no delete or free-list replacement. */
export const requiredElementRevisionSchema = z.object({
  original: z.string().trim().min(1).max(160),
  replacement: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(600),
  preservedFunction: z.string().trim().min(1).max(240),
  sceneKeys: z.array(z.string().trim().min(1)).min(1).max(8),
}).strict();

const appliedRevisionSchema = requiredElementRevisionSchema.extend({ chapterId: z.string().trim().min(1) });
type Revision = z.infer<typeof requiredElementRevisionSchema>;
type AppliedRevision = z.infer<typeof appliedRevisionSchema>;
interface Change { chapterId: string; requiredElementRevisions?: Revision[] }

function identity(revision: AppliedRevision): string {
  return JSON.stringify([revision.chapterId, revision.original, revision.replacement]);
}

/** Validate saved mapping topology without inferring narrative equivalence from strings. */
function validateLedger(revisions: AppliedRevision[]): void {
  const edges = new Map<string, string>();
  for (const revision of revisions) {
    const key = JSON.stringify([revision.chapterId, revision.original]);
    if (revision.original === revision.replacement || (edges.has(key) && edges.get(key) !== revision.replacement)) {
      throw new Error("Required element revision ledger contains an unchanged or branched mapping.");
    }
    edges.set(key, revision.replacement);
  }
  for (const revision of revisions) {
    const seen = new Set<string>();
    let value: string | undefined = revision.original;
    while (value !== undefined) {
      if (seen.has(value)) throw new Error("Required element revision ledger contains a cycle.");
      seen.add(value);
      value = edges.get(JSON.stringify([revision.chapterId, value]));
    }
  }
}

/**
 * The revision ledger is program-managed bookkeeping: it records which saved duty text was renamed
 * by previous accepted rounds. A repair suggestion may echo no-op entries or branch the same source
 * twice. Normalize those away instead of failing the whole repair on a ledger-technicality; a
 * source already resolved by an earlier accepted round must not be re-mapped from the same original.
 */
export function projectPlanningRepairRequiredElementRevisions<T extends { changes: Array<Change> }>(
  output: T,
  previouslyApplied: readonly unknown[],
): T {
  const prior = z.array(appliedRevisionSchema).parse(previouslyApplied);
  const resolved = new Set(prior.map((item) => JSON.stringify([item.chapterId, item.original])));
  return {
    ...output,
    changes: output.changes.map((change) => {
      const byOriginal = new Map<string, Revision>();
      for (const revision of change.requiredElementRevisions ?? []) {
        // No-op echoes and already-saved sources are bookkeeping noise, not requested edits.
        if (revision.original === revision.replacement) continue;
        if (resolved.has(JSON.stringify([change.chapterId, revision.original]))) continue;
        // Branched duplicates for one source: keep the last proposal; the topology guard still
        // protects the persisted ledger from cycles or cross-round contradictions.
        byOriginal.set(revision.original, revision);
      }
      return { ...change, requiredElementRevisions: [...byOriginal.values()] };
    }),
  };
}

/** Call only after candidate construction succeeds and persist together with that candidate. */
export function mergeAppliedPlanningRepairRequiredElements(prior: readonly unknown[], changes: readonly Change[]): AppliedRevision[] {
  const saved = z.array(appliedRevisionSchema).parse(prior);
  const current = changes.flatMap(change => (change.requiredElementRevisions ?? [])
    .map(revision => appliedRevisionSchema.parse({ ...revision, chapterId: change.chapterId })));
  const merged = new Map<string, AppliedRevision>();
  for (const revision of [...saved, ...current]) if (!merged.has(identity(revision))) merged.set(identity(revision), revision);
  const result = [...merged.values()];
  validateLedger(result);
  return result;
}

function savedEndpoint(revision: AppliedRevision, prior: AppliedRevision[], currentElements: readonly string[]): string | null {
  if (!prior.some(item => identity(item) === identity(revision))) return null;
  let value = revision.replacement;
  const seen = new Set<string>([revision.original]);
  while (!seen.has(value)) {
    seen.add(value);
    const next = prior.find(item => item.chapterId === revision.chapterId && item.original === value);
    if (!next) return currentElements.includes(value) ? value : null;
    value = next.replacement;
  }
  return null;
}

/** Apply exact source mappings only; mandatory AI review decides factual support and preserved function. */
export function applyRequiredElementRevisions(input: {
  chapterId: string;
  elements: readonly string[];
  sceneKeys: readonly string[];
  revisions?: readonly Revision[];
  previouslyApplied: readonly unknown[];
}): string[] {
  const prior = z.array(appliedRevisionSchema).parse(input.previouslyApplied);
  const revisions = z.array(requiredElementRevisionSchema).max(8).parse(input.revisions ?? []);
  validateLedger(prior);
  for (const applied of prior.filter(item => item.chapterId === input.chapterId)) {
    if (input.elements.includes(applied.original) || !savedEndpoint(applied, prior, input.elements)) {
      throw new Error("Required element revision ledger disagrees with the saved current duties.");
    }
  }
  mergeAppliedPlanningRepairRequiredElements(prior, [{ chapterId: input.chapterId, requiredElementRevisions: revisions }]);
  const sources = new Set<string>();
  const replacements = new Map<string, string>();
  for (const revision of revisions) {
    if (sources.has(revision.original)) throw new Error("Required element revisions contain a duplicate source.");
    sources.add(revision.original);
    if (new Set(revision.sceneKeys).size !== revision.sceneKeys.length
      || revision.sceneKeys.some(key => !input.sceneKeys.includes(key))) {
      throw new Error("Required element revision must bind existing, unique candidate scene keys.");
    }
    const applied = { ...revision, chapterId: input.chapterId };
    const replay = prior.some(item => identity(item) === identity(applied));
    if (replay) {
      if (input.elements.includes(revision.original) || !savedEndpoint(applied, prior, input.elements)) {
        throw new Error("Required element revision replay restored an obsolete source or lost its saved endpoint.");
      }
      continue;
    }
    if (!input.elements.includes(revision.original)) throw new Error("Required element revision source does not exist in the current chapter.");
    if (input.elements.includes(revision.replacement)
      || prior.some(item => item.chapterId === input.chapterId && item.original === revision.replacement)) {
      throw new Error("Required element revision cannot reuse another duty or restore an obsolete source.");
    }
    replacements.set(revision.original, revision.replacement);
  }
  const result = input.elements.map(element => replacements.get(element) ?? element);
  if (new Set(result).size !== result.length) throw new Error("Required element revisions cannot merge or delete required duties.");
  return result;
}
