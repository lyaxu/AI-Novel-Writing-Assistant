import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../db/prisma";

const transactions = new AsyncLocalStorage<Prisma.TransactionClient>();
export const currentActualStateTransaction = () => transactions.getStore();
export function runInActualStateTransaction<T>(tx: Prisma.TransactionClient, action: () => Promise<T>): Promise<T> {
  return transactions.run(tx, action);
}
/** Only the explicit actual-state adapter graph uses this facade. No global Prisma replacement. */
export const actualStateDb: typeof prisma = new Proxy(prisma, {
  get(target, property) {
    const tx = transactions.getStore();
    if (!tx) return Reflect.get(target, property);
    if (property === "$transaction") return async (action: unknown) => {
      if (typeof action !== "function") throw new Error("Actual-state transactions require a callback.");
      return action(tx);
    };
    const value = Reflect.get(tx, property);
    return typeof value === "function" ? value.bind(tx) : value;
  },
});

/** Compatibility writers must recheck inside their write transaction, including a job started before the journal. */
export async function assertLegacyChapterNotManaged(tx: Prisma.TransactionClient, novelId: string, chapterId: string): Promise<void> {
  if (currentActualStateTransaction()) return;
  const row = await tx.chapterArtifactSyncCheckpoint.findFirst({
    where: { novelId, chapterId, artifactType: "production_execution", contentHash: "active" }, select: { id: true },
  });
  if (row) throw Object.assign(new Error("当前章节由生产执行管理，已阻止旧入口覆盖实际状态。"), { code: "CHAPTER_PRODUCTION_CONFLICT" });
}
