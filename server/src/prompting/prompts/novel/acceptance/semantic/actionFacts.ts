import { z } from "zod";
import {
  actionStateCheckSchema,
  actionStateDimensionCheckSchema,
  type ActionStateCheck,
  type ActionStateDimensionCheck,
} from "@ai-novel/shared/types/novel/sceneCausality";
import { resolveEvidenceReference, type EvidenceCatalog } from "../evidenceCatalog";

const references = z.array(z.object({ evidenceId: z.string().trim().min(1) }).strict()).max(2);
const text = z.string().trim().min(1).max(180);
const canonicalFacts = actionStateDimensionCheckSchema.shape.semanticFacts.unwrap();
const fact = canonicalFacts.shape.before.unwrap().extend({ evidence: references.optional() }).strict();
const prerequisite = canonicalFacts.shape.prerequisite.unwrap().extend({ basis: fact.optional() }).strict();
const resultChange = canonicalFacts.shape.resultChange.unwrap().extend({ basis: fact.optional() }).strict();

/** Omitted semantic findings reach the one full-context correction, not JSON-only repair. */
export const semanticActionAssessmentSchema = z.object({
  sceneKey: z.string().trim().min(1),
  actor: text,
  action: text,
  actionEvidence: references.min(1).max(1),
  states: z.array(z.object({
    entity: text,
    dimension: actionStateDimensionCheckSchema.shape.dimension,
    requiredForAction: text,
    before: fact.optional(),
    after: fact.optional(),
    prerequisite: prerequisite.optional(),
    resultChange: resultChange.optional(),
  }).strict()).min(1).max(5),
  explanation: actionStateCheckSchema.shape.explanation,
}).strict();

type RawAction = z.infer<typeof semanticActionAssessmentSchema>;
type Facts = NonNullable<ActionStateDimensionCheck["semanticFacts"]>;
type Fact = NonNullable<Facts["before"]>;

/** Validate structured bindings, never infer the story from keywords or source offsets. */
export function auditSemanticState(state: ActionStateDimensionCheck, path: string) {
  const problems: string[] = [];
  const facts = state.semanticFacts!;
  const problem = (field: string, code: string, value: unknown, requirement: string) => {
    problems.push(`${path}.${field}:${code}；当前值=${JSON.stringify(value) ?? "未提供"}；${requirement}`);
  };
  const inspectFact = (binding: Fact | undefined, role: string) => {
    if (!binding) {
      problem(role, "semantic_fact_missing", binding, "提供完整事实绑定；无法确认时如实填写insufficient/unknown并说明原因。");
      return;
    }
    for (const field of ["entity", "dimension", "claim", "evidence", "storyTime", "support", "reason"] as const) {
      if (binding[field] === undefined) problem(`${role}.${field}`, "semantic_fact_field_missing", undefined, "此项是必需的语义判断，须结合完整正文补齐，不能凭空补写正文。");
    }
    if (binding.entity !== undefined && binding.entity !== state.entity) {
      problem(`${role}.entity`, "semantic_entity_mismatch", binding.entity, `事实必须绑定本状态entity=${JSON.stringify(state.entity)}；重新核对证据主体，不能只改名字冒充。`);
    }
    if (binding.dimension !== undefined && binding.dimension !== state.dimension) {
      problem(`${role}.dimension`, "semantic_dimension_mismatch", binding.dimension, `事实必须属于本状态dimension=${state.dimension}；叙述别人的知情或位置变化不能证明本人的知识变化。`);
    }
    if (binding.support === "supported" && !binding.evidence?.length) {
      problem(`${role}.evidence`, "supported_fact_without_evidence", binding.evidence, "supported必须选择支持claim的目录evidenceId；没有依据则如实insufficient，不能降低已证实的缺陷来通过审查。");
    }
  };
  inspectFact(facts.before, "before");
  inspectFact(facts.after, "after");
  for (const role of ["prerequisite", "resultChange"] as const) {
    const finding = facts[role];
    if (!finding) {
      problem(role, "semantic_finding_missing", undefined, "分别判断行动前提与结果变化，填写status、basis和reason。");
      continue;
    }
    if (!finding.status) problem(`${role}.status`, "semantic_status_missing", undefined, "结合该角色事实明确结论，无法确认则unknown。");
    if (!finding.reason) problem(`${role}.reason`, "semantic_reason_missing", finding.reason, "说明该事实如何支持本项结论，不能只重复标签。");
    inspectFact(finding.basis, `${role}.basis`);
  }
  const requireSupport = (binding: Fact | undefined, role: string, time?: Fact["storyTime"]) => {
    if (!binding) return; // Already reported, still inspect all other roles.
    if (binding.support !== "supported") {
      problem(`${role}.support`, "finding_requires_supported_fact", binding.support, "该确定结论必须有支持事实；不能把不支持或反驳claim的引文认证为依据。重新核对结论及claim，不改正文。");
    }
    if (time && binding.storyTime !== time) {
      problem(`${role}.storyTime`, "finding_story_time_conflict", binding.storyTime, `该结论要求故事时间=${time}。根据事实相对当前原子行动的发生时间判断；文本位置不等于故事时间，实际事后获得不能填成事前成立。`);
    }
  };
  if (facts.before?.support === "supported" && facts.before.storyTime === "during_or_after_action") {
    problem("before.storyTime", "before_fact_happens_after_action", facts.before.storyTime, "before应描述前提使用前或使用时的状态；事后才成立的条件不能冒充前提，须保留真实负面判断。");
  }
  if (facts.after?.support === "supported" && facts.after.storyTime === "before_or_at_action") {
    problem("after.storyTime", "after_fact_is_only_prior_state", facts.after.storyTime, "after需说明行动中或之后的状态，前文只能支持先前事实；可用本章实际运用证明状态延续。");
  }
  const p = facts.prerequisite;
  const r = facts.resultChange;
  if (p?.status === "satisfied" || p?.status === "established") {
    requireSupport(facts.before, "before", "before_or_at_action");
    requireSupport(p.basis, "prerequisite.basis", "before_or_at_action");
  } else if (p?.status === "missing" || p?.status === "contradicted") {
    requireSupport(p.basis, "prerequisite.basis");
    if (p.basis?.storyTime === "unknown") problem("prerequisite.basis.storyTime", "negative_finding_time_unknown", "unknown", "确证前提缺失/冲突也须说明事实与行动的故事时间，无法确认则unknown。");
  }
  if (r?.status === "unchanged" || r?.status === "changed") {
    requireSupport(facts.after, "after", "during_or_after_action");
    requireSupport(r.basis, "resultChange.basis", "during_or_after_action");
  } else if (r?.status === "unsupported" || r?.status === "contradicted") {
    requireSupport(r.basis, "resultChange.basis");
    if (r.basis?.storyTime === "unknown") problem("resultChange.basis.storyTime", "negative_finding_time_unknown", "unknown", "确证结果缺口也须说明相关事实与行动的故事时间，无法确认则unknown。");
  }
  const contradiction = p?.status === "contradicted" || r?.status === "contradicted";
  const missing = p?.status === "missing" || r?.status === "unsupported";
  const unknown = !p?.status || !r?.status || p.status === "unknown" || r.status === "unknown"
    || [facts.before, facts.after, p.basis, r.basis].some(binding => !binding
      || binding.support !== "supported" || binding.storyTime === "unknown" || !binding.evidence?.length);
  return { problems, contradiction, missing, unknown };
}

