import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CAPABILITY_AUTHORIZATION_RULES } from "./context/capabilityAuthorization";
import { z } from "zod";
import type { PromptAsset } from "../../core/promptTypes";
import { renderSelectedContextBlocks } from "../../core/renderContextBlocks";
import { NOVEL_PROMPT_BUDGETS } from "./promptBudgetProfiles";
import { CHAPTER_PROSE_QUALITY_AUDIT_RULES } from "@ai-novel/shared/types/chapterProseContract";
import { actionStateCheckSchema, sceneCausalityVerdictSchema } from "@ai-novel/shared/types/novel/sceneCausality";
import { reconcileSceneActionVerdicts, validateActionStateEvidence } from "./acceptance/actionStateEvidence";
import type { ActionStateEvidenceInput } from "./acceptance/actionStateEvidence";
import { chapterProgressionCheckSchema } from "@ai-novel/shared/types/novel/progression/index";
import { CHAPTER_EMOTION_AUDIT_RULES } from "./context/emotionPresence";
import { CHAPTER_TYPOGRAPHY_AUDIT_RULES } from "./context/typography";
import { validateProgressionEvidence, validateAcceptanceIssueSources } from "./acceptance/progressionEvidence";
import { collectAcceptanceDiagnostics } from "./acceptance/reviewDiagnostics";
import { referenceActionAssessmentSchema } from "./acceptance/stateAssessment";
import { validateUnifiedAcceptance, recoverUnifiedAcceptance, unifiedExample } from "./acceptance/reviewContract";
import { buildEvidenceCatalog } from "./acceptance/evidenceCatalog";
import { resolveAcceptanceReferences, REFERENCE_AUDIT_RULES, BEFORE_TIMING_CONTRACT, missingReferenceTiming } from "./acceptance/referenceAssessment";
import {
  semanticActionAssessmentSchema, SEMANTIC_ACTION_RULES, semanticSceneSchema, SEMANTIC_SCENE_RULES,
  reviewFindingSchema, reviewFindingRecordSchema, reviewQualityDebtSchema, REPAIR_FINDING_RULES,
  validateSemanticAcceptance, recoverSemanticAcceptance, semanticExample,
  reviewEnvelopeSchema, validateReviewEnvelope, recoverReviewEnvelope, type ReviewEnvelope,
} from "./acceptance/semantic";
import {
  PHYSICAL_CONTINUITY_RULES,
  physicalContinuityCheckSchema,
  semanticPhysicalContinuityCheckSchema,
} from "./acceptance/semantic/physicalContinuity";

const acceptanceSourceEvidenceSchema = z.object({
  source: z.enum(["current_prose", "established_context"]),
  sourceId: z.string().trim().min(1),
  quote: z.string().min(1).max(240),
  evidenceId: z.string().optional(),
  evidenceSnapshotId: z.string().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

export const chapterAcceptanceIssueCategorySchema = z.enum([
  "continuity",
  "character",
  "plot",
  "mode_fit",
  "voice",
]);

function normalizeAcceptanceCategory(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "coherence" || normalized === "logic") {
    return "continuity";
  }
  if (normalized === "pacing" || normalized === "repetition" || normalized === "ending") {
    return "plot";
  }
  if (normalized === "style" || normalized === "tone") {
    return "voice";
  }
  if (normalized === "mode" || normalized === "mode-fit" || normalized === "mode fit") {
    return "mode_fit";
  }
  return normalized;
}

function normalizeAcceptanceStatus(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["acceptable", "accept", "pass", "passed", "approved", "ok", "okay"].includes(normalized)) {
    return "accepted";
  }
  if (["needs_repair", "fixable", "repair", "patchable", "needs_fix"].includes(normalized)) {
    return "repairable";
  }
  if (["manual", "stop", "review_required", "needs_review", "manual_review"].includes(normalized)) {
    return "needs_manual_review";
  }
  if (["continue", "go_on", "proceed", "continue_risk"].includes(normalized)) {
    return "continue_with_risk";
  }
  return normalized;
}

function normalizeRepairTarget(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "coherence" || normalized === "logic") {
    return "continuity";
  }
  if (
    normalized === "pacing"
    || normalized === "repetition"
    || normalized === "middle"
    || normalized === "internal_monologue"
    || normalized === "internal monologue"
  ) {
    return "plot";
  }
  if (normalized === "ending_hook" || normalized === "ending hook" || normalized === "hook") {
    return "ending";
  }
  if (normalized === "style" || normalized === "tone" || normalized === "ending_tone" || normalized === "ending tone") {
    return "voice";
  }
  return normalized;
}

