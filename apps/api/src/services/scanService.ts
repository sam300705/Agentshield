import { evaluateFindings } from "@agentshield/policy-engine";
import { generateRemediation } from "@agentshield/remediation";
import { runScan } from "@agentshield/scanner";
import {
  type Dependency,
  type Finding,
  sanitizeEvidence,
  type JsonValue,
  type PolicyDecision,
  type PolicyDecisionType,
  type Remediation,
} from "@agentshield/schemas";
import { AuditAction, Prisma, ScanStatus, type PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../db/prisma.js";

const SYSTEM_ACTOR = "System";
const DEMO_TARGET_PATH = "../../examples/vulnerable-repo";
const API_PACKAGE_ROOT = new URL("../../", import.meta.url);

interface FindingCounts {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableInputJson(
  value: JsonValue | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : toInputJson(value);
}

function shouldGenerateRemediation(decision: PolicyDecisionType): boolean {
  return decision === "BLOCK" || decision === "REQUIRE_APPROVAL";
}

function createFindingCounts(findings: Finding[]): FindingCounts {
  return findings.reduce<FindingCounts>(
    (counts, finding) => {
      counts.total += 1;

      switch (finding.severity) {
        case "CRITICAL":
          counts.critical += 1;
          break;
        case "HIGH":
          counts.high += 1;
          break;
        case "MEDIUM":
          counts.medium += 1;
          break;
        case "LOW":
          counts.low += 1;
          break;
      }

      return counts;
    },
    {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  );
}

function createDecisionCounts(decisions: PolicyDecision[]): Record<PolicyDecisionType, number> {
  return decisions.reduce<Record<PolicyDecisionType, number>>(
    (counts, decision) => {
      counts[decision.decision] += 1;
      return counts;
    },
    {
      ALLOW: 0,
      WARN: 0,
      REQUIRE_APPROVAL: 0,
      BLOCK: 0,
    },
  );
}

function createScanMetadata(input: {
  targetPath: string;
  findingCounts: FindingCounts;
  decisionCounts: Record<PolicyDecisionType, number>;
  dependencyCount: number;
  remediationCount: number;
  approvalCount: number;
}): Prisma.InputJsonValue {
  return toInputJson({
    source: "LOCAL_EXAMPLE",
    targetPath: input.targetPath,
    triggeredBy: SYSTEM_ACTOR,
    labels: ["demo", "api-run"],
    aggregateCounts: {
      findings: input.findingCounts,
      policyDecisions: input.decisionCounts,
      dependencies: input.dependencyCount,
      remediations: input.remediationCount,
      approvals: input.approvalCount,
    },
  });
}

function createScannerEvidence(finding: Finding): Prisma.InputJsonValue {
  const sanitized = sanitizeEvidence(finding.evidence);
  const evidence =
    typeof sanitized === "object" && sanitized != null && !Array.isArray(sanitized)
      ? sanitized
      : {};
  return toInputJson({
    ...evidence,
    scannerFingerprint: finding.fingerprint,
  });
}

function createDatabaseFingerprint(finding: Finding, scanId: string): string {
  return `${scanId}:${finding.fingerprint}`;
}

async function persistDependency(
  tx: Prisma.TransactionClient,
  dependency: Dependency,
): Promise<void> {
  await tx.dependency.create({
    data: {
      id: dependency.id,
      scanId: dependency.scanId,
      packageName: dependency.packageName,
      version: dependency.version,
      packageManager: dependency.packageManager,
      scope: dependency.scope,
      manifestPath: dependency.manifestPath,
      purl: dependency.purl ?? null,
      license: dependency.license ?? null,
      supplier: dependency.supplier ?? null,
      metadata: toInputJson(dependency.metadata),
      createdAt: dependency.createdAt,
    },
  });
}

async function persistFinding(
  tx: Prisma.TransactionClient,
  finding: Finding,
  scanId: string,
): Promise<void> {
  await tx.finding.create({
    data: {
      id: finding.id,
      scanId,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      filePath: finding.filePath,
      lineStart: finding.lineStart ?? null,
      lineEnd: finding.lineEnd ?? null,
      evidence: createScannerEvidence(finding),
      fingerprint: createDatabaseFingerprint(finding, scanId),
      createdAt: finding.createdAt,
    },
  });
}

async function persistPolicyDecision(
  tx: Prisma.TransactionClient,
  decision: PolicyDecision,
): Promise<void> {
  await tx.policyDecision.create({
    data: {
      id: decision.id,
      findingId: decision.findingId,
      decision: decision.decision,
      ruleId: decision.ruleId,
      ruleVersion: decision.ruleVersion,
      reason: decision.reason,
      ruleSnapshot: toInputJson(decision.ruleSnapshot),
      decidedAt: decision.decidedAt,
    },
  });
}

async function persistRemediation(
  tx: Prisma.TransactionClient,
  remediation: Remediation,
): Promise<void> {
  await tx.remediation.create({
    data: {
      id: remediation.id,
      findingId: remediation.findingId,
      summary: remediation.summary,
      detail: remediation.detail ?? null,
      steps: toInputJson(remediation.steps),
      patch: toNullableInputJson(remediation.patch),
      generatedForDecision: remediation.generatedForDecision,
      createdAt: remediation.createdAt,
    },
  });
}

async function markScanFailed(client: PrismaClient, scanId: string, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : "Unknown scan failure";
  const sanitizedError = sanitizeEvidence(errorMessage);
  const safeError = typeof sanitizedError === "string" ? sanitizedError : "Unknown scan failure";
  await client.scan.update({
    where: {
      id: scanId,
    },
    data: {
      status: ScanStatus.FAILED,
      completedAt: new Date(),
      metadata: {
        source: "LOCAL_EXAMPLE",
        targetPath: DEMO_TARGET_PATH,
        triggeredBy: SYSTEM_ACTOR,
        error: safeError,
      },
    },
  });
}

export async function runDemoScan(
  existingScanId?: string,
  organizationId = "demo-organization",
  correlationId = "system",
): Promise<string> {
  const scan =
    existingScanId == null
      ? await prisma.scan.create({
          data: {
            repositoryName: "agentshield-vulnerable-demo-target",
            repositoryUrl: "https://github.com/example/agentshield-vulnerable-demo-target",
            branch: "main",
            status: ScanStatus.RUNNING,
            organizationId,
            metadata: {
              source: "LOCAL_EXAMPLE",
              targetPath: DEMO_TARGET_PATH,
              triggeredBy: SYSTEM_ACTOR,
              correlationId,
            },
          },
        })
      : await prisma.scan.update({
          where: { id: existingScanId },
          data: { status: ScanStatus.RUNNING, startedAt: new Date(), completedAt: null },
        });

  await prisma.auditEvent.create({
    data: {
      actor: SYSTEM_ACTOR,
      action: AuditAction.SCAN_CREATED,
      entityType: "Scan",
      entityId: scan.id,
      scanId: scan.id,
      organizationId,
      correlationId,
      metadata: {
        status: ScanStatus.RUNNING,
        targetPath: DEMO_TARGET_PATH,
      },
    },
  });

  try {
    const targetPath = path.resolve(fileURLToPath(new URL(DEMO_TARGET_PATH, API_PACKAGE_ROOT)));
    const scanResult = await runScan(targetPath, scan.id);
    const policyDecisions = evaluateFindings(scanResult.findings, scan.id);
    const decisionsByFindingId = new Map(
      policyDecisions.map((decision) => [decision.findingId, decision]),
    );
    const remediations: Remediation[] = [];
    const approvalFindingIds: string[] = [];

    for (const finding of scanResult.findings) {
      const decision = decisionsByFindingId.get(finding.id);

      if (decision == null) {
        throw new Error(`No policy decision generated for finding ${finding.id}`);
      }

      if (shouldGenerateRemediation(decision.decision)) {
        remediations.push(generateRemediation(finding, scan.id));
      }

      if (decision.decision === "REQUIRE_APPROVAL") {
        approvalFindingIds.push(finding.id);
      }
    }

    const findingCounts = createFindingCounts(scanResult.findings);
    const decisionCounts = createDecisionCounts(policyDecisions);
    const metadata = createScanMetadata({
      targetPath: DEMO_TARGET_PATH,
      findingCounts,
      decisionCounts,
      dependencyCount: scanResult.dependencies.length,
      remediationCount: remediations.length,
      approvalCount: approvalFindingIds.length,
    });

    await prisma.$transaction(
      async (tx) => {
        for (const dependency of scanResult.dependencies) {
          await persistDependency(tx, dependency);
        }

        for (const finding of scanResult.findings) {
          await persistFinding(tx, finding, scan.id);
        }

        for (const decision of policyDecisions) {
          await persistPolicyDecision(tx, decision);
        }

        for (const remediation of remediations) {
          await persistRemediation(tx, remediation);
        }

        for (const findingId of approvalFindingIds) {
          await tx.approval.create({
            data: {
              findingId,
              status: "PENDING",
              actor: SYSTEM_ACTOR,
              reason: "Policy decision requires human approval before merge.",
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            actor: SYSTEM_ACTOR,
            action: AuditAction.SCAN_COMPLETED,
            entityType: "Scan",
            entityId: scan.id,
            scanId: scan.id,
            organizationId,
            correlationId,
            metadata,
          },
        });

        await tx.scan.update({
          where: {
            id: scan.id,
          },
          data: {
            status: ScanStatus.COMPLETED,
            completedAt: new Date(),
            metadata,
          },
        });
      },
      {
        timeout: 30_000,
      },
    );

    return scan.id;
  } catch (error) {
    await markScanFailed(prisma, scan.id, error);
    throw error;
  }
}
