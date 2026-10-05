import { isOpeningPlanningPromise, selectedPlanningPromiseIds, type SelectedPlanningDirection } from "@ai-novel/shared/types/novel/planningPromises";
import type { ChapterPlanningPromiseCheck } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { buildChapterEvidenceIndex, matchesChapterEvidence } from "./chapterEvidence";

export function planningPromiseEvidenceContext(reviewContextJson?: string, chapterOrder?: number) {
  let context: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(reviewContextJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) context = parsed as Record<string, unknown>;
  } catch { /* Missing context remains unknown. */ }
  const direction = context.selectedPlanningDirection as SelectedPlanningDirection | undefined;
  const source = direction?.status === "available" ? direction.candidate : {};
  const sourceIndex = buildChapterEvidenceIndex(source);
  const contextIndex = buildChapterEvidenceIndex({
    originalChapters: context.originalChapters, candidateChapters: context.candidateChapters,
    readonlyPrevious: context.readonlyPrevious, readonlyNext: context.readonlyNext,
    writtenEvidence: context.writtenEvidence,
    readonlyOpeningRoutes: context.readonlyOpeningRoutes,
    readonlyPlanningHorizon: context.readonlyPlanningHorizon,
    plannedVolume: (context.planningContext as { targetVolume?: unknown } | undefined)?.targetVolume,
  });
  return { direction, sourceIndex, contextIndex, sourceIds: selectedPlanningPromiseIds(direction, chapterOrder) };
}

export function validatePlanningPromiseEvidence(checks: ChapterPlanningPromiseCheck[], candidate: unknown, reviewContextJson?: string) {
  const { sourceIds, sourceIndex, contextIndex } = planningPromiseEvidenceContext(reviewContextJson, (candidate as { chapterOrder?: number })?.chapterOrder);
  if (checks.length !== sourceIds.length || new Set(checks.map(check => check.sourceId)).size !== checks.length
    || checks.some(check => !sourceIds.includes(check.sourceId))) {
    const returned = checks.map(check => check.sourceId);
    const missing = sourceIds.filter(id => !returned.includes(id));
    const extra = returned.filter(id => !sourceIds.includes(id));
    const duplicated = returned.filter((id, index) => returned.indexOf(id) !== index);
    throw new Error(`promiseChecks must cover every selected source exactly once; absent sources must not be invented. `
      + `应核对 ${sourceIds.length} 个来源，实际返回 ${checks.length} 条；`
      + `缺失 ${JSON.stringify(missing)}，多余 ${JSON.stringify(extra)}，重复 ${JSON.stringify([...new Set(duplicated)])}。`);
  }
  const candidateIndex = buildChapterEvidenceIndex(candidate);
  for (const check of checks) {
    if (check.handoffStatus !== undefined && (check.status === "deferred" ? check.handoffStatus === "not_needed" : check.handoffStatus !== "not_needed")) {
      throw new Error(`Promise ${check.sourceId} has an incompatible handoffStatus. 实际 status=${JSON.stringify(check.status)}，handoffStatus=${JSON.stringify(check.handoffStatus)}：deferred 时 handoffStatus 必须是 not_needed，其他状态则不能是 not_needed。`);
    }
    if (isOpeningPlanningPromise(check.sourceId) && check.scope === "book_arc") throw new Error(`Opening promise ${check.sourceId} cannot be reclassified as a book arc. 实际 scope=${JSON.stringify(check.scope)}：开篇承诺必须留在开篇范围内。`);
    if (!check.sourceEvidence.length || check.sourceEvidence.some(evidence => {
      const sourcePath = evidence.sourcePath.startsWith("selectedPlanningDirection.candidate.")
        ? evidence.sourcePath.slice("selectedPlanningDirection.candidate.".length)
        : evidence.sourcePath;
      return !belongsToPlanningPromiseSource(sourcePath, check.sourceId)
        || !matchesChapterEvidence(sourceIndex, { ...evidence, sourcePath });
    })) {
      const failed = check.sourceEvidence.filter(evidence => {
        const sourcePath = evidence.sourcePath.startsWith("selectedPlanningDirection.candidate.")
          ? evidence.sourcePath.slice("selectedPlanningDirection.candidate.".length)
          : evidence.sourcePath;
        return !belongsToPlanningPromiseSource(sourcePath, check.sourceId)
          || !matchesChapterEvidence(sourceIndex, { ...evidence, sourcePath });
      });
      throw new Error(`Promise ${check.sourceId} lacks exact selected-source evidence. `
        + `sourceEvidence 共 ${check.sourceEvidence.length} 条，其中 ${failed.length} 条不合格：`
        + JSON.stringify(failed.map(evidence => ({ sourcePath: evidence.sourcePath ?? null, quote: (evidence.quote ?? "").slice(0, 80) })))
        + `。"不合格"包括路径不属于该承诺 ${check.sourceId}，或引文在来源里找不到。`);
    }
    if (check.candidateEvidence.some(evidence => !matchesChapterEvidence(candidateIndex, evidence))
      || check.contextEvidence.some(evidence => !matchesChapterEvidence(contextIndex, evidence))) {
      const badCandidate = check.candidateEvidence.filter(evidence => !matchesChapterEvidence(candidateIndex, evidence));
      const badContext = check.contextEvidence.filter(evidence => !matchesChapterEvidence(contextIndex, evidence));
      throw new Error(`Promise ${check.sourceId} cites evidence absent from supplied plans or written facts. `
        + `candidateEvidence 不合格 ${badCandidate.length}/${check.candidateEvidence.length} 条，`
        + `contextEvidence 不合格 ${badContext.length}/${check.contextEvidence.length} 条：`
        + JSON.stringify([...badCandidate, ...badContext].map(evidence => ({ sourcePath: evidence.sourcePath ?? null, quote: (evidence.quote ?? "").slice(0, 80) }))));
    }
    if (["preserved", "adapted"].includes(check.status) && !check.candidateEvidence.length && !check.contextEvidence.length) {
      throw new Error(`Promise ${check.sourceId} needs evidence of its preserved narrative value. 实际 status=${JSON.stringify(check.status)}，candidateEvidence ${check.candidateEvidence.length} 条、contextEvidence ${check.contextEvidence.length} 条：preserved/adapted 至少要有一条证据。`);
    }
  }
}

export function belongsToPlanningPromiseSource(sourcePath: string, sourceId: string): boolean {
  return sourcePath === sourceId || sourcePath.startsWith(`${sourceId}.`) || sourcePath.startsWith(`${sourceId}[`);
}
