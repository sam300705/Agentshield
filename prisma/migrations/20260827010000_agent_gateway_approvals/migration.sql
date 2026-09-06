CREATE TABLE "AgentApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "resource" TEXT,
  "actionDigest" TEXT NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reason" TEXT,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentApproval_organizationId_sessionId_idempotencyKey_key"
  ON "AgentApproval"("organizationId", "sessionId", "idempotencyKey");
CREATE INDEX "AgentApproval_organizationId_status_requestedAt_idx"
  ON "AgentApproval"("organizationId", "status", "requestedAt");
CREATE INDEX "AgentApproval_sessionId_status_idx"
  ON "AgentApproval"("sessionId", "status");
CREATE INDEX "AgentApproval_organizationId_actionDigest_idx"
  ON "AgentApproval"("organizationId", "actionDigest");
CREATE INDEX "AgentApproval_correlationId_idx"
  ON "AgentApproval"("correlationId");

ALTER TABLE "AgentApproval"
  ADD CONSTRAINT "AgentApproval_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentApproval"
  ADD CONSTRAINT "AgentApproval_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
