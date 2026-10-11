import type { ChapterProductionSession } from "./session";
import { withProductionSession } from "./executionContext";

/** Owns the session lifetime, including SSE iteration and its later onDone callback. */
export async function executeProduction<T>(session: ChapterProductionSession, action: () => Promise<T>): Promise<T> {
  const heartbeat = setInterval(() => { void session.renew().catch(() => {}); }, 10_000);
  heartbeat.unref();
  try {
    const result = await withProductionSession(session, action);
    await session.close({ completed: true });
    return result;
  } catch (error) {
    await session.close({ error }).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function executeProductionStream<TChunk, TArgs extends unknown[], TResult>(
  session: ChapterProductionSession,
  create: () => Promise<{ stream: AsyncIterable<TChunk>; onDone: (...args: TArgs) => Promise<TResult> }>,
): Promise<{ stream: AsyncIterable<TChunk>; onDone: (...args: TArgs) => Promise<TResult> }> {
  const heartbeat = setInterval(() => { void session.renew().catch(() => {}); }, 10_000);
  heartbeat.unref();
  let closed = false;
  let fullyRead = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const close = async (error?: unknown, completed = false) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(idle);
    if (error) await session.close({ error, completed }).catch(() => {});
    else await session.close({ completed });
  };
  try {
    const result = await withProductionSession(session, create);
    const expireUnconsumed = () => {
      idle = setTimeout(() => { void close(new Error("正文输出未被接收，已停止本次执行并保留草稿。")); }, 60_000);
      idle.unref();
    };
    expireUnconsumed();
    return {
      stream: (async function* () {
        clearTimeout(idle);
        if (closed) throw Object.assign(new Error("正文输出接收已超时，请先核对已保存进度。"), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
        const iterator = result.stream[Symbol.asyncIterator]();
        try {
          while (true) {
            const next = await withProductionSession(session, () => iterator.next());
            if (next.done) { fullyRead = true; expireUnconsumed(); break; }
            yield next.value;
          }
        } catch (error) {
          await close(error);
          throw error;
        } finally {
          if (!fullyRead) {
            await withProductionSession(session, async () => { await iterator.return?.(); });
            await close(new Error("正文流未完整接收，部分稿已保留。"));
          }
        }
      })(),
      onDone: async (...args) => {
        clearTimeout(idle);
        if (!fullyRead || closed) {
          throw Object.assign(new Error("正文流未完成，不能保存为完整章节。"), { code: "CHAPTER_PRODUCTION_UNCERTAIN" });
        }
        try {
          const done = await withProductionSession(session, () => result.onDone(...args));
          await close(undefined, true);
          return done;
        } catch (error) {
          await close(error);
          throw error;
        }
      },
    };
  } catch (error) {
    await close(error);
    throw error;
  }
}
