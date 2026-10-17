import type { ChapterAcceptanceAssessmentOutput, ChapterAcceptancePromptInput, SemanticChapterAcceptanceOutput } from "../../chapterAcceptance.prompts";
import { buildEvidenceCatalog } from "../evidenceCatalog";
import { resolveAcceptanceReferences } from "../referenceAssessment";
import { collectAcceptanceDiagnostics } from "../reviewDiagnostics";
import { normalizeSemanticActions, SEMANTIC_ACTION_RULES } from "./actionFacts";
import { normalizeSemanticScenes, SEMANTIC_SCENE_RULES } from "./sceneFindings";
import { normalizeRepairFindings, retainStateClaimCoverageDebt, REPAIR_FINDING_RULES } from "./repairFindings";

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
  return retainStateClaimCoverageDebt({ ...output, actionStateChecks: diagnostics.audit.checks, progressionChecks: diagnostics.progression.checks,
    reviewContractIssues: [], actionStateAuditIssues: [], progressionAuditIssues: [] }, diagnostics.audit.claimCoverageIssues);
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
export function semanticExample(input?: { expectedSceneKeys?: string[] }) {
  // One generic scene demonstrates the wire shape. Coverage belongs to the real input,
  // never to copies of this illustrative story for every expected key.
  const sceneKey = input?.expectedSceneKeys?.[0] ?? "example_scene";
  const evidence = [{ evidenceId: "从本次目录选择编号" }];
  const fact = (claim: string, storyTime: "before_or_at_action" | "during_or_after_action", reason: string) => ({
    entity: "她对合同欠款条款的知情", dimension: "knowledge", claim, evidence, storyTime, support: "supported", reason,
  });
  return {
    score: { coherence: 82, pacing: 80, repetition: 85, engagement: 81, voice: 83, overall: 82 },
    summary: "知情后拒绝签字，选择及后果有依据。",
    sceneCausalityVerdicts: [{ sceneKey, outcomeObserved: true,
      choiceAndResistance: { claim: "她不接受欠款责任，面对签字要求作出拒绝。", evidence, support: "supported", reason: "引用须同时支持她的选择与面对的要求。" },
      constraints: [{ claim: "双方没有签约，合作仍未成立。", evidence, support: "supported", reason: "引用须支持拒签后合作未成立这一持续结果。" }],
    }],
    actionStateChecks: [{ sceneKey, actor: "她", action: "拒绝签字", actionEvidence: evidence,
      states: [{ entity: "她对合同欠款条款的知情", dimension: "knowledge", requiredForAction: "了解所拒绝的欠款条款",
        before: fact("知道合同要求承担欠款", "before_or_at_action", "引用阅读并理解条款的依据，知识在拒签前已有。"),
        after: fact("仍知道合同要求承担欠款", "during_or_after_action", "拒签时运用这条信息，未因拒绝而获得另一条知识。"),
        prerequisite: { status: "satisfied", basis: fact("知道合同要求承担欠款", "before_or_at_action", "同一条款已被理解。"), reason: "拒签前已知所拒绝的条款。" },
        resultChange: { status: "unchanged", basis: fact("仍知道合同要求承担欠款", "during_or_after_action", "行动中继续运用同一信息。"), reason: "她作出拒绝决定，这条知识仍然存在；不是知识内容改变。" },
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