function normalizeRepairMode(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "light" || normalized === "minor" || normalized === "fix") {
    return "patch";
  }
  if (normalized === "full_rewrite" || normalized === "full rewrite" || normalized === "redo") {
    return "rewrite";
  }
  if (normalized === "pause" || normalized === "human" || normalized === "review") {
    return "manual";
  }
  return normalized;
}

function normalizeContinuePolicy(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "go_on" || normalized === "proceed" || normalized === "continue_with_risk") {
    return "continue";
  }
  if (normalized === "repair" || normalized === "patch" || normalized === "fix_once") {
    return "repair_once";
  }
  if (normalized === "manual" || normalized === "needs_manual_review" || normalized === "stop") {
    return "pause";
  }
  return normalized;
}

function normalizeMissingObligationKind(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    must_hit: "must_hit_now",
    required_must_hit: "must_hit_now",
    required_hit: "must_hit_now",
    must_preserve_now: "must_preserve",
    required_preserve: "must_preserve",
    required_payoff_touch: "payoff_touch",
    payoff: "payoff_touch",
    required_character_appearance: "character_appearance",
    character: "character_appearance",
    character_required: "character_appearance",
    required_goal_change: "goal_change",
    goal: "goal_change",
    forbidden: "forbidden_crossing",
    forbidden_event: "forbidden_crossing",
  };
  return aliases[normalized] ?? normalized;
}

