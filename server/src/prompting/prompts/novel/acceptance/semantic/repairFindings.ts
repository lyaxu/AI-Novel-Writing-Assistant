import { z } from "zod";
import type { ChapterAcceptanceAssessmentOutput } from "../../chapterAcceptance.prompts";
import { resolveEvidenceReference, type EvidenceCatalog } from "../evidenceCatalog";

export const repairScopeSchema = z.enum(["none", "local", "chapter", "replan"]);
const issueIdSchema = z.string().trim().min(1).max(120);
const referenceSchema = z.object({ evidenceId: z.string().trim().min(1) }).strict();
const findingFields = {
  issueId: issueIdSchema,
  issueIndex: z.number().int().nonnegative(),
  status: z.enum(["unresolved", "already_addressed", "uncertain"]),
  repairScope: repairScopeSchema,
  reason: z.string().trim().min(1).max(360),
};

/** The AI must compare a proposed defect with the surrounding prose before requesting edits. */
export const reviewFindingSchema = z.object({
  ...findingFields, nearbyEvidence: z.array(referenceSchema).max(4),
}).strict();

const canonicalEvidenceSchema = z.object({
  source: z.enum(["current_prose", "established_context", "planned_contract"]),
  sourceId: z.string(), quote: z.string(), evidenceId: z.string().optional(),
  evidenceSnapshotId: z.string().optional(), start: z.number().optional(), end: z.number().optional(),
});
const originalIssueSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]), category: z.string(), code: z.string(),
  evidence: z.string(), fixSuggestion: z.string(), sourceEvidence: z.array(canonicalEvidenceSchema).optional(),
  sourceValidationIssues: z.array(z.string()).optional(), unverifiedFixSuggestion: z.string().optional(),
}).passthrough();

