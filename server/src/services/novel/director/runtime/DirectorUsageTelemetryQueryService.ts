import type {
  DirectorLlmUsageRecordSummary,
  DirectorLlmUsageSummary,
  DirectorPromptUsageSummary,
  DirectorStepRun,
  DirectorStepUsageSummary,
} from "@ai-novel/shared/types/directorRuntime";
import { prisma } from "../../../../db/prisma";

interface DirectorUsageRow {
  id: string;
  novelId: string | null;
  taskId: string | null;
  runId: string | null;
  stepIdempotencyKey: string | null;
  nodeKey: string | null;
  promptAssetKey: string | null;
  promptVersion: string | null;
  modelRoute: string | null;
  provider: string | null;
  model: string | null;
  status: string;
  attributionStatus: string;
  durationMs: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  metadataJson: string | null;
  recordedAt: Date | string;
}

export interface DirectorUsageTelemetryProjection {
  summary: DirectorLlmUsageSummary | null;
  recentUsage: DirectorLlmUsageRecordSummary[];
  stepUsage: DirectorStepUsageSummary[];
  promptUsage: DirectorPromptUsageSummary[];
}

export interface DirectorChapterUsageBudgetSummary extends DirectorLlmUsageSummary {
  chapterId: string;
  chapterOrder: number | null;
  sourceChapterIds: string[];
  latestUsageRecordId: string;
  nodeKey?: string | null;
}

export interface DirectorControlUsageRecord extends DirectorLlmUsageRecordSummary {
  chapterOrder: number | null;
  sourceChapterId: string | null;
  finishReason: string | null;
}

export interface DirectorTaskControlUsage {
  summary: DirectorLlmUsageSummary | null;
  chapterUsage: DirectorChapterUsageBudgetSummary[];
  unattributedUsage: DirectorLlmUsageSummary | null;
  nodeUsage: Array<DirectorLlmUsageSummary & { nodeKey: string | null }>;
  stageUsage: Array<DirectorLlmUsageSummary & { stage: string | null }>;
  /** Complete, chronological records, not the truncated display history. */
  records: DirectorControlUsageRecord[];
}

interface ChapterIdentity {
  chapterId: string;
  chapterOrder: number;
  volumeId?: string;
}

interface DirectorUsageMetadata {
  chapterId?: string | null;
  volumeId?: string | null;
  stage?: string | null;
  itemKey?: string | null;
  scope?: string | null;
  entrypoint?: string | null;
  finishReason?: string | null;
}