function readAliasString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeMissingObligation(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const kind = normalizeMissingObligationKind(
    record.kind ?? record.obligationType ?? record.type ?? record.category,
  );
  const summary = readAliasString(record, ["summary", "target", "fixSuggestion", "description", "issue"]);
  const evidence = readAliasString(record, ["evidence", "reason", "text"]);
  return {
    ...record,
    kind,
    ...(summary ? { summary } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

const acceptanceRepairDirectiveSchema = z.object({
  issueId: z.string().trim().min(1).optional(),
  mode: z.preprocess(normalizeRepairMode, z.enum(["patch", "rewrite", "manual"])),
  target: z.preprocess(normalizeRepairTarget, z.enum(["continuity", "character", "plot", "ending", "voice"])),
  instruction: z.string().trim().min(1),
});

const acceptanceMissingObligationSchema = z.preprocess(normalizeMissingObligation, z.object({
    issueId: z.string().trim().min(1).optional(),
    kind: z.preprocess(normalizeMissingObligationKind, z.enum([
      "must_hit_now",
      "must_preserve",
      "payoff_touch",
      "character_appearance",
      "goal_change",
      "forbidden_crossing",
    ])),
    summary: z.string().trim().min(1),
    evidence: z.string().trim().min(1).nullable().optional(),
  }));

/** Measured length compliance; computed by the program from the existing length contract. */
export const chapterLengthComplianceSchema = z.object({
  targetWordCount: z.number().int().positive().nullable(),
  actualWordCount: z.number().int().nonnegative(),
  minWordCount: z.number().int().positive().nullable(),
  maxWordCount: z.number().int().positive().nullable(),
  hardMaxWordCount: z.number().int().positive().nullable(),
  status: z.enum(["within_band", "over_soft", "over_hard", "under_soft"]),
  excessWordCount: z.number().int().nullable(),
});
export type ChapterLengthCompliance = z.infer<typeof chapterLengthComplianceSchema>;

export const chapterAcceptanceAssessmentSchema = z.object({
  status: z.preprocess(
    normalizeAcceptanceStatus,
    z.enum(["accepted", "repairable", "needs_manual_review", "continue_with_risk"]),
  ),
  score: z.object({
    coherence: z.number().min(0).max(100),
    pacing: z.number().min(0).max(100),
    repetition: z.number().min(0).max(100),
    engagement: z.number().min(0).max(100),
    voice: z.number().min(0).max(100),
    overall: z.number().min(0).max(100),
  }),
  summary: z.string().trim().min(1),
  sceneCausalityVerdicts: z.array(sceneCausalityVerdictSchema).max(8).optional(),
  actionStateChecks: z.array(actionStateCheckSchema).max(8).optional(),
  actionStateAuditIssues: z.array(z.string()).optional(),
  progressionChecks: z.array(chapterProgressionCheckSchema).max(3).optional(),
  progressionAuditIssues: z.array(z.string()).optional(),
  /** Physical/continuity audit rows; absent on legacy reports and older prompt versions. */
  physicalContinuityChecks: z.array(physicalContinuityCheckSchema).max(4).optional(),
  /** Program-owned measurement of the written length against the existing target band. */
  lengthCompliance: chapterLengthComplianceSchema.optional(),
  reviewContractIssues: z.array(z.string()).optional(),
  reviewRawResponse: z.unknown().optional(),
  reviewFindings: z.array(reviewFindingRecordSchema).optional(),
  reviewQualityDebt: z.array(reviewQualityDebtSchema).optional(),
  reviewSemanticResponse: z.unknown().optional(),
  reviewCorrectionHints: z.array(z.string()).optional(),
  evidenceCatalogSnapshotId: z.string().optional(),
  evidenceReferenceIssues: z.array(z.string()).optional(),
  blockingIssues: z.array(z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    category: z.preprocess(normalizeAcceptanceCategory, chapterAcceptanceIssueCategorySchema),
    code: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    fixSuggestion: z.string().trim().min(1),
    sourceEvidence: z.array(acceptanceSourceEvidenceSchema).optional(),
    sourceValidationIssues: z.array(z.string()).optional(),
    unverifiedFixSuggestion: z.string().optional(),
  })).default([]),
  repairDirectives: z.array(acceptanceRepairDirectiveSchema).default([]),
  deferredRepairDirectives: z.array(acceptanceRepairDirectiveSchema).optional(),
  missingObligations: z.array(acceptanceMissingObligationSchema).default([]),
  deferredMissingObligations: z.array(acceptanceMissingObligationSchema).optional(),
  repairability: z.enum([
    "none",
    "patchable_obligation_gap",
    "rewrite_needed",
    "plan_misalignment",
  ]).default("none"),
  decisionReason: z.string().trim().min(1).default("正文可继续推进。"),
  riskTags: z.array(z.string().trim().min(1)).default([]),
  assetSyncRecommendation: z.object({
    priority: z.enum(["normal", "high"]).default("normal"),
    reason: z.string().trim().min(1),
    requiresFullPayoffReconcile: z.boolean().default(false),
  }),
  continuePolicy: z.preprocess(normalizeContinuePolicy, z.enum(["continue", "repair_once", "pause"])),
});

export type ChapterAcceptanceAssessmentOutput = z.infer<typeof chapterAcceptanceAssessmentSchema>;

/** New model output must explicitly report evidence; old persisted assessments remain readable. */
export const generatedChapterAcceptanceAssessmentSchema = chapterAcceptanceAssessmentSchema.omit({ actionStateAuditIssues: true, progressionAuditIssues: true, deferredRepairDirectives: true, deferredMissingObligations: true }).extend({
  sceneCausalityVerdicts: z.array(sceneCausalityVerdictSchema).max(8),
  actionStateChecks: z.array(actionStateCheckSchema.omit({ validationIssues: true })).min(1).max(8),
  progressionChecks: z.array(chapterProgressionCheckSchema.omit({ validationIssues: true }).extend({
    repeatsEstablishedBeat: z.boolean().nullable(),
    addsNewConsequence: z.boolean().nullable(),
  })).length(3),
  blockingIssues: z.array(chapterAcceptanceAssessmentSchema.shape.blockingIssues.removeDefault().element.omit({ sourceValidationIssues: true, unverifiedFixSuggestion: true }).extend({
    sourceEvidence: z.array(acceptanceSourceEvidenceSchema).min(1),
  })),
});

const evidenceReferenceSchema = z.object({ evidenceId: z.string().trim().min(1) }).strict();
const referenceArray = z.array(evidenceReferenceSchema).max(2);
/** Wire tolerance: a few valid extra citations are real material, not a review failure. */
const tolerantReferenceArray = z.array(evidenceReferenceSchema).max(6);
/** Only IDs cross the new model boundary; canonical quotations are server-owned. */
export const referenceChapterAcceptanceAssessmentSchema = generatedChapterAcceptanceAssessmentSchema.omit({
  evidenceCatalogSnapshotId: true, evidenceReferenceIssues: true, reviewContractIssues: true, reviewCorrectionHints: true, reviewRawResponse: true,
}).extend({
  actionStateChecks: z.array(actionStateCheckSchema.omit({ validationIssues: true }).extend({
    actionEvidence: referenceArray.min(1),
    states: z.array(actionStateCheckSchema.shape.states.element.extend({
      beforeEvidence: referenceArray, afterEvidence: referenceArray, transitionEvidence: referenceArray,
      // Required by postValidate: missing semantic findings need the full prose, not JSON-only repair.
      beforeEvidenceTiming: actionStateCheckSchema.shape.states.element.shape.beforeEvidenceTiming,
    })).min(1).max(5),
  })).min(1).max(8),
  progressionChecks: z.array(generatedChapterAcceptanceAssessmentSchema.shape.progressionChecks.element.extend({
    previousEvidence: referenceArray, currentEvidence: referenceArray,
  })).length(3),
  blockingIssues: z.array(generatedChapterAcceptanceAssessmentSchema.shape.blockingIssues.element.extend({
    sourceEvidence: z.array(evidenceReferenceSchema).min(1),
  })),
});
export type ReferenceChapterAcceptanceOutput = z.infer<typeof referenceChapterAcceptanceAssessmentSchema>;
export const unifiedChapterAcceptanceAssessmentSchema = referenceChapterAcceptanceAssessmentSchema.extend({
  actionStateChecks: z.array(referenceActionAssessmentSchema).min(1).max(8),
});
export type UnifiedChapterAcceptanceOutput = z.infer<typeof unifiedChapterAcceptanceAssessmentSchema>;

/** One semantic source per fact and repair decision; canonical UI fields are server projections. */
export const semanticChapterAcceptanceSchema = unifiedChapterAcceptanceAssessmentSchema.omit({
  status: true, repairability: true, reviewFindings: true, reviewQualityDebt: true, reviewSemanticResponse: true,
}).extend({
  actionStateChecks: z.array(semanticActionAssessmentSchema.extend({ findingIssueId: z.string().trim().min(1).optional() })).min(1).max(8),
  sceneCausalityVerdicts: z.array(semanticSceneSchema).max(8),
  issueChecks: z.array(reviewFindingSchema).optional(),
  progressionChecks: z.array(unifiedChapterAcceptanceAssessmentSchema.shape.progressionChecks.element.extend({
    findingIssueId: z.string().trim().min(1).optional(),
    previousEvidence: tolerantReferenceArray,
    currentEvidence: tolerantReferenceArray,
  })).length(3),
  // Optional for archived answers and pre-v19 prompts; when present it must cover all
  // four physical-continuity dimensions exactly once (legacy reports stay readable).
  physicalContinuityChecks: z.array(semanticPhysicalContinuityCheckSchema).length(4).optional(),
});
export type SemanticChapterAcceptanceOutput = z.infer<typeof semanticChapterAcceptanceSchema>;

export interface ChapterAcceptancePromptInput {
  chapterId?: string;
  novelTitle: string;
  chapterOrder: number;
  chapterTitle: string;
  targetWordCount?: number | null;
  content: string;
  expectedSceneKeys?: string[];
  expectedStateClaims?: ActionStateEvidenceInput["expectedStateClaims"];
  establishedProse?: Array<{ chapterId: string; order: number; content: string }>;
}

export const CHAPTER_ACCEPTANCE_EXAMPLE: ChapterAcceptanceAssessmentOutput = {
  status: "repairable",
  score: {
    coherence: 82,
    pacing: 78,
    repetition: 86,
    engagement: 80,
    voice: 81,
    overall: 81,
  },
  summary: "本章主线可以成立，但结尾钩子和中段推进需要轻修后再继续。",
  sceneCausalityVerdicts: [],
  progressionChecks: [
    { dimension: "event_repetition", status: "progressed", repeatsEstablishedBeat: false, addsNewConsequence: true, priorState: "等待她回应合同", actualChange: "知情后拒绝签字", newConsequence: "合作未能成立", previousEvidence: [], currentEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她把笔放下，没有签字。" }], explanation: "本章拒绝形成实际结果，而非再次决定要考虑合同。", repairSuggestion: "" },
    { dimension: "knowledge_repetition", status: "progressed", repeatsEstablishedBeat: false, addsNewConsequence: true, priorState: "未得知具体欠款条款", actualChange: "读完欠款条款后改变合作意愿", newConsequence: "拒绝承担欠款", previousEvidence: [], currentEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她读完了欠款条款。" }], explanation: "信息进入本次选择，不仅重复背景。", repairSuggestion: "" },
    { dimension: "prior_goal_followthrough", status: "insufficient_evidence", repeatsEstablishedBeat: null, addsNewConsequence: null, priorState: "未提供前章原文", actualChange: "当前有拒绝行动", newConsequence: "", previousEvidence: [], currentEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她把笔放下，没有签字。" }], explanation: "不能凭计划认证前章曾作出的决定。", repairSuggestion: "" },
  ],
  actionStateChecks: [{
    sceneKey: "chapter", actor: "她", action: "拒绝签字", actionEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她把笔放下，没有签字。" }],
    states: [{ dimension: "knowledge", entity: "她对欠款的知情", before: "已经读到欠款条款", requiredForAction: "了解合同条款", after: "知情但拒绝承担欠款",
      beforeEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她读完了欠款条款。" }],
      beforeEvidenceTiming: { relation: "before_or_at_action", reason: "读完条款发生在拒绝签字之前，叙述也按这一顺序展开。" },
      afterEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她把笔放下，没有签字。" }],
      transitionEvidence: [], enablingTransitionRequired: false, stateChanged: false, transitionStatus: "not_needed" }],
    verdict: "earned", explanation: "知情后拒绝签字，未发生无来源的知识变化。",
  }],
  blockingIssues: [
    {
      severity: "medium",
      category: "plot",
      code: "ending_hook_soft",
      sourceEvidence: [{ source: "current_prose", sourceId: "本章chapterId", quote: "她把笔放下，没有签字。" }],
      evidence: "结尾只说明主角准备行动，没有形成新的压力或悬念。",
      fixSuggestion: "补强结尾的决策代价或外部压力，让下一章入口更明确。",
    },
  ],
  repairDirectives: [
    {
      mode: "patch",
      target: "ending",
      instruction: "保留正文主体，只补强结尾 300 字以内的钩子和压力。",
    },
  ],
  missingObligations: [
    {
      kind: "must_hit_now",
      summary: "本章必须让主角发现敌方试探，但正文只写了日常过渡。",
      evidence: "正文没有出现敌方试探或主角识破的可见行动。",
    },
    {
      kind: "character_appearance",
      summary: "关键角色春桃必须出场并执行观察任务。",
      evidence: "正文未出现春桃，也没有替代执行者。",
    },
  ],
  repairability: "patchable_obligation_gap",
  decisionReason: "结尾钩子可以通过局部补丁补齐，不需要重排章节计划。",
  riskTags: ["ending_hook"],
  assetSyncRecommendation: {
    priority: "normal",
    reason: "本章有可记录的剧情推进，但没有明显需要全量伏笔对账的风险。",
    requiresFullPayoffReconcile: false,
  },
  continuePolicy: "repair_once",
};

export const legacyExample = CHAPTER_ACCEPTANCE_EXAMPLE;

export const resolvedAcceptanceValidation: Pick<PromptAsset<ChapterAcceptancePromptInput, ChapterAcceptanceAssessmentOutput>, "postValidate" | "postValidateFailureRecovery"> = {
  postValidateFailureRecovery: ({ rawOutput, promptInput, validationError }) => {
    const allDiagnostics = collectAcceptanceDiagnostics(rawOutput, promptInput, { citationMode: "legacy" });
    const blockingIssues = rawOutput.blockingIssues.map((issue) => {
      try {
        validateAcceptanceIssueSources([issue], promptInput);
        return issue;
      } catch (error) {
        return {
          ...issue,
          sourceValidationIssues: [error instanceof Error ? error.message : String(error)],
          unverifiedFixSuggestion: issue.fixSuggestion,
          fixSuggestion: "先核实本章与前章原文来源；未核实前保留正文，不执行这条修改建议。",
        };
      }
    });
    const audit = validateActionStateEvidence(rawOutput.actionStateChecks ?? [], promptInput);
    const progression = validateProgressionEvidence(rawOutput.progressionChecks ?? [], promptInput);
    const hasInvalidIssueSource = blockingIssues.some(issue => issue.sourceValidationIssues?.length);
    if (!allDiagnostics.problems.length) throw new Error(validationError);
    // Keep the last completed answer for inspection. The runtime's review-completion
    // gate pauses here; exhaustion is never approval or permission to rewrite prose.
    return {
      ...rawOutput,
      reviewContractIssues: allDiagnostics.problems,
      reviewCorrectionHints: allDiagnostics.correctionHints,
      status: hasInvalidIssueSource ? "continue_with_risk" : "needs_manual_review",
      continuePolicy: hasInvalidIssueSource ? "continue" : "pause",
      repairability: "none",
      decisionReason: "审查的引文或状态证据未能核实，完整保留回答供复核；保留正文，不执行未核实的修改建议。",
      blockingIssues,
      deferredRepairDirectives: rawOutput.repairDirectives,
      deferredMissingObligations: rawOutput.missingObligations,
      missingObligations: [],
      repairDirectives: [],
      riskTags: [...new Set([...rawOutput.riskTags, "acceptance_source_evidence_unverified"])],
      actionStateChecks: audit.checks,
      actionStateAuditIssues: audit.coverageIssues,
      progressionChecks: progression.checks,
      progressionAuditIssues: progression.coverageIssues,
      sceneCausalityVerdicts: reconcileSceneActionVerdicts(rawOutput.sceneCausalityVerdicts ?? [], audit.checks).map((row) =>
        row.verdict === "earned" && audit.coverageIssues.some((issue) => issue.endsWith(`:${row.sceneKey}`))
          ? { ...row, verdict: "insufficient_evidence" as const, explanation: "关键行动状态核验缺失或重复，不能认证因果已成立。" }
          : row),
    };
  },
  postValidate: (output, input) => {
    const diagnostics = collectAcceptanceDiagnostics(output, input, { citationMode: "legacy" });
    const { audit, progression, problems } = diagnostics;
    if (problems.length) {
      throw Object.assign(new Error([
        "审查回答的证据校验未通过；只纠正审查 JSON，不改正文、不补造剧情。",
        ...problems,
        ...diagnostics.correctionHints,
        "从声明来源逐字复制连续准确原文，保留标点；补齐覆盖、状态变化证据，区分行动前提与行动结果。",
        "没有比较职责时使用 not_applicable；无法核实则如实标记未知，不用高分或 earned 掩盖缺证据。",
      ].join("\n")), { evidenceProblems: problems, evidenceCorrectionHints: diagnostics.correctionHints });
    }
    return {
      ...output,
      actionStateChecks: audit.checks,
      actionStateAuditIssues: audit.coverageIssues,
      progressionChecks: progression.checks,
      progressionAuditIssues: progression.coverageIssues,
      sceneCausalityVerdicts: reconcileSceneActionVerdicts(output.sceneCausalityVerdicts ?? [], audit.checks).map((row) =>
        row.verdict === "earned" && audit.coverageIssues.some((issue) => issue.endsWith(`:${row.sceneKey}`))
          ? { ...row, verdict: "insufficient_evidence" as const, explanation: "关键行动状态核验缺失或重复，不能认证因果已成立。" }
          : row),
    };
  },
};

/** Schema illustration only; placeholder IDs must be replaced by selections from the real catalog. */
export function referenceExample(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(referenceExample);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.quote === "string" && typeof record.sourceId === "string") return { evidenceId: "从本次目录选择编号" };
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, referenceExample(item)]));
}

