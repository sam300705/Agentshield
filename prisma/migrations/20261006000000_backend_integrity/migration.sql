ALTER TYPE "AuditAction" ADD VALUE 'SCAN_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'SCAN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'SCAN_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'SCAN_RECOVERED';
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_attempt_bounds" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10 AND "attempts" <= "maxAttempts");
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_progress_bounds" CHECK ("progress" BETWEEN 0 AND 100);
CREATE INDEX "ScanJob_status_leaseExpiresAt_idx" ON "ScanJob" ("status", "leaseExpiresAt");
-- Owner-consistent parent links supplement Prisma's single-column relations.
-- Nullable legacy links use MATCH SIMPLE; new API/worker records always carry a tenant.
CREATE UNIQUE INDEX "Repository_id_organizationId_key" ON "Repository" ("id", "organizationId");
CREATE UNIQUE INDEX "AgentSession_id_organizationId_key" ON "AgentSession" ("id", "organizationId");
CREATE UNIQUE INDEX "Scan_id_organizationId_key" ON "Scan" ("id", "organizationId");
CREATE UNIQUE INDEX "GitHubInstallation_id_organizationId_key" ON "GitHubInstallation" ("id", "organizationId");
CREATE UNIQUE INDEX "GitHubInstallation_installationId_organizationId_key" ON "GitHubInstallation" ("installationId", "organizationId");
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_repository_owner_fkey" FOREIGN KEY ("repositoryId", "organizationId") REFERENCES "Repository" ("id", "organizationId");
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_session_owner_fkey" FOREIGN KEY ("sessionId", "organizationId") REFERENCES "AgentSession" ("id", "organizationId");
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_repository_owner_fkey" FOREIGN KEY ("repositoryId", "organizationId") REFERENCES "Repository" ("id", "organizationId");
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_session_owner_fkey" FOREIGN KEY ("sessionId", "organizationId") REFERENCES "AgentSession" ("id", "organizationId");
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installation_owner_fkey" FOREIGN KEY ("githubInstallationId", "organizationId") REFERENCES "GitHubInstallation" ("id", "organizationId");
ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "GitHubWebhookDelivery_installation_owner_fkey" FOREIGN KEY ("installationId", "organizationId") REFERENCES "GitHubInstallation" ("installationId", "organizationId");
ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "GitHubWebhookDelivery_scan_owner_fkey" FOREIGN KEY ("scanId", "organizationId") REFERENCES "Scan" ("id", "organizationId");
