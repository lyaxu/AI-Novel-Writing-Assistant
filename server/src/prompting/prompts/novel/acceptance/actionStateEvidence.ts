import type { ActionStateCheck, ActionStateEvidence, SceneCausalityVerdict } from "@ai-novel/shared/types/novel/sceneCausality";
import { auditSemanticState } from "./semantic/actionFacts";

export interface ActionStateEvidenceInput {
  chapterId?: string;
  chapterOrder: number;
  content: string;
  expectedSceneKeys?: string[];
  establishedProse?: Array<{ chapterId: string; order: number; content: string }>;
}

const compact = (text: string) => text.replace(/\s+/gu, "");

/** Positions locate quotations. Story time is an AI finding, not an inference from character offsets. */
function positions(text: string, quote: string): number[] {
  const source = compact(text);
  const needle = compact(quote);
  if (!needle) return [];
  const found: number[] = [];
  for (let start = source.indexOf(needle); start >= 0; start = source.indexOf(needle, start + 1)) found.push(start);
  return found;
}

/** Catalog citations retain their exact occurrence; legacy records alone use text search. */
function evidencePositions(text: string, evidence: ActionStateEvidence): number[] {
  if (evidence.start !== undefined || evidence.end !== undefined) {
    if (!Number.isInteger(evidence.start) || !Number.isInteger(evidence.end)
      || evidence.start! < 0 || evidence.end! <= evidence.start! || evidence.end! > text.length
      || text.slice(evidence.start, evidence.end) !== evidence.quote || !compact(evidence.quote)) return [];
    return [compact(text.slice(0, evidence.start)).length];
  }
  return positions(text, evidence.quote);
}

