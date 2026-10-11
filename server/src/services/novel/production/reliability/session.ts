import { randomUUID } from "node:crypto";
import { ChapterProductionError, chapterFingerprint, productionFingerprint, isDefinitiveProductionFailure, type ChapterProductionInspection, type ChapterProductionJournalRecord, type ChapterProductionJournalRepository, type JournalChapter, type JournalContentWrite, type JournalStateWrite, type JournalTransaction } from "./types";

export interface ChapterProductionSession {
  readonly novelId: string;
  readonly chapterId: string;
  readonly operationId: string;
  runStep<T>(key: string, fn: () => Promise<T>, options?: { external?: boolean }): Promise<T>;
  get<T>(key: string): T | undefined;
  getStepOutput<T>(key: string): T | undefined;
  put(key: string, value: unknown): Promise<void>;
  checkpoint(partialText: string): Promise<void>;
  assertCurrent(): Promise<void>;
  renew(): Promise<void>;
  bindPrepared(snapshot: unknown): Promise<void>;
  saveContent(input: JournalContentWrite): Promise<void>;
  updateState(input: JournalStateWrite): Promise<void>;
  close(options?: { completed?: boolean; error?: unknown }): Promise<void>;
}
export interface OpenChapterProductionInput { novelId: string; chapterId: string; request: unknown; operationId?: string }
export interface ChapterProductionJournalOptions { repository: ChapterProductionJournalRepository; now?: () => number; leaseMs?: number }
function parseRecord(json: string | null): ChapterProductionJournalRecord {
  try {
    const parsed = JSON.parse(json ?? "null") as ChapterProductionJournalRecord;
    if (parsed?.version !== 1 || !parsed.expectedChapter || !parsed.steps || !parsed.values || !parsed.operationId) throw new Error("Unsupported journal record");
    return parsed;
  } catch (cause) { throw new ChapterProductionError("CHAPTER_PRODUCTION_STORAGE", "章节恢复记录不可读取，请保留现场。", { cause }); }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function conflict(): never { throw new ChapterProductionError("CHAPTER_PRODUCTION_CONFLICT", "章节正文、执行约定或执行所有权已变化，已停止写入，请回到章节工作区核对。"); }

export function createChapterProductionJournal(options: ChapterProductionJournalOptions) {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? 120_000;
  async function transaction<T>(fn: (tx: JournalTransaction) => Promise<T>): Promise<T> {
    try { return await options.repository.transaction(fn); }
    catch (cause) {
      if (cause instanceof ChapterProductionError) throw cause;
      throw new ChapterProductionError("CHAPTER_PRODUCTION_STORAGE", `章节恢复记录保存失败：${message(cause)}`, { cause });
    }
  }
  return {
    async inspect(input: { novelId: string; chapterId: string }): Promise<ChapterProductionInspection | null> {
      return transaction(async (tx) => {
        const row = await tx.readJournal(input.novelId, input.chapterId);
        if (!row) return null;
        const record = parseRecord(row.metadataJson);
        return {
          operationId: record.operationId,
          status: record.status,
          ...(record.partialText !== undefined ? { partialText: record.partialText } : {}),
          // Provider diagnostics can contain request fragments. Keep raw errors private in the journal.
          steps: Object.entries(record.steps).map(([key, step]) => ({
            key, status: step.status,
            ...(step.error ? { error: step.status === "unknown" ? "外部调用结果未确认，请核对已保留内容。" : "这一步尚未完成，请查看运行记录。" } : {}),
          })),
          ...(record.error ? { error: "执行尚未完成，请查看步骤状态和已保留内容。" } : {}),
          ...(record.expectedChapter.content ? { savedDraft: record.expectedChapter.content } : {}),
        };
      });
    },
    async open(input: OpenChapterProductionInput): Promise<ChapterProductionSession> {
      const { novelId, chapterId } = input;
      const token = randomUUID();
      const requestFingerprint = productionFingerprint(input.request);
      let record = await transaction(async (tx) => {
        const chapter = await tx.readChapter(novelId, chapterId);
        if (!chapter) conflict();
        const row = await tx.readJournal(novelId, chapterId);
        let next: ChapterProductionJournalRecord;
        const previous = row ? parseRecord(row.metadataJson) : null;
        if (previous?.status === "running" && previous.expiresAt > now()) throw new ChapterProductionError("CHAPTER_PRODUCTION_BUSY", "本章已有执行进行中，请查看已保存进度。");
        const explicitNewOperation = Boolean(previous && input.operationId && input.operationId !== previous.operationId);
        if (previous && !explicitNewOperation) {
          if (previous.requestFingerprint !== requestFingerprint || previous.expectedFingerprint !== chapterFingerprint(chapter)) conflict();
          if (input.operationId && previous.operationId !== input.operationId) conflict();
          next = previous;
          for (const step of Object.values(next.steps)) if (step.status === "running") step.status = step.external ? "unknown" : "failed";
          next.token = token;
          next.expiresAt = now() + leaseMs;
          next.status = "running";
        } else {
          if (previous) {
            for (const step of Object.values(previous.steps)) if (step.status === "running") step.status = step.external ? "unknown" : "failed";
            if (previous.status === "running") previous.status = "paused";
            await tx.archiveJournal(novelId, chapterId, previous);
          }
          const fingerprint = chapterFingerprint(chapter);
          next = { version: 1, operationId: input.operationId ?? randomUUID(), requestFingerprint, inputFingerprint: fingerprint, expectedFingerprint: fingerprint, expectedChapter: chapter, token, expiresAt: now() + leaseMs, status: "running", steps: {}, values: {} };
        }
        await tx.writeJournal(novelId, chapterId, row?.metadataJson ?? null, JSON.stringify(next));
        return next;
      });
      let closed = false;
      let tail: Promise<unknown> = Promise.resolve();
      // Serialize only short journal transactions, never user callbacks: nested steps are valid.
      function mutate<T>(fn: (current: ChapterProductionJournalRecord, chapter: JournalChapter, tx: JournalTransaction) => Promise<T> | T, checkVersion = true): Promise<T> {
        const pending = tail.then(async () => {
          if (closed) conflict();
          return transaction(async (tx) => {
            const row = await tx.readJournal(novelId, chapterId);
            if (!row) conflict();
            const current = parseRecord(row.metadataJson);
            if (current.token !== token || current.expiresAt <= now() || current.status !== "running") conflict();
            const chapter = await tx.readChapter(novelId, chapterId);
            if (!chapter || (checkVersion && chapterFingerprint(chapter) !== current.expectedFingerprint)) conflict();
            const result = await fn(current, chapter, tx);
            current.expiresAt = current.status === "running" ? now() + leaseMs : 0;
            await tx.writeJournal(novelId, chapterId, row.metadataJson, JSON.stringify(current));
            record = current;
            return result;
          });
        });
        tail = pending.catch(() => undefined);
        return pending;
      }
      const session: ChapterProductionSession = {
        novelId, chapterId,
        operationId: record.operationId,
        get<T>(key: string) { return record.values[key] as T | undefined; },
        getStepOutput<T>(key: string) { return record.steps[key]?.status === "done" ? record.steps[key].output as T : undefined; },
        put: (key, value) => mutate((current) => { current.values[key] = value; }),
        checkpoint: (partialText) => mutate((current) => { current.partialText = partialText; }),
        assertCurrent: () => mutate(() => undefined),
        renew: () => mutate(() => undefined),
        bindPrepared: (snapshot) => mutate((current, chapter) => {
          if ((chapter.content ?? "") !== (current.expectedChapter.content ?? "")) conflict();
          current.prepared = snapshot;
          current.expectedChapter = chapter;
          current.expectedFingerprint = chapterFingerprint(chapter);
        }, false),
        saveContent: (data) => mutate(async (current, chapter, tx) => {
          await tx.writeContent(novelId, chapterId, chapter, data);
          current.expectedChapter = { ...chapter, content: data.content };
          current.expectedFingerprint = chapterFingerprint(current.expectedChapter);
        }),
        updateState: (data) => mutate(async (_current, chapter, tx) => {
          await tx.writeState(novelId, chapterId, chapter, data);
        }),
        async runStep<T>(key: string, fn: () => Promise<T>, stepOptions: { external?: boolean } = {}): Promise<T> {
          const state = await mutate((current) => {
            const previous = current.steps[key];
            if (previous?.status === "unknown") throw new ChapterProductionError("CHAPTER_PRODUCTION_UNCERTAIN", "外部调用结果尚不确定，已保留已接收内容，请核对后再处理。");
            if (previous?.status === "running") throw new ChapterProductionError("CHAPTER_PRODUCTION_BUSY", "本章的这一步已在执行。");
            if (previous?.status === "done") return { reused: true as const, output: previous.output as T };
            current.steps[key] = { status: "running", external: stepOptions.external ?? false };
            return { reused: false as const };
          });
          if (state.reused) return state.output;
          let output: T;
          try { output = await fn(); }
          catch (error) {
            const definitive = isDefinitiveProductionFailure(error);
            await mutate((current) => {
              current.steps[key] = { status: stepOptions.external && !definitive ? "unknown" : "failed", external: stepOptions.external ?? false, error: message(error) };
              current.error = message(error);
            }, false);
            // Preserve typed safety/limit codes for the caller while the journal blocks resending.
            const typed = error as { code?: unknown; name?: string; category?: string } | null;
            const terminalCode = typeof typed?.code === "string" && (
              typed.code === "LLM_OUTPUT_LIMIT" || typed.code.startsWith("CHAPTER_PRODUCTION_")
              || typed.code === "PLANNING_REPAIR_CONFLICT" || typed.code === "PLANNING_REPAIR_CONFIRMATION_REQUIRED"
              || typed.code === "CONFIRMATION_REQUIRED"
            );
            const preserveError = error instanceof ChapterProductionError || terminalCode
              || (typed?.name === "StructuredOutputError" && typed.category === "output_limit");
            if (stepOptions.external && !definitive && !preserveError) throw new ChapterProductionError("CHAPTER_PRODUCTION_UNCERTAIN", "外部调用中断，已保留已有输出，不能自动重新发送。", { cause: error });
            throw error;
          }
          // Persist failure here is NOT a callback failure: keep running/unknown, never allow resending.
          await mutate((current) => { current.steps[key] = { status: "done", external: stepOptions.external ?? false, output }; });
          return output;
        },
        async close(closeOptions = {}) {
          if (closed) return;
          await mutate((current) => {
            current.status = closeOptions.completed ? "completed" : "paused";
            current.expiresAt = 0;
            if (closeOptions.error) current.error = message(closeOptions.error);
          }, closeOptions.completed === true);
          closed = true;
        },
      };
      return session;
    },
  };
}
