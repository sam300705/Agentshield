import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { agentEventSchema } from "@agentshield/schemas";
import { verifyIntegrityChain } from "@agentshield/policy-engine";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";
import { ingestAgentEvent } from "../apps/api/src/services/agentEventService.js";
import {
  enqueueDemoScan,
  processNextScanJob,
  recoverAbandonedJobs,
} from "../apps/api/src/services/scanQueue.js";
assertSafeSeedTarget(process.env.NODE_ENV, process.env.DATABASE_URL ?? "");
assert.equal(process.env.AGENTSHIELD_DISPOSABLE_DATABASE, "true");
const db = new PrismaClient();
const tag = randomUUID().replaceAll("-", "");
const org = `review-regression-${tag}`,
  actor = `actor-${tag}`,
  session = `session-${tag}`;
try {
  await db.organization.create({
    data: { id: org, slug: org, name: "Synthetic review regressions" },
  });
  const repository = await db.repository.create({
    data: {
      organizationId: org,
      provider: "LOCAL",
      externalId: tag,
      fullName: "synthetic/review-regression",
    },
  });
  await db.agentSession.create({
    data: {
      id: session,
      organizationId: org,
      repositoryId: repository.id,
      actor,
      source: "test",
      taskSummary: "Source and lease regression",
      correlationId: tag,
    },
  });
  if (!process.argv.includes("--expiry")) {
    const canary = `synthetic-private-source-${tag}`;
    const event = {
      organizationId: org,
      sessionId: session,
      sequence: 0,
      idempotencyKey: `event-${tag}`,
      timestamp: new Date(),
      actor,
      source: `Bearer ${canary}`,
      type: "SHELL_COMMAND" as const,
      riskLevel: "HIGH" as const,
      summary: "Synthetic source boundary",
      evidence: {},
      correlationId: tag,
    };
    const created = await ingestAgentEvent(event);
    assert.equal(created.kind, "CREATED");
    const row = await db.agentEvent.findFirstOrThrow({ where: { sessionId: session } });
    assert(!row.source.includes(canary), "Credential canary in event source must not persist");
    assert(row.rawPayloadHash);
    assert.equal((await ingestAgentEvent(event)).kind, "EXISTING");
    assert.equal(
      (await ingestAgentEvent({ ...event, source: `Bearer different-${canary}` })).kind,
      "IDEMPOTENCY_CONFLICT",
    );
    assert(
      verifyIntegrityChain([
        agentEventSchema.parse({
          id: row.id,
          sessionId: row.sessionId,
          sequence: row.sequence,
          timestamp: row.timestamp,
          actor: row.actor,
          source: row.source,
          type: row.type,
          riskLevel: row.riskLevel,
          summary: row.summary,
          evidence: row.evidence,
          correlationId: row.correlationId,
          integrity: {
            algorithm: "sha256",
            previousHash: row.previousHash,
            eventHash: row.eventHash,
          },
        }),
      ]),
    );
    console.warn(
      "PASS persisted event source is sanitized before integrity hashing; raw-input replay remains exact.",
    );
  }
  if (!process.argv.includes("--source")) {
    for (const concurrentRecovery of [false, true]) {
      const job = await enqueueDemoScan(`expired-${concurrentRecovery}-${tag}`, org, tag, actor);
      await db.scanJob.update({ where: { id: job.id }, data: { maxAttempts: 1 } });
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const worker = processNextScanJob("expired-invocation", {
        execute: async (input) => {
          assert.equal(input.scanId, job.scanId);
          entered();
          await gate;
          throw new Error("EXPIRED_WORKER_MUST_NOT_FINALIZE");
        },
      });
      try {
        await started;
        await db.scanJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
        release();
        if (concurrentRecovery) await Promise.all([worker, recoverAbandonedJobs()]);
        else {
          await worker;
          const unchanged = await db.scanJob.findUniqueOrThrow({ where: { id: job.id } });
          assert.equal(
            unchanged.status,
            "RUNNING",
            "Expired failure finalizer must leave the job for recovery",
          );
          assert.equal(unchanged.failureCode, null);
          await recoverAbandonedJobs();
        }
        const recovered = await db.scanJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(recovered.failureCode, "MAX_ATTEMPTS_EXCEEDED");
        assert(recovered.deadLetteredAt);
        assert(!JSON.stringify(recovered).includes("EXPIRED_WORKER_MUST_NOT_FINALIZE"));
        assert.equal(
          await db.auditEvent.count({ where: { entityId: job.id, action: "SCAN_FAILED" } }),
          0,
        );
      } finally {
        release();
        await worker;
      }
    }
    console.warn(
      "PASS expired failure cannot finalize before or concurrently with actual recovery.",
    );
  }
} finally {
  const scans = await db.scan.findMany({ where: { organizationId: org }, select: { id: true } });
  await db.securityReceipt.deleteMany({ where: { scanId: { in: scans.map((item) => item.id) } } });
  await db.auditEvent.deleteMany({ where: { organizationId: org } });
  await db.scan.deleteMany({ where: { organizationId: org } });
  await db.organization.deleteMany({ where: { id: org } });
  await db.$disconnect();
}
