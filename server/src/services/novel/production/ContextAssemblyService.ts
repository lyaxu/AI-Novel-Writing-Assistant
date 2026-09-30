import type {
  CanonicalCharacterRuntimeState,
  CanonicalOpenConflictState,
  CanonicalPayoffState,
  CanonicalTimelineEventState,
  ChapterPayoffDirective,
  ChapterStateGoal,
  GenerationNextAction,
  NovelControlPolicy,
} from "@ai-novel/shared/types/canonicalState";
import { canonicalStateService, type CanonicalStateScope } from "../state/CanonicalStateService";
import { generationDecisionEngine } from "./GenerationDecisionEngine";
import type { ChapterPayoffDecision } from "@ai-novel/shared/types/novel/payoffPlanning";

export interface BuildStateDrivenContextInput extends CanonicalStateScope {
  novelId: string;
  policy?: Partial<NovelControlPolicy> | null;
  pendingReviewProposalCount?: number;
  openAuditIssueCount?: number;
  hasRepairableDraft?: boolean;
  payoffDecisions?: ChapterPayoffDecision[];
}

export interface StateDrivenContextBundle {
  snapshot: Awaited<ReturnType<typeof canonicalStateService.getSnapshot>>;
  nextAction: GenerationNextAction;
  chapterStateGoal: ChapterStateGoal | null;
  localCharacters: CanonicalCharacterRuntimeState[];
  localConflicts: CanonicalOpenConflictState[];
  localPayoffs: CanonicalPayoffState[];
  recentTimeline: CanonicalTimelineEventState[];
  protectedSecrets: string[];
}

function takeTop<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

export function buildChapterPayoffDirectives(
  snapshot: Awaited<ReturnType<typeof canonicalStateService.getSnapshot>>,
  _protectedSecrets: string[],
  decisions: ChapterPayoffDecision[] = [],
): ChapterPayoffDirective[] {
  const candidates = [...snapshot.narrative.overduePayoffs, ...snapshot.narrative.urgentPayoffs, ...snapshot.narrative.pendingPayoffs];
  return decisions.flatMap((decision) => {
    const payoff = candidates.find((item) => item.ledgerKey === decision.ledgerKey);
    if (!payoff || ["defer", "out_of_scope", "requires_replan"].includes(decision.operation)) return [];
    const operation = decision.operation as ChapterPayoffDirective["operation"];
    // Protected information is a separate boundary. Only the structured AI
    // decision can distinguish a permitted reward from its still-secret origin.
    const forbiddenReveal = operation === "forbid" ? decision.authorizedScope : null;
    return [{
      title: payoff.title, ledgerKey: payoff.ledgerKey,
      operation,
      reason: `${decision.reason}；本章授权范围：${decision.authorizedScope}${decision.remainingObligation ? `；余下交付：${decision.remainingObligation}` : ""}${decision.followUp ? `；后续第${decision.followUp.chapterOrder}章：${decision.followUp.expectedChange}` : ""}`,
      forbiddenReveal,
    }];
  });
}

export function buildChapterPlanningReferenceCandidates(
  snapshot: Awaited<ReturnType<typeof canonicalStateService.getSnapshot>>,
) {
  return {
    scope: "reference_candidates_not_chapter_obligations",
    openConflicts: snapshot.narrative.openConflicts,
    payoffCandidates: [...new Map([...snapshot.narrative.overduePayoffs, ...snapshot.narrative.urgentPayoffs, ...snapshot.narrative.pendingPayoffs]
      .map((item) => [item.ledgerKey, item])).values()].slice(0, 5),
    relationshipStages: snapshot.characters.map((character) => ({
      name: character.name,
      stages: character.relationStageLabels,
    })),
  };
}

export function buildChapterStateGoal(
  snapshot: Awaited<ReturnType<typeof canonicalStateService.getSnapshot>>,
  payoffDecisions: ChapterPayoffDecision[] = [],
): ChapterStateGoal | null {
  if (
    !snapshot.narrative.currentChapterId
    || typeof snapshot.narrative.currentChapterOrder !== "number"
  ) {
    return null;
  }
  const protectedSecrets = takeTop(snapshot.narrative.hiddenKnowledge, 4);
  return {
    chapterId: snapshot.narrative.currentChapterId,
    chapterOrder: snapshot.narrative.currentChapterOrder,
    summary: snapshot.narrative.currentChapterGoal ?? "advance the current narrative state",
    // Snapshot conflicts and relationship stages are reference candidates, not
    // chapter obligations. The planner must select their current relevance.
    // Keep their full records in snapshot/localConflicts/localCharacters.
    targetConflicts: [],
    targetRelationships: [],
    targetPayoffs: buildChapterPayoffDirectives(snapshot, protectedSecrets, payoffDecisions).map((item) => item.title),
    targetPayoffDirectives: buildChapterPayoffDirectives(snapshot, protectedSecrets, payoffDecisions),
    protectedSecrets,
  };
}

export class ContextAssemblyService {
  async build(input: BuildStateDrivenContextInput): Promise<StateDrivenContextBundle> {
    const snapshot = await canonicalStateService.getSnapshot(input.novelId, {
      chapterId: input.chapterId,
      chapterOrder: input.chapterOrder,
      includeCurrentChapterState: input.includeCurrentChapterState,
      timelineWindow: input.timelineWindow,
    });
    const nextAction = generationDecisionEngine.decideNextAction({
      snapshot,
      policy: input.policy,
      pendingReviewProposalCount: input.pendingReviewProposalCount,
      openAuditIssueCount: input.openAuditIssueCount,
      hasRepairableDraft: input.hasRepairableDraft,
    });
    return {
      snapshot,
      nextAction,
      chapterStateGoal: buildChapterStateGoal(snapshot, input.payoffDecisions),
      localCharacters: takeTop(snapshot.characters, 6),
      localConflicts: takeTop(snapshot.narrative.openConflicts, 4),
      localPayoffs: takeTop([
        ...snapshot.narrative.overduePayoffs,
        ...snapshot.narrative.urgentPayoffs,
        ...snapshot.narrative.pendingPayoffs,
      ], 6),
      recentTimeline: takeTop(snapshot.timeline, 4),
      protectedSecrets: takeTop(snapshot.narrative.hiddenKnowledge, 4),
    };
  }
}

export const contextAssemblyService = new ContextAssemblyService();