export function validateActionStateEvidence(checks: ActionStateCheck[], input: ActionStateEvidenceInput, options?: { citationMode: "refs" | "legacy" }) {
  const correctionHints: string[] = [];
  const expected = input.expectedSceneKeys?.length ? input.expectedSceneKeys : ["chapter"];
  const coverageIssues = expected.filter((key) => !checks.some((check) => check.sceneKey === key))
    .map((key) => `action_state_coverage_missing:${key}`);
  for (const key of expected) {
    if (checks.filter((check) => check.sceneKey === key).length > 1) coverageIssues.push(`action_state_coverage_duplicate:${key}`);
  }
  const context = new Map((input.establishedProse ?? [])
    .filter((chapter) => chapter.order < input.chapterOrder && chapter.chapterId !== input.chapterId)
    .map((chapter) => [chapter.chapterId, chapter.content]));
  const currentId = input.chapterId ?? "current";
  const sourceProblem = (evidence: ActionStateEvidence): string | undefined => {
    if (evidence.source === "planned_contract") return "planned_contract_is_not_prose";
    const content = evidence.source === "current_prose"
      ? evidence.sourceId === currentId ? input.content : undefined
      : context.get(evidence.sourceId);
    if (content === undefined) return "declared_source_unavailable";
    if (!evidencePositions(content, evidence).length) return "quote_not_found";
    return undefined;
  };
  const isFact = (evidence: ActionStateEvidence): boolean => sourceProblem(evidence) === undefined;
  const explainSources = (evidence: ActionStateEvidence[], field: string) => {
    evidence.forEach((item, index) => {
      const problem = sourceProblem(item);
      if (!problem) return;
      const reason = problem === "quote_not_found" ? "在声明来源中未找到连续准确原文"
        : problem === "declared_source_unavailable" ? "声明的来源ID未提供对应正文"
          : "计划不是已发生事实的正文来源";
      correctionHints.push(`${field}[${index}]：${problem}，${reason}。source=${item.source}，sourceId=${JSON.stringify(item.sourceId)}，quote=${JSON.stringify(item.quote)}。这条引用尚未定位，不判断时序。${options?.citationMode === "refs" ? "从本次目录选择支持结论的evidenceId；原文、来源和位置由程序还原，不输出quote/source/sourceId。" : "回到声明来源逐字核对连续原文，不要额外添加引号或改标点；JSON字符串外层引号不是引文内容，不可仅替换sourceId冒充来源。"}找不到依据则如实标未知，不能删除真实证据来认证通过，也不能修改正文。`);
    });
  };
  const rows = checks.map((check, checkIndex): ActionStateCheck => {
    const invalid: string[] = [];
    let missing = false;
    let contradiction = false;
    let unknown = false;
    const checkField = `actionStateChecks[${checkIndex}](sceneKey=${check.sceneKey})`;
    explainSources(check.actionEvidence, `${checkField}.actionEvidence`);
    if (!expected.includes(check.sceneKey)) invalid.push("unexpected_scene");
    if (!check.actionEvidence.length || check.actionEvidence.some((item) => item.source !== "current_prose" || !isFact(item))) {
      invalid.push("action_not_in_current_prose");
      const wrongRoleFields = check.actionEvidence.length
        ? check.actionEvidence.flatMap((item, index) => item.source !== "current_prose" ? [`${checkField}.actionEvidence[${index}]`] : [])
        : [`${checkField}.actionEvidence`];
      for (const field of wrongRoleFields) correctionHints.push(`${field}：关键行动必须由本章current_prose证明，前章事实不能作为本次行动的定位锚点；从本章引用实际行动，不要只改来源标签。`);
    }
    if (check.states.some(state => state.semanticFacts) && check.actionEvidence.length !== 1) {
      invalid.push("semantic_action_requires_single_anchor");
      correctionHints.push(`${checkField}.actionEvidence：每场只选一个明确的原子行动及1条本章目录证据；不能拼接多个时刻来放宽前提或结果的时间边界。`);
    }
    // No position comparison until every action anchor has a verified current-prose source.
    const actionLocated = check.actionEvidence.length > 0
      && check.actionEvidence.every(item => item.source === "current_prose" && isFact(item));
    const actionPositions = actionLocated ? evidencePositions(input.content, check.actionEvidence[0]) : [];
    const actionStart = actionPositions[0];
    const actionEnd = actionStart === undefined ? undefined : actionStart + compact(check.actionEvidence[0].quote).length;
    const entities = new Set<string>();
    for (const [stateIndex, state] of check.states.entries()) {
      const field = `${checkField}.states[${stateIndex}]`;
      const key = `${state.dimension}:${state.entity}`;
      if (entities.has(key)) invalid.push(`duplicate_state:${key}`);
      entities.add(key);
      if (state.semanticFacts) {
        const facts = state.semanticFacts;
        const roles = [
          { name: "before", fact: facts.before, current: false },
          { name: "after", fact: facts.after, current: true },
          { name: "prerequisite.basis", fact: facts.prerequisite?.basis,
            current: facts.prerequisite?.status === "established" },
          { name: "resultChange.basis", fact: facts.resultChange?.basis, current: true },
        ];
        for (const role of roles) {
          const evidence = role.fact?.evidence ?? [];
          explainSources(evidence, `${field}.${role.name}.evidence`);
          if (evidence.some(item => !isFact(item))) invalid.push(`unverified_semantic_source:${key}:${role.name}`);
          if (role.current && evidence.some(item => item.source !== "current_prose")) {
            invalid.push(`semantic_role_requires_current_prose:${key}:${role.name}`);
            correctionHints.push(`${field}.${role.name}.evidence：该角色须由本章正文支持，前章只能证明既有事实，不能独自证明本次行动或本章建立的前提；选择本章对应evidenceId，不改来源标签。`);
          }
        }
        const audit = auditSemanticState(state, field);
        invalid.push(...audit.problems);
        correctionHints.push(...audit.problems);
        contradiction ||= audit.contradiction;
        missing ||= audit.missing;
        unknown ||= audit.unknown;
        // v16 facts are authoritative. Offsets locate exact citations only; none of
        // the legacy narrative-position rules below may decide their story time.
        continue;
      }
      const cited = [...state.beforeEvidence, ...state.afterEvidence, ...state.transitionEvidence];
      if (cited.some((item) => !isFact(item))) invalid.push(`unverified_source:${key}`);
      for (const role of (state.assessment ? ["beforeEvidence", "afterEvidence"] : ["beforeEvidence", "afterEvidence", "transitionEvidence"]) as Array<"beforeEvidence" | "afterEvidence" | "transitionEvidence">) {
        explainSources(state[role], `${field}.${role}`);
      }
      const afterSourcesLocated = state.afterEvidence.length > 0 && state.afterEvidence.every(isFact);
      const hasCurrentAfter = state.afterEvidence.some(item => item.source === "current_prose");
      if (afterSourcesLocated && !hasCurrentAfter) {
        invalid.push(`after_state_requires_current_prose:${key}`);
        correctionHints.push(`${field}.afterEvidence：已写前章可说明既有前提，但不能独自证明本次行动中或之后的状态。afterEvidence必须包含本章current_prose的准确引文；这是来源角色不符，不判断时序。不要仅替换source/sourceId，须回到本章核对实际表现。`);
      }
      if (!state.beforeEvidence.length || !state.afterEvidence.length) unknown = true;
      const timing = state.beforeEvidenceTiming;
      const timingReasonPresent = Boolean(timing?.reason?.trim());
      if (timing && !timingReasonPresent) invalid.push(`before_timing_reason_missing:${key}`);
      const retrospective = timing?.relation === "retrospective_prior_state";
      const retrospectiveSourceValid = state.beforeEvidence.some(item => item.source === "current_prose" && isFact(item))
        && state.beforeEvidence.every(isFact);
      if (retrospective && !retrospectiveSourceValid) invalid.push(`retrospective_before_source_missing:${key}`);
      if (retrospective && state.enablingTransitionRequired && !state.assessment) {
        invalid.push(`retrospective_conflicts_with_required_transition:${key}`);
        correctionHints.push(`${field}：既有状态回叙与enablingTransitionRequired=true不能同时用来豁免前提核验。请按正文判断是早已具备条件，还是本次行动需要先发生变化；后者仍须给出真实的前置transitionEvidence，不能用回叙标签替代。`);
      }
      if (timing?.relation === "not_before_action") contradiction = true;
      if (timing?.relation === "unknown") unknown = true;
      // Only consume an explicit, source-backed semantic finding. This does not certify
      // the AI's literary judgment, infer tense, or excuse a missing enabling transition.
      const explicitTiming = timingReasonPresent && (
        (retrospective && retrospectiveSourceValid && (!state.enablingTransitionRequired || Boolean(state.assessment)))
        || timing?.relation === "not_before_action" || timing?.relation === "unknown"
      );
      if (actionStart !== undefined) {
        if (!explicitTiming && state.beforeEvidence.some((item) => item.source === "current_prose" && isFact(item)
          && !evidencePositions(input.content, item).some((position) => position <= actionStart))) {
          invalid.push(`before_state_after_action:${key}`);
          correctionHints.push(`${field}.beforeEvidence：引文在文本中的位置晚于actionEvidence起点，尚缺故事时间判断；晚叙述不等于晚发生。actionEvidence=${JSON.stringify(check.actionEvidence.map(item => item.quote))}；beforeEvidence=${JSON.stringify(state.beforeEvidence.map(item => item.quote))}。请结合完整正文判断：若引文回述行动前已有的状态，保留准确依据并填写beforeEvidenceTiming={relation:"retrospective_prior_state",reason:"说明该事实为何早于本次行动"}；若确实在行动后才成立，填not_before_action；无法判断填unknown。${options?.citationMode === "refs" ? "结合正文同步核对prerequisite和resultChange，行动结论由程序汇总；引用仍只选evidenceId。" : "同步给出contradicted/unearned或insufficient_evidence的动作与场景结论。"}不可换一个行动躲开核验、删除真实依据或改写正文。`);
        }
        // Missing evidence can be an honest audit result; supplied evidence must still match the action boundary.
        const explicitlyUnknownAfter = !state.afterEvidence.length
          && (state.assessment ? state.assessment.resultChange.status === "unknown"
            : check.verdict === "insufficient_evidence" && state.transitionStatus === "unknown");
        // An unlocated quotation is a provenance failure, not evidence that it happened too early.
        if (!explicitlyUnknownAfter && state.afterEvidence.every(isFact)
          && (!state.afterEvidence.length || hasCurrentAfter)
          && !state.afterEvidence.some((item) => item.source === "current_prose"
          && evidencePositions(input.content, item).some((position) => position >= actionStart))) {
          invalid.push(`after_state_not_in_current_action:${key}`);
          correctionHints.push(`${field}.afterEvidence：所引证据未定位到关键行动发生时或之后。actionEvidence=${JSON.stringify(check.actionEvidence.map(item => item.quote))}；afterEvidence=${JSON.stringify(state.afterEvidence.map(item => item.quote))}。行动前的判断可作为beforeEvidence或必要过渡，不能单独证明after；请重新核对所选行动的边界，并引用正文中该行动发生时或之后的状态表现。无需正文重复解释知识，但须引用其在行动中的实际运用；原文不足则如实标未知，不编写新句子。`);
        }
      }
      if (state.assessment) {
        const { prerequisite, resultChange } = state.assessment;
        explainSources(prerequisite.evidence, `${field}.prerequisite.evidence`);
        explainSources(resultChange.evidence, `${field}.resultChange.evidence`);
        const requireEvidence = (evidence: ActionStateEvidence[], role: string, current: boolean) => {
          if (!evidence.length || evidence.some(item => !isFact(item) || current && item.source !== "current_prose")) {
            invalid.push(`assessment_evidence_missing_or_invalid:${key}:${role}`);
            correctionHints.push(`${field}.${role}.evidence：声明的判断需要${current ? "本章" : "已提供正文"}依据。选择支持该判断的目录evidenceId；不能只因结果出现就认证前提成立，也不能把计划或别人的状态当该人物的证据。`);
          }
        };
        if (["satisfied", "established"].includes(prerequisite.status)) {
          requireEvidence(prerequisite.evidence, "prerequisite", prerequisite.status === "established");
        }
        if (prerequisite.status === "established" && prerequisite.evidence.length && prerequisite.evidence.every(isFact)
          && actionEnd !== undefined && prerequisite.evidence.every(item => item.source === "current_prose"
            && evidencePositions(input.content, item).every(position => position >= actionEnd))) {
          contradiction = true;
          invalid.push(`prerequisite_established_after_action:${key}`);
          correctionHints.push(`${field}.prerequisite：建立必要前提的全部证据都晚于行动结束；不能用行动后取得的条件认证行动。按完整正文重新判断前提，确实缺失/冲突则给missing/contradicted，不能凭空补过程。`);
        }
        if (prerequisite.status === "satisfied" && state.beforeEvidenceTiming?.relation !== "retrospective_prior_state"
          && state.beforeEvidenceTiming?.relation !== "unknown" && state.beforeEvidenceTiming?.relation !== "not_before_action"
          && actionStart !== undefined && prerequisite.evidence.some(item => item.source === "current_prose" && isFact(item)
            && evidencePositions(input.content, item).every(position => position > actionStart))) {
          invalid.push(`prerequisite_satisfied_after_action:${key}`);
          correctionHints.push(`${field}.prerequisite：既有条件的证据后叙，需要beforeEvidenceTiming明确说明是否回述行动前已有状态；不得把事后才成立的条件填satisfied。`);
        }
        if (resultChange.status === "changed") {
          requireEvidence(resultChange.evidence, "resultChange", true);
          if (resultChange.evidence.length && resultChange.evidence.every(isFact) && actionStart !== undefined
            && !resultChange.evidence.some(item => item.source === "current_prose" && evidencePositions(input.content, item).some(position => position >= actionStart))) {
            invalid.push(`result_change_before_action:${key}`);
            correctionHints.push(`${field}.resultChange：行动结果变化应由行动中或之后的本章证据支持；前置准备不能独自证明结果。无法定位则如实unknown，不改正文。`);
          }
        }
        if (prerequisite.status === "missing" || resultChange.status === "unsupported") missing = true;
        if (prerequisite.status === "contradicted" || resultChange.status === "contradicted") contradiction = true;
        if (prerequisite.status === "unknown" || resultChange.status === "unknown") unknown = true;
        // New assessments are authoritative; the legacy transition summary is a compatibility projection.
        continue;
      }
      if (state.transitionStatus === "contradicted") contradiction = true;
      if (state.transitionStatus === "missing") missing = true;
      if (state.transitionStatus === "unknown") unknown = true;
      if ((!state.beforeEvidence.length || timing?.relation === "unknown" || state.transitionStatus === "unknown") && check.verdict === "earned") {
        correctionHints.push(`${field}：前状态缺少证据或已声明时序/变化未知，却仍将动作判为earned。若能从完整正文确认既有状态，保留准确来源及明确时序理由；确实未知则transitionStatus=unknown、动作和对应场景verdict=insufficient_evidence。动作发生不等于能力在此刻新获得，不能只为通过校验把stateChanged改成true。`);
      }
      if (state.transitionStatus === "not_needed" && (state.enablingTransitionRequired || state.stateChanged)) missing = true;
      if (state.transitionStatus === "not_needed" && (state.enablingTransitionRequired || state.stateChanged)) {
        invalid.push(`inconsistent_transition_fields:${key}`);
        correctionHints.push(`${field}：stateChanged=${state.stateChanged}、enablingTransitionRequired=${state.enablingTransitionRequired}与transitionStatus=not_needed矛盾。not_needed只适用于两者都为false。若正文写出了变化，使用established并从正文填写transitionEvidence；变化就是行动本身时可以引用该动作，无需另造前置情节。若变化缺失/相互冲突/无法判断，分别使用missing/contradicted/unknown并同步核对verdict。不要为了通过检查机械修改布尔值或降低结论。`);
      }
      if (state.transitionStatus === "established") {
        if (!state.transitionEvidence.length) unknown = true;
        if (!state.transitionEvidence.length) correctionHints.push(`${field}.transitionEvidence：transitionStatus=established但证据为空；${options?.citationMode === "refs" ? "从目录选择变化过程的evidenceId" : "逐字引用正文中的变化过程"}，行动本身造成变化时可引用actionEvidence。没有证据时须如实重评transitionStatus和verdict。`);
        // A transition can occur within the same action (e.g. an authorized awakening).
        // Only disjoint evidence after that action is deterministically too late; the AI reviews overlapping causality.
        if (state.enablingTransitionRequired && state.transitionEvidence.length
          && state.transitionEvidence.every(isFact) && actionEnd !== undefined
          && state.transitionEvidence.every((item) => item.source === "current_prose"
            && evidencePositions(input.content, item).every((position) => position >= actionEnd))) {
          contradiction = true;
          correctionHints.push(`${field}.transitionEvidence：所选必要前提的证据全部晚于关键行动结束；核对是否实际事后获得，不能仅以结果发生保持earned。`);
          // Unlike an invalid citation, this is a witnessed but too-late enabling event.
        }
      }
    }
    if (!check.states.length) invalid.push("state_checks_missing");
    const verdict = invalid.length ? "insufficient_evidence"
      : contradiction ? "contradicted"
        : missing ? "unearned"
          : unknown ? "insufficient_evidence" : check.verdict;
    const validationIssues = [...new Set([
      ...invalid,
      ...(contradiction && check.verdict === "earned" ? ["earned_conflicts_with_state_or_transition_order"] : []),
      ...(missing && check.verdict === "earned" ? ["earned_without_required_transition"] : []),
      ...(unknown && check.verdict === "earned" ? ["earned_without_state_evidence"] : []),
    ])];
    return { ...check, verdict, ...(validationIssues.length ? { validationIssues } : { validationIssues: [] }) };
  });
  return { checks: rows, coverageIssues, correctionHints };
}

