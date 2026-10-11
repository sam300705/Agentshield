import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { assertScanLease } from "../apps/api/src/services/scanService.js";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";

// Database-backed verification is intentionally restricted to disposable local CI targets.
assertSafeSeedTarget(process.env.NODE_ENV, process.env.DATABASE_URL_UNPOOLED ?? "");
const db = new PrismaClient();
const tag = randomUUID();
const scan = await db.scan.create({
  data: { repositoryName: "synthetic/lease-" + tag, branch: "main", status: "RUNNING" },
});
try {
  await db.scanJob.create({
    data: {
      scanId: scan.id,
      idempotencyKey: "lease-" + tag,
      repositoryRef: "synthetic/" + tag,
      policyBundleVersion: "2026.06.0",
      requester: "lease-test",
      correlationId: "lease-" + tag,
      status: "RUNNING",
      lockedBy: "worker-original",
      attempts: 1,
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });

  let releaseLock: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { releaseLock = resolve; });
  let announceLock: () => void = () => undefined;
  const locked = new Promise<void>((resolve) => { announceLock = resolve; });

  // Worker A's transaction must hold a database row lock before B can take over.
  const first = db.$transaction(async (tx) => {
    await assertScanLease(tx, scan.id, { owner: "worker-original", attempt: 1 });
    announceLock();
    await held;
  }, { timeout: 10_000 });

  try {
    await locked;
    const takeover = db.scanJob.updateMany({
      where: { scanId: scan.id, lockedBy: "worker-original", attempts: 1 },
      data: {
        lockedBy: "worker-replacement",
        attempts: 2,
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const result = await Promise.race([
      takeover.then(() => "updated"),
      delay(120, "waiting"),
    ]);
    assert.equal(result, "waiting", "takeover cannot change a row locked by a writer");
    releaseLock();
    await first;
    assert.equal((await takeover).count, 1);
  } finally {
    releaseLock();
    await first;
  }

  await assert.rejects(
    db.$transaction((tx) => assertScanLease(tx, scan.id, { owner: "worker-original", attempt: 1 })),
    /WORKER_LEASE_LOST/,
  );
  await db.$transaction((tx) =>
    assertScanLease(tx, scan.id, { owner: "worker-replacement", attempt: 2 }),
  );

  await db.scanJob.updateMany({
    where: { scanId: scan.id },
    data: { cancelRequestedAt: new Date() },
  });
  await assert.rejects(
    db.$transaction((tx) =>
      assertScanLease(tx, scan.id, { owner: "worker-replacement", attempt: 2 }),
    ),
    /WORKER_LEASE_LOST/,
  );

  await db.scanJob.updateMany({
    where: { scanId: scan.id },
    data: { cancelRequestedAt: null, leaseExpiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    db.$transaction((tx) =>
      assertScanLease(tx, scan.id, { owner: "worker-replacement", attempt: 2 }),
    ),
    /WORKER_LEASE_LOST/,
  );
  assert.equal((await db.scan.findUniqueOrThrow({ where: { id: scan.id } })).status, "RUNNING");
  process.stdout.write("PASS: PostgreSQL lease row locking, takeover, cancellation and expiration\n");
} finally {
  await db.scan.delete({ where: { id: scan.id } });
  await db.$disconnect();
}
