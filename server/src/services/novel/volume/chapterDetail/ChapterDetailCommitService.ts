import type { Prisma } from "@prisma/client";
import type { VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { assessChapterExecutionContractShape, formatChapterTaskSheetQualityFailure } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { prisma } from "../../../../db/prisma";
import { getActiveVersionRow, persistActiveVolumeWorkspace, runVolumeWorkspaceTransaction } from "../volumeWorkspacePersistence";
import { buildVolumeWorkspaceDocument, serializeVolumeWorkspaceDocument } from "../volumeWorkspaceDocument";
import type { VolumeGenerationWriteGuard } from "../infrastructure/VolumeGenerationWriteGuard";

export interface ChapterDetailTarget { volumeId: string; chapterId: string; detailMode: "purpose" | "boundary" | "task_sheet" }
interface ChapterDetailBaseline {
  novelId: string;
  workspace: VolumePlanDocument;
  versionId: string;
  versionContent: string;
  chapterRevisions: string;
  target: ChapterDetailTarget;
  writeGuard?: VolumeGenerationWriteGuard;
}
const receipts = new WeakMap<VolumePlanDocument, ChapterDetailBaseline>();
const revisions = (rows: { id: string; updatedAt: Date }[]) => JSON.stringify(rows.map(row => [row.id, row.updatedAt.toISOString()]));

/** Service-owned source receipt; clients cannot grant themselves a smaller validation scope. */
export async function captureChapterDetailBaseline(novelId: string, workspace: VolumePlanDocument, target: ChapterDetailTarget, writeGuard?: VolumeGenerationWriteGuard): Promise<ChapterDetailBaseline> {
  const [version, chapters] = await Promise.all([
    getActiveVersionRow(novelId),
    prisma.chapter.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
  ]);
  if (!version) throw new Error("章节规划来源版本不存在，请刷新卷规划。");
  return { novelId, workspace: structuredClone(workspace), versionId: version.id,
    versionContent: version.contentJson, chapterRevisions: revisions(chapters), target, writeGuard };
}

export function rememberChapterDetailBaseline(document: VolumePlanDocument, baseline: ChapterDetailBaseline): void {
  receipts.set(document, baseline);
}

export async function commitGeneratedChapterDetail(input: {
  novelId: string; generated: VolumePlanDocument; target: ChapterDetailTarget;
  ensureActiveVersionRecord: (tx: Prisma.TransactionClient, novelId: string, document: VolumePlanDocument) => Promise<{ versionId: string }>;
  writeGuard?: VolumeGenerationWriteGuard;
}): Promise<VolumePlanDocument> {
  const baseline = receipts.get(input.generated);
  if (!baseline || baseline.novelId !== input.novelId || JSON.stringify(baseline.target) !== JSON.stringify(input.target)) {
    throw new Error("章节细化结果缺少对应的生成来源，请重新细化目标章节。");
  }
  const before = baseline.workspace.volumes.find(v => v.id === input.target.volumeId)?.chapters.find(c => c.id === input.target.chapterId);
  const generated = input.generated.volumes.find(v => v.id === input.target.volumeId)?.chapters.find(c => c.id === input.target.chapterId);
  if (!before || !generated || before.chapterOrder !== generated.chapterOrder || before.chapterId !== generated.chapterId) {
    throw new Error("章节细化不能移动章节或更换执行章节。");
  }
  // Single-field editing must not pretend an unfinished chapter is an execution-ready contract.
  if (input.target.detailMode === "task_sheet") {
    const shape = assessChapterExecutionContractShape({ ...generated, novelId: input.novelId, volumeId: input.target.volumeId, chapterId: generated.id });
    if (!shape.canEnterExecution) throw new Error(formatChapterTaskSheetQualityFailure(shape));
  }
  return runVolumeWorkspaceTransaction(async tx => {
    await baseline.writeGuard?.(tx);
    await input.writeGuard?.(tx);
    const [version, rows] = await Promise.all([
      getActiveVersionRow(input.novelId, tx),
      tx.chapter.findMany({ where: { novelId: input.novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    ]);
    if (!version || version.id !== baseline.versionId || version.contentJson !== baseline.versionContent || revisions(rows) !== baseline.chapterRevisions) {
      throw new Error("细化期间章节或规划已发生修改，请刷新后重试；本次结果未保存。");
    }
    let chapter = before.chapterId
      ? await tx.chapter.findFirst({ where: { id: before.chapterId, novelId: input.novelId } })
      : await tx.chapter.findFirst({ where: { novelId: input.novelId, order: before.chapterOrder } });
    if (!chapter && before.chapterId) throw new Error("目标章节连接已失效，请刷新卷规划。");
    if (!chapter) {
      chapter = await tx.chapter.create({ data: { novelId: input.novelId, order: before.chapterOrder,
        title: generated.title, content: "", expectation: generated.summary } });
    }
    if (chapter.order !== before.chapterOrder) throw new Error("目标章节顺序已改变，请刷新卷规划。");
    const nextChapter = { ...generated, chapterId: chapter.id };
    const document = buildVolumeWorkspaceDocument({ ...baseline.workspace, volumes: baseline.workspace.volumes.map(volume =>
      volume.id !== input.target.volumeId ? volume : { ...volume, chapters: volume.chapters.map(c => c.id === before.id ? nextChapter : c) }) });
    const { versionId } = await input.ensureActiveVersionRecord(tx, input.novelId, document);
    const persisted = { ...document, activeVersionId: versionId, source: "volume" as const };
    // These are execution-contract fields only. Prose, chapter order and lifecycle state are untouched.
    await tx.chapter.update({ where: { id: chapter.id }, data: {
      title: nextChapter.title, expectation: nextChapter.summary,
      targetWordCount: nextChapter.targetWordCount ?? null, conflictLevel: nextChapter.conflictLevel ?? null,
      revealLevel: nextChapter.revealLevel ?? null, mustAvoid: nextChapter.mustAvoid ?? null,
      taskSheet: nextChapter.taskSheet ?? null, sceneCards: nextChapter.sceneCards ?? null,
    } });
    await tx.storyPlan.updateMany({ where: { novelId: input.novelId, level: "chapter", chapterId: chapter.id }, data: { status: "stale" } });
    await tx.volumePlanVersion.update({ where: { id: versionId }, data: { contentJson: serializeVolumeWorkspaceDocument(persisted) } });
    await persistActiveVolumeWorkspace(tx, input.novelId, persisted, versionId);
    await baseline.writeGuard?.(tx);
    await input.writeGuard?.(tx);
    return persisted;
  });
}
