ALTER TABLE "CharacterCastOption" ADD COLUMN "coveragePlanJson" TEXT;
ALTER TABLE "CharacterCastOptionMember" ADD COLUMN "identityKey" TEXT;
ALTER TABLE "CharacterCastOptionMember" ADD COLUMN "appliedCharacterId" TEXT;
ALTER TABLE "CharacterCastOptionMember" ADD COLUMN "aliasesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CharacterCastOptionMember" ADD COLUMN "nameLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CharacterCastOptionRelation" ADD COLUMN "sourceIdentityKey" TEXT;
ALTER TABLE "CharacterCastOptionRelation" ADD COLUMN "targetIdentityKey" TEXT;
CREATE UNIQUE INDEX "CharacterCastOptionMember_optionId_identityKey_key" ON "CharacterCastOptionMember"("optionId", "identityKey");
