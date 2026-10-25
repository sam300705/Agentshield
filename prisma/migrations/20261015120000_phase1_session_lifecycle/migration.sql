-- Additive: existing sessions retain NULL idempotency context and remain readable.
ALTER TYPE "AuditAction" ADD VALUE 'SCAN_ATTEMPT_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_CLOSED';
ALTER TABLE "AgentSession" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "AgentSession" ADD COLUMN "contextDigest" TEXT;
CREATE UNIQUE INDEX "AgentSession_organizationId_actor_idempotencyKey_key" ON "AgentSession"("organizationId", "actor", "idempotencyKey");
