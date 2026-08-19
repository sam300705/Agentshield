import {
  ApprovalStatus,
  AuditAction,
  DependencyScope,
  FindingCategory,
  PackageManager,
  PolicyDecisionType,
  PrismaClient,
  ScanStatus,
  Severity,
} from "@prisma/client";

const prisma = new PrismaClient();

async function clearDatabase() {
  await prisma.auditEvent.deleteMany();
  await prisma.policyDecision.deleteMany();
  await prisma.remediation.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.scan.deleteMany();
}

async function main() {
  await clearDatabase();

  const scan = await prisma.scan.create({
    data: {
      repositoryName: "agentshield-vulnerable-demo-target",
      repositoryUrl: "https://github.com/example/agentshield-vulnerable-demo-target",
      branch: "main",
      commitSha: "3f2a9c7d4b1e8f0a6c5d2e9b7a4c1f0e8d6b5a3c",
      status: ScanStatus.COMPLETED,
      metadata: {
        source: "LOCAL_EXAMPLE",
        targetPath: "examples/vulnerable-repo",
        triggeredBy: "System",
        labels: ["demo", "phase-2-seed"],
        extra: {
          note: "Deterministic seeded evidence for the AgentShield demo workspace.",
        },
      },
      completedAt: new Date(),
    },
  });

  await prisma.dependency.createMany({
    data: [
      {
        scanId: scan.id,
        packageName: "debug",
        version: "*",
        packageManager: PackageManager.NPM,
        scope: DependencyScope.PRODUCTION,
        manifestPath: "examples/vulnerable-repo/package.json",
        purl: "pkg:npm/debug@*",
        metadata: {
          source: "seed-sbom-inventory",
          note: "Inventory finding only; no CVE assertion is made.",
        },
      },
      {
        scanId: scan.id,
        packageName: "express",
        version: "4.16.0",
        packageManager: PackageManager.NPM,
        scope: DependencyScope.PRODUCTION,
        manifestPath: "examples/vulnerable-repo/package.json",
        purl: "pkg:npm/express@4.16.0",
        metadata: {
          source: "seed-sbom-inventory",
        },
      },
      {
        scanId: scan.id,
        packageName: "lodash",
        version: "4.17.20",
        packageManager: PackageManager.NPM,
        scope: DependencyScope.PRODUCTION,
        manifestPath: "examples/vulnerable-repo/package.json",
        purl: "pkg:npm/lodash@4.17.20",
        metadata: {
          source: "seed-sbom-inventory",
        },
      },
      {
        scanId: scan.id,
        packageName: "eslint",
        version: "latest",
        packageManager: PackageManager.NPM,
        scope: DependencyScope.DEVELOPMENT,
        manifestPath: "examples/vulnerable-repo/package.json",
        purl: "pkg:npm/eslint@latest",
        metadata: {
          source: "seed-sbom-inventory",
          note: "Unpinned dev dependency captured as inventory metadata.",
        },
      },
    ],
  });

  const secretFinding = await prisma.finding.create({
    data: {
      scanId: scan.id,
      category: FindingCategory.SECRET,
      severity: Severity.CRITICAL,
      title: "High-confidence cloud credential in environment template",
      description:
        "The demo environment template contains values matching high-confidence AWS credential patterns.",
      filePath: "examples/vulnerable-repo/.env.example",
      lineStart: 2,
      lineEnd: 3,
      evidence: {
        matchedPatterns: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
        redacted: true,
      },
      fingerprint: "seed:vulnerable-repo:secret:aws-env-example",
      policyDecision: {
        create: {
          decision: PolicyDecisionType.BLOCK,
          ruleId: "secret.high_confidence.cloud_credential",
          ruleVersion: "2026.06.0",
          reason: "High-confidence secret patterns must block merge until removed.",
          ruleSnapshot: {
            id: "secret.high_confidence.cloud_credential",
            version: "2026.06.0",
            name: "Block high-confidence cloud credentials",
            description: "Blocks findings that match high-confidence cloud secret regex patterns.",
            enabled: true,
            target: {
              categories: ["SECRET"],
              severities: ["HIGH", "CRITICAL"],
            },
            conditions: [
              {
                field: "category",
                operator: "EQUALS",
                value: "SECRET",
              },
              {
                field: "severity",
                operator: "IN",
                value: ["HIGH", "CRITICAL"],
              },
            ],
            decision: "BLOCK",
            remediationEligible: true,
            rationale: "Secrets in source control create immediate credential exposure risk.",
            tags: ["secret", "supply-chain"],
          },
        },
      },
      remediation: {
        create: {
          summary: "Remove the credential from source control and rotate it.",
          detail:
            "Delete the hardcoded values, replace them with secret-manager references, and rotate any real credential that may have been exposed.",
          steps: [
            "Remove AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from the committed template.",
            "Replace local examples with clearly fake placeholders.",
            "Rotate the credential if this occurred outside the demo repository.",
          ],
          generatedForDecision: PolicyDecisionType.BLOCK,
        },
      },
      approval: {
        create: {
          status: ApprovalStatus.PENDING,
          actor: "System",
          reason: "Security approval required after the blocking secret finding is remediated.",
        },
      },
    },
  });

  const dockerfileFinding = await prisma.finding.create({
    data: {
      scanId: scan.id,
      category: FindingCategory.DOCKERFILE,
      severity: Severity.HIGH,
      title: "Dockerfile executes remote script as root",
      description:
        "The Dockerfile uses an unpinned base image, executes a remote install script, and runs as root.",
      filePath: "examples/vulnerable-repo/Dockerfile",
      lineStart: 1,
      lineEnd: 11,
      evidence: {
        baseImage: "node:latest",
        unsafeCommands: ["curl -fsSL https://example.invalid/install.sh | bash"],
        user: "root",
      },
      fingerprint: "seed:vulnerable-repo:dockerfile:remote-script-root",
      policyDecision: {
        create: {
          decision: PolicyDecisionType.REQUIRE_APPROVAL,
          ruleId: "dockerfile.remote_script.root_user",
          ruleVersion: "2026.06.0",
          reason: "Remote shell execution and root runtime require platform-owner approval.",
          ruleSnapshot: {
            id: "dockerfile.remote_script.root_user",
            version: "2026.06.0",
            name: "Require approval for remote script execution as root",
            description:
              "Flags Dockerfiles that combine remote script execution with root runtime.",
            enabled: true,
            target: {
              categories: ["DOCKERFILE"],
              severities: ["HIGH", "CRITICAL"],
            },
            conditions: [
              {
                field: "category",
                operator: "EQUALS",
                value: "DOCKERFILE",
              },
              {
                field: "evidence.unsafeCommands",
                operator: "EXISTS",
              },
            ],
            decision: "REQUIRE_APPROVAL",
            remediationEligible: true,
            rationale:
              "Build-time remote execution and root containers increase supply-chain risk.",
            tags: ["dockerfile", "platform-approval"],
          },
        },
      },
      remediation: {
        create: {
          summary: "Pin the base image, remove remote shell execution, and run as a non-root user.",
          detail:
            "Replace node:latest with a pinned supported image, vendor or verify installation assets, and create a non-root runtime user.",
          steps: [
            "Replace node:latest with a pinned Node.js image digest or fixed version.",
            "Remove curl-to-shell installation from the build.",
            "Create and switch to a non-root user before the runtime command.",
          ],
          generatedForDecision: PolicyDecisionType.REQUIRE_APPROVAL,
        },
      },
      approval: {
        create: {
          status: ApprovalStatus.PENDING,
          actor: "System",
          reason: "Platform approval required before merging this container build pattern.",
        },
      },
    },
  });

  const dependencyFinding = await prisma.finding.create({
    data: {
      scanId: scan.id,
      category: FindingCategory.DEPENDENCY,
      severity: Severity.MEDIUM,
      title: "SBOM inventory contains unpinned dependency ranges",
      description:
        "The SBOM inventory captured wildcard and latest dependency ranges. This is inventory drift, not a CVE vulnerability assertion.",
      filePath: "examples/vulnerable-repo/package.json",
      lineStart: 11,
      lineEnd: 19,
      evidence: {
        packageManager: "NPM",
        dependencies: ["debug@*", "eslint@latest"],
        classification: "SBOM_INVENTORY",
      },
      fingerprint: "seed:vulnerable-repo:dependency:unpinned-inventory",
      policyDecision: {
        create: {
          decision: PolicyDecisionType.WARN,
          ruleId: "sbom.unpinned_dependency_inventory",
          ruleVersion: "2026.06.0",
          reason: "Unpinned dependency ranges should be visible in the SBOM inventory.",
          ruleSnapshot: {
            id: "sbom.unpinned_dependency_inventory",
            version: "2026.06.0",
            name: "Warn on unpinned dependency inventory",
            description:
              "Warns when the SBOM generator records wildcard or latest dependency versions.",
            enabled: true,
            target: {
              categories: ["DEPENDENCY"],
              severities: ["LOW", "MEDIUM"],
            },
            conditions: [
              {
                field: "category",
                operator: "EQUALS",
                value: "DEPENDENCY",
              },
              {
                field: "evidence.classification",
                operator: "EQUALS",
                value: "SBOM_INVENTORY",
              },
            ],
            decision: "WARN",
            remediationEligible: false,
            rationale:
              "Dependency inventory drift should be visible without claiming deep CVE scanning.",
            tags: ["sbom", "dependency-inventory"],
          },
        },
      },
      remediation: {
        create: {
          summary: "No detailed remediation generated for WARN decisions.",
          detail: null,
          steps: [],
          generatedForDecision: PolicyDecisionType.WARN,
        },
      },
      approval: {
        create: {
          status: ApprovalStatus.APPROVED,
          actor: "System",
          reason: "WARN decisions are recorded for audit but do not require human approval.",
          reviewedAt: new Date(),
        },
      },
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        actor: "System",
        action: AuditAction.SCAN_CREATED,
        entityType: "Scan",
        entityId: scan.id,
        scanId: scan.id,
        metadata: {
          repositoryName: scan.repositoryName,
        },
      },
      {
        actor: "System",
        action: AuditAction.SCAN_COMPLETED,
        entityType: "Scan",
        entityId: scan.id,
        scanId: scan.id,
        metadata: {
          status: ScanStatus.COMPLETED,
        },
      },
      {
        actor: "System",
        action: AuditAction.FINDING_CREATED,
        entityType: "Finding",
        entityId: secretFinding.id,
        scanId: scan.id,
        metadata: {
          category: FindingCategory.SECRET,
          severity: Severity.CRITICAL,
        },
      },
      {
        actor: "System",
        action: AuditAction.FINDING_CREATED,
        entityType: "Finding",
        entityId: dockerfileFinding.id,
        scanId: scan.id,
        metadata: {
          category: FindingCategory.DOCKERFILE,
          severity: Severity.HIGH,
        },
      },
      {
        actor: "System",
        action: AuditAction.FINDING_CREATED,
        entityType: "Finding",
        entityId: dependencyFinding.id,
        scanId: scan.id,
        metadata: {
          category: FindingCategory.DEPENDENCY,
          severity: Severity.MEDIUM,
        },
      },
    ],
  });

  console.warn(
    `Seeded scan ${scan.id} with 3 findings, 4 SBOM dependency records, and audit events.`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
