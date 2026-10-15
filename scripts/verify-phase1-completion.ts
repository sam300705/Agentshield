import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  agentSessionResponseSchema,
  dependencySchema,
  scanOptionsSchema,
  securityReceiptSchema,
} from "@agentshield/schemas";
import { verifyReceiptHash, POLICY_RULE_VERSION } from "@agentshield/policy-engine";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";
import {
  createAgentSessionController,
  getAgentSessionController,
  closeAgentSessionController,
} from "../apps/api/src/controllers/sessionLifecycleController.js";
import { authorizeAgentActionController } from "../apps/api/src/controllers/agentGatewayController.js";
import { ingestAgentEvent } from "../apps/api/src/services/agentEventService.js";
import { ensureAgentApproval } from "../apps/api/src/services/agentApprovalService.js";
import {
  runConfiguredScan,
  persistAdvisories,
  consolidateDependencies,
} from "../apps/api/src/services/scanService.js";
import { enqueueDemoScan, processNextScanJob } from "../apps/api/src/services/scanQueue.js";

assertSafeSeedTarget(process.env.NODE_ENV, process.env.DATABASE_URL ?? "");
// An additional explicit opt-in is required for fault injection and seed replacement.
assert.equal(
  process.env.AGENTSHIELD_DISPOSABLE_DATABASE,
  "true",
  "Set AGENTSHIELD_DISPOSABLE_DATABASE=true only for a disposable database.",
);
const db = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const org = `completion-${suffix}`;
const directory = await mkdtemp(path.join(os.tmpdir(), "agentshield-completion-"));
const trigger = `completion_${suffix}`;
type Controller = typeof createAgentSessionController;
type Request = Parameters<Controller>[0];
type Response = Parameters<Controller>[1];
async function invoke(
  controller: Controller,
  body: unknown = {},
  params: Record<string, string> = {},
  actor = "synthetic-actor",
  organizationId = org,
) {
  let status = 200;
  let output: unknown;
  const response = {
    locals: { actor: { id: actor, organizationId, role: "DEVELOPER", demo: false } },
    getHeader: () => "completion-correlation",
    status: (value: number) => {
      status = value;
      return response;
    },
    json: (value: unknown) => {
      output = value;
      return response;
    },
  };
  await controller({ body, params, query: {} } as Request, response as unknown as Response);
  return { status, output };
}
function sessionData(output: unknown) {
  return agentSessionResponseSchema.parse((output as { data: unknown }).data);
}
async function fault(action: string) {
  // Only a generated identifier and this test's organization are interpolated.
  assert.match(action, /^[A-Z_]+$/);
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = '${org}' AND NEW."action"::text = '${action}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
}
try {
  await db.organization.create({
    data: { id: org, slug: org, name: "Synthetic completion regression" },
  });
  const repository = await db.repository.create({
    data: {
      organizationId: org,
      provider: "LOCAL",
      externalId: suffix,
      fullName: "synthetic/completion",
    },
  });
  const input = {
    repositoryId: repository.id,
    source: "synthetic-sdk",
    taskSummary: "Synthetic lifecycle verification",
    idempotencyKey: "create-key",
  };
  const creations = await Promise.all([
    invoke(createAgentSessionController, input),
    invoke(createAgentSessionController, input),
  ]);
  assert.deepEqual(creations.map((r) => r.status).sort(), [200, 201]);
  const session = sessionData(creations[0].output);
  assert.equal(sessionData(creations[1].output).id, session.id);
  assert.equal(
    await db.auditEvent.count({ where: { organizationId: org, action: "SESSION_CREATED" } }),
    1,
  );
  assert.equal(
    (await invoke(createAgentSessionController, { ...input, taskSummary: "Changed context" }))
      .status,
    409,
  );
  assert.equal(
    (
      await invoke(createAgentSessionController, {
        ...input,
        repositoryId: "foreign",
        idempotencyKey: "other",
      })
    ).status,
    404,
  );
  await assert.rejects(invoke(createAgentSessionController, { ...input, actor: "spoofed" }));
  assert.equal(
    (await invoke(getAgentSessionController, {}, { sessionId: session.id }, "different-actor"))
      .status,
    404,
  );
  assert.equal(
    (
      await invoke(
        getAgentSessionController,
        {},
        { sessionId: session.id },
        "synthetic-actor",
        "foreign-tenant",
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(getAgentSessionController, {}, { sessionId: "nonexistent" })).status,
    404,
  );

  await fault("SESSION_CLOSED");
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
  );
  await assert.rejects(invoke(closeAgentSessionController, {}, { sessionId: session.id }));
  assert.equal(
    (await db.agentSession.findUniqueOrThrow({ where: { id: session.id } })).status,
    "ACTIVE",
  );
  await fault("SESSION_CREATED");
  await assert.rejects(
    invoke(createAgentSessionController, { ...input, idempotencyKey: "rollback-create" }),
  );
  assert.equal(
    await db.agentSession.count({
      where: { organizationId: org, idempotencyKey: "rollback-create" },
    }),
    0,
  );
  await fault("DISABLED");
  const event = {
    organizationId: org,
    sessionId: session.id,
    actor: "synthetic-actor",
    source: "synthetic-sdk",
    sequence: 0,
    idempotencyKey: "event-key",
    timestamp: new Date(),
    type: "FILE_READ" as const,
    riskLevel: "LOW" as const,
    summary: "Read public documentation",
    resource: "README.md",
    evidence: {},
    correlationId: "completion-event",
  };
  const [closed, ingested] = await Promise.all([
    invoke(closeAgentSessionController, {}, { sessionId: session.id }),
    ingestAgentEvent(event),
  ]);
  assert.equal(closed.status, 200);
  assert(["CREATED", "SESSION_NOT_FOUND"].includes(ingested.kind));
  assert.equal(
    (await ingestAgentEvent({ ...event, idempotencyKey: "after-close" })).kind,
    "SESSION_NOT_FOUND",
  );
  assert.equal(
    (
      await invoke(authorizeAgentActionController, {
        organizationId: org,
        sessionId: session.id,
        actor: "synthetic-actor",
        action: "READ_FILE",
        resource: "README.md",
        correlationId: "after-close",
        idempotencyKey: "after-close",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await ensureAgentApproval(
        {
          organizationId: org,
          sessionId: session.id,
          actor: "synthetic-actor",
          action: "ACCESS_SECRET",
          resource: ".env",
          correlationId: "after-close",
          idempotencyKey: "after-close",
        },
        "after-close",
      )
    ).kind,
    "SESSION_NOT_FOUND",
  );
  const closedAgain = sessionData(
    (await invoke(closeAgentSessionController, {}, { sessionId: session.id })).output,
  );
  assert.equal(closedAgain.status, "COMPLETED");
  assert.equal(
    await db.auditEvent.count({ where: { organizationId: org, action: "SESSION_CLOSED" } }),
    1,
  );
  assert.equal(
    sessionData((await invoke(createAgentSessionController, input)).output).status,
    "COMPLETED",
  );

  const raceSession = sessionData(
    (
      await invoke(createAgentSessionController, {
        ...input,
        idempotencyKey: "approval-close-race",
      })
    ).output,
  );
  const protectedAction = {
    organizationId: org,
    sessionId: raceSession.id,
    actor: "synthetic-actor",
    action: "ACCESS_SECRET" as const,
    resource: ".env",
    correlationId: "closure-race",
    idempotencyKey: "closure-race",
  };
  const [raceClose, raceApproval, raceAuthorization] = await Promise.all([
    invoke(closeAgentSessionController, {}, { sessionId: raceSession.id }),
    ensureAgentApproval(protectedAction, "closure-race"),
    invoke(authorizeAgentActionController, {
      ...protectedAction,
      action: "READ_FILE",
      resource: "README.md",
    }),
  ]);
  assert.equal(raceClose.status, 200);
  assert(["CREATED", "SESSION_NOT_FOUND"].includes(raceApproval.kind));
  assert([200, 404].includes(raceAuthorization.status));
  const approvalsBefore = await db.agentApproval.count({ where: { sessionId: raceSession.id } });
  assert.equal(
    (
      await ensureAgentApproval(
        { ...protectedAction, idempotencyKey: "post-close-new" },
        "closure-race",
      )
    ).kind,
    "SESSION_NOT_FOUND",
  );
  assert.equal(
    await db.agentApproval.count({ where: { sessionId: raceSession.id } }),
    approvalsBefore,
  );

  // Distinct credential-bearing versions collapse only after redaction.
  const versionA = "git+https://fixture-a:fixture-password-a@example.test/repo.git";
  const versionB = "git+https://fixture-b:fixture-password-b@example.test/repo.git";
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "synthetic",
      version: "1.0.0",
      dependencies: { alpha: versionA },
      devDependencies: { alpha: versionB },
    }),
  );
  const scanId = await runConfiguredScan({
    source: "MANUAL",
    targetPath: directory,
    targetPathLabel: "synthetic-completion",
    repositoryName: "synthetic/completion",
    branch: "main",
    organizationId: org,
    triggeredBy: "synthetic-actor",
    correlationId: "completion-scan",
    labels: ["synthetic"],
    policyBundleVersion: POLICY_RULE_VERSION,
    options: scanOptionsSchema.parse({}),
  });
  const dependencies = await db.dependency.findMany({ where: { scanId } });
  assert.equal(dependencies.length, 1);
  assert.equal(dependencies[0]!.scope, "PRODUCTION");
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId } });
  assert.equal(
    (scan.metadata as { aggregateCounts: { dependencies: number } }).aggregateCounts.dependencies,
    1,
  );
  const serialized = JSON.stringify(dependencies);
  assert(!serialized.includes("fixture-password"));
  assert(!serialized.includes("fixture-a"));
  const storedReceipt = await db.securityReceipt.findUniqueOrThrow({ where: { scanId } });
  assert.equal(storedReceipt.signature, null);
  const receipt = securityReceiptSchema.parse(storedReceipt.signedPayload);
  assert(receipt.coverage);
  assert(verifyReceiptHash(receipt));
  assert(
    !verifyReceiptHash({ ...receipt, coverage: { ...receipt.coverage, excludedEntries: 99 } }),
  );
  const original = dependencySchema.parse({ ...dependencies[0]!, version: versionA });
  const consolidated = consolidateDependencies([original]);
  await db.$transaction((tx) =>
    persistAdvisories(tx, org, scanId, consolidated, [
      {
        packageName: "alpha",
        version: versionA,
        packageManager: "NPM",
        advisories: [
          {
            advisoryId: "SYNTHETIC-1",
            aliases: [],
            severity: "HIGH",
            fixedVersions: ["2.0.0"],
            match: "CONFIRMED",
            matchReason: "Synthetic exact match",
            summary: "Synthetic advisory",
            references: [],
          },
        ],
      },
    ]),
  );
  assert.equal(
    (await db.advisory.findFirstOrThrow({ where: { scanId } })).dependencyId,
    dependencies[0]!.id,
  );

  const job = await enqueueDemoScan(`retry-${suffix}`, org, "retry-correlation", "synthetic-actor");
  await db.scanJob.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      attempts: 1,
      failureCode: "SYNTHETIC_FAILURE",
      failureMessage: "https://fixture:fixture-password@example.test/error",
    },
  });
  const executor = { execute: () => Promise.resolve(scanId) };
  await fault("SCAN_ATTEMPT_ARCHIVED");
  await assert.rejects(processNextScanJob("rollback-worker", executor));
  assert.equal((await db.scanJob.findUniqueOrThrow({ where: { id: job.id } })).attempts, 1);
  await fault("DISABLED");
  await Promise.all([
    processNextScanJob("claimer-a", executor),
    processNextScanJob("claimer-b", executor),
  ]);
  const archived = await db.auditEvent.findMany({
    where: { organizationId: org, entityId: job.id, action: "SCAN_ATTEMPT_ARCHIVED" },
  });
  assert.equal(archived.length, 1);
  assert.equal(archived[0]!.actor, "synthetic-actor");
  assert.equal(archived[0]!.scanId, job.scanId);
  assert.equal(archived[0]!.correlationId, "retry-correlation");
  assert(!JSON.stringify(archived).includes("fixture-password"));
  assert.equal((await db.scanJob.findUniqueOrThrow({ where: { id: job.id } })).failureCode, null);

  // Importing helpers must not execute the CLI or create a client with side effects.
  const beforeImport = await db.scan.count();
  const { seedDemoData } = await import("../prisma/seed.js");
  assert.equal(await db.scan.count(), beforeImport);
  await db.organization.upsert({
    where: { id: "demo-organization" },
    update: {},
    create: { id: "demo-organization", slug: "demo-organization", name: "Synthetic demo tenant" },
  });
  const customer = await db.scan.create({
    data: {
      organizationId: "demo-organization",
      repositoryName: `synthetic-customer-${suffix}`,
      branch: "main",
      metadata: { owner: "synthetic-customer" },
    },
  });
  const customerAudit = await db.auditEvent.create({
    data: {
      organizationId: "demo-organization",
      actor: "synthetic-customer",
      action: "SCAN_CREATED",
      entityType: "Scan",
      entityId: customer.id,
      scanId: customer.id,
      metadata: { synthetic: true },
    },
  });
  const customerReceipt = await db.securityReceipt.create({
    data: {
      scanId: customer.id,
      scannerVersion: "synthetic",
      policyBundleVersion: "synthetic",
      findingCounts: {},
      decisionCounts: {},
      approvalState: "NONE",
      evidenceDigest: "a".repeat(64),
      gateResult: "ALLOW",
      receiptHash: suffix.padEnd(64, "0"),
    },
  });
  const customerBefore = await db.scan.findUniqueOrThrow({ where: { id: customer.id } });
  await seedDemoData(db);
  const seededBefore = await db.scan.findMany({
    where: {
      organizationId: "demo-organization",
      metadata: { path: ["labels"], array_contains: ["phase-2-seed"] },
    },
  });
  const seededIds = seededBefore.map((s) => s.id);
  const childrenBefore = {
    findings: await db.finding.findMany({
      where: { scanId: { in: seededIds } },
      orderBy: { id: "asc" },
    }),
    dependencies: await db.dependency.findMany({
      where: { scanId: { in: seededIds } },
      orderBy: { id: "asc" },
    }),
    audits: await db.auditEvent.findMany({
      where: { scanId: { in: seededIds } },
      orderBy: { id: "asc" },
    }),
  };
  await assert.rejects(seedDemoData(db, () => Promise.reject(new Error("synthetic rollback"))));
  assert.deepEqual(
    await db.scan.findMany({ where: { id: { in: seededBefore.map((s) => s.id) } } }),
    seededBefore,
  );
  assert.deepEqual(
    {
      findings: await db.finding.findMany({
        where: { scanId: { in: seededIds } },
        orderBy: { id: "asc" },
      }),
      dependencies: await db.dependency.findMany({
        where: { scanId: { in: seededIds } },
        orderBy: { id: "asc" },
      }),
      audits: await db.auditEvent.findMany({
        where: { scanId: { in: seededIds } },
        orderBy: { id: "asc" },
      }),
    },
    childrenBefore,
  );
  await Promise.all([seedDemoData(db), seedDemoData(db)]);
  assert.equal(
    await db.scan.count({
      where: {
        organizationId: "demo-organization",
        metadata: { path: ["labels"], array_contains: ["phase-2-seed"] },
      },
    }),
    1,
  );
  assert.deepEqual(await db.scan.findUniqueOrThrow({ where: { id: customer.id } }), customerBefore);
  assert.deepEqual(
    await db.auditEvent.findUnique({ where: { id: customerAudit.id } }),
    customerAudit,
  );
  assert.deepEqual(
    await db.securityReceipt.findUnique({ where: { id: customerReceipt.id } }),
    customerReceipt,
  );
  await db.securityReceipt.delete({ where: { id: customerReceipt.id } });
  await db.auditEvent.delete({ where: { id: customerAudit.id } });
  await db.scan.delete({ where: { id: customer.id } });
  console.warn(
    "Phase 1 real PostgreSQL completion regressions passed: lifecycle ownership/replay/concurrency/audit rollback/closure ordering, collision consolidation/advisory identity/counts, coverage receipts, retry history/claim race/rollback, seed import/preservation/rollback/serialization.",
  );
} finally {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditEvent"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
  await db.advisory.deleteMany({ where: { organizationId: org } });
  await db.securityReceipt.deleteMany({ where: { scan: { organizationId: org } } });
  await db.auditEvent.deleteMany({ where: { organizationId: org } });
  await db.scan.deleteMany({ where: { organizationId: org } });
  await db.organization.deleteMany({ where: { id: org } });
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
