/**
 * Cross-layer port for the automatic chapter-title recovery path.
 *
 * The workflow healing service runs on the read path (`getTaskById`) and must
 * not import the director runtime stack (that would create a workflow -> director
 * -> workflow module cycle). The director service registers an implementation of
 * this port when it is constructed; the healing service only knows this small
 * contract.
 *
 * The port stays optional on purpose: in tests or in a worker process without a
 * director runtime the healing service keeps its previous bounded-pause
 * behaviour instead of failing.
 */
export type ChapterTitleAutoRecoveryScheduleResult = "scheduled" | "already_attempted" | "unavailable";

export interface ChapterTitleAutoRecoveryPort {
  /** Bounded, idempotent: at most one automatic repair per task + volume. */
  scheduleAutoRepair(input: {
    taskId: string;
    volumeId: string | null;
    issue: string;
  }): Promise<ChapterTitleAutoRecoveryScheduleResult>;
}

let chapterTitleAutoRecoveryPort: ChapterTitleAutoRecoveryPort | null = null;

export function registerChapterTitleAutoRecoveryPort(port: ChapterTitleAutoRecoveryPort | null): void {
  chapterTitleAutoRecoveryPort = port;
}

export function getChapterTitleAutoRecoveryPort(): ChapterTitleAutoRecoveryPort | null {
  return chapterTitleAutoRecoveryPort;
}