/** Retain withdrawn and uncertain diagnoses for inspection without turning them into edits. */
export const reviewFindingRecordSchema = z.object({
  ...findingFields, nearbyEvidence: z.array(canonicalEvidenceSchema).max(4), originalIssue: originalIssueSchema,
});
export const reviewQualityDebtSchema = reviewFindingRecordSchema.extend({
  status: z.enum(["uncertain", "unresolved"]), repairScope: z.literal("none"),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewFindingRecord = z.infer<typeof reviewFindingRecordSchema>;

/** Checklist omissions do not authorize changing prose or stopping the book. */
export function retainStateClaimCoverageDebt(
  output: ChapterAcceptanceAssessmentOutput, missing: string[],
): ChapterAcceptanceAssessmentOutput {
  if (!missing.length) return output;
  const existing = new Set((output.reviewQualityDebt ?? []).map(item => item.originalIssue.code));
  const debt = [...new Set(missing)].filter(code => !existing.has(code)).map((code, index) => ({
    // sceneKey<=48 and claimId<=64: stable identity stays within the 120-char contract.
    issueId: `sc:${code.slice("state_claim_coverage_missing:".length)}`, issueIndex: output.blockingIssues.length + index,
    status: "uncertain" as const, repairScope: "none" as const, nearbyEvidence: [],
    reason: "本轮未覆盖此场景状态声明；尚不能据此认定正文有错。",
    originalIssue: {
      code, severity: "medium" as const, category: "continuity",
      evidence: `状态核验清单尚缺：${code}`,
      fixSuggestion: "对照最终保留正文复核该声明的事实、意图、尝试或结果；保留未核验风险，不凭计划补造正文事实。",
    },
  }));
  return { ...output,
    status: output.status === "accepted" ? "continue_with_risk" : output.status,
    reviewQualityDebt: [...(output.reviewQualityDebt ?? []), ...debt],
    riskTags: [...new Set([...output.riskTags, ...missing])],
  };
}

export const REPAIR_FINDING_RULES = [
  '逐条复核blockingIssues，并在issueChecks恰好填写对应一项：{issueId:"本次回答内唯一编号",issueIndex:0,status:"unresolved|already_addressed|uncertain",repairScope:"none|local|chapter|replan",nearbyEvidence:[{evidenceId:"本次目录编号"}],reason:"说明相邻正文为何仍未解决或已解决该问题"}。issueIndex为blockingIssues的零起始下标；status与repairScope分别选一个值；nearbyEvidence最多4条；reason非空且360字以内。不得重复编号、漏项或指向不存在的问题。',
  '先读疑点前后完整过程，再判断原文是否已经解释、行动是否已经发生、时间是否真的冲突。nearbyEvidence选择能够支持或反驳缺陷的相邻正文，不只重复最初怀疑那一句。unresolved=核对后问题确实仍在；already_addressed=原文已处理或该指控并不成立；uncertain=无法确定是否缺陷。确定未解决或已处理时必须选择本章依据。引用存在不等于结论正确，不可为通过校验编造反证或遗漏已有过程。',
  'repairScope独立表达已核实问题的处理范围：none=无需执行改稿，local=局部修补，chapter=确需章级重写，replan=必须重新规划相邻章节。already_addressed和uncertain必须为none。不得因low/high严重度标签自动决定重写范围；局部问题不要标chapter或replan。程序据各项明确范围汇总status/repairability，保留真实重规划路径。',
  '每条repairDirectives和missingObligations必须带issueId，绑定issueChecks中的同一真实问题；只允许unresolved且repairScope不是none的已核实问题授权修改。already_addressed保留审查记录，uncertain保留可见质量债，两者都不生成自动补写、重写或全局停写理由。不要另写未绑定的问题来绕过此核验。',
  'action、scene或progression的负面结论若声称真实缺陷并要修稿，也须通过findingIssueId关联相应unresolved问题；编号链接不能替代该缺陷的本章依据。审查自身格式/引用错误不等于正文缺陷，不得以修正文来解决审查回答错误。',
  'continuePolicy明确表达已核实问题的处理意图；没有已核实改稿工作时使用continue，不确定普通质量意见不触发pause。必须replan时保留pause及真实依据。程序根据结构化范围汇总修订方式，不凭分数、关键词或题材模板扩大改稿。',
  '时间一致性检查须考虑两事件之间是否经过了时间或发生条件变化，不以两个不同结果直接认定矛盾。情绪表达须检查相关段落中的言语、观察、行动或选择是否已承接，不重复要求已有过程；允许克制表达，不强制更激烈的反应。',
];
type ReviewQualityDebt = z.infer<typeof reviewQualityDebtSchema>;
type BoundDirective = ChapterAcceptanceAssessmentOutput["repairDirectives"][number] & { issueId?: string };
type BoundObligation = ChapterAcceptanceAssessmentOutput["missingObligations"][number] & { issueId?: string };
type InputAssessment = ChapterAcceptanceAssessmentOutput & {
  repairDirectives: BoundDirective[];
  missingObligations: BoundObligation[];
};
type FindingAssessment = InputAssessment & { reviewFindings: ReviewFindingRecord[]; reviewQualityDebt: ReviewQualityDebt[] };

function validCanonicalEvidence(evidence: z.infer<typeof canonicalEvidenceSchema>, catalog: EvidenceCatalog): boolean {
  const entry = evidence.evidenceId ? catalog.byId.get(evidence.evidenceId) : undefined;
  return Boolean(entry && entry.source === evidence.source && entry.sourceId === evidence.sourceId
    && entry.quote === evidence.quote && entry.start === evidence.start && entry.end === evidence.end
    && evidence.evidenceSnapshotId === catalog.snapshotId);
}

/** Consume explicit AI findings, not story keywords; never infer a defect or a repair scope. */
export function normalizeRepairFindings(
  findings: ReviewFinding[] | undefined,
  existing: InputAssessment,
  catalog: EvidenceCatalog,
): { output: FindingAssessment; problems: string[] } {
  const problems: string[] = [];
  const records: ReviewFindingRecord[] = [];
  const validById = new Map<string, ReviewFindingRecord>();
  const ids = new Set<string>();
  const indexes = new Set<number>();
  const duplicateIds = new Set((findings ?? []).filter((row, index, rows) => rows.findIndex(other => other.issueId === row.issueId) !== index).map(row => row.issueId));
  const duplicateIndexes = new Set((findings ?? []).filter((row, index, rows) => rows.findIndex(other => other.issueIndex === row.issueIndex) !== index).map(row => row.issueIndex));
  for (const [index, finding] of (findings ?? []).entries()) {
    const field = `issueChecks[${index}](issueId=${finding.issueId})`;
    const originalIssue = existing.blockingIssues[finding.issueIndex];
    if (ids.has(finding.issueId)) problems.push(`${field}.issueId:duplicate_issue_id`);
    if (indexes.has(finding.issueIndex)) problems.push(`${field}.issueIndex:duplicate_issue_index`);
    ids.add(finding.issueId); indexes.add(finding.issueIndex);
    if (!originalIssue) { problems.push(`${field}.issueIndex:source_issue_not_found:${finding.issueIndex}`); continue; }
    const problemStart = problems.length;
    const nearbyEvidence = finding.nearbyEvidence.flatMap((ref, evidenceIndex) => {
      try { return [resolveEvidenceReference(catalog, ref)]; }
      catch (error) {
        problems.push(`${field}.nearbyEvidence[${evidenceIndex}]:${error instanceof Error ? error.message : String(error)} snapshot=${catalog.snapshotId}`);
        return [];
      }
    });
    if (finding.status !== "uncertain" && !nearbyEvidence.some(item => item.source === "current_prose")) {
      problems.push(`${field}.nearbyEvidence:current_nearby_evidence_required`);
    }
    if (finding.status === "unresolved") {
      const sources = originalIssue.sourceEvidence ?? [];
      if (!sources.some(item => item.source === "current_prose") || sources.some(item => !validCanonicalEvidence(item, catalog))
        || originalIssue.sourceValidationIssues?.length) problems.push(`${field}.issueIndex:unverified_issue_source`);
    }
    if (finding.status !== "unresolved" && finding.repairScope !== "none") {
      problems.push(`${field}.repairScope:non_actionable_finding_requires_none`);
    }
    const record: ReviewFindingRecord = { ...finding, nearbyEvidence, originalIssue: structuredClone(originalIssue) };
    records.push(record);
    if (problems.length === problemStart && !duplicateIds.has(finding.issueId) && !duplicateIndexes.has(finding.issueIndex)) {
      validById.set(finding.issueId, record);
    }
  }
  existing.blockingIssues.forEach((_issue, index) => {
    if (!indexes.has(index)) problems.push(`blockingIssues[${index}]:issue_check_missing`);
  });

  const active = [...validById.values()].filter(record => record.status === "unresolved");
  const suppressedDirectives: BoundDirective[] = [];
  const suppressedObligations: BoundObligation[] = [];
  const actionable = (item: { issueId?: string }, path: string): ReviewFindingRecord | undefined => {
    if (!item.issueId) { problems.push(`${path}.issueId:required_issue_binding_missing`); return undefined; }
    const record = validById.get(item.issueId);
    if (!record) { problems.push(`${path}.issueId:unknown_or_invalid_issue_binding:${item.issueId}`); return undefined; }
    if (record.status !== "unresolved") return undefined;
    if (record.repairScope === "none") {
      problems.push(`${path}.issueId:repair_scope_none_cannot_authorize_edit:${item.issueId}`); return undefined;
    }
    return record;
  };
  const repairDirectives = existing.repairDirectives.flatMap((directive, index) => {
    const record = actionable(directive, `repairDirectives[${index}]`);
    if (!record) { suppressedDirectives.push(directive); return []; }
    // Scope is the AI's explicit decision; avoid a second, contradictory model-authored mode.
    return [{ ...directive, mode: record.repairScope === "replan" ? "manual" as const
      : record.repairScope === "chapter" ? "rewrite" as const : "patch" as const }];
  });
  const missingObligations = existing.missingObligations.flatMap((obligation, index) => {
    if (!actionable(obligation, `missingObligations[${index}]`)) { suppressedObligations.push(obligation); return []; }
    return [obligation];
  });
  const scope = active.some(record => record.repairScope === "replan") ? "replan"
    : active.some(record => record.repairScope === "chapter") ? "chapter"
      : active.some(record => record.repairScope === "local") ? "local" : "none";
  const reviewQualityDebt = records.filter((record): record is ReviewQualityDebt => record.repairScope === "none"
    && (record.status === "uncertain" || record.status === "unresolved"));
  const withdrawnCodes = new Set(records.filter(record => record.status !== "unresolved").map(record => record.originalIssue.code));
  const preservedRiskTags = existing.riskTags.filter(tag => !withdrawnCodes.has(tag));
  const hasWarning = reviewQualityDebt.length > 0 || active.length > 0 || preservedRiskTags.length > 0
    || existing.actionStateChecks?.some(check => check.verdict !== "earned")
    || existing.progressionChecks?.some(check => check.status === "insufficient_evidence" || check.status === "stalled")
    || existing.sceneCausalityVerdicts?.some(scene => scene.verdict !== "earned");
  const status = scope === "replan" ? "needs_manual_review" as const
    : scope !== "none" ? "repairable" as const : hasWarning ? "continue_with_risk" as const : "accepted" as const;
  return {
    output: {
      ...existing, reviewFindings: records, reviewQualityDebt,
      blockingIssues: active.filter(record => record.repairScope !== "none")
        .map(record => ({ ...record.originalIssue })) as InputAssessment["blockingIssues"],
      repairDirectives, missingObligations,
      deferredRepairDirectives: [...(existing.deferredRepairDirectives ?? []), ...suppressedDirectives],
      deferredMissingObligations: [...(existing.deferredMissingObligations ?? []), ...suppressedObligations],
      status,
      repairability: scope === "replan" ? "plan_misalignment" : scope === "chapter" ? "rewrite_needed"
        : scope === "local" ? "patchable_obligation_gap" : "none",
      continuePolicy: scope === "replan" ? "pause" : scope === "none" ? "continue" : existing.continuePolicy,
      riskTags: [...new Set([...preservedRiskTags,
        ...reviewQualityDebt.map(record => `${record.status === "uncertain" ? "review_uncertain" : "review_quality_debt"}:${record.issueId}`)])],
    },
    problems,
  };
}