/** A single compatibility projection; legacy flags and verdict are never model-authored. */
export function normalizeSemanticActions(rawChecks: RawAction[], catalog: EvidenceCatalog): {
  checks: ActionStateCheck[]; problems: string[];
} {
  const problems: string[] = [];
  const resolve = (refs: Array<{ evidenceId: string }> | undefined, path: string) => refs?.flatMap((ref, index) => {
    // Missing IDs are an expected contract error; unexpected resolver errors propagate.
    if (!catalog.byId.has(ref.evidenceId)) {
      problems.push(`${path}[${index}]:unknown_evidence_id=${JSON.stringify(ref.evidenceId)}；snapshot=${catalog.snapshotId}；从本次目录选择支持claim的原有evidenceId，不能沿用其他正文版本。`);
      return [];
    }
    return [resolveEvidenceReference(catalog, ref)];
  });
  const bind = (raw: z.infer<typeof fact> | undefined, path: string): Fact | undefined => raw
    ? { ...raw, evidence: resolve(raw.evidence, `${path}.evidence`) } : undefined;
  const checks = rawChecks.map((raw, index): ActionStateCheck => {
    const path = `actionStateChecks[${index}](sceneKey=${raw.sceneKey})`;
    const initialProblems = problems.length;
    const actionEvidence = resolve(raw.actionEvidence, `${path}.actionEvidence`) ?? [];
    const audits: ReturnType<typeof auditSemanticState>[] = [];
    const states = raw.states.map((state, stateIndex): ActionStateDimensionCheck => {
      const statePath = `${path}.states[${stateIndex}]`;
      const before = bind(state.before, `${statePath}.before`);
      const after = bind(state.after, `${statePath}.after`);
      const p = state.prerequisite ? { ...state.prerequisite, basis: bind(state.prerequisite.basis, `${statePath}.prerequisite.basis`) } : undefined;
      const r = state.resultChange ? { ...state.resultChange, basis: bind(state.resultChange.basis, `${statePath}.resultChange.basis`) } : undefined;
      const transitionStatus = p?.status === "contradicted" || r?.status === "contradicted" ? "contradicted"
        : p?.status === "missing" || r?.status === "unsupported" ? "missing"
          : !p?.status || !r?.status || p.status === "unknown" || r.status === "unknown" ? "unknown"
            : p.status === "established" || r.status === "changed" ? "established" : "not_needed";
      const canonical: ActionStateDimensionCheck = {
        entity: state.entity, dimension: state.dimension, requiredForAction: state.requiredForAction,
        before: before?.claim ?? "审查未提供前状态事实", after: after?.claim ?? "审查未提供后状态事实",
        beforeEvidence: before?.evidence ?? [], afterEvidence: after?.evidence ?? [],
        transitionEvidence: [...(p?.basis?.evidence ?? []), ...(r?.basis?.evidence ?? [])],
        semanticFacts: { before, after, prerequisite: p, resultChange: r },
        enablingTransitionRequired: p?.status === "established" || p?.status === "missing" || p?.status === "contradicted",
        stateChanged: r?.status === "changed" || r?.status === "unsupported" || r?.status === "contradicted",
        transitionStatus,
      };
      const audit = auditSemanticState(canonical, statePath);
      audits.push(audit);
      problems.push(...audit.problems);
      return canonical;
    });
    const verdict = problems.length > initialProblems ? "insufficient_evidence"
      : audits.some(item => item.contradiction) ? "contradicted"
        : audits.some(item => item.missing) ? "unearned"
          : audits.some(item => item.unknown) ? "insufficient_evidence" : "earned";
    return { sceneKey: raw.sceneKey, actor: raw.actor, action: raw.action, actionEvidence,
      states, verdict, explanation: raw.explanation };
  });
  return { checks, problems };
}

