import type { ScanCoverage } from "@agentshield/schemas";
import {
  createSecurityReceipt,
  canonicalJson,
  POLICY_RULE_VERSION,
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
import { receiptSigningSettings } from "../security/receiptSigningConfig.js";
export { receiptSigningSettings } from "../security/receiptSigningConfig.js";

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
  advisoryInventoryDiagnostics?: JsonValue;
  policyBundleVersion: string;
}): Prisma.InputJsonObject {
  return {
    source: input.source,
    targetPath: input.targetPath,
    triggeredBy: input.triggeredBy,
    labels: input.labels,
    aggregateCounts: {
      findings: { ...input.findingCounts },
      policyDecisions: input.decisionCounts,
      dependencies: input.dependencyCount,
      remediations: input.remediationCount,
      approvals: input.approvalCount,
      advisories: input.advisoryCount,
      advisoryStatus: input.advisoryStatus,
      advisoryInventoryDiagnostics: input.advisoryInventoryDiagnostics ?? [],
      ...(input.advisoryDiagnostic == null ? {} : { advisoryDiagnostic: input.advisoryDiagnostic }),
    },
    policyBundleVersion: input.policyBundleVersion,
  };
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
  signal?: AbortSignal,
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
        ...(signal == null ? {} : { signal }),
        ...(process.env.OSV_API_BASE_URL == null ? {} : { baseUrl: process.env.OSV_API_BASE_URL }),
        ...(process.env.OSV_REQUEST_TIMEOUT_MS == null
          ? {}
          : { timeoutMs: Number(process.env.OSV_REQUEST_TIMEOUT_MS) }),
      },
    );
    return { results, status: "ENRICHED" };
  } catch (error) {
    signal?.throwIfAborted();
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

// Consolidate only public, redacted identity; no secret-derived hash/discriminator.
// A production occurrence dominates weaker scopes; differing nonproduction scopes
// become UNKNOWN. Advisory lookup uses this same persisted public identity.
export function consolidateDependencies(dependencies: Dependency[]): Dependency[] {
  const groups = new Map<string, Dependency[]>();
  for (const raw of dependencies) {
    const dependency = {
      ...raw,
      packageName: sanitizeText(raw.packageName),
      version: sanitizeText(raw.version),
      manifestPath: sanitizeText(raw.manifestPath),
      purl: raw.purl == null ? null : sanitizeText(raw.purl),
      license: raw.license == null ? null : sanitizeText(raw.license),
      supplier: raw.supplier == null ? null : sanitizeText(raw.supplier),
      metadata: sanitizeEvidence(raw.metadata) as Dependency["metadata"],
    };
    const key = JSON.stringify([
      dependency.scanId,
      dependency.packageName,
      dependency.version,
      dependency.manifestPath,
    ]);
    const group = groups.get(key) ?? [];
    group.push(dependency);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const sourceKey = (d: Dependency) =>
        canonicalJson({
          scope: d.scope,
          packageManager: d.packageManager,
          metadata: d.metadata,
          purl: d.purl ?? null,
          license: d.license ?? null,
          supplier: d.supplier ?? null,
        });
      group.sort(
        (a, b) =>
          Number(b.scope === "PRODUCTION") - Number(a.scope === "PRODUCTION") ||
          sourceKey(a).localeCompare(sourceKey(b)) ||
          a.id.localeCompare(b.id),
      );
      const first = group[0]!;
      const scopes = [...new Set(group.map((d) => d.scope))].sort();
      return {
        ...first,
        scope: scopes.includes("PRODUCTION")
          ? "PRODUCTION"
          : scopes.length === 1
            ? first.scope
            : "UNKNOWN",
        metadata: {
          ...first.metadata,
          consolidatedOccurrences: group.length,
          observedScopes: scopes,
          dependencyFields: [
            ...new Set(
              group
                .map((d) => d.metadata.dependencyField)
                .filter((field): field is string => typeof field === "string"),
            ),
          ].sort(),
        },
      };
    });
}