function parseUsageMetadata(row: DirectorUsageRow): DirectorUsageMetadata {
  if (!row.metadataJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(row.metadataJson) as Record<string, unknown>;
    return {
      chapterId: typeof parsed.chapterId === "string" ? parsed.chapterId : null,
      volumeId: typeof parsed.volumeId === "string" ? parsed.volumeId : null,
      stage: typeof parsed.stage === "string" ? parsed.stage : null,
      itemKey: typeof parsed.itemKey === "string" ? parsed.itemKey : null,
      scope: typeof parsed.scope === "string" ? parsed.scope : null,
      entrypoint: typeof parsed.entrypoint === "string" ? parsed.entrypoint : null,
      finishReason: typeof parsed.finishReason === "string" ? parsed.finishReason : null,
    };
  } catch {
    return {};
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toTimestamp(value: Date | string | null | undefined): number {
  const iso = toIso(value);
  if (!iso) {
    return 0;
  }
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function emptySummary(): DirectorLlmUsageSummary {
  return {
    llmCallCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    lastRecordedAt: null,
  };
}

function hasUsage(summary: DirectorLlmUsageSummary): boolean {
  return summary.llmCallCount > 0
    || summary.promptTokens > 0
    || summary.completionTokens > 0
    || summary.totalTokens > 0;
}

function summarizeRows(rows: DirectorUsageRow[]): DirectorLlmUsageSummary | null {
  const summary = rows.reduce<DirectorLlmUsageSummary>((acc, row) => {
    const recordedAt = toIso(row.recordedAt);
    return {
      llmCallCount: acc.llmCallCount + 1,
      promptTokens: acc.promptTokens + row.promptTokens,
      completionTokens: acc.completionTokens + row.completionTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      durationMs: (acc.durationMs ?? 0) + Math.max(0, row.durationMs ?? 0),
      lastRecordedAt: toTimestamp(recordedAt) > toTimestamp(acc.lastRecordedAt)
        ? recordedAt
        : acc.lastRecordedAt,
    };
  }, emptySummary());
  return hasUsage(summary) ? summary : null;
}

function mapUsageRecord(row: DirectorUsageRow): DirectorLlmUsageRecordSummary {
  const metadata = parseUsageMetadata(row);
  return {
    id: row.id,
    novelId: row.novelId,
    taskId: row.taskId,
    runId: row.runId,
    chapterId: metadata.chapterId ?? null,
    volumeId: metadata.volumeId ?? null,
    stage: metadata.stage ?? null,
    itemKey: metadata.itemKey ?? null,
    scope: metadata.scope ?? null,
    entrypoint: metadata.entrypoint ?? null,
    stepIdempotencyKey: row.stepIdempotencyKey,
    nodeKey: row.nodeKey,
    promptAssetKey: row.promptAssetKey,
    promptVersion: row.promptVersion,
    modelRoute: row.modelRoute,
    provider: row.provider,
    model: row.model,
    status: row.status,
    attributionStatus: row.attributionStatus,
    llmCallCount: 1,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    durationMs: row.durationMs,
    lastRecordedAt: toIso(row.recordedAt),
    recordedAt: toIso(row.recordedAt) ?? new Date(0).toISOString(),
  };
}

function buildChapterUsage(
  rows: DirectorUsageRow[],
  identities: Map<string, ChapterIdentity>,
): DirectorChapterUsageBudgetSummary[] {
  const grouped = new Map<string, DirectorUsageRow[]>();
  for (const row of rows) {
    const chapterId = resolveChapterIdentity(row, identities)?.chapterId;
    if (!chapterId) {
      continue;
    }
    grouped.set(chapterId, [
      ...(grouped.get(chapterId) ?? []),
      row,
    ]);
  }
  return [...grouped.entries()]
    .map(([chapterId, chapterRows]) => {
      const sortedRows = chapterRows
        .slice()
        .sort((left, right) => toTimestamp(right.recordedAt) - toTimestamp(left.recordedAt));
      const summary = summarizeRows(sortedRows) ?? emptySummary();
      return {
        ...summary,
        chapterId,
        chapterOrder: resolveChapterIdentity(sortedRows[0]!, identities)?.chapterOrder ?? null,
        sourceChapterIds: [...new Set(sortedRows.map((row) => parseUsageMetadata(row).chapterId!))],
        latestUsageRecordId: sortedRows[0]?.id ?? chapterId,
        nodeKey: sortedRows[0]?.nodeKey ?? null,
      };
    })
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function resolveChapterIdentity(row: DirectorUsageRow, identities: Map<string, ChapterIdentity>) {
  const metadata = parseUsageMetadata(row);
  const identity = identities.get(metadata.chapterId?.trim() ?? "");
  // A contradictory volume reference is not reliable chapter attribution.
  if (identity?.volumeId && metadata.volumeId && identity.volumeId !== metadata.volumeId) {
    return undefined;
  }
  return identity;
}

function summarizeByDimension(rows: DirectorUsageRow[], key: (row: DirectorUsageRow) => string | null) {
  const grouped = new Map<string | null, DirectorUsageRow[]>();
  for (const row of rows) {
    const dimension = key(row);
    const group = grouped.get(dimension) ?? [];
    group.push(row);
    grouped.set(dimension, group);
  }
  return [...grouped].map(([dimension, group]) => ({ dimension, ...summarizeRows(group)! }));
}

function buildStepUsage(
  rows: DirectorUsageRow[],
  steps: DirectorStepRun[] = [],
): DirectorStepUsageSummary[] {
  const stepByKey = new Map(steps.map((step) => [step.idempotencyKey, step]));
  const grouped = new Map<string, DirectorUsageRow[]>();
  for (const row of rows) {
    if (!row.stepIdempotencyKey) {
      continue;
    }
    grouped.set(row.stepIdempotencyKey, [
      ...(grouped.get(row.stepIdempotencyKey) ?? []),
      row,
    ]);
  }

  return [...grouped.entries()]
    .map(([stepIdempotencyKey, stepRows]) => {
      const first = stepRows[0];
      const step = stepByKey.get(stepIdempotencyKey);
      const summary = summarizeRows(stepRows) ?? emptySummary();
      return {
        ...summary,
        stepIdempotencyKey,
        nodeKey: step?.nodeKey ?? first?.nodeKey ?? "unknown",
        label: step?.label ?? null,
        status: step?.status ?? null,
        startedAt: step?.startedAt ?? null,
        finishedAt: step?.finishedAt ?? null,
        attributionStatus: "step_attributed",
      };
    })
    .sort((left, right) => toTimestamp(right.lastRecordedAt) - toTimestamp(left.lastRecordedAt))
    .slice(0, 12);
}

function buildPromptUsage(rows: DirectorUsageRow[]): DirectorPromptUsageSummary[] {
  const grouped = new Map<string, DirectorUsageRow[]>();
  for (const row of rows) {
    const promptAssetKey = row.promptAssetKey?.trim();
    if (!promptAssetKey) {
      continue;
    }
    const groupKey = [
      promptAssetKey,
      row.promptVersion?.trim() ?? "",
      row.nodeKey?.trim() ?? "",
    ].join("|");
    grouped.set(groupKey, [
      ...(grouped.get(groupKey) ?? []),
      row,
    ]);
  }

  return [...grouped.values()]
    .map((promptRows) => {
      const first = promptRows[0]!;
      const summary = summarizeRows(promptRows) ?? emptySummary();
      return {
        ...summary,
        promptAssetKey: first.promptAssetKey ?? "unknown",
        promptVersion: first.promptVersion,
        nodeKey: first.nodeKey,
        stepIdempotencyKey: first.stepIdempotencyKey,
        label: first.promptAssetKey,
        attributionStatus: first.attributionStatus,
      };
    })
    .sort((left, right) => toTimestamp(right.lastRecordedAt) - toTimestamp(left.lastRecordedAt))
    .slice(0, 16);
}

function normalizeWhereByNovelOrTask(novelId: string, taskIds: string[]) {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter((id) => id.trim().length > 0)));
  if (uniqueTaskIds.length === 0) {
    return { novelId };
  }
  return {
    OR: [
      { novelId },
      { taskId: { in: uniqueTaskIds } },
    ],
  };
}

export class DirectorUsageTelemetryQueryService {
  async getTaskUsage(
    taskId: string,
    steps: DirectorStepRun[] = [],
  ): Promise<DirectorUsageTelemetryProjection> {
    const rows = await prisma.directorLlmUsageRecord.findMany({
      where: { taskId },
      orderBy: { recordedAt: "desc" },
      select: this.selectUsageRow(),
    });
    return this.buildProjection(rows, steps);
  }

  async getBookUsage(input: {
    novelId: string;
    taskIds?: string[];
    steps?: DirectorStepRun[];
  }): Promise<DirectorUsageTelemetryProjection> {
    const rows = await prisma.directorLlmUsageRecord.findMany({
      where: normalizeWhereByNovelOrTask(input.novelId, input.taskIds ?? []),
      orderBy: { recordedAt: "desc" },
      select: this.selectUsageRow(),
    });
    return this.buildProjection(rows, input.steps ?? []);
  }

  async getTaskControlUsage(input: {
    novelId: string;
    taskId: string;
    since?: Date;
  }): Promise<DirectorTaskControlUsage> {
    if (!input.taskId.trim() || !input.novelId.trim()) {
      throw new Error("Task-scoped usage requires a task and novel identifier.");
    }
    if (input.since && !Number.isFinite(input.since.getTime())) {
      throw new Error("Usage recovery boundary must be a valid date.");
    }
    const [rows, identities] = await Promise.all([
      prisma.directorLlmUsageRecord.findMany({
        where: {
          taskId: input.taskId,
          ...(input.since ? { recordedAt: { gte: input.since } } : {}),
        },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        select: this.selectUsageRow(),
      }),
      this.loadChapterIdentities(input.novelId),
    ]);
    // Defensively preserve the query boundary in test adapters and imported stores too.
    const scopedRows = rows.filter((row) => row.taskId === input.taskId
      && (!input.since || toTimestamp(row.recordedAt) >= input.since.getTime()))
      .sort((left, right) => toTimestamp(left.recordedAt) - toTimestamp(right.recordedAt)
        || left.id.localeCompare(right.id));
    const resolve = (row: DirectorUsageRow) => row.novelId && row.novelId !== input.novelId
      ? undefined
      : resolveChapterIdentity(row, identities);
    const attributableRows = scopedRows.filter((row) => resolve(row));
    return {
      summary: summarizeRows(scopedRows),
      chapterUsage: buildChapterUsage(attributableRows, identities),
      unattributedUsage: summarizeRows(scopedRows.filter((row) => !resolve(row))),
      nodeUsage: summarizeByDimension(scopedRows, (row) => row.nodeKey)
        .map(({ dimension, ...summary }) => ({ ...summary, nodeKey: dimension })),
      stageUsage: summarizeByDimension(scopedRows, (row) => parseUsageMetadata(row).stage ?? null)
        .map(({ dimension, ...summary }) => ({ ...summary, stage: dimension })),
      records: scopedRows.map((row) => {
        const identity = resolve(row);
        const metadata = parseUsageMetadata(row);
        return {
          ...mapUsageRecord(row),
          sourceChapterId: metadata.chapterId ?? null,
          chapterId: identity?.chapterId ?? null,
          chapterOrder: identity?.chapterOrder ?? null,
          finishReason: metadata.finishReason ?? null,
        };
      }),
    };
  }

  async getLargestChapterUsage(input: {
    novelId: string;
    taskIds?: string[];
    since?: Date;
  }): Promise<DirectorChapterUsageBudgetSummary | null> {
    // Budget checks must be scoped to the current task only.
    // normalizeWhereByNovelOrTask uses OR semantics that pull in all historical
    // novel records across cancelled/failed tasks, causing false positives.
    const uniqueTaskIds = Array.from(
      new Set((input.taskIds ?? []).filter((id) => id.trim().length > 0)),
    );
    const scopeWhere = uniqueTaskIds.length > 0
      ? { taskId: { in: uniqueTaskIds } }
      : { novelId: input.novelId };
    const rows = await prisma.directorLlmUsageRecord.findMany({
      where: {
        ...scopeWhere,
        ...(input.since ? { recordedAt: { gte: input.since } } : {}),
      },
      orderBy: { recordedAt: "desc" },
      select: this.selectUsageRow(),
    });
    const identities = await this.loadChapterIdentities(input.novelId);
    return buildChapterUsage(rows.filter((row) => !row.novelId || row.novelId === input.novelId), identities)[0] ?? null;
  }

  private async loadChapterIdentities(novelId: string): Promise<Map<string, ChapterIdentity>> {
    const [chapters, plans] = await Promise.all([
      prisma.chapter.findMany({
        where: { novelId },
        select: { id: true, order: true },
      }),
      prisma.volumeChapterPlan.findMany({
        where: { volume: { novelId } },
        select: { id: true, chapterId: true, chapterOrder: true, volumeId: true },
      }),
    ]);
    const identities = new Map<string, ChapterIdentity>(chapters.map((chapter) => [chapter.id, {
      chapterId: chapter.id,
      chapterOrder: chapter.order,
    }]));
    for (const plan of plans) {
      if (!Number.isSafeInteger(plan.chapterOrder) || plan.chapterOrder < 1) continue;
      const linked = plan.chapterId ? identities.get(plan.chapterId) : undefined;
      // Never guess from titles, timestamp proximity, or matching chapter orders.
      // Broken/cross-book links and conflicting orders remain unassigned.
      if (plan.chapterId && (!linked || linked.chapterOrder !== plan.chapterOrder)) continue;
      if (identities.has(plan.id)) continue;
      identities.set(plan.id, {
        chapterId: linked?.chapterId ?? plan.id,
        chapterOrder: plan.chapterOrder,
        volumeId: plan.volumeId,
      });
    }
    return identities;
  }

  private buildProjection(
    rows: DirectorUsageRow[],
    steps: DirectorStepRun[],
  ): DirectorUsageTelemetryProjection {
    const sortedRows = rows
      .slice()
      .sort((left, right) => toTimestamp(right.recordedAt) - toTimestamp(left.recordedAt));
    return {
      summary: summarizeRows(sortedRows),
      recentUsage: sortedRows.slice(0, 12).map(mapUsageRecord),
      stepUsage: buildStepUsage(sortedRows, steps),
      promptUsage: buildPromptUsage(sortedRows),
    };
  }

  private selectUsageRow() {
    return {
      id: true,
      novelId: true,
      taskId: true,
      runId: true,
      stepIdempotencyKey: true,
      nodeKey: true,
      promptAssetKey: true,
      promptVersion: true,
      modelRoute: true,
      provider: true,
      model: true,
      status: true,
      attributionStatus: true,
      durationMs: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      metadataJson: true,
      recordedAt: true,
    } satisfies Record<keyof DirectorUsageRow, true>;
  }
}

export const directorUsageTelemetryQueryService = new DirectorUsageTelemetryQueryService();
