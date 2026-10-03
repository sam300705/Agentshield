/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import {
  ApprovalStatus,
  AuditAction,
  DependencyScope,
  FindingCategory,
  PackageManager,
  PolicyDecisionType,
  type PrismaClient,
  ScanStatus,
  Severity,
} from "@prisma/client";

// In-Memory Database store for when external PostgreSQL is not connected
interface InMemoryData {
  scans: any[];
  findings: any[];
  policyDecisions: any[];
  remediations: any[];
  approvals: any[];
  dependencies: any[];
  auditEvents: any[];
}

function createInitialData(): InMemoryData {
  const now = new Date();
  const scanId = "seed-demo-scan-1";
  const secretFindingId = "seed-finding-secret";
  const dockerFindingId = "seed-finding-docker";
  const depFindingId = "seed-finding-dep";

  const scans = [
    {
      id: scanId,
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
        extra: { note: "Seeded AgentShield security analysis" },
      },
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const findings = [
    {
      id: secretFindingId,
      scanId,
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
      createdAt: now,
    },
    {
      id: dockerFindingId,
      scanId,
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
      createdAt: now,
    },
    {
      id: depFindingId,
      scanId,
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
      createdAt: now,
    },
  ];

  const policyDecisions = [
    {
      id: "seed-decision-secret",
      findingId: secretFindingId,
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
        target: { categories: ["SECRET"], severities: ["HIGH", "CRITICAL"] },
        conditions: [
          { field: "category", operator: "EQUALS", value: "SECRET" },
          { field: "severity", operator: "IN", value: ["HIGH", "CRITICAL"] },
        ],
        decision: "BLOCK",
        remediationEligible: true,
        rationale: "Secrets in source control create immediate credential exposure risk.",
        tags: ["secret", "supply-chain"],
      },
      decidedAt: now,
    },
    {
      id: "seed-decision-docker",
      findingId: dockerFindingId,
      decision: PolicyDecisionType.REQUIRE_APPROVAL,
      ruleId: "dockerfile.remote_script.root_user",
      ruleVersion: "2026.06.0",
      reason: "Remote shell execution and root runtime require platform-owner approval.",
      ruleSnapshot: {
        id: "dockerfile.remote_script.root_user",
        version: "2026.06.0",
        name: "Require approval for remote script execution as root",
        description: "Flags Dockerfiles that combine remote script execution with root runtime.",
        enabled: true,
        target: { categories: ["DOCKERFILE"], severities: ["HIGH", "CRITICAL"] },
        conditions: [
          { field: "category", operator: "EQUALS", value: "DOCKERFILE" },
          { field: "evidence.unsafeCommands", operator: "EXISTS" },
        ],
        decision: "REQUIRE_APPROVAL",
        remediationEligible: true,
        rationale: "Build-time remote execution and root containers increase supply-chain risk.",
        tags: ["dockerfile", "platform-approval"],
      },
      decidedAt: now,
    },
    {
      id: "seed-decision-dep",
      findingId: depFindingId,
      decision: PolicyDecisionType.WARN,
      ruleId: "sbom.unpinned_dependency_inventory",
      ruleVersion: "2026.06.0",
      reason: "Unpinned dependency ranges should be visible in the SBOM inventory.",
      ruleSnapshot: {
        id: "sbom.unpinned_dependency_inventory",
        version: "2026.06.0",
        name: "Warn on unpinned dependency inventory",
        description: "Warns when the SBOM generator records wildcard or latest dependency versions.",
        enabled: true,
        target: { categories: ["DEPENDENCY"], severities: ["LOW", "MEDIUM"] },
        conditions: [
          { field: "category", operator: "EQUALS", value: "DEPENDENCY" },
          { field: "evidence.classification", operator: "EQUALS", value: "SBOM_INVENTORY" },
        ],
        decision: "WARN",
        remediationEligible: false,
        rationale: "Dependency inventory drift should be visible without claiming deep CVE scanning.",
        tags: ["sbom", "dependency-inventory"],
      },
      decidedAt: now,
    },
  ];

  const remediations = [
    {
      id: "seed-remediation-secret",
      findingId: secretFindingId,
      summary: "Remove the credential from source control and rotate it.",
      detail:
        "Delete the hardcoded values, replace them with secret-manager references, and rotate any real credential that may have been exposed.",
      steps: [
        "Remove AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from the committed template.",
        "Replace local examples with clearly fake placeholders.",
        "Rotate the credential if this occurred outside the demo repository.",
      ],
      patch: null,
      generatedForDecision: PolicyDecisionType.BLOCK,
      createdAt: now,
    },
    {
      id: "seed-remediation-docker",
      findingId: dockerFindingId,
      summary: "Pin the base image, remove remote shell execution, and run as a non-root user.",
      detail:
        "Replace node:latest with a pinned supported image, vendor or verify installation assets, and create a non-root runtime user.",
      steps: [
        "Replace node:latest with a pinned Node.js image digest or fixed version.",
        "Remove curl-to-shell installation from the build.",
        "Create and switch to a non-root user before the runtime command.",
      ],
      patch: null,
      generatedForDecision: PolicyDecisionType.REQUIRE_APPROVAL,
      createdAt: now,
    },
    {
      id: "seed-remediation-dep",
      findingId: depFindingId,
      summary: "No detailed remediation generated for WARN decisions.",
      detail: null,
      steps: [],
      patch: null,
      generatedForDecision: PolicyDecisionType.WARN,
      createdAt: now,
    },
  ];

  const approvals = [
    {
      id: "seed-approval-secret",
      findingId: secretFindingId,
      status: ApprovalStatus.PENDING,
      actor: "System",
      reason: "Security approval required after the blocking secret finding is remediated.",
      requestedAt: now,
      reviewedAt: null,
    },
    {
      id: "seed-approval-docker",
      findingId: dockerFindingId,
      status: ApprovalStatus.PENDING,
      actor: "System",
      reason: "Platform approval required before merging this container build pattern.",
      requestedAt: now,
      reviewedAt: null,
    },
    {
      id: "seed-approval-dep",
      findingId: depFindingId,
      status: ApprovalStatus.APPROVED,
      actor: "System",
      reason: "WARN decisions are recorded for audit but do not require human approval.",
      requestedAt: now,
      reviewedAt: now,
    },
  ];

  const dependencies = [
    {
      id: "seed-dep-1",
      scanId,
      packageName: "debug",
      version: "*",
      packageManager: PackageManager.NPM,
      scope: DependencyScope.PRODUCTION,
      manifestPath: "examples/vulnerable-repo/package.json",
      purl: "pkg:npm/debug@*",
      license: "MIT",
      supplier: null,
      metadata: { source: "seed-sbom-inventory", note: "Inventory finding only" },
      createdAt: now,
    },
    {
      id: "seed-dep-2",
      scanId,
      packageName: "express",
      version: "4.16.0",
      packageManager: PackageManager.NPM,
      scope: DependencyScope.PRODUCTION,
      manifestPath: "examples/vulnerable-repo/package.json",
      purl: "pkg:npm/express@4.16.0",
      license: "MIT",
      supplier: null,
      metadata: { source: "seed-sbom-inventory" },
      createdAt: now,
    },
    {
      id: "seed-dep-3",
      scanId,
      packageName: "lodash",
      version: "4.17.20",
      packageManager: PackageManager.NPM,
      scope: DependencyScope.PRODUCTION,
      manifestPath: "examples/vulnerable-repo/package.json",
      purl: "pkg:npm/lodash@4.17.20",
      license: "MIT",
      supplier: null,
      metadata: { source: "seed-sbom-inventory" },
      createdAt: now,
    },
    {
      id: "seed-dep-4",
      scanId,
      packageName: "eslint",
      version: "latest",
      packageManager: PackageManager.NPM,
      scope: DependencyScope.DEVELOPMENT,
      manifestPath: "examples/vulnerable-repo/package.json",
      purl: "pkg:npm/eslint@latest",
      license: "MIT",
      supplier: null,
      metadata: { source: "seed-sbom-inventory" },
      createdAt: now,
    },
  ];

  const auditEvents = [
    {
      id: "seed-audit-1",
      actor: "System",
      action: AuditAction.SCAN_CREATED,
      entityType: "Scan",
      entityId: scanId,
      scanId,
      metadata: { repositoryName: "agentshield-vulnerable-demo-target" },
      createdAt: now,
    },
    {
      id: "seed-audit-2",
      actor: "System",
      action: AuditAction.SCAN_COMPLETED,
      entityType: "Scan",
      entityId: scanId,
      scanId,
      metadata: { status: ScanStatus.COMPLETED },
      createdAt: now,
    },
    {
      id: "seed-audit-3",
      actor: "System",
      action: AuditAction.FINDING_CREATED,
      entityType: "Finding",
      entityId: secretFindingId,
      scanId,
      metadata: { category: FindingCategory.SECRET, severity: Severity.CRITICAL },
      createdAt: now,
    },
    {
      id: "seed-audit-4",
      actor: "System",
      action: AuditAction.FINDING_CREATED,
      entityType: "Finding",
      entityId: dockerFindingId,
      scanId,
      metadata: { category: FindingCategory.DOCKERFILE, severity: Severity.HIGH },
      createdAt: now,
    },
    {
      id: "seed-audit-5",
      actor: "System",
      action: AuditAction.FINDING_CREATED,
      entityType: "Finding",
      entityId: depFindingId,
      scanId,
      metadata: { category: FindingCategory.DEPENDENCY, severity: Severity.MEDIUM },
      createdAt: now,
    },
  ];

  return { scans, findings, policyDecisions, remediations, approvals, dependencies, auditEvents };
}

