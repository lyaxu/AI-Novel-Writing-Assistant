import type { ChapterAcceptanceAssessmentOutput, ChapterAcceptancePromptInput } from "../chapterAcceptance.prompts";
import { validateActionStateEvidence } from "./actionStateEvidence";
import { collectAcceptanceIssueSources, validateProgressionEvidence } from "./progressionEvidence";

export interface ReviewDiagnosticOptions { citationMode: "refs" | "legacy" }

const progressionCorrections: Record<string, { fields: string; instruction: string }> = {
  previous_quote_not_in_established_prose: { fields: "previousEvidence", instruction: "前章证据只能来自本次提供的已写前章，不能用本章、计划或未提供的章节替代。" },
  current_quote_not_in_current_prose: { fields: "currentEvidence", instruction: "本章证据必须来自当前审查正文，不能把前章证据换标签充当本章。" },
  current_evidence_missing: { fields: "currentEvidence/status", instruction: "当前结论声称有比较或进展，却缺本章依据；补足实际依据，确实无法核实时如实声明证据不足，不得编造。" },
  comparison_evidence_missing: { fields: "previousEvidence/status", instruction: "停滞或有价值的重复需要前后双方依据；缺前文则不能认证已重复。" },
  prior_goal_evidence_missing: { fields: "previousEvidence/status", instruction: "声称前章目标已落实，必须先证明前章确有该决定，再核对本章执行或改选。" },
  actual_change_missing: { fields: "actualChange/status", instruction: "progressed须说明实际变化；不要用计划或空字符串冒充已发生增量。" },
  new_consequence_missing: { fields: "newConsequence/status", instruction: "justified_repetition须说明此次重复的具体新后果；不能把其他无关桥段的新变化填在此处。" },
  repair_suggestion_missing: { fields: "repairSuggestion/status", instruction: "确证stalled须给局部、可执行的调整方向，指出保留内容与应承接的行动；不得凭空增加大事件。" },
  semantic_findings_unknown: { fields: "repeatsEstablishedBeat/addsNewConsequence/status", instruction: "当前确定结论与未知语义判断冲突；结合全文完成判断，仍未知时使用insufficient_evidence，不凭猜测填写true/false。" },
  repetition_evidence_missing: { fields: "previousEvidence/repeatsEstablishedBeat", instruction: "声明重演既有事件须有前章依据；无法确认旧事件时不能认证重复。" },
  progressed_conflicts_with_repeated_beat: { fields: "status/repeatsEstablishedBeat", instruction: "已声明重演旧职责，不能同时判为progressed；结合新后果区分有价值的重复或停滞，不能机械改布尔值。" },
  justified_repetition_conflicts_with_semantic_findings: { fields: "status/repeatsEstablishedBeat/addsNewConsequence", instruction: "justified_repetition要求确有重复且确有新后果；当前否定判断与结论冲突，须按全文重评。" },
  stalled_conflicts_with_new_consequence: { fields: "status/addsNewConsequence", instruction: "已声明该重复带来新后果，却又判停滞；核对后果是否真的属于被比较的事件，再统一结论。" },
  declared_consequence_missing: { fields: "addsNewConsequence/newConsequence", instruction: "已声明有新后果，必须说明具体发生了什么，并给对应本章依据。" },
  progressed_but_consequence_denied: { fields: "status/repeatsEstablishedBeat/addsNewConsequence", instruction: "progressed与明确否认新增后果相矛盾；核对行动、认知、关系或选择的真实变化，不得只改标签凑通过。" },
  previous_prose_unavailable: { fields: "status/previousEvidence", instruction: "后章缺少前章原文时，不能以not_applicable认证没有继承职责；使用insufficient_evidence保留无法核验的范围。" },
  dimension_coverage_invalid: { fields: "dimension", instruction: "每个推进维度必须恰好一行；补齐缺项并合并重复项，保留实际审查发现。" },
};

function evidenceInstruction(mode: ReviewDiagnosticOptions["citationMode"]): string {
  return mode === "refs"
    ? "引用操作只选择本次目录的evidenceId；原文、来源和位置由程序还原，不生成quote/source/sourceId，不改正文。"
    : "引用操作须从声明来源复制连续准确原文；保持真实来源与标点，不补写原文没有的文字，不改正文。";
}

