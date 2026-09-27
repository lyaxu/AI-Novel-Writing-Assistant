interface SimpleCreationChapterFact {
  id?: string;
  order: number;
  content?: string | null;
}

export function isCompletedStorySample(input: {
  status?: string;
  checkpointType?: string | null;
  seed: Record<string, unknown> | null;
}): boolean {
  if (input.status !== "succeeded" || input.checkpointType !== "workflow_completed") return false;
  const scope = input.seed?.productionScope;
  if (scope !== "sample3" && scope !== "sample5") return false;
  const directorInput = input.seed?.directorInput as { autoExecutionPlan?: unknown } | undefined;
  const plan = directorInput?.autoExecutionPlan ?? input.seed?.autoExecutionPlan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return false;
  const range = plan as Record<string, unknown>;
  return range.mode === "chapter_range" && range.startOrder === 1
    && range.endOrder === (scope === "sample3" ? 3 : 5);
}

export interface SimpleCreationRemainingRange {
  startOrder: number;
  endOrder: number;
  totalChapterCount: number;
  savedChapterCount: number;
  remainingChapterCount: number;
  nextChapterId: string | null;
}

export function resolveSimpleCreationRemainingRange(input: {
  chapters: SimpleCreationChapterFact[];
  estimatedChapterCount?: number | null;
}): SimpleCreationRemainingRange | null {
  const maxChapterOrder = input.chapters.reduce(
    (maximum, chapter) => Math.max(maximum, Math.round(chapter.order)),
    0,
  );
  const totalChapterCount = Math.max(
    maxChapterOrder,
    Math.round(input.estimatedChapterCount ?? 0),
  );
  if (totalChapterCount <= 0) return null;

  const savedOrders = new Set(
    input.chapters
      .filter((chapter) => chapter.content?.trim())
      .map((chapter) => Math.round(chapter.order)),
  );
  const startOrder = Array.from(
    { length: totalChapterCount },
    (_item, index) => index + 1,
  ).find((order) => !savedOrders.has(order));
  if (!startOrder) return null;

  return {
    startOrder,
    endOrder: totalChapterCount,
    totalChapterCount,
    savedChapterCount: savedOrders.size,
    remainingChapterCount: totalChapterCount - savedOrders.size,
    nextChapterId: input.chapters.find((chapter) => chapter.order === startOrder)?.id ?? null,
  };
}
