ALTER TYPE "AuditAction" ADD VALUE 'GITHUB_DELIVERY_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'GITHUB_INSTALLATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'GITHUB_CHECK_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'GITHUB_CHECK_FAILED';
ALTER TABLE "Repository" ADD COLUMN "githubAccessible" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "GitHubCheckPublication" (
 "scanId" TEXT PRIMARY KEY REFERENCES "Scan"("id") ON DELETE CASCADE,
 "checkRunId" INTEGER,
 "publishedState" TEXT,
 "status" TEXT NOT NULL DEFAULT 'PENDING',
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "failureCode" TEXT,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "GitHubCheckPublication_status_nextAttemptAt_idx" ON "GitHubCheckPublication"("status", "nextAttemptAt");
ALTER TABLE "GitHubWebhookDelivery"
 ADD COLUMN "repositoryExternalId" TEXT,
 ADD COLUMN "pullRequestNumber" INTEGER,
 ADD COLUMN "commitSha" TEXT,
 ADD COLUMN "ref" TEXT;
