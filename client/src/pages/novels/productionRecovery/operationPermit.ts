import { create } from "zustand";
import { resolveChapterOperation, type NewOperationPermit } from "./contracts";
import { readChapterProductionRecovery } from "./api";

const keyFor = (novelId: string, chapterId: string) => `${novelId}:${chapterId}`;
interface PermitState {
  permits: Record<string, NewOperationPermit | undefined>;
  authorize: (novelId: string, chapterId: string, previousOperationId: string) => void;
  clear: (novelId: string, chapterId: string) => void;
}

export const useOperationPermit = create<PermitState>((set) => ({
  permits: {},
  authorize: (novelId, chapterId, previousOperationId) => set((state) => ({
    permits: { ...state.permits, [keyFor(novelId, chapterId)]: { previousOperationId, operationId: crypto.randomUUID() } },
  })),
  clear: (novelId, chapterId) => set((state) => {
    const permits = { ...state.permits };
    delete permits[keyFor(novelId, chapterId)];
    return { permits };
  }),
}));

export function getOperationPermit(novelId: string, chapterId: string) {
  return useOperationPermit.getState().permits[keyFor(novelId, chapterId)];
}

/** Called only by an explicit chapter generation/repair click. Read failure is fail-closed. */
export async function prepareChapterOperation(novelId: string, chapterId: string): Promise<string | undefined> {
  const record = await readChapterProductionRecovery(novelId, chapterId);
  const permit = getOperationPermit(novelId, chapterId);
  useOperationPermit.getState().clear(novelId, chapterId);
  return resolveChapterOperation(record, permit);
}
