import { z } from "zod";
import { semanticChapterAcceptanceSchema, type SemanticChapterAcceptanceOutput, type ChapterAcceptanceAssessmentOutput, type ChapterAcceptancePromptInput } from "../../chapterAcceptance.prompts";
import { validateSemanticAcceptance, recoverSemanticAcceptance } from "./reviewContract";
import { auditSemanticState, semanticActionAssessmentSchema } from "./actionFacts";
import { buildEvidenceCatalog, resolveEvidenceReference } from "../evidenceCatalog";
import type { ActionStateDimensionCheck } from "@ai-novel/shared/types/novel/sceneCausality";

/** Transport parses JSON only. Every review field needs the full prose for correction. */
export const reviewEnvelopeSchema = z.unknown();
export type ReviewEnvelope = z.infer<typeof reviewEnvelopeSchema>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function atPath(raw: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((value, key) => value && typeof value === "object"
    ? (value as Record<PropertyKey, unknown>)[key] : undefined, raw);
}

/** An incomplete projection is diagnostic data, never a review eligible for execution. */
function inspectableFields(raw: Record<string, unknown>) {
  const indexes: Record<string, number[]> = {};
  // Rows dropped for their own shape error must not also be reported as missing coverage:
  // that cascade tells the model to add scenes it already wrote and invites duplicates.
  const dropped = { sceneKeys: [] as string[], progressionDimensions: [] as string[] };
  const fields: Record<string, unknown> = {
    score: { coherence: 0, pacing: 0, repetition: 0, engagement: 0, voice: 0, overall: 0 },
    summary: "审查回答结构尚未核实。", decisionReason: "等待完整上下文纠正审查回答。",
    assetSyncRecommendation: { priority: "normal", reason: "未完成审查不授权同步。", requiresFullPayoffReconcile: false },
    continuePolicy: "pause", actionStateChecks: [], sceneCausalityVerdicts: [], progressionChecks: [],
    blockingIssues: [], issueChecks: [], repairDirectives: [], missingObligations: [], riskTags: [],
  };
  for (const [key, schema] of Object.entries(semanticChapterAcceptanceSchema.shape)) {
    const parsed = schema.safeParse(raw[key]);
    if (parsed.success && parsed.data !== undefined) fields[key] = parsed.data;
  }
  // Keep independently valid rows for the same correction; don't let one bad row hide the others.
  for (const key of ["actionStateChecks", "sceneCausalityVerdicts", "progressionChecks", "blockingIssues", "issueChecks", "repairDirectives", "missingObligations"] as const) {
    if (!Array.isArray(raw[key])) continue;
    let schema: z.ZodType = semanticChapterAcceptanceSchema.shape[key];
    while (!(schema instanceof z.ZodArray) && "unwrap" in schema) schema = (schema as z.ZodOptional<z.ZodType>).unwrap();
    if (!(schema instanceof z.ZodArray)) continue;
    const element = schema.element as z.ZodType;
    indexes[key] = [];
    fields[key] = raw[key].flatMap((row, index) => {
      const parsed = element.safeParse(row);
      if (parsed.success) indexes[key]!.push(index);
      else if (key === "sceneCausalityVerdicts") {
        const sceneKey = record(row)?.sceneKey;
        if (typeof sceneKey === "string" && sceneKey.trim()) dropped.sceneKeys.push(sceneKey.trim());
      } else if (key === "progressionChecks") {
        const dimension = record(row)?.dimension;
        if (typeof dimension === "string" && dimension.trim()) dropped.progressionDimensions.push(dimension.trim());
      }
      return parsed.success ? [parsed.data] : [];
    });
  }
  const candidate = fields as SemanticChapterAcceptanceOutput;
  // issueIndex points into the original array, not its diagnostic projection.
  candidate.issueChecks = candidate.issueChecks?.map(finding => ({ ...finding,
    issueIndex: indexes.blockingIssues ? indexes.blockingIssues.indexOf(finding.issueIndex) : finding.issueIndex,
  }));
  const originalPaths = (text: string) => text.replace(/(actionStateChecks|sceneCausalityVerdicts|progressionChecks|blockingIssues|issueChecks|repairDirectives|missingObligations)\[(\d+)\]/g,
    (whole, key: string, index: string) => indexes[key]?.[Number(index)] === undefined ? whole : `${key}[${indexes[key]![Number(index)]}]`);
  return { candidate, originalPaths, dropped };
}

