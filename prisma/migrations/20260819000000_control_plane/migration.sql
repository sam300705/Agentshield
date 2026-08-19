-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('SECRET', 'DOCKERFILE', 'KUBERNETES', 'DEPENDENCY', 'AGENT_WORKFLOW');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PolicyDecisionType" AS ENUM ('ALLOW', 'WARN', 'REQUIRE_APPROVAL', 'BLOCK');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PackageManager" AS ENUM ('NPM', 'PNPM', 'YARN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DependencyScope" AS ENUM ('PRODUCTION', 'DEVELOPMENT', 'OPTIONAL', 'PEER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('SCAN_CREATED', 'SCAN_COMPLETED', 'FINDING_CREATED', 'POLICY_DECIDED', 'REMEDIATION_CREATED', 'APPROVAL_REQUESTED', 'APPROVAL_UPDATED', 'AGENT_EVENT_INGESTED', 'POLICY_SIMULATED', 'RECEIPT_GENERATED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('VIEWER', 'DEVELOPER', 'SECURITY_REVIEWER', 'POLICY_ADMINISTRATOR', 'ORGANIZATION_ADMINISTRATOR');

-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentEventType" AS ENUM ('TOOL_INVOCATION', 'SHELL_COMMAND', 'FILE_READ', 'FILE_MODIFICATION', 'DEPENDENCY_INSTALLATION', 'NETWORK_REQUEST', 'SECRET_ACCESS_ATTEMPT', 'INFRASTRUCTURE_CHANGE', 'POLICY_EVALUATION', 'APPROVAL_REQUEST', 'HUMAN_DECISION');

-- CreateEnum
CREATE TYPE "PolicyEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PolicyBundleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskNodeKind" AS ENUM ('TASK', 'EVENT', 'RESOURCE', 'RISK', 'POLICY', 'DECISION');

-- CreateEnum
CREATE TYPE "EdgeConfidence" AS ENUM ('CONFIRMED', 'INFERRED');

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "repositoryUrl" TEXT,
    "branch" TEXT NOT NULL,
    "commitSha" TEXT,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "repositoryId" TEXT,
    "sessionId" TEXT,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "category" "FindingCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "decision" "PolicyDecisionType" NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remediation" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "patch" JSONB,
    "generatedForDecision" "PolicyDecisionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Remediation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "requestedBy" TEXT NOT NULL DEFAULT 'system',
    "reviewedBy" TEXT,
    "nonce" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "packageManager" "PackageManager" NOT NULL,
    "scope" "DependencyScope" NOT NULL DEFAULT 'UNKNOWN',
    "manifestPath" TEXT NOT NULL,
    "purl" TEXT,
    "license" TEXT,
    "supplier" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "scanId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT,
    "correlationId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "taskSummary" TEXT NOT NULL,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" "AgentEventType" NOT NULL,
    "riskLevel" "Severity" NOT NULL,
    "summary" TEXT NOT NULL,
    "resource" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT NOT NULL,
    "previousHash" TEXT,
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyBundle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" "PolicyEnvironment" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyBundleVersion" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "semanticVersion" TEXT NOT NULL,
    "status" "PolicyBundleStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedBy" TEXT,
    "promotedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyBundleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySimulation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceScanId" TEXT,
    "sourceSessionId" TEXT,
    "bundleVersionId" TEXT NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'QUEUED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PolicySimulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationDecision" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "originalDecision" "PolicyDecisionType" NOT NULL,
    "simulatedDecision" "PolicyDecisionType" NOT NULL,
    "originalRuleId" TEXT NOT NULL,
    "simulatedRuleId" TEXT NOT NULL,
    "conditionTrace" JSONB NOT NULL,

    CONSTRAINT "SimulationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskNode" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "RiskNodeKind" NOT NULL,
    "label" TEXT NOT NULL,
    "riskLevel" "Severity" NOT NULL,
    "eventId" TEXT,
    "resource" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "RiskNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEdge" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" "EdgeConfidence" NOT NULL,

    CONSTRAINT "RiskEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" TEXT NOT NULL,
    "findingId" TEXT,
    "sessionId" TEXT,
    "mediaType" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT true,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityReceipt" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "scannerVersion" TEXT NOT NULL,
    "policyBundleVersion" TEXT NOT NULL,
    "findingCounts" JSONB NOT NULL,
    "decisionCounts" JSONB NOT NULL,
    "approvalState" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "gateResult" "PolicyDecisionType" NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "lastHealthAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentBaseline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "agentIdentifier" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scan_status_idx" ON "Scan"("status");

-- CreateIndex
CREATE INDEX "Scan_repositoryName_idx" ON "Scan"("repositoryName");

-- CreateIndex
CREATE INDEX "Scan_organizationId_createdAt_idx" ON "Scan"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Scan_repositoryId_createdAt_idx" ON "Scan"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "Scan_sessionId_idx" ON "Scan"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_fingerprint_key" ON "Finding"("fingerprint");

-- CreateIndex
CREATE INDEX "Finding_scanId_idx" ON "Finding"("scanId");

-- CreateIndex
CREATE INDEX "Finding_category_idx" ON "Finding"("category");

-- CreateIndex
CREATE INDEX "Finding_severity_idx" ON "Finding"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDecision_findingId_key" ON "PolicyDecision"("findingId");

-- CreateIndex
CREATE INDEX "PolicyDecision_decision_idx" ON "PolicyDecision"("decision");

-- CreateIndex
CREATE INDEX "PolicyDecision_ruleId_idx" ON "PolicyDecision"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "Remediation_findingId_key" ON "Remediation"("findingId");

-- CreateIndex
CREATE INDEX "Remediation_generatedForDecision_idx" ON "Remediation"("generatedForDecision");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_findingId_key" ON "Approval"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_nonce_key" ON "Approval"("nonce");

-- CreateIndex
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- CreateIndex
CREATE INDEX "Approval_actor_idx" ON "Approval"("actor");

-- CreateIndex
CREATE INDEX "Dependency_scanId_idx" ON "Dependency"("scanId");

-- CreateIndex
CREATE INDEX "Dependency_packageManager_idx" ON "Dependency"("packageManager");

-- CreateIndex
CREATE UNIQUE INDEX "Dependency_scanId_packageName_version_manifestPath_key" ON "Dependency"("scanId", "packageName", "version", "manifestPath");

-- CreateIndex
CREATE INDEX "AuditEvent_actor_idx" ON "AuditEvent"("actor");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_scanId_idx" ON "AuditEvent"("scanId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Repository_organizationId_fullName_idx" ON "Repository"("organizationId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_organizationId_provider_externalId_key" ON "Repository"("organizationId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "AgentSession_organizationId_startedAt_idx" ON "AgentSession"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_repositoryId_startedAt_idx" ON "AgentSession"("repositoryId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_status_idx" ON "AgentSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_organizationId_correlationId_key" ON "AgentSession"("organizationId", "correlationId");

-- CreateIndex
CREATE INDEX "AgentEvent_sessionId_timestamp_idx" ON "AgentEvent"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "AgentEvent_correlationId_idx" ON "AgentEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AgentEvent_type_riskLevel_idx" ON "AgentEvent"("type", "riskLevel");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_sessionId_sequence_key" ON "AgentEvent"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_sessionId_idempotencyKey_key" ON "AgentEvent"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_scanId_key" ON "ScanJob"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_idempotencyKey_key" ON "ScanJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScanJob_status_nextAttemptAt_idx" ON "ScanJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ScanJob_lockedAt_idx" ON "ScanJob"("lockedAt");

-- CreateIndex
CREATE INDEX "PolicyBundle_organizationId_environment_idx" ON "PolicyBundle"("organizationId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyBundle_organizationId_name_environment_key" ON "PolicyBundle"("organizationId", "name", "environment");

-- CreateIndex
CREATE INDEX "PolicyBundleVersion_bundleId_status_idx" ON "PolicyBundleVersion"("bundleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyBundleVersion_bundleId_semanticVersion_key" ON "PolicyBundleVersion"("bundleId", "semanticVersion");

-- CreateIndex
CREATE INDEX "PolicySimulation_organizationId_createdAt_idx" ON "PolicySimulation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PolicySimulation_sourceScanId_idx" ON "PolicySimulation"("sourceScanId");

-- CreateIndex
CREATE INDEX "PolicySimulation_sourceSessionId_idx" ON "PolicySimulation"("sourceSessionId");

-- CreateIndex
CREATE INDEX "SimulationDecision_simulationId_simulatedDecision_idx" ON "SimulationDecision"("simulationId", "simulatedDecision");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationDecision_simulationId_findingId_key" ON "SimulationDecision"("simulationId", "findingId");

-- CreateIndex
CREATE INDEX "RiskNode_sessionId_riskLevel_idx" ON "RiskNode"("sessionId", "riskLevel");

-- CreateIndex
CREATE INDEX "RiskEdge_sessionId_idx" ON "RiskEdge"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEdge_sessionId_fromNodeId_toNodeId_relation_key" ON "RiskEdge"("sessionId", "fromNodeId", "toNodeId", "relation");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_findingId_idx" ON "EvidenceArtifact"("findingId");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_sessionId_idx" ON "EvidenceArtifact"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_digest_storageKey_key" ON "EvidenceArtifact"("digest", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityReceipt_scanId_key" ON "SecurityReceipt"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityReceipt_receiptHash_key" ON "SecurityReceipt"("receiptHash");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_organizationId_provider_key" ON "Integration"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "AgentBaseline_organizationId_agentIdentifier_idx" ON "AgentBaseline"("organizationId", "agentIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "AgentBaseline_organizationId_repositoryId_agentIdentifier_key" ON "AgentBaseline"("organizationId", "repositoryId", "agentIdentifier");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBundle" ADD CONSTRAINT "PolicyBundle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBundleVersion" ADD CONSTRAINT "PolicyBundleVersion_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "PolicyBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySimulation" ADD CONSTRAINT "PolicySimulation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySimulation" ADD CONSTRAINT "PolicySimulation_sourceScanId_fkey" FOREIGN KEY ("sourceScanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySimulation" ADD CONSTRAINT "PolicySimulation_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "AgentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySimulation" ADD CONSTRAINT "PolicySimulation_bundleVersionId_fkey" FOREIGN KEY ("bundleVersionId") REFERENCES "PolicyBundleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationDecision" ADD CONSTRAINT "SimulationDecision_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "PolicySimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskNode" ADD CONSTRAINT "RiskNode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEdge" ADD CONSTRAINT "RiskEdge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEdge" ADD CONSTRAINT "RiskEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "RiskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEdge" ADD CONSTRAINT "RiskEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "RiskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReceipt" ADD CONSTRAINT "SecurityReceipt_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBaseline" ADD CONSTRAINT "AgentBaseline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBaseline" ADD CONSTRAINT "AgentBaseline_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
