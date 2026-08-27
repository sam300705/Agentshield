import {
  createSecurityReceipt,
  evaluateFindings,
  signSecurityReceipt,
} from "@agentshield/policy-engine";
import { generateRemediation } from "@agentshield/remediation";
import { enrichDependencies, runScan, type DependencyAdvisoryResult } from "@agentshield/scanner";
import {
  type Dependency,
  type Finding,
  sanitizeEvidence,
  sanitizeText,
  type JsonValue,
  type PolicyDecision,
  type PolicyDecisionType,
  type Remediation,
  type ScanOptions,
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
  source: string;
  targetPath: string;
  triggeredBy: string;
  labels: string[];
  findingCounts: FindingCounts;
  decisionCounts: Record<PolicyDecisionType, number>;
  dependencyCount: number;
  remediationCount: number;
  approvalCount: number;
  advisoryCount: number;
  advisoryStatus: "DISABLED" | "ENRICHED" | "UNAVAILABLE";
  advisoryDiagnostic?: string;
  policyBundleVersion: string;
}): Prisma.InputJsonValue {
  return toInputJson({
    source: input.source,
    targetPath: input.targetPath,
    triggeredBy: input.triggeredBy,
    labels: input.labels,
    aggregateCounts: {
      findings: input.findingCounts,
      policyDecisions: input.decisionCounts,
      dependencies: input.dependencyCount,
      remediations: input.remediationCount,
      approvals: input.approvalCount,
      advisories: input.advisoryCount,
      advisoryStatus: input.advisoryStatus,
      ...(input.advisoryDiagnostic == null ? {} : { advisoryDiagnostic: input.advisoryDiagnostic }),
    },
    policyBundleVersion: input.policyBundleVersion,
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

function ecosystemForPackageManager(packageManager: string): string {
  return ["NPM", "PNPM", "YARN"].includes(packageManager) ? "npm" : "unknown";
}

function gateResultForDecisions(decisions: PolicyDecision[]): PolicyDecisionType {
  if (decisions.some((decision) => decision.decision === "BLOCK")) return "BLOCK";
  if (decisions.some((decision) => decision.decision === "REQUIRE_APPROVAL")) {
    return "REQUIRE_APPROVAL";
  }
  if (decisions.some((decision) => decision.decision === "WARN")) return "WARN";
  return "ALLOW";
}

type AdvisoryEnrichment = {
  results: DependencyAdvisoryResult[];
  status: "DISABLED" | "ENRICHED" | "UNAVAILABLE";
  diagnostic?: string;
};

async function runAdvisoryEnrichment(
  dependencies: Dependency[],
  enabled: boolean,
): Promise<AdvisoryEnrichment> {
  if (!enabled) return { results: [], status: "DISABLED" };
  try {
    const results = await enrichDependencies(
      dependencies.map((dependency) => ({
        packageName: dependency.packageName,
        version: dependency.version,
        packageManager: dependency.packageManager,
        ...(dependency.purl == null ? {} : { purl: dependency.purl }),
      })),
      {
        ...(process.env.OSV_API_BASE_URL == null ? {} : { baseUrl: process.env.OSV_API_BASE_URL }),
        ...(process.env.OSV_REQUEST_TIMEOUT_MS == null
          ? {}
          : { timeoutMs: Number(process.env.OSV_REQUEST_TIMEOUT_MS) }),
      },
    );
    return { results, status: "ENRICHED" };
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        subsystem: "osv-enrichment",
        message: "Optional advisory enrichment was unavailable; scan continued.",
        errorType: sanitizeText(error instanceof Error ? error.name : "UnknownError"),
      }),
    );
    return {
      results: [],
      status: "UNAVAILABLE",
      diagnostic: "Optional advisory provider unavailable; no advisory match was asserted.",
    };
  }
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

async function persistAdvisories(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scanId: string,
  dependencies: Dependency[],
  results: DependencyAdvisoryResult[],
): Promise<number> {
  const dependencyIds = new Map(
    dependencies.map((dependency) => [
      `${dependency.packageName}:${dependency.version}:${dependency.packageManager}`,
      dependency.id,
    ]),
  );
  let count = 0;
  for (const result of results) {
    for (const advisory of result.advisories) {
      const dependencyId = dependencyIds.get(
        `${result.packageName}:${result.version}:${result.packageManager}`,
      );
      const data = {
        organizationId,
        scanId,
        ...(dependencyId == null ? {} : { dependencyId }),
        packageName: result.packageName,
        version: result.version,
        ecosystem: ecosystemForPackageManager(result.packageManager),
        advisoryId: advisory.advisoryId,
        aliases: toInputJson(advisory.aliases),
        severity: advisory.severity,
        fixedVersion: advisory.fixedVersions[0] ?? null,
        lastSeen: new Date(),
      };
      await tx.advisory.upsert({
        where: {
          organizationId_advisoryId_packageName_version: {
            organizationId,
            advisoryId: advisory.advisoryId,
            packageName: result.packageName,
            version: result.version,
          },
        },
        update: data,
        create: data,
      });
      count += 1;
    }
  }
  return count;
}

async function persistSecurityReceipt(
  tx: Prisma.TransactionClient,
  options: ScanRunOptions,
  scanId: string,
  scanStartedAt: Date,
  completedAt: Date,
  findings: Finding[],
  findingCounts: FindingCounts,
  decisionCounts: Record<PolicyDecisionType, number>,
  decisions: PolicyDecision[],
  approvalCount: number,
): Promise<void> {
  const receipt = createSecurityReceipt({
    id: `receipt:${scanId}`,
    scanId,
    repository: options.repositoryName,
    branch: options.branch,
    commitSha: options.commitSha ?? "unresolved",
    scannerVersion: "agentshield-scanner@0.1.0",
    policyBundleVersion: options.policyBundleVersion,
    findingCounts: { ...findingCounts },
    decisionCounts,
    approvalState: approvalCount > 0 ? "PENDING" : "NONE",
    evidence: findings.map((finding) => ({
      id: finding.id,
      fingerprint: finding.fingerprint,
      evidence: sanitizeEvidence(finding.evidence),
    })),
    startedAt: scanStartedAt,
    completedAt,
    gateResult: gateResultForDecisions(decisions),
  });
  const privateKey = process.env.RECEIPT_SIGNING_PRIVATE_KEY;
  const keyId = process.env.RECEIPT_SIGNING_KEY_ID;
  if ((privateKey == null) !== (keyId == null)) {
    throw new Error("Receipt signing requires both private key and key ID.");
  }
  const signed =
    privateKey != null && keyId != null
      ? signSecurityReceipt(receipt, { keyId, privateKey })
      : null;
  await tx.securityReceipt.upsert({
    where: { scanId },
    update: {
      schemaVersion: "1",
      scannerVersion: receipt.scannerVersion,
      policyBundleVersion: receipt.policyBundleVersion,
      branch: receipt.branch,
      commitSha: receipt.commitSha,
      findingCounts: toInputJson(receipt.findingCounts),
      decisionCounts: toInputJson(receipt.decisionCounts),
      approvalState: receipt.approvalState,
      evidenceDigest: receipt.evidenceDigest,
      gateResult: receipt.gateResult,
      signingAlgorithm: signed?.algorithm ?? null,
      keyId: signed?.keyId ?? null,
      signature: signed?.signature ?? null,
      signedPayload: signed == null ? Prisma.JsonNull : toInputJson(signed.payload),
      receiptHash: receipt.receiptHash,
    },
    create: {
      scanId,
      schemaVersion: "1",
      scannerVersion: receipt.scannerVersion,
      policyBundleVersion: receipt.policyBundleVersion,
      branch: receipt.branch,
      commitSha: receipt.commitSha,
      findingCounts: toInputJson(receipt.findingCounts),
      decisionCounts: toInputJson(receipt.decisionCounts),
      approvalState: receipt.approvalState,
      evidenceDigest: receipt.evidenceDigest,
      gateResult: receipt.gateResult,
      signingAlgorithm: signed?.algorithm ?? null,
      keyId: signed?.keyId ?? null,
      signature: signed?.signature ?? null,
      signedPayload: signed == null ? Prisma.JsonNull : toInputJson(signed.payload),
      receiptHash: receipt.receiptHash,
    },
  });
}

async function markScanFailed(
  client: PrismaClient,
  scanId: string,
  error: unknown,
  metadata: Pick<ScanRunOptions, "source" | "targetPathLabel" | "triggeredBy" | "labels">,
): Promise<void> {
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
        source: metadata.source,
        targetPath: metadata.targetPathLabel,
        triggeredBy: metadata.triggeredBy,
        labels: metadata.labels,
        error: safeError,
      },
    },
  });
}

