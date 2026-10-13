import type { ChapterAcceptanceAssessmentOutput, ChapterAcceptancePromptInput, ReferenceChapterAcceptanceOutput } from "../chapterAcceptance.prompts";
import { buildEvidenceCatalog, resolveEvidenceReference } from "./evidenceCatalog";

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
  "所有结构化证据对象只写{evidenceId}，从末尾本次正文证据目录选择编号；不输出quote、source、sourceId或位置，原文与来源由程序还原。每条编号绑定本次正文，不可自编、改写或沿用其他稿件编号。",
  "actionEvidence以及afterEvidence必须包含current_prose编号；beforeEvidence可用本章或已写前章。progressionChecks.previousEvidence只用established_context，currentEvidence只用current_prose。blockingIssues.sourceEvidence至少含本章证据，跨章冲突另附前章编号。计划、摘要、场景卡不属于事实证据目录。",
  "编号只证明这段原文存在，不证明结论正确。逐项判断所选片段是否确实支持对应人物、状态、行动、变化或缺陷。错误来源用途、不支持结论、未知状态仍须如实记录，不得为通过校验随意选一个存在的编号。",
  "文本叙述顺序与故事发生时间分开。后文回叙既有技能或先前物品时，beforeEvidenceTiming可为retrospective_prior_state并给理由；确为事后才成立用not_before_action，无法确认用unknown。不要改选行动来回避核验，回叙不能豁免必要前提。",
  "每个expectedSceneKey恰好选一个决定结果的关键行动（最多8条），无合同用chapter；states只选有关body/item/ability/knowledge/location维度，一般1—2项。actionEvidence和各状态before/after/transition证据至多2个编号，原文跨片段可选相邻两项，不拼写新引文。",
  "先确定action，再判断行动前或开始时的before、所需条件requiredForAction、行动中或之后的after。缺少前文或证据不足时可用unknown和空证据数组，不能编造前情；动作或场景不得以earned掩盖未知、冲突或缺失变化。",
  "stateChanged表示本次状态是否变化；enablingTransitionRequired表示行动能成立前必须发生变化。行动本身造成变化时stateChanged=true、enablingTransitionRequired=false、transitionStatus=established并选择变化过程编号；not_needed只在两布尔值均false时成立。established必须有transitionEvidence，授权觉醒/赠予可与行动同步，不另加代价或训练。",
  "transitionStatus为not_needed/established/missing/contradicted/unknown。必要前提未建立用missing，对应动作unearned；实际冲突用contradicted；无证据可判断用unknown，对应insufficient_evidence。结果出现不自动证明人物具备条件。动作失败不能同时维持场景earned。",
  "progressionChecks恰好覆盖event_repetition、knowledge_repetition、prior_goal_followthrough。先判断repeatsEstablishedBeat与addsNewConsequence，再选progressed/justified_repetition/stalled/insufficient_evidence/not_applicable；判定与actualChange/newConsequence/explanation一致。重复无新后果不能progressed，justified_repetition须真实新增后果。",
  "首章没有比较职责可not_applicable且两布尔为null、证据为空；后章缺前章正文用insufficient_evidence，不能宣称前章无目标。stalled/justified_repetition须双方证据，prior_goal_followthrough=progressed须先前决定与本次行动。未知不能自动产生补写剧情指令。",
  "细腻的认知、关系、情绪变化、受阻改选和新的代价均可构成推进，不要求每章胜利或大场面。区分知道任务、知道内容、知道位置、知道方法；人物局部未知不等于遗忘全部信息。逐条读完整上下文，不把计划当成实际发生，不以关键词和题材模板判断。",
];
