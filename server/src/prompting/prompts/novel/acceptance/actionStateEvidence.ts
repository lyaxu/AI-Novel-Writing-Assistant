import type { ActionStateCheck, ActionStateEvidence, SceneCausalityVerdict } from "@ai-novel/shared/types/novel/sceneCausality";

export interface ActionStateEvidenceInput {
  chapterId?: string;
  chapterOrder: number;
  content: string;
  expectedSceneKeys?: string[];
  establishedProse?: Array<{ chapterId: string; order: number; content: string }>;
}

const compact = (text: string) => text.replace(/\s+/gu, "");

/** Text positions validate provenance and sequence only; they do not infer fictional physics. */
function positions(text: string, quote: string): number[] {
  const source = compact(text);
  const needle = compact(quote);
  if (!needle) return [];
  const found: number[] = [];
  for (let start = source.indexOf(needle); start >= 0; start = source.indexOf(needle, start + 1)) found.push(start);
  return found;
}

export function validateActionStateEvidence(checks: ActionStateCheck[], input: ActionStateEvidenceInput) {
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
  const isFact = (evidence: ActionStateEvidence): boolean => {
    if (evidence.source === "planned_contract") return false;
    const content = evidence.source === "current_prose"
      ? evidence.sourceId === currentId ? input.content : undefined
      : context.get(evidence.sourceId);
    return content !== undefined && positions(content, evidence.quote).length > 0;
  };
  const rows = checks.map((check, checkIndex): ActionStateCheck => {
    const invalid: string[] = [];
    let missing = false;
    let contradiction = false;
    let unknown = false;
    if (!expected.includes(check.sceneKey)) invalid.push("unexpected_scene");
    if (!check.actionEvidence.length || check.actionEvidence.some((item) => item.source !== "current_prose" || !isFact(item))) {
      invalid.push("action_not_in_current_prose");
    }
    const actionPositions = check.actionEvidence[0] ? positions(input.content, check.actionEvidence[0].quote) : [];
    const actionStart = actionPositions[0];
    const actionEnd = actionStart === undefined ? undefined : actionStart + compact(check.actionEvidence[0].quote).length;
    const entities = new Set<string>();
    for (const [stateIndex, state] of check.states.entries()) {
      const field = `actionStateChecks[${checkIndex}](sceneKey=${check.sceneKey}).states[${stateIndex}]`;
      const key = `${state.dimension}:${state.entity}`;
      if (entities.has(key)) invalid.push(`duplicate_state:${key}`);
      entities.add(key);
      const cited = [...state.beforeEvidence, ...state.afterEvidence, ...state.transitionEvidence];
      if (cited.some((item) => !isFact(item))) invalid.push(`unverified_source:${key}`);
      if (!state.beforeEvidence.length || !state.afterEvidence.length) unknown = true;
      if (actionStart !== undefined) {
        if (state.beforeEvidence.some((item) => item.source === "current_prose"
          && !positions(input.content, item.quote).some((position) => position <= actionStart))) {
          invalid.push(`before_state_after_action:${key}`);
          correctionHints.push(`${field}.beforeEvidence：所引当前正文位于actionEvidence起点之后，不能证明所选行动开始前的状态。actionEvidence=${JSON.stringify(check.actionEvidence.map(item => item.quote))}；beforeEvidence=${JSON.stringify(state.beforeEvidence.map(item => item.quote))}。请先明确action及其原文边界：接听后才得知的内容属于after或transition；复合行动中途的状态不能当作整个行动之前的状态。重新选择准确的行动/证据或如实标未知，不改正文、不凭空补前置情节。`);
        }
        // Missing evidence can be an honest audit result; supplied evidence must still match the action boundary.
        const explicitlyUnknownAfter = !state.afterEvidence.length
          && check.verdict === "insufficient_evidence" && state.transitionStatus === "unknown";
        if (!explicitlyUnknownAfter && !state.afterEvidence.some((item) => item.source === "current_prose"
          && positions(input.content, item.quote).some((position) => position >= actionStart))) {
          invalid.push(`after_state_not_in_current_action:${key}`);
          correctionHints.push(`${field}.afterEvidence：所引证据未定位到关键行动发生时或之后。actionEvidence=${JSON.stringify(check.actionEvidence.map(item => item.quote))}；afterEvidence=${JSON.stringify(state.afterEvidence.map(item => item.quote))}。行动前的判断可作为beforeEvidence或必要过渡，不能单独证明after；请重新核对所选行动的边界，并引用正文中该行动发生时或之后的状态表现。无需正文重复解释知识，但须引用其在行动中的实际运用；原文不足则如实标未知，不编写新句子。`);
        }
      }
      if (state.transitionStatus === "contradicted") contradiction = true;
      if (state.transitionStatus === "missing") missing = true;
      if (state.transitionStatus === "unknown") unknown = true;
      if (state.transitionStatus === "not_needed" && (state.enablingTransitionRequired || state.stateChanged)) missing = true;
      if (state.transitionStatus === "not_needed" && (state.enablingTransitionRequired || state.stateChanged)) {
        correctionHints.push(`${field}：stateChanged=${state.stateChanged}、enablingTransitionRequired=${state.enablingTransitionRequired}与transitionStatus=not_needed矛盾。not_needed只适用于两者都为false。若正文写出了变化，使用established并从正文填写transitionEvidence；变化就是行动本身时可以引用该动作，无需另造前置情节。若变化缺失/相互冲突/无法判断，分别使用missing/contradicted/unknown并同步核对verdict。不要为了通过检查机械修改布尔值或降低结论。`);
      }
      if (state.transitionStatus === "established") {
        if (!state.transitionEvidence.length) unknown = true;
        if (!state.transitionEvidence.length) correctionHints.push(`${field}.transitionEvidence：transitionStatus=established但证据为空；请逐字引用正文中的变化过程，行动本身造成变化时可引用actionEvidence。没有证据时须如实重评transitionStatus和verdict。`);
        // A transition can occur within the same action (e.g. an authorized awakening).
        // Only disjoint evidence after that action is deterministically too late; the AI reviews overlapping causality.
        if (state.enablingTransitionRequired && state.transitionEvidence.length && actionEnd !== undefined
          && state.transitionEvidence.every((item) => item.source === "current_prose"
            && positions(input.content, item.quote).every((position) => position >= actionEnd))) {
          contradiction = true;
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
