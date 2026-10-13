import type { ChapterAcceptanceAssessmentOutput, ChapterAcceptancePromptInput, ReferenceChapterAcceptanceOutput } from "../chapterAcceptance.prompts";
import { buildEvidenceCatalog, resolveEvidenceReference } from "./evidenceCatalog";

export const BEFORE_TIMING_CONTRACT = '每个states项必须完整给出beforeEvidenceTiming={relation:"before_or_at_action|retrospective_prior_state|not_before_action|unknown",reason:"结合所选证据说明故事发生时间"}，relation从四项选一。before_state_after_action表示证据在后文，不能仅原样重发：若后文回述行动前已有条件，选retrospective_prior_state并说明依据；确实事后才成立选not_before_action；无法核实选unknown并如实保留不确定性。before_or_at_action仅表示按顺序写出的前置事实，不能豁免后置证据检查。';

/** Require an AI time finding in the full-context semantic pass, never infer it in JSON repair. */
export function missingReferenceTiming(raw: ReferenceChapterAcceptanceOutput): string[] {
  return raw.actionStateChecks.flatMap((check, index) => check.states.flatMap((state, stateIndex) =>
    state.beforeEvidenceTiming ? [] : [`actionStateChecks[${index}](sceneKey=${check.sceneKey}).states[${stateIndex}].beforeEvidenceTiming:required_story_time_finding_missing`]));
}

/** Resolve all provenance-bearing fields without asking the model to reproduce any source text. */
export function resolveAcceptanceReferences(raw: ReferenceChapterAcceptanceOutput, input: ChapterAcceptancePromptInput) {
  const catalog = buildEvidenceCatalog(input);
  const issues: string[] = [];
  const resolve = (refs: Array<{ evidenceId: string }>, field: string) => refs.flatMap((ref, index) => {
    try { return [resolveEvidenceReference(catalog, ref)]; }
    catch (error) {
      issues.push(`${field}[${index}]: ${error instanceof Error ? error.message : String(error)} snapshot=${catalog.snapshotId}`);
      return [];
    }
  });
  const output: ChapterAcceptanceAssessmentOutput = {
    ...raw,
    evidenceCatalogSnapshotId: catalog.snapshotId,
    actionStateChecks: raw.actionStateChecks.map((check, index) => ({
      ...check, actionEvidence: resolve(check.actionEvidence, `actionStateChecks[${index}].actionEvidence`),
      states: check.states.map((state, stateIndex) => ({
        ...state,
        beforeEvidence: resolve(state.beforeEvidence, `actionStateChecks[${index}].states[${stateIndex}].beforeEvidence`),
        afterEvidence: resolve(state.afterEvidence, `actionStateChecks[${index}].states[${stateIndex}].afterEvidence`),
        transitionEvidence: resolve(state.transitionEvidence, `actionStateChecks[${index}].states[${stateIndex}].transitionEvidence`),
      })),
    })),
    progressionChecks: raw.progressionChecks.map((check, index) => ({
      ...check,
      previousEvidence: resolve(check.previousEvidence, `progressionChecks[${index}].previousEvidence`),
      currentEvidence: resolve(check.currentEvidence, `progressionChecks[${index}].currentEvidence`),
    })),
    blockingIssues: raw.blockingIssues.map((issue, index) => ({
      ...issue, sourceEvidence: resolve(issue.sourceEvidence, `blockingIssues[${index}].sourceEvidence`),
    })),
  };
  output.evidenceReferenceIssues = issues;
  return { output, issues };
}