export interface ScanRunOptions {
  source: "LOCAL_EXAMPLE" | "GITHUB" | "MANUAL";
  targetPath: string;
  targetPathLabel: string;
  repositoryName: string;
  repositoryUrl?: string;
  branch: string;
  commitSha?: string;
  organizationId: string;
  correlationId: string;
  triggeredBy: string;
  labels: string[];
  policyBundleVersion: string;
  options: ScanOptions;
  signal?: AbortSignal;
}

export async function runConfiguredScan(
  options: ScanRunOptions,
  existingScanId?: string,
): Promise<string> {
  const initialMetadata = {
    source: options.source,
    targetPath: options.targetPathLabel,
    triggeredBy: options.triggeredBy,
    labels: options.labels,
    policyBundleVersion: options.policyBundleVersion,
    correlationId: options.correlationId,
  };
  const scan =
    existingScanId == null
      ? await prisma.scan.create({
          data: {
            repositoryName: options.repositoryName,
            ...(options.repositoryUrl == null ? {} : { repositoryUrl: options.repositoryUrl }),
            branch: options.branch,
            ...(options.commitSha == null ? {} : { commitSha: options.commitSha }),
            status: ScanStatus.RUNNING,
            organizationId: options.organizationId,
            metadata: initialMetadata,
          },
        })
      : await prisma.scan.update({
          where: { id: existingScanId },
          data: {
            status: ScanStatus.RUNNING,
            startedAt: new Date(),
            completedAt: null,
            branch: options.branch,
            ...(options.commitSha == null ? {} : { commitSha: options.commitSha }),
            metadata: initialMetadata,
          },
        });

  await prisma.auditEvent.create({
    data: {
      actor: options.triggeredBy,
      action: AuditAction.SCAN_CREATED,
      entityType: "Scan",
      entityId: scan.id,
      scanId: scan.id,
      organizationId: options.organizationId,
      correlationId: options.correlationId,
      metadata: {
        source: options.source,
        repository: options.repositoryName,
        ref: options.branch,
        commitSha: options.commitSha ?? null,
      },
    },
  });

  try {
    const scanResult = await runScan(options.targetPath, scan.id, {
      maxFiles: options.options.maxFiles,
      maxFileSizeBytes: options.options.maxBytes,
      maxTotalBytes: options.options.maxBytes,
      ignorePatterns: options.options.ignorePaths,
      ...(options.signal == null ? {} : { signal: options.signal }),
    });
    const policyDecisions = evaluateFindings(scanResult.findings, scan.id);
    const advisoryEnrichment = await runAdvisoryEnrichment(
      scanResult.dependencies,
      options.options.includeOsv,
    );
    const advisoryResults = advisoryEnrichment.results;
    const advisoryStatus = advisoryEnrichment.status;
    const decisionsByFindingId = new Map(
      policyDecisions.map((decision) => [decision.findingId, decision]),
    );
    const remediations: Remediation[] = [];
    const approvalFindingIds: string[] = [];

    for (const finding of scanResult.findings) {
      if (options.signal != null && options.signal.aborted) throw new Error("Scan cancelled");
      const decision = decisionsByFindingId.get(finding.id);
      if (decision == null) {
        throw new Error(`No policy decision generated for finding ${finding.id}`);
      }
      if (shouldGenerateRemediation(decision.decision)) {
        remediations.push(generateRemediation(finding, scan.id));
      }
      if (decision.decision === "REQUIRE_APPROVAL") approvalFindingIds.push(finding.id);
    }

    const findingCounts = createFindingCounts(scanResult.findings);
    const decisionCounts = createDecisionCounts(policyDecisions);
    const metadata = createScanMetadata({
      source: options.source,
      targetPath: options.targetPathLabel,
      triggeredBy: options.triggeredBy,
      labels: options.labels,
      findingCounts,
      decisionCounts,
      dependencyCount: scanResult.dependencies.length,
      remediationCount: remediations.length,
      approvalCount: approvalFindingIds.length,
      advisoryCount: advisoryResults.reduce((count, result) => count + result.advisories.length, 0),
      advisoryStatus,
      ...(advisoryEnrichment.diagnostic == null
        ? {}
        : { advisoryDiagnostic: advisoryEnrichment.diagnostic }),
      policyBundleVersion: options.policyBundleVersion,
    });
    const completedAt = new Date();

    await prisma.$transaction(
      async (tx) => {
        for (const dependency of scanResult.dependencies) await persistDependency(tx, dependency);
        await persistAdvisories(
          tx,
          options.organizationId,
          scan.id,
          scanResult.dependencies,
          advisoryResults,
        );
        for (const finding of scanResult.findings) await persistFinding(tx, finding, scan.id);
        for (const decision of policyDecisions) await persistPolicyDecision(tx, decision);
        for (const remediation of remediations) await persistRemediation(tx, remediation);
        for (const findingId of approvalFindingIds) {
          await tx.approval.create({
            data: {
              findingId,
              status: "PENDING",
              actor: options.triggeredBy,
              requestedBy: options.triggeredBy,
              reason: "Policy decision requires human approval before merge.",
            },
          });
        }
        await tx.auditEvent.create({
          data: {
            actor: options.triggeredBy,
            action: AuditAction.SCAN_COMPLETED,
            entityType: "Scan",
            entityId: scan.id,
            scanId: scan.id,
            organizationId: options.organizationId,
            correlationId: options.correlationId,
            metadata,
          },
        });
        await persistSecurityReceipt(
          tx,
          options,
          scan.id,
          scan.startedAt,
          completedAt,
          scanResult.findings,
          findingCounts,
          decisionCounts,
          policyDecisions,
          approvalFindingIds.length,
        );
        await tx.scan.update({
          where: { id: scan.id },
          data: { status: ScanStatus.COMPLETED, completedAt, metadata },
        });
      },
      { timeout: 30_000 },
    );
    return scan.id;
  } catch (error) {
    await markScanFailed(prisma, scan.id, error, options);
    throw error;
  }
}

export async function runDemoScan(
  existingScanId?: string,
  organizationId = "demo-organization",
  correlationId = "system",
  signal?: AbortSignal,
): Promise<string> {
  return runConfiguredScan(
    {
      source: "LOCAL_EXAMPLE",
      targetPath: path.resolve(fileURLToPath(new URL(DEMO_TARGET_PATH, API_PACKAGE_ROOT))),
      targetPathLabel: DEMO_TARGET_PATH,
      repositoryName: "agentshield-vulnerable-demo-target",
      repositoryUrl: "https://github.com/example/agentshield-vulnerable-demo-target",
      branch: "main",
      organizationId,
      correlationId,
      triggeredBy: SYSTEM_ACTOR,
      labels: ["demo", "api-run"],
      policyBundleVersion: "demo",
      options: {
        maxFiles: 10_000,
        maxBytes: 100 * 1024 * 1024,
        timeoutMs: 120_000,
        ignorePaths: [],
        includeOsv: false,
      },
      ...(signal == null ? {} : { signal }),
    },
    existingScanId,
  );
}
