import { CHAPTER_PROGRESSION_DIMENSIONS, type ChapterProgressionCheck } from "@ai-novel/shared/types/novel/progression/index";
import type { ActionStateEvidenceInput } from "./actionStateEvidence";

const compact = (text: string) => text.replace(/\s+/gu, "");

/** Validate provenance only. Whether repetition earns its place remains the AI's semantic judgment. */
export function validateProgressionEvidence(checks: ChapterProgressionCheck[], input: ActionStateEvidenceInput) {
  const coverageIssues = CHAPTER_PROGRESSION_DIMENSIONS.flatMap((dimension) => {
    const count = checks.filter((check) => check.dimension === dimension).length;
    return count === 1 ? [] : [`progression_coverage_${count === 0 ? "missing" : "duplicate"}:${dimension}`];
  });
  const prior = new Map((input.establishedProse ?? [])
    .filter((chapter) => chapter.order < input.chapterOrder && chapter.chapterId !== input.chapterId)
    .map((chapter) => [chapter.chapterId, chapter.content]));
  const currentId = input.chapterId ?? "current";
  const rows = checks.map((check): ChapterProgressionCheck => {
    const invalid: string[] = [];
    for (const evidence of check.previousEvidence) {
      const source = prior.get(evidence.sourceId);
      if (evidence.source !== "established_context" || source === undefined || !compact(source).includes(compact(evidence.quote)) || !compact(evidence.quote)) {
        invalid.push("previous_quote_not_in_established_prose");
      }
    }
    for (const evidence of check.currentEvidence) {
      if (evidence.source !== "current_prose" || evidence.sourceId !== currentId
        || !compact(input.content).includes(compact(evidence.quote)) || !compact(evidence.quote)) {
        invalid.push("current_quote_not_in_current_prose");
      }
    }
    if (check.status !== "insufficient_evidence" && !check.currentEvidence.length) invalid.push("current_evidence_missing");
    if (["stalled", "justified_repetition"].includes(check.status) && !check.previousEvidence.length) invalid.push("comparison_evidence_missing");
    if (check.dimension === "prior_goal_followthrough" && check.status === "progressed" && !check.previousEvidence.length) invalid.push("prior_goal_evidence_missing");
    if (check.status === "progressed" && !check.actualChange.trim()) invalid.push("actual_change_missing");
    if (check.status === "justified_repetition" && !check.newConsequence.trim()) invalid.push("new_consequence_missing");
    if (check.status === "stalled" && !check.repairSuggestion.trim()) invalid.push("repair_suggestion_missing");
    // A later chapter without earlier prose cannot certify absence of an inherited goal/repetition.
    if (check.status === "not_applicable" && input.chapterOrder > 1 && !prior.size) invalid.push("previous_prose_unavailable");
    if (coverageIssues.some((issue) => issue.endsWith(`:${check.dimension}`))) invalid.push("dimension_coverage_invalid");
    return {
      ...check,
      status: invalid.length ? "insufficient_evidence" : check.status,
      validationIssues: [...new Set(invalid)],
    };
  });
  return { checks: rows, coverageIssues };
}

export const CHAPTER_PROGRESSION_AUDIT_RULES = [
  "progressionChecks 必须按 event_repetition、knowledge_repetition、prior_goal_followthrough 各输出一行，恰好3行。用written_evidence实际前文与当前正文比较，不把任务表、摘要、预期netChange当实际兑现。每行含dimension、status、priorState、actualChange、newConsequence、previousEvidence、currentEvidence、explanation、repairSuggestion。",
  "event_repetition 检查是否重演前章已完成的事件职责；knowledge_repetition 检查人物/读者是否只是再次发现已确立的信息；prior_goal_followthrough 检查前章已作出的行动决定在本章是否尝试执行、遭遇实质阻力、改变方案或合理延后，而非结尾再决定一次。叙述换词、换摊贩/场景、增加心理旁白，本身不等于新进展。",
  "status 用 progressed（有实际事件、认识、关系或选择变化）、justified_repetition（重访但带来具体新后果/证伪/代价/理解）、stalled（有前后原文证明重复职责且没有相应变化）、insufficient_evidence（前文未覆盖或无法判断）、not_applicable（已查证不存在该比较职责，例如首章无继承目标）。actualChange记正文实际增量；newConsequence说明重复为何有价值；无增量如实留空，不凭计划补结论。",
  "证据格式{source,sourceId,quote}，previousEvidence只用established_context与已写前章ID，currentEvidence只用current_prose与本章ID，必须为对应正文连续准确短引。每类至多2条，引用和状态180字内，explanation和repairSuggestion240字内。stalled及justified_repetition须给双方证据；前章行动落实为progressed也须有先前决定和本章行动证据。首章无前文不构成停滞；后章无前文只能承认无法核验继承，不臆造旧目标。",
  "quote逐字复制，标点也是原文：不要把中文引号替换成英文引号，不要把换行改成句号，不要跨过叙述插入语拼接对白。宁可选一句内部的短片段；若需两处证据，用两个独立引用。说明和概括放explanation，不得混进quote。",
  "保留细腻和慢热：关系中的信任变化、认知修正、证据排除、试探失败、情绪承认都可构成实际增量；不要求赶路到达、战斗、升级、成功、反转或每章大事件。同一地点、习惯动作、再次问路、重复仪式本身不是问题，应判断它在本次产生什么新作用。悬疑暂不揭底、修仙闭关、民俗仪式、科幻等待、日常对白均按实际变化判断，不用题材关键词判罚。",
  "上一章的决定不是本章必须成功完成的硬指标：确有阻力、主动改选、关系后果或与当前冲突有关的心理变化，可以构成落实；单纯重述犹豫或再次决定而没有新依据不能冒充推进。区分角色知道与读者知道，读者已知而角色首次获知且改变行动，可以justified_repetition。",
  "stalled交给既有局部plot修复/质量债，repairSuggestion必须指出保留哪些有效细节、压缩哪项已完成职责、承接哪项实际行动；不新增大危机掩盖停滞，不把细腻压成流水账。insufficient_evidence只保留风险，不编造桥段。不得仅因本组三维缺口输出全局重规划或停止。",
];
