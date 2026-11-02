-- Stop old publishers before deploying: they do not understand publication fencing.
ALTER TABLE "GitHubCheckPublication"
 ADD COLUMN "leaseOwner" TEXT,
 ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
 ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0 CHECK ("generation" >= 0),
 ADD COLUMN "createMayHaveOccurred" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "lastOutcome" TEXT NOT NULL DEFAULT 'NOT_DISPATCHED'
  CHECK ("lastOutcome" IN ('NOT_DISPATCHED','IN_FLIGHT','OBSERVED','UNKNOWN'));
-- A legacy transaction could have crashed after an uncommitted remote create.
-- Never infer absence from a null ID or automatically duplicate such a create.
UPDATE "GitHubCheckPublication" SET
 "createMayHaveOccurred" = ("checkRunId" IS NULL),
 "lastOutcome" = CASE WHEN "checkRunId" IS NULL THEN 'UNKNOWN' ELSE 'OBSERVED' END,
 "status" = CASE WHEN "status" = 'COMPLETE' THEN 'PENDING' ELSE "status" END,
 "publishedState" = NULL;
