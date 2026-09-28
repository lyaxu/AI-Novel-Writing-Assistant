import { createHash } from "node:crypto";
import type { ChapterRuntimePackage } from "@ai-novel/shared/types/chapterRuntime";
import type { ReviewIssue } from "@ai-novel/shared/types/novel";

export interface ChapterRepairCandidateEvaluation {
  content: string;
  pass: boolean;
  runtimePackage: ChapterRuntimePackage;
  issues?: ReviewIssue[];
}

export interface ChapterRepairSelectionRecord {
  selected: "original" | "candidate";
  reasonCode:
    | "candidate_passed"
    | "candidate_resolved_blockers"
    | "candidate_improved"
    | "original_retained_new_severe_issue"
    | "original_retained_uncertain_severe_evidence"
    | "original_retained_obligation_regression"
    | "original_retained_no_clear_improvement";
  reason: string;
  originalContentHash: string;
  candidateContentHash: string;
  originalScore: number;
  candidateScore: number;
  severeEvidenceAttribution?: Array<{ issueKey: string; location: EvidenceLocation }>;
}

type EvidenceLocation = "existing_text" | "changed_text" | "unknown";

export function selectChapterRepairCandidate(input: {
  original: ChapterRepairCandidateEvaluation;
  candidate: ChapterRepairCandidateEvaluation;
}): ChapterRepairSelectionRecord {
  const originalSevereIssues = collectSevereIssueKeys(input.original);
  const severeEvidenceAttribution = input.candidate.runtimePackage.audit.openIssues
    .filter((issue) => (issue.severity === "high" || issue.severity === "critical")
      && !originalSevereIssues.has(normalizeKey(issue.code || issue.id)))
    .map((issue) => ({ issueKey: normalizeKey(issue.code || issue.id),
      location: locateEvidence(issue.evidence, input.original.content, input.candidate.content) }));
  const originalMissing = collectMissingObligationKeys(input.original.runtimePackage);
  const candidateMissing = collectMissingObligationKeys(input.candidate.runtimePackage);
  const rediscoveredMissing = new Set((input.candidate.runtimePackage.obligationCoverage?.missing ?? [])
    .filter((item) => locateEvidence(item.evidence, input.original.content, input.candidate.content) === "existing_text")
    .map((item) => normalizeKey(`${item.kind}:${item.summary}`))
    .filter((key) => !originalMissing.has(key)));
  const addedMissingObligations = [...candidateMissing]
    .filter((key) => !originalMissing.has(key) && !rediscoveredMissing.has(key));
  const comparableCandidateMissingCount = candidateMissing.size - rediscoveredMissing.size;
  const base = {
    originalContentHash: hashContent(input.original.content),
    candidateContentHash: hashContent(input.candidate.content),
    originalScore: input.original.runtimePackage.audit.score.overall,
    candidateScore: input.candidate.runtimePackage.audit.score.overall,
    severeEvidenceAttribution,
  };

  if (severeEvidenceAttribution.some((item) => item.location === "changed_text")) {
    return {
      ...base,
      selected: "original",
      reasonCode: "original_retained_new_severe_issue",
      reason: "候选严重问题的证据位于新增或改写文字，无法确认修复安全，因此保留原稿。",
    };
  }

  if (severeEvidenceAttribution.some((item) => item.location === "unknown")) {
    return { ...base, selected: "original", reasonCode: "original_retained_uncertain_severe_evidence",
      reason: "候选严重问题缺少可定位的原文证据，无法区分既有问题与修复风险，因此保留原稿。" };
  }

  if (addedMissingObligations.length > 0
    || comparableCandidateMissingCount > originalMissing.size) {
    return {
      ...base,
      selected: "original",
      reasonCode: "original_retained_obligation_regression",
      reason: "修复候选新增或扩大了未兑现章节义务，因此保留原稿。",
    };
  }

  if (input.candidate.pass && !input.original.pass) {
    return {
      ...base,
      selected: "candidate",
      reasonCode: "candidate_passed",
      reason: "修复候选通过接收检查，而原稿未通过。",
    };
  }

  const originalBlocking = countBlockingIssues(input.original);
  const candidateBlocking = countBlockingIssues(input.candidate);
  if (candidateBlocking < originalBlocking) {
    return {
      ...base,
      selected: "candidate",
      reasonCode: "candidate_resolved_blockers",
      reason: "修复候选减少了阻塞性问题，且没有引入新的严重问题或义务缺口。",
    };
  }

  const originalIssueCount = input.original.runtimePackage.audit.openIssues.length;
  const candidateIssueCount = input.candidate.runtimePackage.audit.openIssues.length;
  if (comparableCandidateMissingCount < originalMissing.size || candidateIssueCount < originalIssueCount) {
    return {
      ...base,
      selected: "candidate",
      reasonCode: "candidate_improved",
      reason: "修复候选减少了未兑现义务或结构化审校问题，且没有引入新的严重风险。",
    };
  }

  return {
    ...base,
    selected: "original",
    reasonCode: "original_retained_no_clear_improvement",
    reason: "修复候选没有形成明确的结构化质量改善，因此保留原稿。",
  };
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, "");
}

function locateEvidence(evidence: unknown, original: string, candidate: string): EvidenceLocation {
  const values = Array.isArray(evidence) ? evidence : [evidence];
  const excerpts = values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const quoted = [...value.matchAll(/“([^”]+)”|「([^」]+)」|『([^』]+)』|"([^"]+)"|'([^']+)'/g)]
      .map((match) => match.slice(1).find((part) => part !== undefined)!);
    return (quoted.length ? quoted : [value]).map(normalizeEvidenceText)
      .filter((part) => part.length >= 12);
  });
  const before = normalizeEvidenceText(original);
  const after = normalizeEvidenceText(candidate);
  if (!excerpts.length || excerpts.some((part) => !after.includes(part))) return "unknown";
  // This locates quoted evidence only. It does not assert that editing the quoted
  // passage caused the defect, nor erase any issue from the selected assessment.
  return excerpts.every((part) => before.includes(part)) ? "existing_text" : "changed_text";
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function collectSevereIssueKeys(evaluation: ChapterRepairCandidateEvaluation): Set<string> {
  return new Set([
    ...evaluation.runtimePackage.audit.openIssues
      .filter((issue) => issue.severity === "high" || issue.severity === "critical")
      // Runtime audit issues retain stable ids/codes. Derived ReviewIssue
      // values intentionally omit AI evidence, which is not an identity.
      .map((issue) => normalizeKey(issue.code || issue.id)),
  ]);
}

function collectMissingObligationKeys(runtimePackage: ChapterRuntimePackage): Set<string> {
  return new Set((runtimePackage.obligationCoverage?.missing ?? [])
    .map((obligation) => normalizeKey(`${obligation.kind}:${obligation.summary}`)));
}

function countBlockingIssues(evaluation: ChapterRepairCandidateEvaluation): number {
  const severeIssueCount = collectSevereIssueKeys(evaluation).size;
  const explicitBlockingCount = evaluation.runtimePackage.replanRecommendation?.blockingIssueIds?.length ?? 0;
  return Math.max(
    severeIssueCount + explicitBlockingCount,
    evaluation.runtimePackage.audit.hasBlockingIssues ? 1 : 0,
  );
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
