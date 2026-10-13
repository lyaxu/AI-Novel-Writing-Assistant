import type { ChapterAcceptanceAssessmentOutput, ChapterAcceptancePromptInput, SemanticChapterAcceptanceOutput } from "../../chapterAcceptance.prompts";
import { buildEvidenceCatalog } from "../evidenceCatalog";
import { resolveAcceptanceReferences } from "../referenceAssessment";
import { collectAcceptanceDiagnostics } from "../reviewDiagnostics";
import { normalizeSemanticActions, SEMANTIC_ACTION_RULES } from "./actionFacts";
import { normalizeSemanticScenes, SEMANTIC_SCENE_RULES } from "./sceneFindings";
import { normalizeRepairFindings, REPAIR_FINDING_RULES } from "./repairFindings";

function inspect(raw: SemanticChapterAcceptanceOutput, input: ChapterAcceptancePromptInput) {
  const catalog = buildEvidenceCatalog(input);
  const resolved = resolveAcceptanceReferences({ ...raw, status: "accepted", repairability: "none",
    actionStateChecks: [], sceneCausalityVerdicts: [],
  }, input);
  const actions = normalizeSemanticActions(raw.actionStateChecks, catalog);
  const scenes = normalizeSemanticScenes(raw.sceneCausalityVerdicts, actions.checks, catalog);
  const findings = normalizeRepairFindings(raw.issueChecks, {
    ...resolved.output, actionStateChecks: actions.checks, sceneCausalityVerdicts: scenes.scenes,
  }, catalog);
  const output: ChapterAcceptanceAssessmentOutput = { ...findings.output, reviewSemanticResponse: structuredClone(raw) };
  const diagnostics = collectAcceptanceDiagnostics(output, input, { citationMode: "refs" });
  const links = raw.progressionChecks.flatMap((check, index) => check.status === "stalled"
    && !raw.issueChecks?.some(finding => finding.issueId === check.findingIssueId && finding.status === "unresolved")
    ? [`progressionChecks[${index}].findingIssueId:stalled_requires_verified_issue`] : []);
  for (const [kind, rows] of [["actionStateChecks", actions.checks], ["sceneCausalityVerdicts", scenes.scenes]] as const) {
    for (const [index, row] of rows.entries()) {
      const issueId = raw[kind][index]?.findingIssueId;
      if (["unearned", "contradicted"].includes(row.verdict)
        && !raw.issueChecks?.some(finding => finding.issueId === issueId && finding.status === "unresolved")) {
        links.push(`${kind}[${index}].findingIssueId:negative_finding_requires_verified_issue`);
      }
    }
  }
  const problems = [...new Set([...resolved.issues, ...actions.problems, ...scenes.problems,
    ...findings.problems, ...links, ...diagnostics.problems])];
  const hints = [...diagnostics.correctionHints, ...SEMANTIC_ACTION_RULES, ...SEMANTIC_SCENE_RULES, ...REPAIR_FINDING_RULES,
    "所有问题同轮纠正，只改审查回答。证据目录绑定本次正文；保留真实负面判断，无法核实则明确未知。不要以删除场景、改选简单行动或修改正文绕过核验。"];
  return { output, diagnostics, problems, hints };
}

export function validateSemanticAcceptance(raw: SemanticChapterAcceptanceOutput, input: ChapterAcceptancePromptInput): ChapterAcceptanceAssessmentOutput {
  const { output, diagnostics, problems, hints } = inspect(raw, input);
  if (problems.length) throw Object.assign(new Error([
    "审查事实或判断对应关系尚未核实，请结合完整正文一次纠正以下全部问题。", ...problems, ...hints,
  ].join("\n")), { reviewContractIssues: problems, reviewCorrectionHints: hints });
  return { ...output, actionStateChecks: diagnostics.audit.checks, progressionChecks: diagnostics.progression.checks,
    reviewContractIssues: [], actionStateAuditIssues: [], progressionAuditIssues: [] };
}

export function recoverSemanticAcceptance(raw: SemanticChapterAcceptanceOutput, input: ChapterAcceptancePromptInput, validationError: string): ChapterAcceptanceAssessmentOutput {
  const { output, diagnostics, problems, hints } = inspect(raw, input);
  if (!problems.length) throw new Error(validationError);
  return { ...output, status: "needs_manual_review", continuePolicy: "pause", repairability: "none",
    reviewRawResponse: structuredClone(raw), reviewContractIssues: problems, reviewCorrectionHints: hints,
    decisionReason: "审查依据尚未核实，保留回答与稿件，从审查步骤继续。",
    riskTags: [...new Set([...output.riskTags, "acceptance_source_evidence_unverified"])],
    deferredRepairDirectives: [...(output.deferredRepairDirectives ?? []), ...output.repairDirectives],
    deferredMissingObligations: [...(output.deferredMissingObligations ?? []), ...output.missingObligations],
    repairDirectives: [], missingObligations: [], actionStateChecks: diagnostics.audit.checks,
    actionStateAuditIssues: diagnostics.audit.coverageIssues, progressionChecks: diagnostics.progression.checks,
    progressionAuditIssues: diagnostics.progression.coverageIssues };
}

/** Illustration only. Never translate recorded model answers into verified semantic facts. */
export function semanticExample() {
  const evidence = [{ evidenceId: "从本次目录选择编号" }];
  const fact = (claim: string, storyTime: "before_or_at_action" | "during_or_after_action") => ({
    entity: "她", dimension: "knowledge", claim, evidence, storyTime, support: "supported", reason: claim,
  });
  return {
    score: { coherence: 82, pacing: 80, repetition: 85, engagement: 81, voice: 83, overall: 82 },
    summary: "知情后拒绝签字，选择及后果有依据。", sceneCausalityVerdicts: [],
    actionStateChecks: [{ sceneKey: "chapter", actor: "她", action: "拒绝签字", actionEvidence: evidence,
      states: [{ entity: "她", dimension: "knowledge", requiredForAction: "了解欠款条款",
        before: fact("读完欠款条款", "before_or_at_action"), after: fact("知情并运用信息拒绝签字", "during_or_after_action"),
        prerequisite: { status: "satisfied", basis: fact("读完欠款条款", "before_or_at_action"), reason: "拒签前已有信息。" },
        resultChange: { status: "unchanged", basis: fact("拒签不使已知信息改变", "during_or_after_action"), reason: "她改变选择，不是又获得同一条知识。" },
      }], explanation: "读完条款后作出拒绝决定。" }],
    progressionChecks: ["event_repetition", "knowledge_repetition", "prior_goal_followthrough"].map(dimension => ({
      dimension, status: "not_applicable", repeatsEstablishedBeat: null, addsNewConsequence: null,
      priorState: "首章无前章比较", actualChange: "知情后拒签", newConsequence: "", previousEvidence: [], currentEvidence: [],
      explanation: "仅为首章结构示例，后章须核对给定前文。", repairSuggestion: "",
    })),
    blockingIssues: [], issueChecks: [], repairDirectives: [], missingObligations: [], riskTags: [],
    decisionReason: "无已核实缺陷，可继续。", continuePolicy: "continue",
    assetSyncRecommendation: { priority: "normal", reason: "常规同步。", requiresFullPayoffReconcile: false },
  };
}
