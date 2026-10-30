import type {
  StyleContract,
  StyleContractIssueCategory,
  StyleContractSection,
  StyleContractSectionKey,
  StyleContractViolationSource,
  StyleDetectionRuleType,
} from "@ai-novel/shared/types/styleEngine";
import { STYLE_CONTRACT_EXECUTION_LINE } from "./contract/styleRuleText";

/**
 * 正文写作时的合同顺序：叙事/语言/节奏等“核心写法”排在前面。
 * 上下文预算不足、块被摘要裁剪时，先保留的也是这几段核心规则。
 */
export const WRITER_STYLE_CONTRACT_SECTIONS: StyleContractSectionKey[] = [
  "narrative",
  "language",
  "rhythm",
  "character",
  "antiAi",
  "selfCheck",
];

export const PLANNER_STYLE_CONTRACT_SECTIONS: StyleContractSectionKey[] = [
  "narrative",
  "language",
  "character",
  "antiAi",
];

export const STYLE_RULE_CONTRACT_SECTIONS: Array<Extract<StyleContractSectionKey, "narrative" | "character" | "language" | "rhythm">> = [
  "narrative",
  "character",
  "language",
  "rhythm",
];

function getSection(contract: StyleContract, key: StyleContractSectionKey): StyleContractSection {
  return contract[key];
}

function compactValue(value: string | null | undefined, fallback = "none"): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function compactList(values: string[] | undefined, fallback = "none"): string {
  const normalized = (values ?? []).map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join(", ") : fallback;
}

function summarizeSection(section: StyleContractSection, maxLines: number): string[] {
  return section.lines.map((line) => line.trim()).filter(Boolean).slice(0, maxLines);
}

export function listStyleContractSectionsWithContent(contract: StyleContract): StyleContractSectionKey[] {
  return WRITER_STYLE_CONTRACT_SECTIONS.filter((key) => getSection(contract, key).hasContent);
}

/** 是否存在真正的写法规则（叙事/人物/语言/节奏），而不只是全局反 AI 底线。 */
export function hasStyleRuleContent(contract: StyleContract | null | undefined): boolean {
  if (!contract) {
    return false;
  }
  return STYLE_RULE_CONTRACT_SECTIONS.some((key) => getSection(contract, key).hasContent);
}

export function buildPlannerStyleContractSummaryText(
  contract: StyleContract | null | undefined,
  maxLines = 10,
): string {
  if (!contract) {
    return "";
  }

  const lines = PLANNER_STYLE_CONTRACT_SECTIONS
    .flatMap((key) => summarizeSection(getSection(contract, key), key === "antiAi" ? 3 : 2))
    .slice(0, maxLines);

  return lines.join("\n");
}

export function buildFullStyleContractText(
  contract: StyleContract | null | undefined,
  sections: StyleContractSectionKey[] = WRITER_STYLE_CONTRACT_SECTIONS,
): string {
  if (!contract) {
    return "";
  }

  // 只输出有内容的小节：未选写法时不能给正文塞“叙事合同/语言合同”这类空壳标题。
  return sections
    .map((key) => getSection(contract, key))
    .filter((section) => section.hasContent)
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function firstRuleLine(section: StyleContractSection): string {
  const line = section.lines.find((item) => item.trim());
  if (!line) {
    return "";
  }
  return line.replace(/^[-*\d.\s]+/g, "").replace(/^总体要求（[^）]*）：/, "").trim();
}

function buildStyleContractOverview(contract: StyleContract): string {
  const entries: string[] = [];
  for (const key of STYLE_RULE_CONTRACT_SECTIONS) {
    const section = getSection(contract, key);
    if (!section.hasContent) {
      continue;
    }
    const summary = section.summary?.trim() || firstRuleLine(section);
    if (!summary) {
      continue;
    }
    entries.push(`- ${section.title.replace(/合同$/, "")}：${summary.length > 90 ? `${summary.slice(0, 90)}…` : summary}`);
  }
  if (entries.length === 0) {
    return "";
  }
  return ["【写法合同速览】", ...entries].join("\n");
}

export function buildStyleContractMetaText(contract: StyleContract | null | undefined): string {
  if (!contract) {
    return "";
  }

  const activeSections = listStyleContractSectionsWithContent(contract);
  return [
    "Style contract meta:",
    `effective_style_profile_id=${compactValue(contract.meta.effectiveStyleProfileId)}`,
    `task_style_profile_id=${compactValue(contract.meta.taskStyleProfileId)}`,
    `source_targets=${compactList(contract.meta.activeSourceTargets)}`,
    `source_labels=${compactList(contract.meta.activeSourceLabels)}`,
    `maturity=${contract.meta.maturity}`,
    `active_sections=${compactList(activeSections)}`,
    `writer_sections=${compactList(contract.meta.writerIncludedSections)}`,
    `planner_sections=${compactList(contract.meta.plannerIncludedSections)}`,
    `dropped_sections=${compactList(contract.meta.droppedSections)}`,
    `uses_global_anti_ai_baseline=${contract.meta.usesGlobalAntiAiBaseline ? "yes" : "no"}`,
    `global_anti_ai_rule_ids=${compactList(contract.meta.globalAntiAiRuleIds)}`,
    `style_anti_ai_rule_ids=${compactList(contract.meta.styleAntiAiRuleIds)}`,
  ].join("\n");
}

export function buildWriterStyleContractText(contract: StyleContract | null | undefined): string {
  if (!contract) {
    return "";
  }
  const body = buildFullStyleContractText(contract);
  if (!body) {
    return "";
  }
  // 有真正写法规则时先给一段速览：即使上下文预算把合同裁短，核心风格方向也会保留。
  const overview = hasStyleRuleContent(contract) ? buildStyleContractOverview(contract) : "";
  return [overview, body, hasStyleRuleContent(contract) ? STYLE_CONTRACT_EXECUTION_LINE : ""]
    .filter(Boolean)
    .join("\n\n");
}

export function inferStyleViolationSource(
  ruleId: string | null | undefined,
  contract: StyleContract | null | undefined,
): StyleContractViolationSource {
  const normalizedRuleId = ruleId?.trim();
  if (!normalizedRuleId || !contract) {
    return "style_contract";
  }
  if (contract.meta.globalAntiAiRuleIds.includes(normalizedRuleId)) {
    return "global_anti_ai";
  }
  if (contract.meta.styleAntiAiRuleIds.includes(normalizedRuleId)) {
    return "style_anti_ai";
  }
  return "style_contract";
}

export function inferStyleIssueCategory(input: {
  issueCategory?: StyleContractIssueCategory | null;
  source?: StyleContractViolationSource | null;
  ruleType?: StyleDetectionRuleType | null;
}): StyleContractIssueCategory {
  if (input.issueCategory === "story_structure") {
    return "story_structure";
  }
  if (input.source === "global_anti_ai" || input.source === "style_anti_ai") {
    return "style_expression";
  }
  if (input.ruleType === "style" || input.ruleType === "character") {
    return "style_expression";
  }
  return "style_expression";
}
