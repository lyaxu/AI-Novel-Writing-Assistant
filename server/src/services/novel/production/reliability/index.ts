import { createChapterProductionJournal } from "./session";
import { createPrismaChapterProductionRepository } from "./repository";

export { createChapterProductionJournal } from "./session";
export type { ChapterProductionSession, ChapterProductionJournalOptions, OpenChapterProductionInput } from "./session";
export { createPrismaChapterProductionRepository } from "./repository";
export { ChapterProductionError, chapterFingerprint, productionFingerprint, isDefinitiveProductionFailure } from "./types";
export { completedPromptResponseFromError } from "./types";
export type { CompletedPromptResponse } from "./types";
export type { ChapterProductionJournalRepository, ChapterProductionJournalRecord, JournalChapter, JournalContentWrite, JournalStateWrite, JournalTransaction } from "./types";
export { currentProductionSession, withProductionSession, productionStep, captureProductionStream } from "./executionContext";
export { executeProduction, executeProductionStream } from "./ChapterProductionExecution";

// Avoid loading the real database merely by importing the offline journal contract.
export function createDefaultChapterProductionJournal() {
  const { prisma } = require("../../../../db/prisma") as typeof import("../../../../db/prisma");
  return createChapterProductionJournal({ repository: createPrismaChapterProductionRepository(prisma) });
}