function createInMemoryPrismaClient(): any {
  const store = createInitialData();
  let idCounter = 100;

  function nextId(prefix = "rec") {
    idCounter += 1;
    return `${prefix}-${Date.now()}-${idCounter}`;
  }

  function enrichFinding(finding: any) {
    const policyDecision =
      store.policyDecisions.find((pd) => pd.findingId === finding.id) ?? null;
    const remediation =
      store.remediations.find((r) => r.findingId === finding.id) ?? null;
    const approval = store.approvals.find((a) => a.findingId === finding.id) ?? null;
    return {
      ...finding,
      policyDecision,
      remediation,
      approval,
    };
  }

  function enrichApproval(approval: any) {
    const rawFinding = store.findings.find((f) => f.id === approval.findingId);
    const finding = rawFinding ? enrichFinding(rawFinding) : null;
    return {
      ...approval,
      finding,
    };
  }

  function enrichScan(scan: any) {
    const findingsCount = store.findings.filter((f) => f.scanId === scan.id).length;
    const dependenciesCount = store.dependencies.filter((d) => d.scanId === scan.id).length;
    const auditEventsCount = store.auditEvents.filter((a) => a.scanId === scan.id).length;
    return {
      ...scan,
      _count: {
        findings: findingsCount,
        dependencies: dependenciesCount,
        auditEvents: auditEventsCount,
      },
    };
  }

  const client: any = {
    scan: {
      async count(_args?: any) {
        return store.scans.length;
      },
      async findFirst(args?: any) {
        if (store.scans.length === 0) return null;
        const sorted = [...store.scans].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const item = sorted[0];
        return args?.include?._count ? enrichScan(item) : item;
      },
      async findMany(args?: any) {
        let list = [...store.scans].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        if (args?.skip != null) list = list.slice(args.skip);
        if (args?.take != null) list = list.slice(0, args.take);
        return args?.include?._count ? list.map(enrichScan) : list;
      },
      async findUnique(args: any) {
        const item = store.scans.find((s) => s.id === args?.where?.id);
        if (!item) return null;
        return args?.include?._count ? enrichScan(item) : item;
      },
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("scan"),
          createdAt: new Date(),
          updatedAt: new Date(),
          startedAt: new Date(),
          completedAt: null,
          metadata: {},
          ...args.data,
        };
        store.scans.unshift(item);
        return item;
      },
      async update(args: any) {
        const index = store.scans.findIndex((s) => s.id === args.where.id);
        if (index === -1) throw new Error(`Scan not found: ${args.where.id}`);
        store.scans[index] = {
          ...store.scans[index],
          ...args.data,
          updatedAt: new Date(),
        };
        return store.scans[index];
      },
      async deleteMany() {
        store.scans.length = 0;
        return { count: 0 };
      },
    },

    finding: {
      async count(args?: any) {
        if (args?.where?.scanId) {
          return store.findings.filter((f) => f.scanId === args.where.scanId).length;
        }
        return store.findings.length;
      },
      async findMany(args?: any) {
        let list = [...store.findings];
        if (args?.where?.scanId) {
          list = list.filter((f) => f.scanId === args.where.scanId);
        }
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (args?.skip != null) list = list.slice(args.skip);
        if (args?.take != null) list = list.slice(0, args.take);
        return list.map(enrichFinding);
      },
      async groupBy(args: any) {
        const scanId = args?.where?.scanId;
        const matching = scanId
          ? store.findings.filter((f) => f.scanId === scanId)
          : store.findings;
        const counts: Record<string, number> = {};
        for (const item of matching) {
          const key = item.severity;
          counts[key] = (counts[key] || 0) + 1;
        }
        return Object.entries(counts).map(([severity, count]) => ({
          severity,
          _count: { _all: count },
        }));
      },
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("finding"),
          createdAt: new Date(),
          ...args.data,
        };
        store.findings.push(item);
        if (args.data.policyDecision?.create) {
          await client.policyDecision.create({
            data: { findingId: item.id, ...args.data.policyDecision.create },
          });
        }
        if (args.data.remediation?.create) {
          await client.remediation.create({
            data: { findingId: item.id, ...args.data.remediation.create },
          });
        }
        if (args.data.approval?.create) {
          await client.approval.create({
            data: { findingId: item.id, ...args.data.approval.create },
          });
        }
        return item;
      },
      async deleteMany() {
        store.findings.length = 0;
        return { count: 0 };
      },
    },

    policyDecision: {
      async groupBy(args: any) {
        const scanId = args?.where?.finding?.scanId;
        const relevantFindingIds = scanId
          ? new Set(store.findings.filter((f) => f.scanId === scanId).map((f) => f.id))
          : null;
        const matching = relevantFindingIds
          ? store.policyDecisions.filter((pd) => relevantFindingIds.has(pd.findingId))
          : store.policyDecisions;
        const counts: Record<string, number> = {};
        for (const item of matching) {
          const key = item.decision;
          counts[key] = (counts[key] || 0) + 1;
        }
        return Object.entries(counts).map(([decision, count]) => ({
          decision,
          _count: { _all: count },
        }));
      },
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("pd"),
          decidedAt: new Date(),
          ...args.data,
        };
        store.policyDecisions.push(item);
        return item;
      },
      async deleteMany() {
        store.policyDecisions.length = 0;
        return { count: 0 };
      },
    },

    remediation: {
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("rem"),
          createdAt: new Date(),
          ...args.data,
        };
        store.remediations.push(item);
        return item;
      },
      async deleteMany() {
        store.remediations.length = 0;
        return { count: 0 };
      },
    },

    approval: {
      async count(args?: any) {
        if (args?.where?.status) {
          return store.approvals.filter((a) => a.status === args.where.status).length;
        }
        return store.approvals.length;
      },
      async findMany(args?: any) {
        let list = [...store.approvals];
        if (args?.where?.status) {
          list = list.filter((a) => a.status === args.where.status);
        }
        list.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        if (args?.skip != null) list = list.slice(args.skip);
        if (args?.take != null) list = list.slice(0, args.take);
        return list.map(enrichApproval);
      },
      async findUnique(args: any) {
        const item = store.approvals.find((a) => a.id === args?.where?.id);
        if (!item) return null;
        return enrichApproval(item);
      },
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("appr"),
          requestedAt: new Date(),
          reviewedAt: null,
          ...args.data,
        };
        store.approvals.push(item);
        return item;
      },
      async update(args: any) {
        const index = store.approvals.findIndex((a) => a.id === args.where.id);
        if (index === -1) throw new Error(`Approval not found: ${args.where.id}`);
        store.approvals[index] = {
          ...store.approvals[index],
          ...args.data,
          reviewedAt: args.data.reviewedAt || new Date(),
        };
        return enrichApproval(store.approvals[index]);
      },
      async deleteMany() {
        store.approvals.length = 0;
        return { count: 0 };
      },
    },

    dependency: {
      async count(args?: any) {
        if (args?.where?.scanId) {
          return store.dependencies.filter((d) => d.scanId === args.where.scanId).length;
        }
        return store.dependencies.length;
      },
      async findMany(args?: any) {
        let list = [...store.dependencies];
        if (args?.where?.scanId) {
          list = list.filter((d) => d.scanId === args.where.scanId);
        }
        list.sort((a, b) => a.packageName.localeCompare(b.packageName));
        if (args?.skip != null) list = list.slice(args.skip);
        if (args?.take != null) list = list.slice(0, args.take);
        return list;
      },
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("dep"),
          createdAt: new Date(),
          ...args.data,
        };
        store.dependencies.push(item);
        return item;
      },
      async createMany(args: any) {
        const items = (args.data || []).map((d: any) => ({
          id: d.id || nextId("dep"),
          createdAt: new Date(),
          ...d,
        }));
        store.dependencies.push(...items);
        return { count: items.length };
      },
      async deleteMany() {
        store.dependencies.length = 0;
        return { count: 0 };
      },
    },

    auditEvent: {
      async count(_args?: any) {
        return store.auditEvents.length;
      },
      async findMany(args?: any) {
        let list = [...store.auditEvents].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        if (args?.skip != null) list = list.slice(args.skip);
        if (args?.take != null) list = list.slice(0, args.take);
        return list;
      },
      async create(args: any) {
        const item = {
          id: args.data.id || nextId("audit"),
          createdAt: new Date(),
          ...args.data,
        };
        store.auditEvents.unshift(item);
        return item;
      },
      async createMany(args: any) {
        const items = (args.data || []).map((a: any) => ({
          id: a.id || nextId("audit"),
          createdAt: new Date(),
          ...a,
        }));
        store.auditEvents.unshift(...items);
        return { count: items.length };
      },
      async deleteMany() {
        store.auditEvents.length = 0;
        return { count: 0 };
      },
    },

    async $transaction(cbOrList: any) {
      if (typeof cbOrList === "function") {
        return cbOrList(client);
      }
      return Promise.all(cbOrList);
    },

    async $disconnect() {},
  };

  return client;
}

// In-Memory mock client ready with demo data
const inMemoryStoreClient = createInMemoryPrismaClient();

export const prisma = inMemoryStoreClient as unknown as PrismaClient;
