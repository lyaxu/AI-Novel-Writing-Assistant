import { createHash } from "node:crypto";
import { prepareAdviceContext } from "../AdviceContextEncoding";
import { adviceCandidateSourceText } from "../AdviceContext";
import { planningRepairAdviceReviewModelOutputSchema, planningRepairAdviceReviewOutputSchema,
  type PlanningRepairAdviceReviewOutput, assertAdviceIssueCoverage } from "./contract";

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
export interface AdviceReviewEvidence {
  evidenceId: string; sourcePath: string; quote: string;
  authority: "current_candidate" | "written_prose" | "readonly_current_plan";
}
export interface AdviceReviewIssue { issueId: string; chapterId: string; scope: "chapter" | "window"; affectedChapterIds: string[]; sourceIssueId: string | null; claim: unknown }
export interface PreparedAdviceSemanticReviewContext { contextJson: string; evidenceCatalog: AdviceReviewEvidence[]; issueCatalog: AdviceReviewIssue[] }

function leaves(value: unknown, path: string, emit: (path: string, text: string) => void): void {
  if (typeof value === "string") {
    if (!value.trim()) return;
    try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === "object") { leaves(parsed, path, emit); return; } } catch { /* Text leaf. */ }
    emit(path, value);
  } else if (Array.isArray(value)) value.forEach((child, index) => leaves(child, `${path}[${index}]`, emit));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => leaves(child, `${path}.${key}`, emit));
}

export function buildCurrentAdviceReviewIssues(input: unknown): AdviceReviewIssue[] {
  const repair = object(object(input).repair);
  const issueCatalog: AdviceReviewIssue[] = [];
  for (const [chapterId, value] of Object.entries(object(object(repair.quality).chapters))) {
    const issues = object(value).issues;
    if (!Array.isArray(issues)) continue;
    issues.forEach((issue, index) => {
      const item = object(issue);
      const issueId = `issue_${createHash("sha256").update(JSON.stringify([chapterId, index, item.id ?? null, item.summary ?? issue])).digest("hex").slice(0, 24)}`;
      issueCatalog.push({ issueId, chapterId, scope: "chapter", affectedChapterIds: [chapterId], sourceIssueId: typeof item.id === "string" ? item.id : null, claim: issue });
    });
  }
  const windowIssues = object(object(repair.quality).window).issues;
  if (Array.isArray(windowIssues) && windowIssues.length) {
    const reviewed = Array.isArray(repair.affectedChapterIds) ? repair.affectedChapterIds
      : Object.keys(object(object(repair.quality).chapters)).length ? Object.keys(object(object(repair.quality).chapters))
        : typeof repair.chapterId === "string" ? [repair.chapterId] : [];
    const eligible = object(input).eligibleChapterIds;
    const affectedChapterIds = [...new Set(reviewed.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))];
    if (!Array.isArray(eligible) || affectedChapterIds.some(id => !eligible.includes(id))) throw new Error("窗口问题的实际复核范围超出当前授权章节。");
    if (!affectedChapterIds.length) throw new Error("窗口问题缺少可定位的授权章节，请补齐当前规划来源。");
    windowIssues.forEach((claim, index) => {
      const issueId = `issue_${createHash("sha256").update(JSON.stringify(["window", affectedChapterIds, index, claim])).digest("hex").slice(0, 24)}`;
      issueCatalog.push({ issueId, chapterId: affectedChapterIds[0], scope: "window", affectedChapterIds, sourceIssueId: null, claim });
    });
  }
  return issueCatalog;
}