export const legacyReferenceAcceptanceValidation: Pick<PromptAsset<ChapterAcceptancePromptInput, ChapterAcceptanceAssessmentOutput, ReferenceChapterAcceptanceOutput>, "postValidate" | "postValidateFailureRecovery"> = {
  postValidate: (raw, input, context) => {
    const resolved = resolveAcceptanceReferences(raw, input);
    const timingProblems = missingReferenceTiming(raw);
    if (resolved.issues.length) throw new Error([...resolved.issues, ...timingProblems, BEFORE_TIMING_CONTRACT].join("\n"));
    try {
      const validated = resolvedAcceptanceValidation.postValidate!(resolved.output, input, context);
      if (timingProblems.length) throw Object.assign(new Error(timingProblems.join("\n")), { evidenceProblems: [] });
      return validated;
    } catch (error) {
      const problems = (error as { evidenceProblems?: string[] }).evidenceProblems;
      const allProblems = [...timingProblems, ...(problems ?? [error instanceof Error ? error.message : String(error)])];
      throw new Error(`${allProblems.join("\n")}\n${BEFORE_TIMING_CONTRACT}\n证据原文由程序按编号还原，只选evidenceId，不生成quote/source/sourceId或改正文。保留关键行动与真实依据，不换行动或删证据躲避核验。缺失前后状态证据须补正确编号或如实标未知并同步动作和场景，不可无证据仍为earned。`);
    }
  },
  postValidateFailureRecovery: ({ rawOutput, promptInput, context, validationError, semanticRetryAttempts }) => {
    const resolved = resolveAcceptanceReferences(rawOutput, promptInput);
    const timingProblems = missingReferenceTiming(rawOutput);
    if (!resolved.issues.length && !timingProblems.length) return resolvedAcceptanceValidation.postValidateFailureRecovery!({
      rawOutput: resolved.output, promptInput, context, validationError, semanticRetryAttempts,
    });
    // Unknown IDs remain inspectable review failure, including in candidate review.
    return {
      ...resolved.output, status: "needs_manual_review", continuePolicy: "pause", repairability: "none",
      evidenceReferenceIssues: resolved.issues,
      actionStateAuditIssues: [...(resolved.output.actionStateAuditIssues ?? []), ...timingProblems],
      decisionReason: "审查的证据编号或故事时间判断尚未核实，保留回答和正文，等待完成审查。",
      riskTags: [...new Set([...resolved.output.riskTags, "acceptance_source_evidence_unverified"])],
      deferredRepairDirectives: resolved.output.repairDirectives,
      deferredMissingObligations: resolved.output.missingObligations,
      repairDirectives: [], missingObligations: [],
    };
  },
};

