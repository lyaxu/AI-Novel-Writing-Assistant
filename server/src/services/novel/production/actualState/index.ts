export { assertLegacyChapterNotManaged, actualStateDb, currentActualStateTransaction, runInActualStateTransaction } from "./transactionContext";
export function createChapterActualStateService() {
  const { ChapterActualStateService } = require("./ChapterActualStateService") as typeof import("./ChapterActualStateService");
  return new ChapterActualStateService();
}
export { ACTUAL_STATE_INVALID_PROPOSAL, ACTUAL_STATE_MANUAL_IGNORE, retainInvalidProposalsForReview, hasUnresolvedActualStateProposal } from "./proposalDecision";
