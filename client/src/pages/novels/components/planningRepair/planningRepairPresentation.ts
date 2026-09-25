function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function planningRepairHistory(history: unknown) {
  if (!Array.isArray(history)) return [];
  return history.flatMap((value) => {
    const item = record(value);
    const result = record(item.result);
    const summary = item.kind === "repair" ? text(record(item.output).reason)
      : item.kind === "review" || item.kind === "assessment"
        ? text(record(result.window).summary) || Object.values(record(result.chapters)).map(chapter => text(record(chapter).summary)).filter(Boolean).join("；")
        : "";
    return summary ? [{ round: typeof item.round === "number" ? item.round : 0, kind: item.kind, summary }] : [];
  });
}

export function planningRepairIssues(quality: unknown): string[] {
  const review = record(quality);
  const window = record(review.window);
  const candidates = [
    ...(Array.isArray(window.issues) ? window.issues : []),
    ...Object.values(record(review.chapters)).flatMap((value) => {
      const chapter = record(value);
      return Array.isArray(chapter.issues) ? chapter.issues : [];
    }),
  ];
  return [...new Set(candidates.map((issue) => text(issue) || text(record(issue).summary)).filter(Boolean))].slice(0, 3);
}
