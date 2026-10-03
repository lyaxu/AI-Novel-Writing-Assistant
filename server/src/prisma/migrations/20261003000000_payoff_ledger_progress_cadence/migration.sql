-- Payoff ledger promises declare their own advance cadence so a chapter contract can list the
-- promises that are due, and so a promise that was just advanced stops being reported as due.
-- All three are nullable: existing rows simply have no declared cadence until the next sync.
ALTER TABLE "PayoffLedgerItem" ADD COLUMN "progressEvery" INTEGER;
ALTER TABLE "PayoffLedgerItem" ADD COLUMN "nextProgressChapter" INTEGER;
ALTER TABLE "PayoffLedgerItem" ADD COLUMN "payoffIntensity" TEXT;