export const chapterAcceptanceAssessmentPrompt: PromptAsset<
  ChapterAcceptancePromptInput,
  ChapterAcceptanceAssessmentOutput,
  ReviewEnvelope
> = {
  id: "novel.chapter.acceptance_assessment",
  version: "v19",
  taskType: "review",
  mode: "structured",
  language: "zh",
  contextPolicy: {
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.chapterAcceptance,
    preferredGroups: [
      "chapter_mission",
      "reader_experience",
      "scene_causality",
      "obligation_contract",
      "structure_obligations",
      "local_state",
      "style_contract",
      "open_conflicts",
    ],
    dropOrder: [
      "recent_chapters",
      "participant_subset",
      "world_rules",
      "historical_issues",
    ],
  },
  contextRequirements: [
    { group: "chapter_mission", required: true, priority: 100 },
    { group: "reader_experience", required: true, priority: 100 },
    { group: "scene_causality", required: true, priority: 100 },
    { group: "obligation_contract", required: true, priority: 98 },
    { group: "structure_obligations", priority: 94 },
    { group: "local_state", priority: 89 },
    { group: "style_contract", priority: 74 },
    { group: "open_conflicts", priority: 70 },
  ],
  structuredOutputHint: {
    example: (input: ChapterAcceptancePromptInput) => semanticExample(input),
    note: "示例只说明结构，不是当前书的事实或判断；其中占位编号必须替换为本次目录真实编号。一次判断章节接收、修文、继续策略和资产同步优先级。",
  },
  outputSchema: reviewEnvelopeSchema,
  repairPolicy: { maxAttempts: 0 },
  semanticRetryPolicy: { maxAttempts: 1 },
  postValidate: (raw, input) => validateReviewEnvelope(raw, input),
  postValidateFailureRecovery: ({ rawOutput, promptInput, validationError }) => recoverReviewEnvelope(rawOutput, promptInput, validationError),
  render: (input, context) => [
    new SystemMessage([
      "你是中文长篇小说正文接收闸门。",
      "你的任务是一次性判断当前章节正文是否可以保存并继续推进，是否只需要局部轻修，是否需要暂停人工确认，以及后续资产同步是否需要高优先级处理。",
      "",
      "只输出合法 JSON 对象，不要输出 Markdown、解释、注释或额外文本。",
      "",
      "判断原则：",
      "1. 默认支持继续推进；普通可优化问题不要升级为暂停。",
      "2. 严重越过章节任务、关键连续性断裂、角色行为严重失真、受保护信息提前泄露或正文无法阅读，需要先核实问题，再由issueChecks说明修复范围；只有确实需要调整邻章计划时使用repairScope=replan。",
      "3. 先核实事实和上下文，再记录问题。每个修文指令与missingObligations绑定issueId；issueChecks检查已有正文支持，只有unresolved问题可执行修改。",
      "4. status和repairability由issueChecks的repairScope汇总，不输出这两个字段；普通局部问题不应全局暂停。continuePolicy只用continue、repair_once、pause；没有已核实缺陷时继续并保留风险。",
      "5. obligation contract是本章硬合同。must hit now与forbidden crossing的确证缺口写入missingObligations；可后续承接的缺口只有影响下一章入口才当本章缺陷，否则记riskTags。",
      "6. style_contract及反AI要求保留；明显来源实体泄露、模板腔、总结腔归入voice。不要把措辞偏好当作事实缺陷，也不要削弱已认可的叙述声音。",
      "7. blockingIssues.category只用continuity、character、plot、mode_fit、voice。repairDirectives.target只用continuity、character、plot、ending、voice；mode只用patch、rewrite、manual。",
      "8. missingObligations是对象数组，每项含issueId、kind、summary、evidence；kind只用must_hit_now、must_preserve、payoff_touch、character_appearance、goal_change、forbidden_crossing。",
      "9. reader_experience审查保留：实际回报、主动欲望与阻力、关键转折、净变化、继承悬念职责、结尾追读力。普通情绪或钩子不足只做局部建议，不据此全局重规划。",
      "10. assetSyncRecommendation只判断优先级及是否需要全量伏笔对账，不输出落库细节。评分不能覆盖有依据的质量问题。",
      "11. 审查当前完整正文；已写前章是事实来源但叙述位置不等于故事时间，任务表是计划。先检查相关段落是否已解释疑点，再声称人物不知道或缺动作。知道任务但不知道位置不等于完全不知道；保留当前真正新增的行动与情绪。",
      "关键行动状态审查：",
      ...CAPABILITY_AUTHORIZATION_RULES,
      ...SEMANTIC_ACTION_RULES,
      ...SEMANTIC_SCENE_RULES,
      ...REPAIR_FINDING_RULES,
      "actionStateChecks或sceneCausalityVerdicts有确证缺前提/矛盾（最终unearned/contradicted）时，只有你据此声称正文缺陷并要修稿，才用findingIssueId绑定issueChecks中同一unresolved问题；先核对邻近正文是否已解决，防止重复建议。故事内本就发生的失败、资金不足等真实负面事实可以保留判断而不绑定问题，程序只记录风险，不生成修文指令。未知只保留风险。",
      "progressionChecks的previousEvidence/currentEvidence与blockingIssues.sourceEvidence只用目录{evidenceId}。previousEvidence/currentEvidence各选1—2条最能支持结论的片段；多选的有效编号由程序取前2条保留，不构成审查失败。问题来源至少包含本章，跨章冲突另附前章。",
      ...REFERENCE_AUDIT_RULES.slice(10),
      "progressionChecks.status=stalled时findingIssueId必须指向已核实unresolved的问题，先核实已有推进为何不够再建议补文；不能让独立repairSuggestion绕开问题核验。",
      "前后章实际推进审查：",
      "物理连续性与真实世界规则审查：",
      ...PHYSICAL_CONTINUITY_RULES,
      "长度符合性由程序按本章目标字数和现有长度合同核验，你不需要自算字数或发明新阈值；如果篇幅问题来自注水、清单式罗列、重复解释或可压缩的无进展对话，归voice或plot记问题，并说明应保留哪些推进。",
      "正文退化检测边界：",
      ...CHAPTER_PROSE_QUALITY_AUDIT_RULES.map((rule, index) => `${index + 1}. ${rule}`),
      "情绪落地审查：",
      ...CHAPTER_EMOTION_AUDIT_RULES,
      "排版与说话人审查：",
      ...CHAPTER_TYPOGRAPHY_AUDIT_RULES,
    ].join("\n")),
    new HumanMessage([
      `小说：${input.novelTitle}`,
      `章节：第 ${input.chapterOrder} 章 ${input.chapterTitle}`,
      typeof input.targetWordCount === "number" ? `目标长度：约 ${input.targetWordCount} 字` : "目标长度：未指定",
      `expectedSceneKeys：${JSON.stringify(input.expectedSceneKeys ?? [])}`,
      `expectedStateClaims（规划核验清单，不是正文证据）：${JSON.stringify(input.expectedStateClaims ?? [])}`,
      `chapterId（current_prose来源ID）：${input.chapterId ?? "current"}`,
      `established_context可用已写正文来源：${JSON.stringify((input.establishedProse ?? []).map(({ chapterId, order }) => ({ chapterId, order })))}`,
      "",
      "分层上下文：",
      renderSelectedContextBlocks({ ...context, blocks: context.blocks.filter(block => block.group !== "written_evidence") }),
      "",
      "以下为完整正文证据目录，current_prose是本次审查对象，established_context是已写前章对照。每个编号后均为原文，不能把编号当作小说文字：",
      buildEvidenceCatalog(input).rendered,
    ].join("\n")),
  ],
};
