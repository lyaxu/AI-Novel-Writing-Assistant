import type { ContractProseAudit, ContractProseDefects, ContractProseElementCheck } from "@ai-novel/shared/types/contractProseAudit";
import { parseChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import { prisma } from "../../../db/prisma";
import { runStructuredPrompt } from "../../../prompting/core/promptRunner";
import { contractProseAuditPrompt, type ContractProseAuditSceneInput } from "../../../prompting/prompts/novel/audit/contractProseAudit.prompts";
import { contractProseDefectsPrompt } from "../../../prompting/prompts/novel/audit/contractProseDefects.prompts";
import { detectProseQuality } from "../runtime/proseQuality/ProseQualityDetector";

/**
 * Contract-vs-prose audit for a written book.
 *
 * Two kinds of check, kept deliberately separate:
 *
 *  - Deterministic checks answer questions that have one right answer — an empty event list, a
 *    planning marker left in the prose, a contract with no scene cards. They run without a model.
 *  - The reading judgment ("did this chapter actually do what its contract said") is delegated to a
 *    registered PromptAsset. Keyword matching could not do it: a chapter can deliver an event in
 *    completely different words, and overlap would both miss that and accept a passing mention.
 *
 * The report is written to be read by a person, because the point is to make "did we get what we
 * planned" answerable without re-reading the whole book by hand.
 */

export interface ContractProseAuditFinding {
  chapterOrder: number;
  chapterTitle: string;
  kind: "contract" | "prose" | "delivery" | "scene" | "defect";
  severity: "high" | "medium" | "low";
  message: string;
  /** Where to look, when the check can say. */
  detail?: string;
}

export interface ContractProseAuditedChapter {
  chapterOrder: number;
  chapterTitle: string;
  /** Present only when the chapter has prose to judge. */
  audit: ContractProseAudit | null;
  /** The writing-layer pass, a separate call. Null whenever `audit` is null. */
  defects: ContractProseDefects | null;
  /** Deterministic findings for this chapter, independent of the model. */
  deterministic: string[];
  skippedReason?: string;
}

export interface ContractProseAuditReport {
  novelId: string;
  novelTitle: string;
  generatedAt: string;
  chapters: ContractProseAuditedChapter[];
  findings: ContractProseAuditFinding[];
}

const MAX_PROSE_CHARS_PER_CALL = 24_000;

function deterministicChapterFindings(input: {
  requiredElementCount: number;
  sceneCount: number;
  prose: string;
  targetWordCount: number | null;
}): string[] {
  const notes: string[] = [];
  if (input.requiredElementCount === 0) {
    // An empty list is not "nothing to check": it means nothing was required to happen, which is
    // the state a chapter drifts into when its list is lost or never written.
    notes.push("本章合同的最小事件清单为空——本章没有任何被要求发生的事。");
  }
  if (input.sceneCount === 0) notes.push("本章没有场景卡，无法核对阻力与转折。");
  const leaks = detectProseQuality(input.prose).findings.filter((finding) => finding.code.endsWith("token_leak"));
  for (const leak of leaks) notes.push(`正文残留规划标记：${leak.excerpt}`);
  if (input.targetWordCount && input.prose.length < input.targetWordCount * 0.6) {
    notes.push(`正文 ${input.prose.length} 字，明显低于目标 ${input.targetWordCount} 字。`);
  }
  if (input.targetWordCount && input.prose.length > input.targetWordCount * 1.35) {
    // Reported as a deviation from the contract, not as a defect in the writing. Two independent
    // readings of the chapter this check was built from both judged the prose tight while it ran
    // 151% of target, so length alone must not be presented as padding.
    const ratio = Math.round((input.prose.length / input.targetWordCount) * 100);
    notes.push(`正文 ${input.prose.length} 字，为目标 ${input.targetWordCount} 字的 ${ratio}%。超长本身不等于拖沓；这里只记录与合同的偏差。`);
  }
  return notes;
}

/** Markdown so the report can be read, pasted into an issue, or diffed between runs. */
export function renderContractProseReport(report: ContractProseAuditReport): string {
  const lines: string[] = [];
  lines.push(`# 合同 vs 正文 核对报告`);
  lines.push("");
  lines.push(`- 作品：${report.novelTitle}（${report.novelId}）`);
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 章节数：${report.chapters.length}`);
  const bySeverity = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const finding of report.findings) bySeverity[finding.severity] += 1;
  lines.push(`- 问题：高 ${bySeverity.high} / 中 ${bySeverity.medium} / 低 ${bySeverity.low}`);
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push("| 章 | 标题 | 清单 | 已落实 | 偏差 | 结论 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const chapter of report.chapters) {
    const audit = chapter.audit;
    if (!audit) {
      lines.push(`| ${chapter.chapterOrder} | ${chapter.chapterTitle} | - | - | - | ${chapter.skippedReason ?? "未核对"} |`);
      continue;
    }
    const delivered = audit.elements.filter((check) => check.verdict === "delivered").length;
    const issues = audit.elements.filter((check) => check.verdict !== "delivered").length
      + audit.scenes.filter((scene) => !scene.resistanceDelivered || !scene.turnDelivered).length
      + (audit.endingHookDelivered ? 0 : 1);
    lines.push(`| ${chapter.chapterOrder} | ${chapter.chapterTitle} | ${audit.elements.length} | ${delivered} | ${issues} | ${audit.summary.replace(/\|/g, "／")} |`);
  }
  lines.push("");

  for (const chapter of report.chapters) {
    lines.push(`## 第${chapter.chapterOrder}章 ${chapter.chapterTitle}`);
    lines.push("");
    if (chapter.deterministic.length) {
      lines.push("确定性检查（不经模型）：");
      for (const note of chapter.deterministic) lines.push(`- ${note}`);
      lines.push("");
    }
    if (!chapter.audit) {
      lines.push(`${chapter.skippedReason ?? "未核对"}`);
      lines.push("");
      continue;
    }
    lines.push("| # | 清单条目 | 判定 | 正文证据 |");
    lines.push("| --- | --- | --- | --- |");
    for (const check of chapter.audit.elements) {
      lines.push(`| ${check.index} | ${check.element.replace(/\|/g, "／")} | ${check.verdict} | ${(check.evidence || check.note).replace(/\|/g, "／")} |`);
    }
    lines.push("");
    const weakScenes = chapter.audit.scenes.filter((scene) => !scene.resistanceDelivered || !scene.turnDelivered);
    if (weakScenes.length) {
      lines.push("场景核对（只列未达标）：");
      for (const scene of weakScenes) {
        lines.push(`- ${scene.sceneKey}：阻力${scene.resistanceDelivered ? "有" : "缺"} / 转折${scene.turnDelivered ? "有" : "缺"} —— ${scene.evidence || scene.note}`);
      }
      lines.push("");
    }
    if (!chapter.audit.endingHookDelivered) {
      lines.push(`结尾钩子未落实：${chapter.audit.endingHookEvidence || "（无证据）"}`);
      lines.push("");
    }
    for (const exchange of chapter.audit.repeatedExchanges) {
      lines.push(`对话回合重复：${exchange.subject}（${exchange.repeats} 轮）`);
      lines.push(`  - 证据：${exchange.evidence}`);
      lines.push(`  - 怎么改：${exchange.fixHint}`);
    }
    for (const turn of chapter.audit.unsupportedTurns) {
      lines.push(`转变缺硬理由：${turn.character}　${turn.from} → ${turn.to}`);
      lines.push(`  - 证据：${turn.evidence}`);
      lines.push(`  - 怎么改：${turn.fixHint}`);
    }
    lines.push("");
  }

  lines.push("## 问题清单（按章）");
  lines.push("");
  const orders = [...new Set(report.findings.map((finding) => finding.chapterOrder))].sort((a, b) => a - b);
  for (const order of orders) {
    lines.push(`### 第${order}章`);
    for (const finding of report.findings.filter((item) => item.chapterOrder === order)) {
      lines.push(`- [${finding.severity}] ${finding.message}${finding.detail ? `\n  - ${finding.detail}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
/** Keep the model honest about coverage: every element must come back exactly once. */
function reconcileElements(
  required: readonly string[],
  returned: readonly ContractProseElementCheck[],
  chapter: { order: number; title: string },
  findings: ContractProseAuditFinding[],
): ContractProseElementCheck[] {
  const byIndex = new Map(returned.map((check) => [check.index, check]));
  const reconciled = required.map((element, index) => {
    const check = byIndex.get(index);
    if (check) return check;
    findings.push({
      chapterOrder: chapter.order, chapterTitle: chapter.title, kind: "delivery", severity: "medium",
      message: `审查没有对第 ${index} 条清单给出判定，已按未核对记录。`,
      detail: element,
    });
    return { index, element, verdict: "absent" as const, evidence: "（审查未覆盖此条）", note: "需要重新核对该条。" };
  });
  for (const check of returned) {
    if (check.index >= required.length) {
      findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title, kind: "delivery", severity: "low",
        message: `审查返回了清单之外的条目（index ${check.index}），已忽略。`,
      });
    }
  }
  return reconciled;
}

export async function auditNovelContracts(input: {
  novelId: string;
  chapterOrders?: readonly number[];
  provider?: string;
  model?: string;
  onProgress?: (message: string) => void;
}): Promise<ContractProseAuditReport> {
  const novel = await prisma.novel.findUnique({ where: { id: input.novelId }, select: { id: true, title: true } });
  if (!novel) throw new Error(`作品不存在：${input.novelId}`);

  const chapters = await prisma.chapter.findMany({
    where: {
      novelId: input.novelId,
      ...(input.chapterOrders?.length ? { order: { in: [...input.chapterOrders] } } : {}),
    },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { order: true, title: true, content: true, sceneCards: true, targetWordCount: true, chapterStatus: true },
  });

  const report: ContractProseAuditReport = {
    novelId: novel.id,
    novelTitle: novel.title,
    generatedAt: new Date().toISOString(),
    chapters: [],
    findings: [],
  };

  for (const chapter of chapters) {
    const prose = (chapter.content ?? "").trim();
    const scenePlan = parseChapterScenePlan(chapter.sceneCards, { targetWordCount: chapter.targetWordCount ?? undefined });
    const required = scenePlan?.requiredElements ?? [];
    const scenes: ContractProseAuditSceneInput[] = (scenePlan?.scenes ?? []).map((scene) => ({
      key: scene.key,
      title: scene.title ?? "",
      resistance: scene.resistance ?? "",
      turn: scene.turn ?? "",
    }));

    const deterministic = deterministicChapterFindings({
      requiredElementCount: required.length,
      sceneCount: scenes.length,
      prose,
      targetWordCount: chapter.targetWordCount ?? null,
    });
    for (const note of deterministic) {
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "contract", severity: required.length === 0 ? "high" : "medium", message: note,
      });
    }

    if (!prose) {
      report.chapters.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        audit: null, defects: null, deterministic, skippedReason: "本章没有正文，未做落实核对。",
      });
      continue;
    }

    input.onProgress?.(`正在核对第 ${chapter.order} 章…`);
    const result = await runStructuredPrompt({
      asset: contractProseAuditPrompt,
      promptInput: {
        novelTitle: novel.title,
        chapterOrder: chapter.order,
        chapterTitle: chapter.title ?? "",
        requiredElements: required,
        scenes,
        endingHook: scenePlan?.readerExperience?.endingHook ?? "",
        prose: prose.slice(0, MAX_PROSE_CHARS_PER_CALL),
      },
      options: {
        provider: input.provider,
        model: input.model,
        temperature: 0.1,
        novelId: novel.id,
        stage: "contract_prose_audit",
        itemKey: `chapter_${chapter.order}`,
      },
    });

    const audit: ContractProseAudit = {
      ...result.output,
      elements: reconcileElements(required, result.output.elements, { order: chapter.order, title: chapter.title ?? "" }, report.findings),
    };

    // Second, separate reading. Batched into the call above, both defect arrays came back empty for
    // a chapter whose unsupported turn a focused probe found immediately.
    input.onProgress?.(`正在检查第 ${chapter.order} 章的写作问题…`);
    const defectsResult = await runStructuredPrompt({
      asset: contractProseDefectsPrompt,
      promptInput: {
        novelTitle: novel.title,
        chapterOrder: chapter.order,
        chapterTitle: chapter.title ?? "",
        prose: prose.slice(0, MAX_PROSE_CHARS_PER_CALL),
      },
      options: {
        provider: input.provider,
        model: input.model,
        temperature: 0.1,
        novelId: novel.id,
        stage: "contract_prose_defects",
        itemKey: `chapter_${chapter.order}`,
      },
    });
    const defects: ContractProseDefects = defectsResult.output;

    for (const check of audit.elements) {
      if (check.verdict === "delivered") continue;
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "delivery",
        severity: check.verdict === "contradicted" ? "high" : check.verdict === "absent" ? "high" : "medium",
        message: `清单第 ${check.index} 条判定为 ${check.verdict}：${check.element}`,
        detail: [check.evidence, check.note].filter(Boolean).join(" / "),
      });
    }
    for (const scene of audit.scenes) {
      if (scene.resistanceDelivered && scene.turnDelivered) continue;
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "scene", severity: "medium",
        message: `场景 ${scene.sceneKey} 缺少${scene.resistanceDelivered ? "" : "阻力"}${!scene.resistanceDelivered && !scene.turnDelivered ? "与" : ""}${scene.turnDelivered ? "" : "转折"}。`,
        detail: [scene.evidence, scene.note].filter(Boolean).join(" / "),
      });
    }
    if (!audit.endingHookDelivered) {
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "delivery", severity: "medium",
        message: "正文结尾没有落实合同里的结尾钩子。",
        detail: audit.endingHookEvidence,
      });
    }
    for (const exchange of defects.repeatedExchanges) {
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "defect", severity: "high",
        message: `对话回合重复：${exchange.subject}（重复 ${exchange.repeats} 轮且没有新增信息）`,
        detail: [exchange.evidence, exchange.fixHint].filter(Boolean).join(" / "),
      });
    }
    for (const turn of defects.unsupportedTurns) {
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "defect", severity: "high",
        message: `${turn.character} 说出口的立场被推翻却没有新依据：${turn.from} → ${turn.to}`,
        detail: [turn.evidence, turn.fixHint].filter(Boolean).join(" / "),
      });
    }
    if (defects.biggestWeakness) {
      report.findings.push({
        chapterOrder: chapter.order, chapterTitle: chapter.title ?? "",
        kind: "defect", severity: "medium",
        message: `最该改的一处：${defects.biggestWeakness}`,
      });
    }

    report.chapters.push({
      chapterOrder: chapter.order, chapterTitle: chapter.title ?? "", audit, defects, deterministic,
    });
  }

  return report;
}
