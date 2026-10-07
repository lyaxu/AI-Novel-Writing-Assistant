-- The chapter_list prompt requires every chapter to declare its protagonistAction and
-- chapterPayoff, and refuses a list whose neighbouring chapters declare the same action or
-- payoff. Those two values were validated but never persisted: VolumeChapterPlan had no
-- columns for them and the merge rebuilt each row field by field without them, so the
-- anti-repetition check only ever held for the duration of the call that produced it.
-- Both are nullable: existing rows simply have no declaration until the chapters are replanned.
ALTER TABLE "VolumeChapterPlan" ADD COLUMN "protagonistAction" TEXT;
ALTER TABLE "VolumeChapterPlan" ADD COLUMN "chapterPayoff" TEXT;
