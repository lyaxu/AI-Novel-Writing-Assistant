import type { CharacterResourceProposalSummary } from "@ai-novel/shared/types/characterResource";

const REVIEW_NOTE_LABELS: Record<string, string> = {
  "resource update requires manual review": "这项资源变化需要你核对后确认。",
  "low confidence resource update": "AI 对这项变化的把握不足，请对照正文证据。",
  "medium risk resource update": "这项变化还需要核对，请以正文明确发生的事实为准。",
  "invalid character resource payload": "资源变化的信息不完整，无法直接确认。",
  "missing resourceName or narrativeImpact": "缺少资源名称或对后续剧情的影响说明。",
  "missing evidence": "缺少可核对的正文证据。",
  "actual_state:invalid_extraction": "这条提案未通过抽取校验；核对后可忽略，不能直接确认为事实。",
  "source_quality:debt": "来源正文仍有待处理的质量问题，请结合正文核对资源事实。",
  "quality debt source requires manual review": "来源正文存在质量问题，这项资源变化需要人工核对。",
};

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Format saved AI explanations only; never infer a conflict or fabricate an older ledger fact. */
export function buildResourceReviewPresentation(proposal: CharacterResourceProposalSummary) {
  const notes = proposal.validationNotes.map((note) => note.trim()).filter(Boolean);
  const specificNote = notes.find((note) => !Object.hasOwn(REVIEW_NOTE_LABELS, note));
  const question = (notes.includes("actual_state:invalid_extraction") ? REVIEW_NOTE_LABELS["actual_state:invalid_extraction"] : null)
    ?? optionalText(proposal.payload.reviewQuestion)
    ?? optionalText(proposal.payload.riskReason)
    ?? specificNote
    ?? "这条提案未说明具体疑点，请对照下方正文证据判断是否确认。";
  return {
    question,
    ledgerFact: optionalText(proposal.payload.ledgerFact),
    chapterFact: optionalText(proposal.payload.chapterFact),
    reasons: [...new Set(notes.map((note) => REVIEW_NOTE_LABELS[note] ?? note))]
      .filter((note) => note !== question),
  };
}
