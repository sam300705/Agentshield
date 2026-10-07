import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import express from "express";
import { createServer } from "../server.js";
import { prisma } from "../db/prisma.js";
import {
  enqueueRepositoryScan,
  processNextScanJob,
  recoverAbandonedJobs,
  requestJobCancellation,
  renewScanJobLease,
} from "../services/scanQueue.js";
import { runConfiguredScan } from "../services/scanService.js";
import { ConfiguredScanJobExecutor } from "../services/scanJobExecutor.js";
import { ensureAgentApproval, reviewAgentApproval } from "../services/agentApprovalService.js";
import {
  sanitizeText,
  scanOptionsSchema,
  type AgentAuthorizationRequest,
} from "@agentshield/schemas";

const suffix = randomUUID();
const orgA = `security-a-${suffix}`,
  orgB = `security-b-${suffix}`;
const actor = `developer-${suffix}`,
  reviewer = `reviewer-${suffix}`;
const repoA = `repo-a-${suffix}`,
  repoB = `repo-b-${suffix}`,
  sessionA = `session-${suffix}`;
const correlationId = `security-${suffix}`;
const secret = ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("");
const observer = new PrismaClient();
let api: Server | undefined, jwks: Server | undefined;
let checks = 0;
function pass(name: string) {
  checks++;
  console.warn(`PASS backend-security: ${name}`);
}
async function listen(app: ReturnType<typeof express>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function url(server: Server): string {
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server | undefined) {
  if (server != null)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
}
const request = {
  repositoryId: repoA,
  ref: "main",
  policyBundleVersion: "test",
  options: scanOptionsSchema.parse({}),
};
async function queue(key: string) {
  return enqueueRepositoryScan(request, `${suffix}-${key}`, orgA, actor, correlationId);
}
async function state(id: string) {
  return prisma.scanJob.findUniqueOrThrow({ where: { id }, include: { scan: true } });
}

async function main() {
  await prisma.organization.createMany({
    data: [
      { id: orgA, slug: orgA, name: "Security test A" },
      { id: orgB, slug: orgB, name: "Security test B" },
    ],
  });
  await prisma.repository.createMany({
    data: [
      {
        id: repoA,
        organizationId: orgA,
        provider: "LOCAL",
        externalId: repoA,
        fullName: "security/a",
      },
      {
        id: repoB,
        organizationId: orgB,
        provider: "LOCAL",
        externalId: repoB,
        fullName: "security/b",
      },
    ],
  });
  await prisma.agentSession.create({
    data: {
      id: sessionA,
      organizationId: orgA,
      repositoryId: repoA,
      actor,
      source: "test",
      taskSummary: "Security integration",
      correlationId,
    },
  });

  const pair = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: suffix, alg: "RS256", use: "sig" };
  const keyApp = express();
  keyApp.get("/jwks", (_req, res) => res.json({ keys: [publicJwk] }));
  jwks = await listen(keyApp);
  const issuer = url(jwks);
  Object.assign(process.env, {
    NODE_ENV: "test",
    AUTH_MODE: "oidc",
    DEMO_AUTH_ENABLED: "false",
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: "backend-security",
    OIDC_JWKS_URL: `${issuer}/jwks`,
    RATE_LIMIT_ENABLED: "false",
    GITHUB_WEBHOOK_ENABLED: "false",
    GITHUB_SCAN_LIFECYCLE_ENABLED: "false",
    GITHUB_MATERIALIZATION_ENABLED: "false",
  });
  api = await listen(createServer());
  async function token(org = orgA, role = "DEVELOPER", subject = actor) {
    return new SignJWT({ organization_id: org, role })
      .setProtectedHeader({ alg: "RS256", kid: suffix })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience("backend-security")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  }
  async function call(
    path: string,
    options: {
      org?: string;
      role?: string;
      subject?: string;
      method?: string;
      body?: unknown;
      key?: string;
      authorization?: string;
    } = {},
  ) {
    const authorization =
      options.authorization ?? `Bearer ${await token(options.org, options.role, options.subject)}`;
    const response = await fetch(`${url(api!)}${path}`, {
      method: options.method ?? "GET",
      headers: {
        authorization,
        "content-type": "application/json",
        ...(options.key == null ? {} : { "idempotency-key": options.key }),
      },
      ...(options.body == null ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    assert(!text.includes(secret), "Raw secret leaked through API");
    return {
      status: response.status,
      body: JSON.parse(text) as { data?: unknown[]; error?: { code: string } },
    };
  }
  assert.equal((await call("/api/v1/scans", { authorization: "Bearer invalid" })).status, 401);
  assert.equal(
    (await call("/api/v1/scans", { method: "POST", role: "VIEWER", body: request })).status,
    403,
  );
  assert.equal((await call("/api/audit-events", { role: "VIEWER" })).status, 403);
  assert.equal(
    (
      await call("/api/v1/scans", {
        method: "POST",
        body: { ...request, organizationId: orgB, actor: "impersonator" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/api/v1/scans", { method: "POST", body: request, key: "bad" })).status,
    400,
  );
  assert.equal((await call("/api/v1/scans?limit=101")).status, 400);
  assert.equal((await call("/api/v1/scans?page=9007199254740991")).status, 400);
  assert.equal((await call("/api/v1/demo/control-plane")).status, 403);
  assert.equal((await call("/api/scans/run-demo", { method: "POST", body: {} })).status, 403);
  pass("OIDC verification, RBAC, impersonation, input bounds, demo isolation");

  const concurrent = await Promise.all([queue("concurrent"), queue("concurrent")]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  const job = concurrent[0];
  assert.equal(await prisma.scan.count({ where: { id: job.scanId } }), 1);
  await assert.rejects(
    enqueueRepositoryScan(
      { ...request, ref: "changed" },
      `${suffix}-concurrent`,
      orgA,
      actor,
      correlationId,
    ),
  );
  await assert.rejects(
    enqueueRepositoryScan(
      { ...request, repositoryId: repoB },
      `${suffix}-foreign`,
      orgA,
      actor,
      correlationId,
    ),
  );
  assert.equal(
    await prisma.scanJob.count({
      where: { idempotencyKey: JSON.stringify([orgA, `${suffix}-foreign`]) },
    }),
    0,
  );
  assert.equal(
    await prisma.auditEvent.count({ where: { scanId: job.scanId, action: "SCAN_CREATED" } }),
    1,
  );
  assert.equal(
    (await observer.scan.findUniqueOrThrow({ where: { id: job.scanId } })).status,
    "QUEUED",
  );
  pass("concurrent idempotent enqueue, scan+job+audit atomicity, separate-client durability");

  // Optional blank values from .env.example must mean signing is disabled.
  process.env.RECEIPT_SIGNING_PRIVATE_KEY = " ";
  process.env.RECEIPT_SIGNING_KEY_ID = "";
  // A real scan exercises scanner -> policy -> remediation -> approval -> receipt persistence.
  const executor = new ConfiguredScanJobExecutor({
    prepare: () =>
      Promise.resolve({
        path: new URL("../../../../examples/vulnerable-repo", import.meta.url).pathname,
        cleanup: () => Promise.resolve(),
      }),
  });
  let executions = 0;
  const counting = {
    execute: async (input: Parameters<typeof executor.execute>[0]) => {
      executions++;
      try {
        return await executor.execute(input);
      } catch (error) {
        console.warn(
          "Sanitized synthetic execution diagnostic:",
          sanitizeText(error instanceof Error ? error.message : "Unknown execution error").slice(
            0,
            1_000,
          ),
        );
        throw error;
      }
    },
  };
  await Promise.all([
    processNextScanJob("claim-a", counting),
    processNextScanJob("claim-b", counting),
  ]);
  assert.equal(executions, 1);
  assert.equal((await state(job.id)).status, "COMPLETED");
  assert.equal((await state(job.id)).scan.status, "COMPLETED");
  const findings = await prisma.finding.findMany({
    where: { scanId: job.scanId },
    include: { policyDecision: true, remediation: true, approval: true },
  });
  assert(findings.length > 0);
  assert(findings.every((f) => f.policyDecision != null));
  assert(findings.some((f) => f.remediation != null));
  assert((await prisma.dependency.count({ where: { scanId: job.scanId } })) > 0);
  assert(await observer.securityReceipt.findUnique({ where: { scanId: job.scanId } }));
  await assert.rejects(
    runConfiguredScan(
      {
        source: "MANUAL",
        targetPath: ".",
        targetPathLabel: "test",
        repositoryName: "test",
        branch: "main",
        organizationId: orgA,
        correlationId,
        triggeredBy: actor,
        labels: [],
        policyBundleVersion: "test",
        options: request.options,
      },
      job.scanId,
    ),
  );
  assert.equal(await requestJobCancellation(job.id, orgA, actor, correlationId), false);
  pass("two-worker single claim, complete evidence/receipt, terminal transition guard");

  for (const path of [
    `/api/v1/scans/${job.scanId}`,
    `/api/v1/scans/${job.scanId}/progress`,
    `/api/v1/receipts/${job.scanId}`,
  ])
    assert.equal((await call(path, { org: orgB })).status, 404, path);
  for (const path of [`/api/v1/scans/${job.scanId}/findings`, `/api/v1/scans/${job.scanId}/sbom`])
    assert.deepEqual((await call(path, { org: orgB })).body.data, []);
  assert.equal(
    (await call(`/api/v1/scans/${job.scanId}/cancel`, { org: orgB, method: "POST", body: {} }))
      .status,
    404,
  );
  assert.equal(
    (await call("/api/v1/scans", { org: orgB, method: "POST", body: request })).status,
    404,
  );
  const repos = (await call("/api/v1/repositories", { org: orgB })).body.data! as { id: string }[];
  assert(repos.every((r) => r.id !== repoA));
  pass(
    "direct-ID tenant isolation for scans/jobs/findings/decisions/remediation/dependencies/receipts/repositories",
  );

  const findingApproval = findings.find((f) => f.approval != null)?.approval;
  assert(findingApproval);
  const reviewPath = `/api/approvals/${findingApproval.id}`;
  assert.equal(
    (
      await call(`${reviewPath}/approve`, {
        org: orgB,
        role: "SECURITY_REVIEWER",
        subject: reviewer,
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(`${reviewPath}/approve`, { role: "DEVELOPER", method: "POST", body: {} })).status,
    403,
  );
  assert.equal(
    (await call(`${reviewPath}/approve`, { role: "SECURITY_REVIEWER", method: "POST", body: {} }))
      .status,
    403,
  );
  const reviews = await Promise.all([
    call(`${reviewPath}/approve`, {
      role: "SECURITY_REVIEWER",
      subject: reviewer,
      method: "POST",
      body: { reason: secret },
    }),
    call(`${reviewPath}/reject`, {
      role: "SECURITY_REVIEWER",
      subject: reviewer,
      method: "POST",
      body: { reason: secret },
    }),
  ]);
  assert.deepEqual(reviews.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await call(`${reviewPath}/reject`, {
        role: "SECURITY_REVIEWER",
        subject: reviewer,
        method: "POST",
        body: {},
      })
    ).status,
    409,
  );
  assert.equal(
    await prisma.auditEvent.count({
      where: { entityId: findingApproval.id, action: "APPROVAL_UPDATED" },
    }),
    1,
  );
  assert.equal(
    (await prisma.approval.findUniqueOrThrow({ where: { id: findingApproval.id } })).reviewedBy,
    reviewer,
  );
  pass("finding approval RBAC, separation of duties, concurrent approve/reject, one durable audit");

  const approvalInput: AgentAuthorizationRequest = {
    organizationId: orgA,
    sessionId: sessionA,
    actor,
    action: "RUN_COMMAND",
    resource: "workspace",
    correlationId,
    idempotencyKey: `approval-${suffix}`,
  };
  const approval = await ensureAgentApproval(approvalInput, correlationId);
  assert("approval" in approval);
  assert.equal(
    (await call(`/api/v1/agent/approvals/${approval.approval.id}`, { org: orgB })).status,
    404,
  );
  // Inject an audit write failure only for this synthetic approval, then verify the
  // real review transaction rolls back its decision. Always remove the test trigger.
  const guard = `security_audit_${suffix.replaceAll("-", "")}`;
  assert(/^[a-z0-9_]+$/.test(guard));
  assert(/^[a-zA-Z0-9_-]+$/.test(approval.approval.id));
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION "${guard}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END; $$`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${guard}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW WHEN (NEW."entityId" = '${approval.approval.id}') EXECUTE FUNCTION "${guard}"()`,
    );
    await assert.rejects(
      reviewAgentApproval(
        orgA,
        approval.approval.id,
        "APPROVED",
        reviewer,
        undefined,
        correlationId,
      ),
    );
    assert.equal(
      (await observer.agentApproval.findUniqueOrThrow({ where: { id: approval.approval.id } }))
        .status,
      "PENDING",
    );
    assert.equal(
      await observer.auditEvent.count({
        where: { entityId: approval.approval.id, action: "APPROVAL_UPDATED" },
      }),
      0,
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${guard}" ON "AuditEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${guard}"()`);
  }
  pass("actual approval decision rollback when its audit insert fails");
  const agentReviews = await Promise.all([
    reviewAgentApproval(orgA, approval.approval.id, "APPROVED", reviewer, secret, correlationId),
    reviewAgentApproval(
      orgA,
      approval.approval.id,
      "REJECTED",
      "second-reviewer",
      secret,
      correlationId,
    ),
  ]);
  assert.equal(agentReviews.filter((r) => r.kind === "UPDATED").length, 1);
  assert.equal(agentReviews.filter((r) => r.kind === "CONFLICT").length, 1);
  assert.equal(
    (
      await reviewAgentApproval(
        orgB,
        approval.approval.id,
        "APPROVED",
        reviewer,
        undefined,
        correlationId,
      )
    ).kind,
    "NOT_FOUND",
  );
  assert.equal(
    (
      await call("/api/v1/agent/events", {
        method: "POST",
        body: {
          organizationId: orgB,
          sessionId: sessionA,
          actor,
          sequence: 0,
          idempotencyKey: "test-event",
          timestamp: new Date(),
          source: "test",
          type: "SHELL_COMMAND",
          riskLevel: "HIGH",
          summary: "test",
          evidence: {},
          correlationId,
        },
      })
    ).status,
    403,
  );
  pass("agent approval race, tenant isolation, event impersonation");

  const cancelled = await queue("cancelled");
  assert(await requestJobCancellation(cancelled.id, orgA, actor, correlationId));
  assert.equal((await state(cancelled.id)).scan.status, "CANCELLED");
  assert.equal(await processNextScanJob("cancel-check", counting), false);
  const failing = await queue("retry");
  await prisma.scanJob.update({ where: { id: failing.id }, data: { maxAttempts: 2 } });
  const failingExecutor = {
    execute: () => Promise.reject(new Error(secret)),
  };
  await processNextScanJob("failure", failingExecutor);
  let failure = await state(failing.id);
  assert.equal(failure.attempts, 1);
  assert(failure.nextAttemptAt);
  assert.equal(failure.deadLetteredAt, null);
  assert.equal(await processNextScanJob("too-soon", failingExecutor), false);
  await prisma.scanJob.update({ where: { id: failing.id }, data: { nextAttemptAt: new Date(0) } });
  await processNextScanJob("failure", failingExecutor);
  failure = await state(failing.id);
  assert.equal(failure.attempts, 2);
  assert(failure.deadLetteredAt);
  assert.equal(failure.nextAttemptAt, null);
  assert.equal(await processNextScanJob("exhausted", failingExecutor), false);
  pass("queued cancellation, bounded retry delay, exhaustion never reclaimed, opaque failures");

  const stale = await queue("stale");
  await prisma.scanJob.update({
    where: { id: stale.id },
    data: {
      status: "RUNNING",
      attempts: 1,
      lockedAt: new Date(0),
      lockedBy: "old-worker",
      leaseExpiresAt: new Date(0),
    },
  });
  await prisma.scan.update({ where: { id: stale.scanId }, data: { status: "RUNNING" } });
  assert.equal(await renewScanJobLease(stale.id, "old-worker"), false);
  assert.equal(await recoverAbandonedJobs(), 1);
  assert.equal((await state(stale.id)).status, "FAILED");
  await processNextScanJob("recovered", counting);
  assert.equal((await state(stale.id)).status, "COMPLETED");
  pass("expired lease cannot renew, stale recovery and next worker complete durably");

  const abandonedFinal = await queue("abandoned-final");
  await prisma.scanJob.update({
    where: { id: abandonedFinal.id },
    data: {
      status: "RUNNING",
      attempts: 3,
      lockedAt: new Date(0),
      lockedBy: "final-worker",
      leaseExpiresAt: new Date(0),
    },
  });
  await prisma.scan.update({ where: { id: abandonedFinal.scanId }, data: { status: "RUNNING" } });
  assert.equal(await recoverAbandonedJobs(), 1);
  assert((await state(abandonedFinal.id)).deadLetteredAt);
  assert.equal(await processNextScanJob("abandoned-exhausted", counting), false);
  pass("final abandoned attempt becomes terminal and is never retried");

  const fenced = await queue("fenced");
  let entered!: () => void, release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stalled = new ConfiguredScanJobExecutor({
    prepare: async () => {
      entered();
      await gate;
      return {
        path: new URL("../../../../examples/vulnerable-repo", import.meta.url).pathname,
        cleanup: () => Promise.resolve(),
      };
    },
  });
  const oldWorker = processNextScanJob("old-fenced", stalled);
  await enteredPromise;
  const oldState = await state(fenced.id);
  assert(oldState.lockedBy);
  assert(await renewScanJobLease(fenced.id, oldState.lockedBy));
  assert.equal(await recoverAbandonedJobs(), 0);
  await prisma.scanJob.update({ where: { id: fenced.id }, data: { leaseExpiresAt: new Date(0) } });
  assert.equal(await recoverAbandonedJobs(), 1);
  await processNextScanJob("new-fenced", counting);
  release();
  await oldWorker;
  assert.equal((await state(fenced.id)).status, "COMPLETED");
  assert.equal((await state(fenced.id)).attempts, 2);
  assert.equal(await renewScanJobLease(fenced.id, oldState.lockedBy), false);
  assert.equal(
    await prisma.auditEvent.count({ where: { scanId: fenced.scanId, action: "SCAN_COMPLETED" } }),
    1,
  );
  pass("old worker completion fenced after real overlapping recovery and newer completion");

  const runningCancel = await queue("running-cancel");
  let runningEntered!: () => void, runningRelease!: () => void;
  const runningStart = new Promise<void>((resolve) => {
    runningEntered = resolve;
  });
  const runningGate = new Promise<void>((resolve) => {
    runningRelease = resolve;
  });
  const cancellable = new ConfiguredScanJobExecutor({
    prepare: async () => {
      runningEntered();
      await runningGate;
      return {
        path: new URL("../../../../examples/vulnerable-repo", import.meta.url).pathname,
        cleanup: () => Promise.resolve(),
      };
    },
  });
  const runningWorker = processNextScanJob("running-cancel", cancellable);
  await runningStart;
  assert(await requestJobCancellation(runningCancel.id, orgA, actor, correlationId));
  runningRelease();
  await runningWorker;
  assert.equal((await state(runningCancel.id)).status, "CANCELLED");
  assert.equal((await state(runningCancel.id)).scan.status, "CANCELLED");
  assert.equal(await prisma.finding.count({ where: { scanId: runningCancel.scanId } }), 0);
  pass("running cancellation prevents evidence publication");

  await assert.rejects(
    prisma.scan.create({
      data: {
        organizationId: orgB,
        repositoryId: repoA,
        repositoryName: "foreign",
        branch: "main",
      },
    }),
  );
  await assert.rejects(
    prisma.agentApproval.create({
      data: {
        organizationId: orgB,
        sessionId: sessionA,
        actor,
        actionType: "RUN_COMMAND",
        actionDigest: "test",
        requestedBy: actor,
        correlationId,
        idempotencyKey: suffix,
      },
    }),
  );
  pass("database rejects cross-tenant parent links independently of controller validation");

  // Receipt signing misconfiguration fails after evidence writes, proving transaction rollback.
  const rollback = await queue("rollback");
  process.env.RECEIPT_SIGNING_PRIVATE_KEY = "synthetic-incomplete-key";
  delete process.env.RECEIPT_SIGNING_KEY_ID;
  await processNextScanJob("rollback", counting);
  delete process.env.RECEIPT_SIGNING_PRIVATE_KEY;
  assert.equal(await prisma.finding.count({ where: { scanId: rollback.scanId } }), 0);
  assert.equal(await prisma.dependency.count({ where: { scanId: rollback.scanId } }), 0);
  assert.equal(
    await prisma.auditEvent.count({ where: { scanId: rollback.scanId, action: "SCAN_COMPLETED" } }),
    0,
  );
  assert.equal(await prisma.securityReceipt.count({ where: { scanId: rollback.scanId } }), 0);
  assert.equal((await state(rollback.id)).status, "FAILED");
  await requestJobCancellation(rollback.id, orgA, actor, correlationId);
  pass("evidence+receipt+completion rollback on actual database transaction failure");

  const durable = JSON.stringify(
    await observer.scan.findMany({
      where: { organizationId: orgA },
      include: {
        findings: { include: { approval: true, remediation: true, policyDecision: true } },
        auditEvents: true,
        job: true,
        receipt: true,
      },
    }),
  );
  assert(!durable.includes(secret));
  assert(
    !JSON.stringify(
      await observer.agentApproval.findMany({ where: { organizationId: orgA } }),
    ).includes(secret),
  );
  const auditB = (
    await call("/api/audit-events", { org: orgB, role: "SECURITY_REVIEWER", subject: reviewer })
  ).body.data!;
  assert.equal(auditB.length, 0);
  pass("no raw secrets in database/API/audit/receipt, tenant audit isolation");
  console.warn(`Backend security integration passed (${checks} groups).`);
}
try {
  await main();
} finally {
  await close(api);
  await close(jwks);
  // Only remove this run's synthetic tenants; no reset of seeded or other data.
  const scans = await prisma.scan.findMany({
    where: { organizationId: { in: [orgA, orgB] } },
    select: { id: true },
  });
  await prisma.securityReceipt.deleteMany({ where: { scanId: { in: scans.map((s) => s.id) } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.scan.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await observer.$disconnect();
  await prisma.$disconnect();
}
