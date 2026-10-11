import type { StateChangeProposal } from "@ai-novel/shared/types/canonicalState";
export const ACTUAL_STATE_INVALID_PROPOSAL = "actual_state:invalid_extraction";
export const ACTUAL_STATE_MANUAL_IGNORE = "actual_state:manual_ignore";
export function retainInvalidProposalsForReview<T extends { accepted: StateChangeProposal[]; pendingReview: StateChangeProposal[]; rejected: StateChangeProposal[] }>(validation: T): T {
  return { ...validation, rejected: [], pendingReview: [...validation.pendingReview, ...validation.rejected.map((proposal) => ({
    ...proposal, status: "pending_review" as const,
    validationNotes: [...proposal.validationNotes, ACTUAL_STATE_INVALID_PROPOSAL],
  }))] };
}
export function hasUnresolvedActualStateProposal(rows: Array<{ payloadJson: string; status: string; validationNotesJson: string | null }>, operationId: string, contentHash: string): boolean {
  return rows.some((row) => {
    const payload = JSON.parse(row.payloadJson) as { syncOperationId?: string; syncContentHash?: string };
    if (payload.syncOperationId !== operationId || payload.syncContentHash !== contentHash) return false;
    const notes: unknown = row.validationNotesJson ? JSON.parse(row.validationNotesJson) : [];
    return row.status !== "committed" && !(row.status === "rejected" && Array.isArray(notes) && notes.includes(ACTUAL_STATE_MANUAL_IGNORE));
  });
}
