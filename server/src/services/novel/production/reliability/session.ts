import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
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
  commitState<T>(key: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  close(options?: { completed?: boolean; error?: unknown }): Promise<void>;
}
export interface OpenChapterProductionInput { novelId: string; chapterId: string; request: unknown; operationId?: string; replaceCompletedOnly?: boolean }
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
function hasUnknownOutcome(record: ChapterProductionJournalRecord): boolean {
  return Object.values(record.steps).some(step => step.status === "unknown" || (step.external && step.status === "running"))
    || Boolean(record.values["stream.started"] && record.steps["stream.normalize"]?.status !== "done")
    || Boolean(record.values["manual_repair.started"] && !record.values["manual_repair.content"]);
}

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
        const request = record.request as { entry?: string; workflowTaskId?: string } | undefined;
        const entry = request?.entry === "stream" || request?.entry === "repair" || request?.entry === "pipeline" ? request.entry : null;
        const chapter = await tx.readChapter(input.novelId, input.chapterId);
        const leaseActive = record.status === "running" && record.expiresAt > now();
        const inputChanged = !chapter || record.expectedFingerprint !== chapterFingerprint(chapter);
        const unknown = hasUnknownOutcome(record);
        const resumeBlockedReason = leaseActive ? "本章仍在执行，请等待结果或刷新进度。"
          : inputChanged ? "当前稿件或章节约定已变化，请核对当前稿与保留稿后决定下一步。"
          : unknown ? "外部调用结果尚未确认，请核对保留稿和调用记录，确认后才可另起操作。"
          : request?.workflowTaskId || entry === "pipeline" ? "本章属于范围任务，请回到原任务的源工作区恢复。"
          : !entry ? "这份历史记录没有完整请求参数，请核对已有产物后明确发起新操作。"
          : record.status === "completed" ? "本次操作已完成；需要重新生成或修文时请明确发起新操作。" : undefined;
        return {
          operationId: record.operationId,
          status: record.status,
          entry, leaseActive, inputChanged,
          canAcknowledge: !leaseActive && !inputChanged && unknown,
          ...(resumeBlockedReason ? { resumeBlockedReason } : {}),
          canResume: Boolean((entry === "stream" || entry === "repair") && !leaseActive && !inputChanged && !unknown && !request?.workflowTaskId && record.status !== "completed"),
          ...(request?.workflowTaskId ? { workflowTaskId: request.workflowTaskId } : {}),
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
    /** Explicit source-workspace decision only: no model call or parent-task state mutation. */
    async acknowledgeUnknown(input: { novelId: string; chapterId: string; operationId: string }): Promise<void> {
      await transaction(async tx => {
        const row = await tx.readJournal(input.novelId, input.chapterId);
        const record = row && parseRecord(row.metadataJson);
        if (!record || record.operationId !== input.operationId) conflict();
        if (record.status === "running" && record.expiresAt > now()) throw new ChapterProductionError("CHAPTER_PRODUCTION_BUSY", "本章仍在执行，请先等待结果。");
        const chapter = await tx.readChapter(input.novelId, input.chapterId);
        if (!chapter || chapterFingerprint(chapter) !== record.expectedFingerprint) conflict();
        if (!hasUnknownOutcome(record)) return;
        const affectedSteps = Object.entries(record.steps).filter(([, step]) => step.status === "unknown" || (step.status === "running" && step.external)).map(([key]) => key);
        if (record.values["stream.started"] && record.steps["stream.normalize"]?.status !== "done") affectedSteps.push("stream.started");
        if (record.values["manual_repair.started"] && !record.values["manual_repair.content"]) affectedSteps.push("manual_repair.started");
        await tx.archiveJournal(input.novelId, input.chapterId, {
          ...record, operationId: `${record.operationId}:decision:${randomUUID()}`,
          recoveryDecision: { kind: "acknowledge_unknown", originalOperationId: record.operationId, acknowledgedAt: now(), affectedSteps },
        });
        for (const step of Object.values(record.steps)) {
          if (step.status === "unknown" || step.status === "running") step.status = "failed";
        }
        if (record.steps["stream.normalize"]?.status !== "done") delete record.values["stream.started"];
        if (!record.values["manual_repair.content"]) delete record.values["manual_repair.started"];
        record.status = "paused"; record.expiresAt = 0; delete record.error;
        await tx.writeJournal(input.novelId, input.chapterId, row!.metadataJson, JSON.stringify(record));
      });
    },
    /** Private saved request; callers must keep it server-side and resume the original entry. */
    async readResumeRequest(input: { novelId: string; chapterId: string; operationId: string }): Promise<Record<string, unknown>> {
      const inspection = await this.inspect(input);
      if (!inspection || inspection.operationId !== input.operationId) conflict();
      if (inspection.leaseActive) throw new ChapterProductionError("CHAPTER_PRODUCTION_BUSY", "本章仍在执行，请先查看已保存进度。");
      if (inspection.inputChanged) conflict();
      if (!inspection.canResume) throw new ChapterProductionError("CHAPTER_PRODUCTION_UNCERTAIN", "请先核对已有输出；范围任务须回到原工作区恢复。");
      return transaction(async tx => {
        const row = await tx.readJournal(input.novelId, input.chapterId);
        const record = row && parseRecord(row.metadataJson);
        if (!record || record.operationId !== input.operationId || !record.request) conflict();
        return record.request as Record<string, unknown>;
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
        if (explicitNewOperation && input.replaceCompletedOnly && previous?.status !== "completed") conflict();
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
          next = { version: 1, operationId: input.operationId ?? randomUUID(), request: input.request, requestFingerprint, inputFingerprint: fingerprint, expectedFingerprint: fingerprint, expectedChapter: chapter, token, expiresAt: now() + leaseMs, status: "running", steps: {}, values: {} };
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
        commitState: (key, write) => mutate(async (current, _chapter, tx) => {
          const previous = current.steps[key];
          if (previous?.status === "done") return previous.output as never;
          if (!tx.assetClient) throw new ChapterProductionError("CHAPTER_PRODUCTION_STORAGE", "章节状态事务不可用，正文已保留。");
          const output = await write(tx.assetClient);
          current.steps[key] = { status: "done", external: false, output };
          return output;
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