/** A scene cannot remain earned when the same structured response identifies a broken key action. */
export function reconcileSceneActionVerdicts(scenes: SceneCausalityVerdict[], checks: ActionStateCheck[]): SceneCausalityVerdict[] {
  return scenes.map((scene) => {
    const failures = checks.filter((check) => check.sceneKey === scene.sceneKey && check.verdict !== "earned");
    if (!failures.length || scene.verdict !== "earned") return scene;
    const verdict = failures.some((check) => check.verdict === "contradicted") ? "contradicted"
      : failures.some((check) => check.verdict === "unearned") ? "unearned" : "insufficient_evidence";
    return { ...scene, verdict, explanation: `关键行动状态核验未成立：${failures.map((check) => check.action).join("；")}`.slice(0, 240) };
  });
}

export const ACTION_STATE_AUDIT_RULES = [
  "先核对每条引文确实存在于声明正文，再判断它与行动的时序。quote_not_found是引用抄写或来源错误，不是行动前后关系的结论；纠正时逐项处理明确指出的字段，不要原样复制错引或仅改变时序标签。摘录对白内部片段不额外加中文引号。例如正文‘她说：“我昨天取了钥匙，今天来开门。”’，可引用其中‘我昨天取了钥匙’，quote值本身不包含新增引号；若要引用带引号的对白，应从原文完整复制其实际边界。",
  "文本排列顺序与故事发生时间分开判断。beforeEvidence晚于action被叙述，不等于状态晚于行动才成立；紧随动作补叙的既有技能、早先拿到的物品、此前已知的信息均须按完整正文语义判断，不能凭字符位置判成凭空获得。不要改选行动或删掉真实前状态证据来躲开时序核验。",
  "每项state可填beforeEvidenceTiming={relation,reason}，reason为180字内的非空语义依据。relation=retrospective_prior_state表示准确的本章beforeEvidence是在回述行动前已有状态，不是行动后才取得的条件；这时enablingTransitionRequired=false，其余状态变化字段仍按正文判断。not_before_action表示该条件实际在行动后才成立，即使引文写在前面也不能支持earned；unknown表示无法判断故事时间，动作和场景须为insufficient_evidence。没有特殊叙事时序可省略该字段，不能只给标签不解释原文依据。此字段只说明beforeEvidence，不替代afterEvidence或必需的transitionEvidence。",
  "回叙结构示例（不带入当前故事）：正文‘她用钥匙打开保险柜。那把钥匙是父亲前一天交给她的。’，action=打开保险柜；beforeEvidence引用第二句，beforeEvidenceTiming={relation:\"retrospective_prior_state\",reason:\"叙述明确钥匙在前一天交付，本次开柜之前已持有\"}，持有钥匙这一状态stateChanged=false、enablingTransitionRequired=false、transitionStatus=not_needed；afterEvidence引用开柜动作。不能把先开柜后才拿到钥匙误判成回叙既有状态。",
  "先选择明确的关键action，再以该action为时间边界填写状态。beforeEvidence证明行动前或开始时；afterEvidence证明行动中或之后（可引用actionEvidence），不能只用更早的认知/决定证明行动后的状态。对未变化的知识，可引用它在该行动中的实际运用，不要求正文再解释一遍知识。",
  "状态字段联合检查：not_needed仅在stateChanged=false且enablingTransitionRequired=false时成立。stateChanged=true不等于必须有前置准备：变化就是action的结果时，enablingTransitionRequired=false、transitionStatus=established，并引用该动作作为transitionEvidence。必要前提在行动前或行动内建立才可enablingTransitionRequired=true且established。",
  "字段示例（只示范结构，不带入当前故事）：正文‘她拿着钥匙。她将钥匙交给门卫。门卫收下了钥匙。’，action=交钥匙，item状态before=她持有、after=门卫持有；stateChanged=true、enablingTransitionRequired=false、transitionStatus=established、transitionEvidence引用‘她将钥匙交给门卫。’。不能因为不需要提前准备就填not_needed。",
  "所有 quote 必须逐字复制对应正文的连续短片段，包括标点；不要换主语、补代词、把逗号改成句号或拼接分散的句子。说明写在 explanation。引用可以从句中开始，不必改成完整句。",
  "transitionStatus=established 时必须提供 transitionEvidence；动作本身就是变化时可引用该动作，不要留空。enablingTransitionRequired 只表示本次 action 发生前必须满足的变化，不能把 action 导致的后续结果倒填成行动前提。若所选 action 不能覆盖要审查的事件，请重新选择关键 action 并配准确证据。",
  "actionStateChecks 必须按 expectedSceneKeys 每场恰好选1个决定结果的关键行动（最多8条）；没有场景合同则 sceneKey=chapter，检查1个实际行动/关系决定。状态审查先于场景earned与总分；不能只确认结局发生。",
  "每条包含 sceneKey、actor、action、actionEvidence、states、verdict、explanation。states只选真正相关的body/item/ability/knowledge/location维度，通常1-2项，不要求每次列齐五类；每项包含dimension、entity、before、requiredForAction、after、beforeEvidence、afterEvidence、transitionEvidence、enablingTransitionRequired、stateChanged、transitionStatus。各状态/说明180字内，引用180字内，每类至多2条；未知就标unknown且状态证据数组可空，不编造。",
  "证据对象为{source,sourceId,quote}。source=current_prose时sourceId使用本章chapterId；established_context时只用written_evidence已写正文的chapterId。quote必须为该来源的连续准确原文。planned_contract只能说明计划，不可证明物品已有、身体状态恢复或行动已发生；不得拿摘要、场景卡或sourceKind声明充当既有事实。actionEvidence和afterEvidence必须含当前正文证据。",
  "先核对行动发生前人物能动哪些部位、持有哪些物品、身处何处、已知什么以及能力边界，再比较requiredForAction，最后核验after。若需要先解绳/恢复/取物/获得能力/接近才能行动，enablingTransitionRequired=true，transitionEvidence须证明前提在使用时成立；授权觉醒或授予可以在同一动作中生效，不必另设学习场景。新状态须有变化机制；stateChanged=true时不能声称not_needed。",
  "transitionStatus只用not_needed（无需变化且前提已满足）、established（变化过程有原文）、missing（关键变化未建立）、contradicted（与已知状态相冲突）、unknown（给定文本不足）。授权的魔法恢复、系统赠予、觉醒或远距作用可直接改变状态，清楚的触发/授予原文即可支持established，不额外要求代价、训练或长铺垫。职业常识不能自动等于异界知识，物品被拿出不自动证明其在先前搜身后仍可用。",
  "逐场最关键的执行条件必须实际核对；别把观察到材料当成已具备加工媒介/热源/时间，别把身体移动当成固定物体移动，别把事后恢复当成事前可行动。这些是通用检查，不要求每个题材都有战斗或器械。安静会谈也可核验知情、权限和位置，不能硬造身体伤害。",
  "缺失桥梁输出unearned，实际冲突输出contradicted，缺少前文原文输出insufficient_evidence；不得写states已经missing/contradicted却给动作或场景earned。未知不应凭空补剧情，确证局部问题交给既有repair/debt，不新增全局停写。",
];
