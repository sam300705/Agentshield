-- Additive lifecycle hardening migration. Temporary defaults keep existing demo jobs valid.
ALTER TABLE "EvidenceArtifact" ADD COLUMN "organizationId" TEXT;

ALTER TABLE "Repository" ADD COLUMN "githubInstallationId" TEXT;

ALTER TABLE "ScanJob"
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "policyBundleVersion" TEXT NOT NULL DEFAULT 'unversioned',
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "repositoryRef" TEXT NOT NULL DEFAULT 'local-demo',
  ADD COLUMN "requester" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "SecurityReceipt"
  ADD COLUMN "branch" TEXT,
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "keyId" TEXT,
  ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT '1',
  ADD COLUMN "signature" TEXT,
  ADD COLUMN "signedPayload" JSONB,
  ADD COLUMN "signingAlgorithm" TEXT;

ALTER TABLE "ScanJob"
  ALTER COLUMN "correlationId" DROP DEFAULT,
  ALTER COLUMN "policyBundleVersion" DROP DEFAULT,
  ALTER COLUMN "repositoryRef" DROP DEFAULT,
  ALTER COLUMN "requester" DROP DEFAULT;

CREATE TABLE "GitHubInstallation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "installationId" INTEGER NOT NULL,
  "accountLogin" TEXT NOT NULL,
  "accountType" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubWebhookDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "installationId" INTEGER NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "action" TEXT,
  "repositoryFullName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "correlationId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,

  CONSTRAINT "GitHubWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Advisory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scanId" TEXT,
  "dependencyId" TEXT,
  "packageName" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "ecosystem" TEXT NOT NULL,
  "advisoryId" TEXT NOT NULL,
  "aliases" JSONB NOT NULL DEFAULT '[]',
  "affectedRange" TEXT,
  "severity" TEXT,
  "cvss" DOUBLE PRECISION,
  "fixedVersion" TEXT,
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolutionState" TEXT NOT NULL DEFAULT 'OPEN',

  CONSTRAINT "Advisory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");
CREATE UNIQUE INDEX "GitHubInstallation_organizationId_accountLogin_key" ON "GitHubInstallation"("organizationId", "accountLogin");
CREATE INDEX "GitHubInstallation_organizationId_status_idx" ON "GitHubInstallation"("organizationId", "status");
CREATE UNIQUE INDEX "GitHubWebhookDelivery_organizationId_deliveryId_key" ON "GitHubWebhookDelivery"("organizationId", "deliveryId");
CREATE INDEX "GitHubWebhookDelivery_organizationId_status_receivedAt_idx" ON "GitHubWebhookDelivery"("organizationId", "status", "receivedAt");
CREATE INDEX "GitHubWebhookDelivery_installationId_receivedAt_idx" ON "GitHubWebhookDelivery"("installationId", "receivedAt");
CREATE INDEX "GitHubWebhookDelivery_correlationId_idx" ON "GitHubWebhookDelivery"("correlationId");
CREATE UNIQUE INDEX "Advisory_organizationId_advisoryId_packageName_version_key" ON "Advisory"("organizationId", "advisoryId", "packageName", "version");
CREATE INDEX "Advisory_organizationId_packageName_version_idx" ON "Advisory"("organizationId", "packageName", "version");
CREATE INDEX "Advisory_scanId_idx" ON "Advisory"("scanId");
CREATE INDEX "Advisory_dependencyId_idx" ON "Advisory"("dependencyId");
CREATE INDEX "EvidenceArtifact_organizationId_createdAt_idx" ON "EvidenceArtifact"("organizationId", "createdAt");
CREATE INDEX "ScanJob_provider_repositoryRef_idx" ON "ScanJob"("provider", "repositoryRef");
CREATE INDEX "ScanJob_correlationId_idx" ON "ScanJob"("correlationId");
CREATE INDEX "ScanJob_deadLetteredAt_idx" ON "ScanJob"("deadLetteredAt");

ALTER TABLE "Repository" ADD CONSTRAINT "Repository_githubInstallationId_fkey" FOREIGN KEY ("githubInstallationId") REFERENCES "GitHubInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "GitHubWebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "GitHubWebhookDelivery_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("installationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Advisory" ADD CONSTRAINT "Advisory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Advisory" ADD CONSTRAINT "Advisory_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Advisory" ADD CONSTRAINT "Advisory_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "Dependency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