export const REFERENCE_AUDIT_RULES = [
  "仅actionStateChecks的actionEvidence、states中的beforeEvidence/afterEvidence及prerequisite.evidence/resultChange.evidence、progressionChecks的previousEvidence/currentEvidence、blockingIssues的sourceEvidence使用{evidenceId}对象数组，从末尾本次正文证据目录选择编号。不输出quote、source、sourceId或位置。sceneCausalityVerdicts的prerequisiteEvidence/constraintEvidence仍为说明字符串数组，choiceAndResistanceEvidence/outcomeMechanismEvidence/explanation仍为说明字符串，不填编号对象。原文与来源由程序还原；每条编号绑定本次正文，不可自编或沿用其他稿件编号。",
  "actionEvidence以及afterEvidence必须包含current_prose编号；beforeEvidence可用本章或已写前章。progressionChecks.previousEvidence只用established_context，currentEvidence只用current_prose。blockingIssues.sourceEvidence至少含本章证据，跨章冲突另附前章编号。计划、摘要、场景卡不属于事实证据目录。",
  "编号只证明这段原文存在，不证明结论正确。逐项判断所选片段是否确实支持对应人物、状态、行动、变化或缺陷。错误来源用途、不支持结论、未知状态仍须如实记录，不得为通过校验随意选一个存在的编号。",
  "每个states项必须填写beforeEvidenceTiming对象，完整格式为{relation:\"before_or_at_action\",reason:\"说明所选beforeEvidence在故事中为何早于行动或在开始时成立\"}。relation四选一：before_or_at_action=按叙述顺序在行动前或开始时成立；retrospective_prior_state=后文补述行动前已有的条件；not_before_action=确实事后才成立；unknown=无法确认。reason必填，须结合证据判断，不能省略该对象或只写relation字符串。",
  "文本位置不等于故事时间。结构示例：先写她开锁，后说明她幼年已学会开锁，则能力的beforeEvidenceTiming={relation:\"retrospective_prior_state\",reason:\"此处后叙幼年所学，能力在本次开锁前已有，不是开锁后才获得\"}。若确为事后获得则not_before_action；无法确认则unknown，行动结论由程序汇总、场景结论保持insufficient_evidence。不要改选行动回避核验，回叙不能豁免必须先完成的过渡。",
  "每个expectedSceneKey恰好选一个决定结果的关键行动（最多8条），无合同用chapter；states只选有关body/item/ability/knowledge/location维度，一般1—2项。actionEvidence和各状态before/after/prerequisite/resultChange证据至多2个编号，原文跨片段可选相邻两项，不拼写新引文。",
  "先确定action，再判断行动前或开始时的before、所需条件requiredForAction、行动中或之后的after。缺少前文或证据不足时可用unknown和空证据数组，不能编造前情；动作或场景不得以earned掩盖未知、冲突或缺失变化。",
  "每项state分别填写prerequisite={status,evidence,reason}与resultChange={status,evidence,reason}。prerequisite只判断requiredForAction在使用时是否具备：satisfied已有条件；established本次在使用前或使用时建立；missing缺少必要前提；contradicted与正文冲突；unknown无法判断。satisfied可用已写前章或本章的既有条件依据；established只用本章在使用前或使用时建立条件的过程证据，不用前章背景掩盖本章事后获得。resultChange只比较该entity该dimension的before/after：unchanged未变；changed变化有正文过程；unsupported声称变化却缺必要过程；contradicted与正文冲突；unknown无法核实。changed需本章变化过程编号。reason解释各自判断。",
  "不要输出stateChanged/enablingTransitionRequired/transitionStatus/transitionEvidence以及actionStateChecks.verdict，它们由程序汇总。已有技能被使用不等于技能增长，身体受伤不能混进ability；告知别人不等于说话人新获知识。前提已具备与行动后发生变化可以同时成立，两个判断分别给证据。",
  "结构示例（不带入故事）：她拿着钥匙，将钥匙交给门卫，门卫收下。对于她持有钥匙这一item状态，prerequisite.status=satisfied（交付前已持有）、resultChange.status=changed（交付后不再持有）；分别选持有和交付过程编号。无需另造获得钥匙的前置事件。若她被绑住却未解缚就起身，前提missing；授权的魔法/系统赠予可直接建立前提，不额外要求训练或代价。真实局部缺陷交给修订/质量债，未知不生成补写剧情指令。",
  "progressionChecks恰好覆盖event_repetition、knowledge_repetition、prior_goal_followthrough。先判断repeatsEstablishedBeat与addsNewConsequence，再选progressed/justified_repetition/stalled/insufficient_evidence/not_applicable；判定与actualChange/newConsequence/explanation一致。重复无新后果不能progressed，justified_repetition须真实新增后果。",
  "首章没有比较职责可not_applicable且两布尔为null、证据为空；后章缺前章正文用insufficient_evidence，不能宣称前章无目标。stalled/justified_repetition须双方证据，prior_goal_followthrough=progressed须先前决定与本次行动。未知不能自动产生补写剧情指令。",
  "细腻的认知、关系、情绪变化、受阻改选和新的代价均可构成推进，不要求每章胜利或大场面。区分知道任务、知道内容、知道位置、知道方法；人物局部未知不等于遗忘全部信息。逐条读完整上下文，不把计划当成实际发生，不以关键词和题材模板判断。",
];
