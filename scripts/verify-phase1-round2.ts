import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { persistAdvisories } from "../apps/api/src/services/scanService.js";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";
import {
  enqueueRepositoryScan,
  enqueueDemoScan,
  requestJobCancellation,
  recoverAbandonedJobs,
} from "../apps/api/src/services/scanQueue.js";
import { ConfiguredScanJobExecutor } from "../apps/api/src/services/scanJobExecutor.js";
import { scanJobPayloadSchema } from "@agentshield/schemas";
import type { DependencyAdvisoryResult } from "@agentshield/scanner";

assertSafeSeedTarget(process.env.NODE_ENV, process.env.DATABASE_URL ?? "");
const prisma = new PrismaClient();
const organizationId = `round2-${randomUUID()}`;
const schema = `round2_${randomUUID().replaceAll("-", "")}`;

async function main() {
  let organizationCreated = false;
  try {
    // Exercise the exact forward SQL against a populated table with the old unique index.
    // A dedicated temporary schema keeps this upgrade test separate from application data.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE "Advisory" (LIKE public."Advisory" INCLUDING DEFAULTS)`,
      );
      await tx.$executeRawUnsafe(
        'CREATE UNIQUE INDEX "Advisory_organizationId_advisoryId_packageName_version_key" ON "Advisory" ("organizationId", "advisoryId", "packageName", "version")',
      );
      await tx.$executeRaw`INSERT INTO "Advisory" ("id", "organizationId", "scanId", "packageName", "version", "ecosystem", "advisoryId", "fixedVersion") VALUES ('legacy', 'org', 'scan-a', 'alpha', '1.0.0', 'npm', 'TEST-1', '2.0.0')`;
      const before = await tx.$queryRaw<
        Array<Record<string, unknown>>
      >`SELECT * FROM "Advisory" ORDER BY "id"`;
      const migration = await readFile(
        new URL(
          "../prisma/migrations/20261007143000_scan_advisory_observations/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      for (const statement of migration.split(";").filter((sql) => sql.trim())) {
        await tx.$executeRawUnsafe(statement);
      }
      assert.deepEqual(await tx.$queryRaw`SELECT * FROM "Advisory" ORDER BY "id"`, before);
      await tx.$executeRaw`INSERT INTO "Advisory" ("id", "organizationId", "scanId", "packageName", "version", "ecosystem", "advisoryId", "fixedVersion") VALUES ('later', 'org', 'scan-b', 'alpha', '1.0.0', 'npm', 'TEST-1', '3.0.0')`;
      assert.equal(
        (await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "Advisory"`)[0]
          ?.count,
        2n,
      );
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });

    await prisma.organization.create({
      data: { id: organizationId, slug: organizationId, name: "Round 2 synthetic verification" },
    });
    organizationCreated = true;
    const installation = await prisma.gitHubInstallation.create({
      data: {
        organizationId,
        installationId: 1200000000 + Math.floor(Math.random() * 100000),
        accountLogin: "synthetic",
        accountType: "User",
        permissions: {},
      },
    });
    const repository = await prisma.repository.create({
      data: {
        organizationId,
        provider: "GITHUB",
        externalId: organizationId,
        fullName: "synthetic/round2",
        defaultBranch: "main",
        githubInstallationId: installation.id,
      },
    });
    const request = {
      repositoryId: repository.id,
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      policyBundleVersion: "synthetic",
      options: {
        maxFiles: 1000,
        maxBytes: 1000,
        timeoutMs: 1000,
        ignorePaths: [],
        includeOsv: false,
      },
    };
    // These direct queue calls qualify the primitive, not public Phase 1 admission.
    await assert.rejects(
      enqueueRepositoryScan(
        { ...request, commitSha: "1234567" },
        "invalid",
        organizationId,
        "synthetic",
        "corr",
      ),
    );
    assert.equal(await prisma.scan.count({ where: { organizationId } }), 0);
    const admitted = await enqueueRepositoryScan(
      request,
      "trusted-installation",
      organizationId,
      "synthetic",
      "corr",
    );
    const payload = scanJobPayloadSchema.parse(
      (await prisma.scanJob.findUniqueOrThrow({ where: { id: admitted.id } })).payload,
    );
    assert.equal(payload.integrationId, String(installation.installationId));
    assert.equal(payload.commitSha, request.commitSha);
    const scanA = await prisma.scan.create({
      data: { organizationId, repositoryName: "synthetic", branch: "main" },
    });
    const scanB = await prisma.scan.create({
      data: { organizationId, repositoryName: "synthetic", branch: "main" },
    });
    const results = (fixedVersion: string): DependencyAdvisoryResult[] => [
      {
        packageName: "alpha",
        version: "1.0.0",
        packageManager: "NPM",
        advisories: [
          {
            advisoryId: "SYNTHETIC-ROUND2",
            aliases: [],
            summary: null,
            severity: "HIGH",
            fixedVersions: [fixedVersion],
            references: [],
            match: "CONFIRMED",
            matchReason: "synthetic exact match",
          },
        ],
      },
    ];
    await prisma.$transaction((tx) =>
      persistAdvisories(tx, organizationId, scanA.id, [], results("2.0.0")),
    );
    const first = await prisma.advisory.findMany({ where: { organizationId, scanId: scanA.id } });
    await prisma.$transaction((tx) =>
      persistAdvisories(tx, organizationId, scanB.id, [], results("3.0.0")),
    );
    await prisma.$transaction((tx) =>
      persistAdvisories(tx, organizationId, scanA.id, [], results("4.0.0")),
    );
    assert.deepEqual(
      await prisma.advisory.findMany({ where: { organizationId, scanId: scanA.id } }),
      first,
    );
    assert.equal(await prisma.advisory.count({ where: { organizationId } }), 2);
    await prisma.scan.delete({ where: { id: scanB.id } });
    assert.deepEqual(
      await prisma.advisory.findMany({ where: { organizationId, scanId: scanA.id } }),
      first,
    );

    for (const status of ["QUEUED", "FAILED"] as const) {
      const scan = await prisma.scan.create({
        data: { organizationId, repositoryName: "synthetic", branch: "main", status },
      });
      const job = await prisma.scanJob.create({
        data: {
          scanId: scan.id,
          status,
          idempotencyKey: `round2-${scan.id}`,
          repositoryRef: "main",
          policyBundleVersion: "synthetic",
          requester: "synthetic",
          correlationId: "synthetic",
          payload: {},
          nextAttemptAt: new Date(Date.now() + 60000),
        },
      });
      assert.equal(await requestJobCancellation(job.id, organizationId), true);
      const cancelled = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(cancelled.status, "CANCELLED");
      assert.equal(cancelled.nextAttemptAt, null);
      assert.equal(
        (await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).status,
        "CANCELLED",
      );
    }
    const running = await prisma.scan.create({
      data: { organizationId, repositoryName: "synthetic", branch: "main", status: "RUNNING" },
    });
    const staleJob = await prisma.scanJob.create({
      data: {
        scanId: running.id,
        status: "RUNNING",
        idempotencyKey: `round2-${running.id}`,
        repositoryRef: "main",
        policyBundleVersion: "synthetic",
        requester: "synthetic",
        correlationId: "synthetic",
        payload: {},
        lockedBy: "expired-worker",
        leaseExpiresAt: new Date(0),
      },
    });
    await Promise.all([
      requestJobCancellation(staleJob.id, organizationId),
      recoverAbandonedJobs(),
    ]);
    assert.equal(
      (await prisma.scanJob.findUniqueOrThrow({ where: { id: staleJob.id } })).status,
      "CANCELLED",
    );
    assert.equal(
      (await prisma.scan.findUniqueOrThrow({ where: { id: running.id } })).status,
      "CANCELLED",
    );
    const demo = await enqueueDemoScan(
      `demo-${randomUUID()}`,
      organizationId,
      "round4-correlation",
      "round4-caller",
    );
    assert.equal(demo.requester, "round4-caller");
    assert.equal(scanJobPayloadSchema.parse(demo.payload).requester, "round4-caller");
    await new ConfiguredScanJobExecutor().execute({
      scanId: demo.scanId,
      payload: demo.payload,
      signal: new AbortController().signal,
    });
    const audits = await prisma.auditEvent.findMany({
      where: { organizationId, scanId: demo.scanId },
    });
    assert.ok(audits.some((audit) => audit.action === "SCAN_CREATED"));
    assert.ok(audits.some((audit) => audit.action === "SCAN_COMPLETED"));
    assert.ok(audits.every((audit) => audit.actor === "round4-caller"));
    console.warn(
      "Round 4 PostgreSQL demo attribution passed: persisted queue requester and scan audits identify the caller.",
    );
    console.warn(
      "Phase 1 Round 2 PostgreSQL checks passed: populated upgrade, immutable scan observations, and terminal nonrunning cancellation.",
    );
  } finally {
    if (organizationCreated) {
      await prisma.securityReceipt.deleteMany({ where: { scan: { organizationId } } });
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.policyDecision.deleteMany({ where: { finding: { scan: { organizationId } } } });
      await prisma.remediation.deleteMany({ where: { finding: { scan: { organizationId } } } });
      await prisma.approval.deleteMany({ where: { finding: { scan: { organizationId } } } });
      await prisma.dependency.deleteMany({ where: { scan: { organizationId } } });
      await prisma.finding.deleteMany({ where: { scan: { organizationId } } });
      await prisma.advisory.deleteMany({ where: { organizationId } });
      await prisma.scan.deleteMany({ where: { organizationId } });
      await prisma.repository.deleteMany({ where: { organizationId } });
      await prisma.gitHubInstallation.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  }
}
await main();
