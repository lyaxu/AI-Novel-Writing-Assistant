import type { ChapterAcceptanceAssessmentOutput, ChapterAcceptancePromptInput, UnifiedChapterAcceptanceOutput } from "../chapterAcceptance.prompts";
import { buildEvidenceCatalog } from "./evidenceCatalog";
import { resolveAcceptanceReferences, BEFORE_TIMING_CONTRACT } from "./referenceAssessment";
import { normalizeReferenceActions } from "./stateAssessment";
import { collectAcceptanceDiagnostics } from "./reviewDiagnostics";
import { reconcileSceneActionVerdicts } from "./actionStateEvidence";

function inspect(raw: UnifiedChapterAcceptanceOutput, input: ChapterAcceptancePromptInput) {
  // Resolve every independent section before collecting problems; one bad ID cannot hide other findings.
  const resolved = resolveAcceptanceReferences({ ...raw, actionStateChecks: [] }, input);
  const actions = normalizeReferenceActions(raw.actionStateChecks, buildEvidenceCatalog(input));
  const output: ChapterAcceptanceAssessmentOutput = { ...resolved.output, actionStateChecks: actions.checks };
  const diagnostics = collectAcceptanceDiagnostics(output, input, { citationMode: "refs" });
  const timingProblems = actions.checks.flatMap((check, index) => check.states.flatMap((state, stateIndex) =>
    state.beforeEvidenceTiming ? [] : [`actionStateChecks[${index}].states[${stateIndex}].beforeEvidenceTiming:required_story_time_finding_missing`]));
  const problems = [...new Set([...resolved.issues, ...actions.problems, ...timingProblems, ...diagnostics.problems])];
  const hints = [...diagnostics.correctionHints, BEFORE_TIMING_CONTRACT,
    "每个状态只回答prerequisite和resultChange两项：prerequisite判断行动要求在使用时是否满足，resultChange判断该人物该维度在行动后是否改变以及是否有依据。已有能力被使用不等于能力增长；受伤属于body，物品消耗属于item，告知别人不等于说话人获得新知识。不要混换人物或维度。",
    "prerequisite.status=satisfied需既有前提的证据；established需本次在使用前或使用时建立条件的证据；missing/contradicted/unknown须如实判断。resultChange.status=changed需本章变化过程证据；unchanged表示该维度未变；unsupported/contradicted/unknown分别表示声称的变化缺桥梁、冲突、无法判断。reason解释依据。",
    "原文只按目录evidenceId引用，不输出quote/source/offset。不要输出旧stateChanged/enablingTransitionRequired/transitionStatus/transitionEvidence或action.verdict，程序根据以上结构化结论汇总。只纠正审查回答，不改正文、不删真实问题、不重选行动躲避核验。"];
  return { output, diagnostics, problems, hints };
}

export function validateUnifiedAcceptance(raw: UnifiedChapterAcceptanceOutput, input: ChapterAcceptancePromptInput) {
  const { output, diagnostics, problems, hints } = inspect(raw, input);
  if (problems.length) throw Object.assign(new Error([
    "审查回答尚未完成以下核验；同一轮一起纠正所有已列问题。", ...problems, ...hints,
  ].join("\n")), { reviewContractIssues: problems, reviewCorrectionHints: hints });
  return {
    ...output,
    actionStateChecks: diagnostics.audit.checks,
    progressionChecks: diagnostics.progression.checks,
    actionStateAuditIssues: [], progressionAuditIssues: [], reviewContractIssues: [],
    sceneCausalityVerdicts: reconcileSceneActionVerdicts(output.sceneCausalityVerdicts ?? [], diagnostics.audit.checks),
  };
}

export function recoverUnifiedAcceptance(raw: UnifiedChapterAcceptanceOutput, input: ChapterAcceptancePromptInput, validationError: string): ChapterAcceptanceAssessmentOutput {
  const { output, diagnostics, problems, hints } = inspect(raw, input);
  if (!problems.length) throw new Error(validationError);
  return {
    ...output, status: "needs_manual_review", continuePolicy: "pause", repairability: "none",
    reviewContractIssues: problems, reviewCorrectionHints: hints,
    reviewRawResponse: structuredClone(raw),
    decisionReason: "审查依据或判断仍有未核实项，保留回答与稿件，从审查步骤处理。",
    riskTags: [...new Set([...output.riskTags, "acceptance_source_evidence_unverified"])],
    deferredRepairDirectives: output.repairDirectives, deferredMissingObligations: output.missingObligations,
    repairDirectives: [], missingObligations: [],
    actionStateChecks: diagnostics.audit.checks, actionStateAuditIssues: diagnostics.audit.coverageIssues,
    progressionChecks: diagnostics.progression.checks, progressionAuditIssues: diagnostics.progression.coverageIssues,
    sceneCausalityVerdicts: reconcileSceneActionVerdicts(output.sceneCausalityVerdicts ?? [], diagnostics.audit.checks),
  };
}

/** Only the fixed schema illustration is converted; live historical answers are never upgraded by guessing. */
export function unifiedExample(example: unknown): unknown {
  const output = structuredClone(example) as { actionStateChecks: Array<{ verdict?: string; states: Array<Record<string, unknown>> }> };
  for (const check of output.actionStateChecks) {
    delete check.verdict;
    for (const state of check.states) {
      state.prerequisite = { status: "satisfied", evidence: state.beforeEvidence, reason: "示例角色已读完条款，拒绝签字时具备所需信息。" };
      state.resultChange = { status: "unchanged", evidence: [], reason: "拒绝签字未改变她已经知情这一状态。" };
      for (const key of ["stateChanged", "enablingTransitionRequired", "transitionStatus", "transitionEvidence"]) delete state[key];
    }
  }
  return output;
}
