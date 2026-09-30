import { CHAPTER_PROGRESSION_DIMENSIONS, type ChapterProgressionCheck } from "@ai-novel/shared/types/novel/progression/index";
import type { ActionStateEvidenceInput } from "./actionStateEvidence";

const compact = (text: string) => text.replace(/\s+/gu, "");

/** Reject a falsely attributed issue citation so the existing bounded semantic repair can correct it. */
export function validateAcceptanceIssueSources(
  issues: Array<{ code: string; sourceEvidence?: Array<{ source: string; sourceId: string; quote: string }> }>,
  input: ActionStateEvidenceInput,
) {
  const prior = new Map((input.establishedProse ?? [])
    .filter((chapter) => chapter.order < input.chapterOrder && chapter.chapterId !== input.chapterId)
    .map((chapter) => [chapter.chapterId, chapter.content]));
  for (const issue of issues) {
    // Historical persisted records have no sourceEvidence. Never fabricate citations for them.
    if (issue.sourceEvidence === undefined) continue;
    if (!issue.sourceEvidence.some((row) => row.source === "current_prose")) {
      throw new Error(`Issue ${issue.code}: sourceEvidence must include current_prose; prior prose alone cannot prove a current chapter defect.`);
    }
    for (const row of issue.sourceEvidence) {
      const source = row.source === "current_prose"
        ? row.sourceId === (input.chapterId ?? "current") ? input.content : undefined
        : row.source === "established_context" ? prior.get(row.sourceId) : undefined;
      if (source === undefined || !compact(row.quote) || !compact(source).includes(compact(row.quote))) {
        throw new Error(`Issue ${issue.code}: sourceEvidence quote does not belong to declared ${row.source}/${row.sourceId}; copy a continuous exact quote from that source, never relabel prior prose as current prose.`);
      }
    }
  }
}

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
    if (check.status !== "insufficient_evidence"
      && (check.repeatsEstablishedBeat === null || check.addsNewConsequence === null)) invalid.push("semantic_findings_unknown");
    if (check.repeatsEstablishedBeat === true && !check.previousEvidence.length) invalid.push("repetition_evidence_missing");
    if (check.status === "progressed" && check.repeatsEstablishedBeat === true) invalid.push("progressed_conflicts_with_repeated_beat");
    if (check.status === "justified_repetition"
      && (check.repeatsEstablishedBeat === false || check.addsNewConsequence === false)) invalid.push("justified_repetition_conflicts_with_semantic_findings");
    if (check.status === "stalled" && check.addsNewConsequence === true) invalid.push("stalled_conflicts_with_new_consequence");
    if (check.addsNewConsequence === true && !check.newConsequence.trim()) invalid.push("declared_consequence_missing");
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
  "每行必须额外填写 repeatsEstablishedBeat（是否重演已完成事件/已知信息/既定决定）和 addsNewConsequence（本次是否确有新后果），值为 true/false；无法判断填 null。先做这两项语义判断再选status：重复且无新后果不能progressed；重复但有新后果用justified_repetition；新后果必须写明newConsequence并由本章证据支持。explanation、actualChange、newConsequence和status必须表达同一结论，不得把本章其他新增桥段算作被重演事件的新后果。",
  "知识核验要分别说明谁知道什么：知道任务存在、知道任务内容、知道目标位置、知道执行方法是不同命题。人物不知道其中一项，不代表其他已知信息被遗忘。判断遗忘/重复认识前，连读否定句前后文、转折和指代，保留原句限定范围，不把局部未知扩写成整体未知。",
  "progressionChecks 必须按 event_repetition、knowledge_repetition、prior_goal_followthrough 各输出一行，恰好3行。用written_evidence实际前文与当前正文比较，不把任务表、摘要、预期netChange当实际兑现。每行含dimension、status、priorState、actualChange、newConsequence、previousEvidence、currentEvidence、explanation、repairSuggestion。",
  "event_repetition 检查是否重演前章已完成的事件职责；knowledge_repetition 检查人物/读者是否只是再次发现已确立的信息；prior_goal_followthrough 检查前章已作出的行动决定在本章是否尝试执行、遭遇实质阻力、改变方案或合理延后，而非结尾再决定一次。叙述换词、换摊贩/场景、增加心理旁白，本身不等于新进展。",
  "status 用 progressed（有实际事件、认识、关系或选择变化）、justified_repetition（重访但带来具体新后果/证伪/代价/理解）、stalled（有前后原文证明重复职责且没有相应变化）、insufficient_evidence（前文未覆盖或无法判断）、not_applicable（已查证不存在该比较职责，例如首章无继承目标）。actualChange记正文实际增量；newConsequence说明重复为何有价值；无增量如实留空，不凭计划补结论。",
  "证据格式{source,sourceId,quote}，previousEvidence只用established_context与已写前章ID，currentEvidence只用current_prose与本章ID，必须为对应正文连续准确短引。每类至多2条，引用和状态180字内，explanation和repairSuggestion240字内。stalled及justified_repetition须给双方证据；前章行动落实为progressed也须有先前决定和本章行动证据。首章无前文不构成停滞；后章无前文只能承认无法核验继承，不臆造旧目标。",
  "quote逐字复制，标点也是原文：不要把中文引号替换成英文引号，不要把换行改成句号，不要跨过叙述插入语拼接对白。宁可选一句内部的短片段；若需两处证据，用两个独立引用。说明和概括放explanation，不得混进quote。",
  "保留细腻和慢热：关系中的信任变化、认知修正、证据排除、试探失败、情绪承认都可构成实际增量；不要求赶路到达、战斗、升级、成功、反转或每章大事件。同一地点、习惯动作、再次问路、重复仪式本身不是问题，应判断它在本次产生什么新作用。悬疑暂不揭底、修仙闭关、民俗仪式、科幻等待、日常对白均按实际变化判断，不用题材关键词判罚。",
  "上一章的决定不是本章必须成功完成的硬指标：确有阻力、主动改选、关系后果或与当前冲突有关的心理变化，可以构成落实；单纯重述犹豫或再次决定而没有新依据不能冒充推进。区分角色知道与读者知道，读者已知而角色首次获知且改变行动，可以justified_repetition。",
  "stalled交给既有局部plot修复/质量债，repairSuggestion必须指出保留哪些有效细节、压缩哪项已完成职责、承接哪项实际行动；不新增大危机掩盖停滞，不把细腻压成流水账。insufficient_evidence只保留风险，不编造桥段。不得仅因本组三维缺口输出全局重规划或停止。",
];
