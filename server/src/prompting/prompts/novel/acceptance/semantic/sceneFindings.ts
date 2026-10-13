import { z } from "zod";
import type { ActionStateCheck, SceneCausalityVerdict } from "@ai-novel/shared/types/novel/sceneCausality";
import { resolveEvidenceReference, type EvidenceCatalog } from "../evidenceCatalog";

const finding = z.object({
  claim: z.string().trim().min(1).max(180),
  evidence: z.array(z.object({ evidenceId: z.string().trim().min(1) }).strict()).max(2),
  support: z.enum(["supported", "missing", "contradicted", "unknown"]),
  reason: z.string().trim().min(1).max(180),
}).strict();

/** Choices, resistance and constraints remain reviewed; causal chronology has one owner: action facts. */
export const semanticSceneSchema = z.object({
  sceneKey: z.string().trim().min(1),
  outcomeObserved: z.boolean(),
  findingIssueId: z.string().trim().min(1).optional(),
  choiceAndResistance: finding.optional(),
  constraints: z.array(finding).max(4).optional(),
}).strict();
export type SemanticScene = z.infer<typeof semanticSceneSchema>;

export function normalizeSemanticScenes(raw: SemanticScene[], actions: ActionStateCheck[], catalog: EvidenceCatalog) {
  const problems: string[] = [];
  const scenes: SceneCausalityVerdict[] = raw.map((scene, index) => {
    const path = `sceneCausalityVerdicts[${index}]`;
    const action = actions.find(check => check.sceneKey === scene.sceneKey);
    if (!scene.choiceAndResistance) problems.push(`${path}.choiceAndResistance:required_semantic_finding_missing`);
    if (!scene.constraints) problems.push(`${path}.constraints:required_semantic_finding_missing`);
    const findings = [scene.choiceAndResistance, ...(scene.constraints ?? [])].filter((value): value is z.infer<typeof finding> => Boolean(value));
    for (const [i, fact] of findings.entries()) {
      const sources = fact.evidence.flatMap(ref => {
        try { return [resolveEvidenceReference(catalog, ref)]; }
        catch (error) { problems.push(`${path}.findings[${i}]:${String(error)}`); return []; }
      });
      if (fact.support !== "unknown" && !sources.some(source => source.source === "current_prose")) {
        problems.push(`${path}.findings[${i}]:current_scene_basis_missing`);
      }
    }
    const verdicts = [action?.verdict ?? "insufficient_evidence", ...findings.map(fact =>
      fact.support === "supported" ? "earned" : fact.support === "missing" ? "unearned"
        : fact.support === "contradicted" ? "contradicted" : "insufficient_evidence")];
    const verdict = verdicts.includes("contradicted") ? "contradicted" : verdicts.includes("unearned") ? "unearned"
      : verdicts.includes("insufficient_evidence") ? "insufficient_evidence" : "earned";
    const states = action?.states ?? [];
    // Do not solicit another account of cause and effect that can contradict the four role findings.
    return {
      sceneKey: scene.sceneKey, outcomeObserved: scene.outcomeObserved, verdict,
      prerequisiteEvidence: states.map(state => state.semanticFacts?.prerequisite?.reason ?? state.requiredForAction).slice(0, 6),
      choiceAndResistanceEvidence: scene.choiceAndResistance ? `${scene.choiceAndResistance.claim}：${scene.choiceAndResistance.reason}`.slice(0, 240) : "选择与阻力尚未核实。",
      outcomeMechanismEvidence: (states.map(state => state.semanticFacts?.resultChange?.reason).filter(Boolean).join("；") || "行动结果尚未核实。").slice(0, 240),
      constraintEvidence: (scene.constraints ?? []).map(fact => `${fact.claim}：${fact.reason}`.slice(0, 240)),
      explanation: `${action?.action ?? "关键行动待核实"}；${states.map(state => `${state.entity}：${state.before}→${state.after}`).join("；")}`.slice(0, 240),
    };
  });
  return { scenes, problems };
}

export const SEMANTIC_SCENE_RULES = [
  "sceneCausalityVerdicts逐一覆盖expectedSceneKeys；无指定场景时为空。每行只给sceneKey、outcomeObserved、choiceAndResistance、constraints。后两项的finding结构为{claim,evidence:[{evidenceId}],support:supported|missing|contradicted|unknown,reason}，constraints可空。选择与阻力要检查双方动机、能力、利益与实际回应，不能只检查结果发生。",
  "场景前提、结果机制与时间说明由同场actionStateChecks的四角色事实投影，不另写一份verdict/prerequisiteEvidence/outcomeMechanismEvidence/explanation。选一个明确的关键动作，不把相距很远的告知、付款、拍照等多个动作合成一个时间边界；后发生的结果不得倒写成前面行动的原因。",
];
