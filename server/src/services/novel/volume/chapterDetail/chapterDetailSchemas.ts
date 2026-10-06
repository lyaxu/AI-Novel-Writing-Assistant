import { z } from "zod";
import { generatedChapterSceneCardSchema } from "@ai-novel/shared/types/chapterLengthControl";
import { generatedReaderExperienceContractSchema } from "@ai-novel/shared/types/novel/readerExperience";

const conciseRequiredText = z.string().trim().min(1).max(240);
const conciseTextList = z.array(z.string().trim().min(1).max(160)).max(8).default([]);
const boundedReaderExperienceSchema = generatedReaderExperienceContractSchema.extend({
  readerQuestion: conciseRequiredText,
  promisedReward: conciseRequiredText,
  protagonistWant: conciseRequiredText,
  primaryResistance: conciseRequiredText,
  keyTurn: conciseRequiredText,
  emotionalShift: conciseRequiredText,
  informationReveal: conciseRequiredText,
  netChange: conciseRequiredText,
  inheritedHookResponsibilities: z.array(z.string().trim().min(1).max(160)).max(4),
  endingHook: conciseRequiredText,
});
const boundedSceneCardSchema = generatedChapterSceneCardSchema.extend({
  key: z.string().trim().min(1).max(48),
  title: z.string().trim().min(1).max(64),
  purpose: conciseRequiredText,
  mustAdvance: conciseTextList,
  mustPreserve: conciseTextList,
  entryState: conciseRequiredText,
  exitState: conciseRequiredText,
  forbiddenExpansion: conciseTextList,
  resistance: conciseRequiredText,
  turn: conciseRequiredText,
  emotionalShift: conciseRequiredText,
  readerValue: conciseRequiredText,
});

function normalizeObjectAlias(raw: unknown, aliasMap: Record<string, string[]>): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const record = { ...(raw as Record<string, unknown>) };
  for (const [canonicalKey, aliases] of Object.entries(aliasMap)) {
    if (record[canonicalKey] !== undefined && record[canonicalKey] !== null) {
      continue;
    }
    for (const alias of aliases) {
      if (record[alias] !== undefined && record[alias] !== null) {
        record[canonicalKey] = record[alias];
        break;
      }
    }
  }
  return record;
}

function normalizeInteger(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return value;
}

function normalizeStringArray(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,，;；、|]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

function normalizeSceneCardPayload(raw: unknown): unknown {
  const normalized = normalizeObjectAlias(raw, {
    key: ["sceneKey", "id"],
    title: ["sceneTitle", "label", "name"],
    purpose: ["objective", "goal", "summary"],
    mustAdvance: ["mustAdvanceItems", "advanceItems", "deliverables"],
    mustPreserve: ["mustPreserveItems", "preserveItems", "guardrails"],
    entryState: ["startState", "sceneEntry", "openingState"],
    exitState: ["endState", "sceneExit", "closingState"],
    forbiddenExpansion: ["forbiddenExpansions", "mustAvoid", "forbidden"],
    targetWordCount: ["target_word_count", "targetWords", "wordCount", "budget", "字数"],
    resistance: ["obstacle", "opposition", "sceneResistance", "阻力"],
    turn: ["turningPoint", "reversal", "sceneTurn", "转折"],
    emotionalShift: ["emotionShift", "emotionalTurn", "情绪位移"],
    readerValue: ["readerReward", "scenePayoff", "读者价值", "读者回报"],
  });
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return normalized;
  }
  const record = normalized as Record<string, unknown>;
  return {
    ...record,
    mustAdvance: normalizeStringArray(record.mustAdvance),
    mustPreserve: normalizeStringArray(record.mustPreserve),
    forbiddenExpansion: normalizeStringArray(record.forbiddenExpansion),
    targetWordCount: normalizeInteger(record.targetWordCount),
  };
}

function normalizeScenePlanPayload(raw: unknown): unknown {
  const normalized = normalizeObjectAlias(raw, {
    taskSheet: ["任务单", "task_sheet", "writingTask", "执行任务单"],
    sceneCards: ["scenePlan", "scenes", "scene_cards", "sceneCardList"],
    readerExperience: ["readerExperienceContract", "reader_experience", "读者体验合同"],
  });
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return normalized;
  }
  const record = normalized as Record<string, unknown>;
  return {
    ...record,
    sceneCards: Array.isArray(record.sceneCards)
      ? record.sceneCards.map((item) => normalizeSceneCardPayload(item))
      : record.sceneCards,
  };
}