/** Collect all independent findings before the one contextual semantic correction.
 * Known review failures are data; unexpected programming/runtime exceptions propagate.
 */
export function collectAcceptanceDiagnostics(
  output: ChapterAcceptanceAssessmentOutput,
  input: ChapterAcceptancePromptInput,
  options: ReviewDiagnosticOptions,
) {
  const problems: string[] = [];
  const correctionHints: string[] = [evidenceInstruction(options.citationMode)];
  const expected = input.expectedSceneKeys ?? [];
  const actual = (output.sceneCausalityVerdicts ?? []).map(row => row.sceneKey);
  if (actual.length !== expected.length || new Set(actual).size !== actual.length || expected.some(key => !actual.includes(key))) {
    problems.push("sceneCausalityVerdicts:scene_coverage_invalid");
    correctionHints.push(`sceneCausalityVerdicts：当前sceneKey=${JSON.stringify(actual)}；要求=${JSON.stringify(expected)}。必须逐一覆盖指定场景，每项恰好一次，无指定场景时返回空数组；补齐或合并，不丢弃既有发现。`);
  }

  const sourceProblems = collectAcceptanceIssueSources(output.blockingIssues, input);
  for (const issue of sourceProblems) {
    problems.push(`${issue.path}:${issue.code}`);
    correctionHints.push(`${issue.path}：${issue.message} ${issue.code === "current_issue_source_missing"
      ? "指出本章缺陷至少需要本章依据；跨章矛盾另附前章依据，前章不能独自证明本章缺陷。"
      : "核对该依据确实来自所声明的已写正文，不得用计划、摘要或另章内容冒充；无法核实时不要保留确定缺陷及补文指令。"} ${evidenceInstruction(options.citationMode)}`);
  }

  const audit = validateActionStateEvidence(output.actionStateChecks ?? [], input, options);
  const progression = validateProgressionEvidence(output.progressionChecks ?? [], input);
  problems.push(...audit.coverageIssues, ...progression.coverageIssues);
  correctionHints.push(...audit.correctionHints);
  if (audit.coverageIssues.length) correctionHints.push(`actionStateChecks覆盖：当前sceneKey=${JSON.stringify((output.actionStateChecks ?? []).map(row => row.sceneKey))}；要求=${JSON.stringify(expected.length ? expected : ["chapter"])}。每场恰好一个关键行动，补齐缺项并合并重复检查，不用其他场景代替。`);
  if (progression.coverageIssues.length) correctionHints.push(`progressionChecks覆盖：当前dimension=${JSON.stringify((output.progressionChecks ?? []).map(row => row.dimension))}。event_repetition、knowledge_repetition、prior_goal_followthrough各一行，不能缺漏或重复。`);

  audit.checks.forEach((row, index) => {
    for (const code of row.validationIssues ?? []) problems.push(`actionStateChecks[${index}](sceneKey=${row.sceneKey}):${code}`);
  });
  progression.checks.forEach((row, index) => {
    const original = output.progressionChecks![index];
    const current = {
      status: original.status, repeatsEstablishedBeat: original.repeatsEstablishedBeat,
      addsNewConsequence: original.addsNewConsequence, actualChange: original.actualChange,
      newConsequence: original.newConsequence, repairSuggestion: original.repairSuggestion,
      previousEvidence: original.previousEvidence, currentEvidence: original.currentEvidence,
    };
    for (const code of row.validationIssues ?? []) {
      const correction = progressionCorrections[code];
      if (!correction) throw new Error(`Missing progression correction contract for ${code}`);
      const path = `progressionChecks[${index}](dimension=${row.dimension})`;
      problems.push(`${path}:${code}`);
      correctionHints.push(`${path}.${correction.fields}：${code}；当前值=${JSON.stringify(current)}。${correction.instruction}`);
    }
  });
  return { audit, progression, problems: [...new Set(problems)], correctionHints: [...new Set(correctionHints)] };
}