export const SEMANTIC_ACTION_RULES = [
  "每个expectedSceneKey只选择一个实际发生的原子行动，actionEvidence只选1条本章目录证据。不要把隔开的见面、交谈、战斗等合成一个行动；判断始终相对此行动，不能换锚点躲开缺陷。",
  "每项state填写entity、dimension、requiredForAction、before、after、prerequisite、resultChange。before/after及两个basis都使用同一事实结构：{entity,dimension,claim,evidence:[{evidenceId}],storyTime,support,reason}。所有字段必须提供；解析允许缺项只为收集审查错误，不代表可省略。",
  "每个事实的entity/dimension须与所属state一致，claim和理由必须核对证据实际主体和维度。人物把已知消息说给别人，不等于说话人新获得知识；移动、结识人物、材料变少、身体受伤分别审查相关主体维度，不能互相替代。",
  "storyTime只用before_or_at_action（前提使用前或使用时已成立，可在同一行动内建立）、during_or_after_action（行动中或之后的状态）、unknown（不能确认）。判断故事发生时间，不按文本字符先后判断；本章后叙的既有能力和前章确证事实均可before_or_at_action，实际使用后才取得的条件不能这样标注。reason解释相对行动及前提使用的语义依据。",
  "support只用supported（证据支持claim）、contradicted（证据反驳claim）、insufficient（不能确认）。supported须有目录证据，未知允许evidence=[]并解释不足；每类证据最多2条。编号只证明引用来源，不自动证明主体、维度、事实或时间正确。",
  "prerequisite={status,basis,reason}，status为satisfied|established|missing|contradicted|unknown。satisfied表示已有条件；established表示本章在前提被使用前或使用时建立前提，basis须全为本章证据。同一行动中授权觉醒、授予、施法恢复可以合法建立条件，无需额外训练或准备场景。两者均须before和basis受证据支持且故事时间为before_or_at_action；before可描述起初未觉醒/空手，由established的basis证明使用时已建立，无需前状态已满足条件。实际使用后才取得条件不能证明成立。",
  "resultChange={status,basis,reason}，status为unchanged|changed|unsupported|contradicted|unknown。unchanged/changed均须after和basis受本章证据支持，故事时间为during_or_after_action；知识在行动中被运用可证明延续，不要求正文重复交代。",
  "确证missing/contradicted/unsupported时，basis应是被证据支持的负面事实，例如仍被绑住而要求自由行动；support仍为supported。不能只因没有搜到引文就认证缺陷，无法确定则unknown。真实局部问题保留负面判断，交给既有修复或质量债，不为通过审查篡改正文。",
  "before/after是同一主体同一维度的两个事实；prerequisite判断是否满足requiredForAction；resultChange判断该状态的结果变化是否有依据，不能把他人的反应当该主体状态改变。不要输出旧布尔、transitionStatus、beforeEvidenceTiming或动作verdict，程序从四角色事实汇总。",
];
