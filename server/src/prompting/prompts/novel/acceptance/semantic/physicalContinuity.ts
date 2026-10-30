import { z } from "zod";
import { resolveEvidenceReference, type EvidenceCatalog } from "../evidenceCatalog";

/**
 * 物理连续性、真实世界规则与专有名词命名来源审计的五个维度。
 *
 * 维度只划分审查职责，不携带题材判断：一个维度里是否真的构成问题由 AI
 * 结合本书设定与已写正文给出结构化结论，程序只核对引用与字段一致性。
 */
export const PHYSICAL_CONTINUITY_DIMENSIONS = [
  "object_container",
  "action_prerequisite",
  "physical_environment",
  "continuity_state",
  "terminology_introduction",
] as const;

export const physicalContinuityDimensionSchema = z.enum(PHYSICAL_CONTINUITY_DIMENSIONS);
export const physicalContinuityVerdictSchema = z.enum([
  "consistent",
  "defect",
  "exempt",
  "not_applicable",
  "unknown",
]);

const evidenceReferenceSchema = z.object({ evidenceId: z.string().trim().min(1) }).strict();
const canonicalEvidenceSchema = z.object({
  source: z.enum(["current_prose", "established_context"]),
  sourceId: z.string(),
  quote: z.string(),
  evidenceId: z.string().optional(),
  evidenceSnapshotId: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});

const physicalFindingFields = {
  dimension: physicalContinuityDimensionSchema,
  verdict: physicalContinuityVerdictSchema,
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  /** Only for verdict=exempt: the in-world rule that legitimately permits the fact. */
  worldRuleBasis: z.string().trim().min(1).max(200).optional(),
  explanation: z.string().trim().min(1).max(240),
  fixSuggestion: z.string().trim().min(1).max(240).optional(),
};

/** New wire finding: only evidence IDs cross the model boundary; prose is restored by the server. */
export const semanticPhysicalContinuityCheckSchema = z.object({
  ...physicalFindingFields,
  evidence: z.array(evidenceReferenceSchema).max(4).default([]),
}).strict();
export type SemanticPhysicalContinuityCheck = z.infer<typeof semanticPhysicalContinuityCheckSchema>;

/** Canonical persisted finding with server-resolved evidence and no free-form citations. */
export const physicalContinuityCheckSchema = z.object({
  ...physicalFindingFields,
  evidence: z.array(canonicalEvidenceSchema).max(4).default([]),
}).strict();
export type PhysicalContinuityCheck = z.infer<typeof physicalContinuityCheckSchema>;

