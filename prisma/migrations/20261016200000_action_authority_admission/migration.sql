-- Authorization-only admission. No worker dispatches this held outbox.
ALTER TYPE "AuditAction" ADD VALUE 'AUTHORITY_POLICY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ACTION_ADMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'ACTION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTHORIZATION_REVOKED';
CREATE TABLE "ActionAuthorityPolicy" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "revision" TEXT NOT NULL UNIQUE,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('DENY','REQUIRE_APPROVAL')),
  "changedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ActionAuthorization" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "actor" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "evidenceScanId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "contextDigest" TEXT NOT NULL,
  "context" JSONB NOT NULL,
  "policyRevision" TEXT NOT NULL,
  "decision" TEXT NOT NULL CHECK ("decision" IN ('DENY','REQUIRE_APPROVAL')),
  "status" TEXT NOT NULL CHECK ("status" IN ('PENDING','APPROVED','REJECTED','REVOKED','CONSUMED')),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reason" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId","organizationId") REFERENCES "AgentSession"("id","organizationId") ON DELETE RESTRICT,
  FOREIGN KEY ("repositoryId","organizationId") REFERENCES "Repository"("id","organizationId") ON DELETE RESTRICT,
  FOREIGN KEY ("evidenceScanId","organizationId") REFERENCES "Scan"("id","organizationId") ON DELETE RESTRICT,
  CHECK ("status" NOT IN ('APPROVED','CONSUMED') OR ("decision"='REQUIRE_APPROVAL' AND "reviewedBy" IS NOT NULL AND "reviewedBy" <> "actor" AND "reviewedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ActionAuthorization_organizationId_actor_idempotencyKey_key" ON "ActionAuthorization"("organizationId","actor","idempotencyKey");
CREATE UNIQUE INDEX "ActionAuthorization_id_organizationId_actor_key" ON "ActionAuthorization"("id","organizationId","actor");
CREATE INDEX "ActionAuthorization_organizationId_sessionId_createdAt_idx" ON "ActionAuthorization"("organizationId","sessionId","createdAt");
CREATE TABLE "ActionOperation" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL UNIQUE,
  "operationKey" TEXT NOT NULL,
  "contextDigest" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'HELD' CHECK ("state" IN ('HELD','CANCELLED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  FOREIGN KEY ("authorizationId","organizationId","actor") REFERENCES "ActionAuthorization"("id","organizationId","actor") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ActionOperation_organizationId_actor_operationKey_key" ON "ActionOperation"("organizationId","actor","operationKey");
CREATE INDEX "ActionOperation_organizationId_createdAt_idx" ON "ActionOperation"("organizationId","createdAt");
CREATE TABLE "ActionOutbox" (
  "id" TEXT PRIMARY KEY,
  "operationId" TEXT NOT NULL UNIQUE REFERENCES "ActionOperation"("id") ON DELETE RESTRICT,
  "state" TEXT NOT NULL DEFAULT 'HELD' CHECK ("state" IN ('HELD','CANCELLED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