/** Coverage complaints caused only by shape-dropped rows are already reported as shape problems. */
function settleDroppedRowCoverage(
  problems: string[],
  candidate: SemanticChapterAcceptanceOutput,
  dropped: { sceneKeys: string[]; progressionDimensions: string[] },
  input: ChapterAcceptancePromptInput,
) {
  const expected = input.expectedSceneKeys ?? [];
  const actualScenes = (candidate.sceneCausalityVerdicts ?? []).map(row => row.sceneKey);
  const sceneExplained = expected.every(key => actualScenes.includes(key) || dropped.sceneKeys.includes(key))
    && new Set(actualScenes).size === actualScenes.length;
  const presentDimensions: string[] = (candidate.progressionChecks ?? []).map(row => row.dimension);
  const explainedDimensions = dropped.progressionDimensions.filter(dimension => presentDimensions.includes(dimension));
  if (!sceneExplained && !explainedDimensions.length) return { problems, hint: undefined };
  const settled = problems.filter(problem => {
    if (problem === "sceneCausalityVerdicts:scene_coverage_invalid" && sceneExplained) return false;
    const coverage = /^progression_coverage_missing:(.+)$/.exec(problem);
    return !(coverage && explainedDimensions.includes(coverage[1]));
  });
  const hint = settled.length < problems.length
    ? "本轮有场景或推进检查因自身格式错误被整行剔除，不是覆盖缺失；按上面的字段诊断只修正这些行的格式，不要新增重复场景或重复行来补覆盖。"
    : undefined;
  return { problems: settled, hint };
}

/** Inspect surviving leaves without inventing values for invalid fields. Never returned as an assessment. */
function partialProblems(raw: Record<string, unknown>, input: ChapterAcceptancePromptInput): string[] {
  const catalog = buildEvidenceCatalog(input);
  const problems: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) { value.forEach((child, index) => walk(child, `${path}[${index}]`)); return; }
    const object = record(value);
    if (!object) return;
    if (typeof object.evidenceId === "string" && !catalog.byId.has(object.evidenceId)) {
      problems.push(`${path}:unknown_evidence_id=${JSON.stringify(object.evidenceId)}；snapshot=${catalog.snapshotId}`);
    }
    for (const [key, child] of Object.entries(object)) walk(child, path ? `${path}.${key}` : key);
  };
  walk(raw, "");
  const stateSchema = semanticActionAssessmentSchema.shape.states.element;
  const factSchema = stateSchema.shape.before.unwrap();
  const validFields = (value: unknown, shape: Record<string, z.ZodType>) => {
    const object = record(value);
    if (!object) return undefined;
    const fields: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(shape)) {
      const parsed = schema.safeParse(object[key]);
      if (parsed.success && parsed.data !== undefined) fields[key] = parsed.data;
    }
    return fields;
  };
  const fact = (value: unknown) => {
    const fields = validFields(value, factSchema.shape);
    if (!fields) return undefined;
    const refs = record(value)?.evidence;
    if (Array.isArray(refs)) fields.evidence = refs.flatMap(ref => {
      const id = record(ref)?.evidenceId;
      return typeof id === "string" && catalog.byId.has(id) ? [resolveEvidenceReference(catalog, { evidenceId: id })] : [];
    });
    return fields;
  };
  if (Array.isArray(raw.actionStateChecks)) raw.actionStateChecks.forEach((action, index) => {
    if (semanticChapterAcceptanceSchema.shape.actionStateChecks.element.safeParse(action).success) return;
    const states = record(action)?.states;
    if (!Array.isArray(states)) return;
    states.forEach((value, stateIndex) => {
      const state = record(value);
      if (!state) return;
      const finding = (key: "prerequisite" | "resultChange") => {
        const fields = validFields(state[key], stateSchema.shape[key].unwrap().shape);
        return fields ? { ...fields, basis: fact(record(state[key])?.basis) } : undefined;
      };
      const diagnostic = { entity: state.entity, dimension: state.dimension, semanticFacts: {
        before: fact(state.before), after: fact(state.after),
        prerequisite: finding("prerequisite"), resultChange: finding("resultChange"),
      } } as ActionStateDimensionCheck;
      problems.push(...auditSemanticState(diagnostic, `actionStateChecks[${index}].states[${stateIndex}]`).problems);
    });
  });
  return problems;
}