export const PHYSICAL_CONTINUITY_RULES = [
  "物理连续性、真实世界规则与专有名词命名来源审查是接收判断的一部分，不是另一次创作：必须恰好覆盖 object_container、action_prerequisite、physical_environment、continuity_state、terminology_introduction 五个维度各一行，不得缺项、重复或换成别的维度名；确实没有可审计事实的维度用 verdict=not_applicable，不能为了凑行编造细节。",
  "object_container：物品与容器的尺寸、容量、重量、数量是否支撑正文动作。人物能否装进、抬动、携带、藏匿某个容器或物品，同一容器前后是否出现容量或可携带性矛盾，搬运是否超出人物体力、人数或运输条件。缺少已有设定或正文依据时不要替作者补设定，按 defect 或 unknown 记录。",
  "action_prerequisite：动作在使用时是否已具备前置条件。画符需要可落笔的符纸、朱砂/墨、时间与场所；拆装装备需要工具与空间；施法需要符纸、代价或授权；开门、调取资料、进入场所需要钥匙、权限或身份；引用知识需要人物此前已获得该信息。计划、摘要、任务表只说明意图，不能证明前置已经建立；前章已写正文或本章使用前的过程可以构成前置。",
  "physical_environment：距离与时间、温度、耐力、伤势、饥饿、电力/能源、承重、重力与载具条件是否与本书设定和已写事实一致。不要把写实常识强加给明确设定允许的世界，但要求同一动作前后的物理条件不要互相矛盾。",
  "continuity_state：道具的状态与位置、伤势与消耗、持有物、人物知识与关系、时间线是否与本章已写内容、已提供前章或状态快照一致。被用了却还没有取得过程、被带在身上却仍留在原地、上一章已经受损却完好无损，都属于需要核对的连续性事实。",
  "terminology_introduction：关键专有名词第一次进入正文时，正文内是否已经建立了这个名称的来源。能力、功法、势力、组织、特殊物品、称号等作者设定名，在首次出现之前必须先由正文内渠道建立：前文已由人物命名、他人告知、系统/界面提示、铭文/记录/告示、传闻等带出，或本章在首次使用之前用上述渠道带出。名称未建立就直接使用设定名 = defect，即使后文补出名字也算首次使用时读者不知道；名称尚未建立时正文只写功能、现象或代称（例如“这双眼睛”“那股寒意”）则不算缺陷。计划、大纲、任务书、作者设定只能说明“要有这个名字”，不能当作正文已经建立。判断只针对读者跟读所需的关键专有名词；普通叙述、日常名词、不承担设定信息的虚构词不进入本维度，本章没有这类首次命名时 verdict=not_applicable。作者或题材确有明确叙述约定（例如已建立的说书人、回忆体、系统播报允许直接称呼名物）时可以 exempt，并在 worldRuleBasis 写明具体依据；仅凭题材标签不得豁免。",
  "设定豁免：本书世界观明确允许的超自然或科幻规则本身就是合理依据（例如空间装备、法术搬运、系统赠予、义体力量、传送），不因它不符合现实物理就报错。此时 verdict=exempt，并在 worldRuleBasis 写明来自本次上下文或已写正文的哪一条设定允许它。没有提供设定依据时不得以题材标签自行豁免，也不得把真实缺陷说成题材特色；凡文本内部无法自洽、缺少已建立前置或与已写事实冲突的，仍记 defect。",
  "证据：每行 evidence 从本次正文证据目录选择编号对象 {evidenceId}，不要输出 quote/source/sourceId/位置。defect 至少含一条 current_prose 编号；consistent 与 exempt 至少含一条本章或已写前章编号；not_applicable 与 unknown 可为空。编号只证明原文存在，不证明结论正确，逐项判断所选片段是否真的支持该结论。",
  "defect 必须给出 severity（low/medium/high/critical 按对可读性与后续推进的影响）与 fixSuggestion，说明应补足的动作过程或应统一的描述。修复只能补足已建立的动作过程、限制动作规模、修正前后描述或补充已授权的前置；不得新增世界设定、不得改大纲、不得把审计意见写进正文。unknown 只保留可见风险，不生成补写指令。",
  "terminology_introduction 的 defect 必须写清名称、首次出现的位置，以及缺失的命名渠道；fixSuggestion 只能给两种方向：在首次使用之前补一个正文内的命名场景或信息渠道，或把首次使用改成只写功能、现象与代称。不得建议在旁白里直接解释设定名，也不得建议新增未建立的世界设定。",
] as const;

/**
 * Resolve every cited passage and collect all structural problems for the single
 * full-context correction pass. This function never decides whether the story is wrong:
 * it only validates the AI's structured judgement and its evidence.
 */
export function normalizeSemanticPhysicalChecks(
  raw: SemanticPhysicalContinuityCheck[] | undefined,
  catalog: EvidenceCatalog,
): { checks: PhysicalContinuityCheck[]; problems: string[] } {
  if (raw === undefined) return { checks: [], problems: [] };
  const problems: string[] = [];
  const seen = new Set<string>();
  const checks = raw.map((check, index) => {
    const path = `physicalContinuityChecks[${index}](dimension=${check.dimension})`;
    if (seen.has(check.dimension)) problems.push(`${path}.dimension:duplicate_physical_dimension`);
    seen.add(check.dimension);
    const evidence = check.evidence.flatMap((ref, refIndex) => {
      try {
        return [resolveEvidenceReference(catalog, ref)];
      } catch (error) {
        problems.push(`${path}.evidence[${refIndex}]:${error instanceof Error ? error.message : String(error)} snapshot=${catalog.snapshotId}`);
        return [];
      }
    });
    const hasCurrentProse = evidence.some((item) => item.source === "current_prose");
    if (check.verdict === "defect") {
      if (!hasCurrentProse) problems.push(`${path}.evidence:current_prose_basis_required_for_defect`);
      if (!check.severity) problems.push(`${path}.severity:required_for_defect`);
      if (!check.fixSuggestion) problems.push(`${path}.fixSuggestion:required_for_defect`);
    }
    if (check.verdict === "exempt" && !check.worldRuleBasis) {
      problems.push(`${path}.worldRuleBasis:required_for_world_rule_exemption`);
    }
    if ((check.verdict === "consistent" || check.verdict === "exempt") && evidence.length === 0) {
      problems.push(`${path}.evidence:required_for_judgement`);
    }
    return { ...check, evidence };
  });
  for (const dimension of PHYSICAL_CONTINUITY_DIMENSIONS) {
    if (!seen.has(dimension)) problems.push(`physicalContinuityChecks:physical_dimension_coverage_missing:${dimension}`);
  }
  return { checks, problems };
}
