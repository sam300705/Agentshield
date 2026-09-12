CREATE TABLE "GitHubCheckPublication" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "failureMessage" TEXT,
    "deadLetteredAt" TIMESTAMP(3),
    "checkRunId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubCheckPublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubCheckPublication_scanId_key" ON "GitHubCheckPublication"("scanId");
CREATE INDEX "GitHubCheckPublication_status_nextAttemptAt_idx" ON "GitHubCheckPublication"("status", "nextAttemptAt");
CREATE INDEX "GitHubCheckPublication_organizationId_status_idx" ON "GitHubCheckPublication"("organizationId", "status");
CREATE INDEX "GitHubCheckPublication_leaseExpiresAt_idx" ON "GitHubCheckPublication"("leaseExpiresAt");
CREATE INDEX "GitHubCheckPublication_deadLetteredAt_idx" ON "GitHubCheckPublication"("deadLetteredAt");

ALTER TABLE "GitHubCheckPublication"
ADD CONSTRAINT "GitHubCheckPublication_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