function inspect(raw: ReviewEnvelope, input: ChapterAcceptancePromptInput) {
  const parsed = semanticChapterAcceptanceSchema.safeParse(raw);
  const shapeProblems = parsed.success ? [] : parsed.error.issues.map(issue => {
    const value = atPath(raw, issue.path);
    return `${issue.path.join(".") || "review"}:review_shape_invalid；当前值=${JSON.stringify(value) ?? "未提供"}；${issue.message}。只在完整正文语境内纠正字段，保留其他已完成场景与判断；不得让格式修复重写整份报告。`;
  });
  const diagnostic = parsed.success ? { candidate: parsed.data, originalPaths: (text: string) => text, dropped: undefined }
    : inspectableFields(record(raw) ?? {});
  const candidate = diagnostic.candidate;
  let output: ChapterAcceptanceAssessmentOutput;
  let semanticProblems: string[] = [];
  let hints: string[] = [];
  try { output = validateSemanticAcceptance(candidate, input); }
  catch (error) {
    const failure = error as Error & { reviewContractIssues?: string[]; reviewCorrectionHints?: string[] };
    if (!failure.reviewContractIssues) throw error;
    semanticProblems = failure.reviewContractIssues;
    hints = failure.reviewCorrectionHints ?? [];
    output = recoverSemanticAcceptance(candidate, input, failure.message);
  }
  const mappedProblems = [...new Set([...shapeProblems, ...semanticProblems.map(diagnostic.originalPaths),
    ...(!parsed.success ? partialProblems(record(raw) ?? {}, input) : [])])];
  const settled = diagnostic.dropped
    ? settleDroppedRowCoverage(mappedProblems, candidate, diagnostic.dropped, input)
    : { problems: mappedProblems, hint: undefined };
  return { output, problems: settled.problems, hints: [...(settled.hint ? [settled.hint] : []), ...hints.map(diagnostic.originalPaths)] };
}

export function validateReviewEnvelope(raw: ReviewEnvelope, input: ChapterAcceptancePromptInput): ChapterAcceptanceAssessmentOutput {
  const { output, problems, hints } = inspect(raw, input);
  if (problems.length) throw Object.assign(new Error([
    "审查的格式、覆盖和语义问题需在同一轮完整上下文中纠正；不要删掉未报错的场景、事实或证据。",
    ...problems, ...hints,
  ].join("\n")), { reviewContractIssues: problems, reviewCorrectionHints: hints });
  return { ...output, reviewSemanticResponse: structuredClone(raw) };
}

export function recoverReviewEnvelope(raw: ReviewEnvelope, input: ChapterAcceptancePromptInput, validationError: string): ChapterAcceptanceAssessmentOutput {
  const { output, problems, hints } = inspect(raw, input);
  if (!problems.length) throw new Error(validationError);
  return {
    ...output, status: "needs_manual_review", repairability: "none", continuePolicy: "pause",
    reviewRawResponse: structuredClone(raw), reviewSemanticResponse: structuredClone(raw),
    reviewContractIssues: problems, reviewCorrectionHints: hints,
    decisionReason: "审查尚未完成，保留完整回答和原稿，从审查步骤继续。",
    riskTags: [...new Set([...output.riskTags, "acceptance_source_evidence_unverified"])],
    deferredRepairDirectives: [...(output.deferredRepairDirectives ?? []), ...output.repairDirectives],
    deferredMissingObligations: [...(output.deferredMissingObligations ?? []), ...output.missingObligations],
    repairDirectives: [], missingObligations: [],
  };
}
