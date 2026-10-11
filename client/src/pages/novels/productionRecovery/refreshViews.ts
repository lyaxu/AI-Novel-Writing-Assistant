import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys.ts";

/** Failure can retain both prose and proposals, so refresh their independent caches together. */
export async function refreshChapterProductionViews(
  client: Pick<QueryClient, "invalidateQueries">,
  novelId: string,
  chapterId: string,
) {
  await Promise.all([
    queryKeys.novels.detail(novelId),
    queryKeys.novels.chapterEditorWorkspace(novelId, chapterId),
    queryKeys.novels.characterResources(novelId),
    queryKeys.novels.characterResourceContext(novelId, chapterId),
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}