/** Second-pass review intentionally excludes all competing historical plan versions. */
export function prepareAdviceSemanticReviewContext(input: unknown): PreparedAdviceSemanticReviewContext {
  const source = object(input); const repair = object(source.repair); const intent = object(source.userIntent);
  const evidenceCatalog: AdviceReviewEvidence[] = [];
  const add = (authority: AdviceReviewEvidence["authority"]) => (sourcePath: string, text: string) => {
    // Overlapping, literal windows preserve prose around boundaries without model paraphrase.
    for (let start = 0; start < text.length; start += 480) {
      const quote = text.slice(start, start + 600);
      if (!quote.trim()) continue;
      const evidenceId = `ev_${createHash("sha256").update(JSON.stringify([sourcePath, quote])).digest("hex").slice(0, 24)}`;
      if (!evidenceCatalog.some(entry => entry.evidenceId === evidenceId)) evidenceCatalog.push({ evidenceId, sourcePath, quote, authority });
      if (start + 600 >= text.length) break;
    }
  };
  leaves(source.candidateWindow, "candidateWindow", (path, text) => {
    if (adviceCandidateSourceText(source, path)) add("current_candidate")(path, text);
  });
  if (Array.isArray(source.chapterEvidence)) source.chapterEvidence.forEach((chapter, index) => {
    const content = object(chapter).content;
    if (typeof content === "string") add("written_prose")(`chapterEvidence[${index}].content`, content);
  });
  leaves(source.candidatePlanningHorizon, "candidatePlanningHorizon", add("readonly_current_plan"));
  const issueCatalog = buildCurrentAdviceReviewIssues(source);
  const isolated = {
    candidateAuthority: source.candidateAuthority,
    candidateWindow: source.candidateWindow,
    candidatePlanningHorizon: source.candidatePlanningHorizon,
    chapterEvidence: Array.isArray(source.chapterEvidence) ? source.chapterEvidence.map(chapter => {
      const item = object(chapter); return { id: item.id, order: item.order, title: item.title, content: item.content };
    }) : [],
    novel: source.novel, macro: source.macro,
    userIntent: { directorInput: intent.directorInput, selectedCandidate: intent.selectedCandidate },
    eligibleChapterIds: source.eligibleChapterIds,
    currentQuality: { authority: "review_claims_to_verify_not_candidate_text", assessment: repair.quality ?? null },
    obligationPolicy: "已应用义务映射由运行时保留。新修订必须以当前候选引用为来源，按同章revise显式记录，不能重放历史错误原句。",
    issueCatalog,
    scopeNotice: "只有eligibleChapterIds可修改。candidateWindow是唯一当前候选；后续路线与已写正文只读。核验主张需逐项验证，不是当前执行内容。", missingEvidence: source.missingEvidence,
    evidenceCatalog,
  };
  return { contextJson: prepareAdviceContext(isolated), evidenceCatalog, issueCatalog };
}

/** Model cannot rewrite source text: only identifiers from this invocation resolve. */
function resolveReview(raw: unknown, prepared: PreparedAdviceSemanticReviewContext): PlanningRepairAdviceReviewOutput {
  const parsed = planningRepairAdviceReviewModelOutputSchema.parse(raw);
  const catalog = new Map(prepared.evidenceCatalog.map(entry => [entry.evidenceId, entry]));
  if (catalog.size !== prepared.evidenceCatalog.length) throw new Error("语义核验证据目录标识重复。");
  const resolve = (evidenceId: string) => {
    const entry = catalog.get(evidenceId);
    if (!entry) throw new Error("语义核验选择了本次目录中不存在的证据，请重新获取建议。");
    return { sourcePath: entry.sourcePath, quote: entry.quote };
  };
  const assessed = new Set(parsed.issueAssessments.map(item => item.issueId));
  if (assessed.size !== parsed.issueAssessments.length || assessed.size !== prepared.issueCatalog.length
    || prepared.issueCatalog.some(issue => !assessed.has(issue.issueId))) {
    throw new Error("语义核验必须完整且不重复地核对当前问题目录。");
  }
  const issueAssessments = parsed.issueAssessments.map(assessment => {
    const issue = prepared.issueCatalog.find(item => item.issueId === assessment.issueId)!;
    if (assessment.status !== "insufficient" && !assessment.evidenceIds.length) throw new Error("问题判断缺少本次原文证据。");
    assertAdviceIssueCoverage(assessment.status, issue, parsed.options);
    return { issueId: issue.issueId, chapterId: issue.chapterId, scope: issue.scope, affectedChapterIds: issue.affectedChapterIds, status: assessment.status,
      rationale: assessment.rationale, evidence: assessment.evidenceIds.map(resolve) };
  });
  return planningRepairAdviceReviewOutputSchema.parse({ issueAssessments, advice: { summary: parsed.summary, recommendedOptionId: parsed.recommendedOptionId, options: parsed.options }, checks: parsed.checks.map(check => ({
    ...check, evidence: check.evidence.map(evidence => ({ ...resolve(evidence.evidenceId), relation: evidence.relation })),
  })) });
}

export function resolveAdviceSemanticReview(raw: unknown, prepared: PreparedAdviceSemanticReviewContext): PlanningRepairAdviceReviewOutput {
  try { return resolveReview(raw, prepared); }
  catch (cause) {
    const error = new Error(cause instanceof Error ? cause.message : "语义核验响应无效。", { cause });
    Object.defineProperty(error, "rejectedOutput", { value: { parsed: raw }, enumerable: false });
    throw error;
  }
}