function normalizeBoundaryPayload(raw: unknown): unknown {
  const normalized = normalizeObjectAlias(raw, {
    exclusiveEvent: ["exclusive_event", "chapterExclusiveEvent", "独占事件", "核心独占事件"],
    endingState: ["ending_state", "chapterEndingState", "章末状态", "本章结束状态"],
    nextChapterEntryState: ["next_chapter_entry_state", "nextEntryState", "下章起始状态", "下章入口状态"],
    conflictLevel: ["冲突等级", "conflict_level", "conflict"],
    revealLevel: ["揭露等级", "reveal_level", "reveal"],
    targetWordCount: ["目标字数", "target_word_count", "wordCount", "字数"],
    mustAvoid: ["禁止事项", "避免事项", "must_avoid"],
    payoffRefs: ["兑现关联", "payoff_refs", "payoffs", "关联兑现"],
  });
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return normalized;
  }
  const record = normalized as Record<string, unknown>;
  return {
    ...record,
    conflictLevel: normalizeInteger(record.conflictLevel),
    revealLevel: normalizeInteger(record.revealLevel),
    targetWordCount: normalizeInteger(record.targetWordCount),
    mustAvoid: Array.isArray(record.mustAvoid)
      ? record.mustAvoid.map((item) => String(item).trim()).filter(Boolean).join("；")
      : record.mustAvoid,
    payoffRefs: normalizeStringArray(record.payoffRefs),
  };
}

export function createChapterPurposeSchema() {
  return z.preprocess(
    (raw) => normalizeObjectAlias(raw, {
      purpose: ["章节目标", "chapterGoal", "goal", "objective"],
    }),
    z.object({
      purpose: conciseRequiredText,
    }),
  );
}

export function createChapterBoundarySchema() {
  return z.preprocess(normalizeBoundaryPayload, z.object({
    exclusiveEvent: conciseRequiredText,
    endingState: conciseRequiredText,
    nextChapterEntryState: conciseRequiredText,
    conflictLevel: z.number().int().min(0).max(100),
    revealLevel: z.number().int().min(0).max(100),
    targetWordCount: z.number().int().min(200).max(20000),
    mustAvoid: conciseRequiredText,
    payoffRefs: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  }));
}

export function createChapterTaskSheetSchema() {
  return z.preprocess(normalizeScenePlanPayload, z.object({
    requiredElements: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
    taskSheet: z.string().trim().min(1).max(600),
    readerExperience: boundedReaderExperienceSchema,
    sceneCards: z.array(z.preprocess(normalizeSceneCardPayload, boundedSceneCardSchema)).min(3).max(8),
  }));
}

export function createChapterExecutionContractSchema() {
  return z.preprocess(
    (raw) => normalizeScenePlanPayload(normalizeBoundaryPayload(normalizeObjectAlias(raw, {
      purpose: ["章节目标", "chapterGoal", "goal", "objective"],
      requiredElements: ["requiredBeats", "mustHappen", "chapterRequiredElements", "必须落实"],
    }))),
    z.object({
      purpose: conciseRequiredText,
      exclusiveEvent: conciseRequiredText,
      endingState: conciseRequiredText,
      nextChapterEntryState: conciseRequiredText,
      conflictLevel: z.number().int().min(0).max(100),
      revealLevel: z.number().int().min(0).max(100),
      targetWordCount: z.number().int().min(200).max(20000),
      mustAvoid: conciseRequiredText,
      payoffRefs: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
      // Chapter-level minimum event list: the concrete things this chapter must actually show.
      // The prompt asks for 3-8 concrete entries, but the schema stays permissive on purpose:
      // a hard minimum would fail generation and force a retry whenever the model omits one,
      // and a local planning gap must not block the chain. Absence is surfaced as advisory debt.
      requiredElements: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
      taskSheet: z.string().trim().min(1).max(600),
      readerExperience: boundedReaderExperienceSchema,
      sceneCards: z.array(z.preprocess(normalizeSceneCardPayload, boundedSceneCardSchema)).min(3).max(8),
      // The model declares, per adjacent chapter, whether this contract consumes that
      // chapter's one-time milestone. Code cannot decide this: the original guard tried to
      // infer it from an 18-word verb list in titles and was blind on a real book
      // (5/5 titles yielded no anchor, including "翻出"). Asking the model to state the
      // relationship turns an unsolvable string-matching problem into a structural check
      // that can reject a contract which pre-empts or re-runs a neighbouring chapter.
      neighborEventUse: z.array(z.object({
        relation: z.enum(["previous", "next"]),
        consumesExclusiveEvent: z.boolean(),
        evidence: z.string().trim().min(1).max(200),
      })).default([]),
      // The model declares any place where mustAvoid forbids something the contract also
      // schedules. Verified structurally (each entry must cite a real mustAvoid clause and a
      // real scheduled item), never by string-matching prohibition text against prose.
      mustAvoidConflicts: z.array(z.object({
        forbiddenClause: z.string().trim().min(1).max(200),
        scheduledIn: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(200),
      })).default([]),
    }),
  );
}