async function persistDependency(
  tx: Prisma.TransactionClient,
  dependency: Dependency,
): Promise<void> {
  await tx.dependency.create({
    data: {
      id: dependency.id,
      scanId: dependency.scanId,
      packageName: sanitizeText(dependency.packageName),
      version: sanitizeText(dependency.version),
      packageManager: dependency.packageManager,
      scope: dependency.scope,
      manifestPath: sanitizeText(dependency.manifestPath),
      purl: dependency.purl == null ? null : sanitizeText(dependency.purl),
      license: dependency.license == null ? null : sanitizeText(dependency.license),
      supplier: dependency.supplier == null ? null : sanitizeText(dependency.supplier),
      metadata: toInputJson(sanitizeEvidence(dependency.metadata)),
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

export function partitionAdvisoryResults(results: DependencyAdvisoryResult[]) {
  return {
    confirmed: results.map((result) => ({
      ...result,
      advisories: result.advisories.filter((advisory) => advisory.match === "CONFIRMED"),
    })),
    diagnostics: sanitizeEvidence(
      results.flatMap((result) =>
        result.advisories
          .filter((advisory) => advisory.match !== "CONFIRMED")
          .map((advisory) => ({
            packageName: sanitizeText(result.packageName),
            version: sanitizeText(result.version),
            match: advisory.match,
            matchReason: advisory.matchReason,
          })),
      ),
    ),
  };
}

function advisoryObservationKey(result: DependencyAdvisoryResult, advisoryId: string): string {
  return JSON.stringify([
    ecosystemForPackageManager(result.packageManager),
    sanitizeText(result.packageName),
    sanitizeText(result.version),
    sanitizeText(advisoryId),
  ]);
}
function persistedAdvisoryCount(results: DependencyAdvisoryResult[]): number {
  return new Set(
    results.flatMap((result) =>
      result.advisories
        .filter((a) => a.match === "CONFIRMED")
        .map((a) => advisoryObservationKey(result, a.advisoryId)),
    ),
  ).size;
}

export async function persistAdvisories(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scanId: string,
  dependencies: Dependency[],
  results: DependencyAdvisoryResult[],
): Promise<number> {
  const dependencyIds = new Map(
    dependencies.map((dependency) => [
      JSON.stringify([dependency.packageName, dependency.version, dependency.packageManager]),
      dependency.id,
    ]),
  );
  let count = 0;
  const seen = new Set<string>();
  for (const result of results) {
    for (const advisory of result.advisories) {
      if (advisory.match !== "CONFIRMED") continue;
      const observation = advisoryObservationKey(result, advisory.advisoryId);
      if (seen.has(observation)) continue;
      seen.add(observation);
      const dependencyId = dependencyIds.get(
        JSON.stringify([
          sanitizeText(result.packageName),
          sanitizeText(result.version),
          result.packageManager,
        ]),
      );
      const data = {
        organizationId,
        scanId,
        ...(dependencyId == null ? {} : { dependencyId }),
        packageName: sanitizeText(result.packageName),
        version: sanitizeText(result.version),
        ecosystem: ecosystemForPackageManager(result.packageManager),
        advisoryId: sanitizeText(advisory.advisoryId),
        aliases: toInputJson(sanitizeEvidence(advisory.aliases)),
        severity: advisory.severity,
        fixedVersion:
          advisory.fixedVersions[0] == null ? null : sanitizeText(advisory.fixedVersions[0]),
        lastSeen: new Date(),
      };
      await tx.advisory.upsert({
        where: {
          organizationId_scanId_ecosystem_advisoryId_packageName_version: {
            organizationId,
            scanId,
            ecosystem: ecosystemForPackageManager(result.packageManager),
            advisoryId: sanitizeText(advisory.advisoryId),
            packageName: sanitizeText(result.packageName),
            version: sanitizeText(result.version),
          },
        },
        update: {},
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
  coverage?: ScanCoverage,
): Promise<void> {
  const receipt = createSecurityReceipt({
    ...(coverage == null ? {} : { coverage }),
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
  const { privateKey, keyId } = receiptSigningSettings(process.env);
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
      signedPayload: toInputJson(signed?.payload ?? receipt),
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
      signedPayload: toInputJson(signed?.payload ?? receipt),
      receiptHash: receipt.receiptHash,
    },
  });
}

export interface ScanLeaseFence {
  owner: string;
  attempt: number;
}

export async function assertScanLease(
  tx: Prisma.TransactionClient,
  scanId: string,
  lease: ScanLeaseFence,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ScanJob"
    WHERE "scanId" = ${scanId}
      AND "lockedBy" = ${lease.owner}
      AND "attempts" = ${lease.attempt}
      AND "status" = 'RUNNING'
      AND "cancelRequestedAt" IS NULL
      AND "leaseExpiresAt" > NOW()
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new Error("WORKER_LEASE_LOST");
}

async function markScanFailed(
  client: PrismaClient,
  scanId: string,
  error: unknown,
  metadata: Pick<ScanRunOptions, "source" | "targetPathLabel" | "triggeredBy" | "labels">,
  lease?: ScanLeaseFence,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : "Unknown scan failure";
  const sanitizedError = sanitizeEvidence(errorMessage);
  const safeError = typeof sanitizedError === "string" ? sanitizedError : "Unknown scan failure";
  const data = {
    status: ScanStatus.FAILED,
    completedAt: new Date(),
    metadata: {
      source: metadata.source,
      targetPath: metadata.targetPathLabel,
      triggeredBy: metadata.triggeredBy,
      labels: metadata.labels,
      error: safeError,
    },
  };
  if (lease == null) {
    await client.scan.updateMany({ where: { id: scanId, status: ScanStatus.RUNNING }, data });
    return;
  }
  await client.$transaction(async (tx) => {
    await assertScanLease(tx, scanId, lease);
    await tx.scan.updateMany({ where: { id: scanId, status: ScanStatus.RUNNING }, data });
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
  lease?: ScanLeaseFence;
}

export async function runConfiguredScan(
  options: ScanRunOptions,
  existingScanId?: string,
): Promise<string> {
  if (options.policyBundleVersion !== POLICY_RULE_VERSION) {
    throw new Error("Unsupported policy bundle version.");
  }
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
      : options.lease == null
        ? await prisma.scan.update({
            where: { id: existingScanId },
            data: {
              status: ScanStatus.RUNNING,
              startedAt: new Date(),
              completedAt: null,
              branch: options.branch,
              ...(options.commitSha == null ? {} : { commitSha: options.commitSha }),
              metadata: initialMetadata,
            },
          })
        : await prisma.$transaction(async (tx) => {
            await assertScanLease(tx, existingScanId, options.lease!);
            return tx.scan.update({
              where: { id: existingScanId, status: { not: ScanStatus.COMPLETED } },
              data: {
                status: ScanStatus.RUNNING,
                startedAt: new Date(),
                completedAt: null,
                branch: options.branch,
                ...(options.commitSha == null ? {} : { commitSha: options.commitSha }),
                metadata: initialMetadata,
              },
            });
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
    const persistedDependencies = consolidateDependencies(scanResult.dependencies);
    const policyDecisions = evaluateFindings(scanResult.findings, scan.id);
    const advisoryEnrichment = await runAdvisoryEnrichment(
      scanResult.dependencies,
      options.options.includeOsv,
      options.signal,
    );
    const { confirmed: advisoryResults, diagnostics: advisoryInventoryDiagnostics } =
      partitionAdvisoryResults(advisoryEnrichment.results);
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
    const metadata = {
      ...createScanMetadata({
        source: options.source,
        targetPath: options.targetPathLabel,
        triggeredBy: options.triggeredBy,
        labels: options.labels,
        findingCounts,
        decisionCounts,
        dependencyCount: persistedDependencies.length,
        remediationCount: remediations.length,
        approvalCount: approvalFindingIds.length,
        advisoryCount: persistedAdvisoryCount(advisoryResults),
        advisoryStatus,
        advisoryInventoryDiagnostics,
        ...(advisoryEnrichment.diagnostic == null
          ? {}
          : { advisoryDiagnostic: advisoryEnrichment.diagnostic }),
        policyBundleVersion: options.policyBundleVersion,
      }),
      coverage: toInputJson(scanResult.coverage ?? { status: "UNAVAILABLE" }),
    };
    const completedAt = new Date();

    await prisma.$transaction(
      async (tx) => {
        if (options.lease != null) await assertScanLease(tx, scan.id, options.lease);
        for (const dependency of persistedDependencies) await persistDependency(tx, dependency);
        await persistAdvisories(
          tx,
          options.organizationId,
          scan.id,
          persistedDependencies,
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
          scanResult.coverage,
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
    try {
      await markScanFailed(prisma, scan.id, error, options, options.lease);
    } catch (failure) {
      if (!(failure instanceof Error && failure.message === "WORKER_LEASE_LOST")) throw failure;
    }
    throw error;
  }
}

export async function runDemoScan(
  existingScanId?: string,
  organizationId = "demo-organization",
  correlationId = "system",
  signal?: AbortSignal,
  triggeredBy = SYSTEM_ACTOR,
  lease?: ScanLeaseFence,
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
      triggeredBy,
      labels: ["demo", "api-run"],
      policyBundleVersion: POLICY_RULE_VERSION,
      options: {
        maxFiles: 10_000,
        maxBytes: 100 * 1024 * 1024,
        timeoutMs: 120_000,
        ignorePaths: [],
        includeOsv: false,
      },
      ...(signal == null ? {} : { signal }),
      ...(lease == null ? {} : { lease }),
    },
    existingScanId,
  );
}
