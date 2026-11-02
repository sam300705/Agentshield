import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";
import { processNextScanJob } from "../apps/api/src/services/scanQueue.js";
const target = new URL(process.env.DATABASE_URL ?? "");
const schema = target.searchParams.get("schema") ?? "";
assert(/^p2upgrade_[a-f0-9]{32}$/.test(schema));
target.searchParams.delete("schema");
assertSafeSeedTarget(process.env.NODE_ENV, target.href);
assert.equal(process.env.AGENTSHIELD_DISPOSABLE_DATABASE, "true");
const db = new PrismaClient();
try {
  const before = await db.scanJob.findUniqueOrThrow({ where: { id: "preserve-legacy-demo" } });
  assert.equal(before.policyBundleVersion, "demo");
  assert.equal(await processNextScanJob("upgrade-demo-worker"), true);
  const after = await db.scanJob.findUniqueOrThrow({
    where: { id: before.id },
    include: { scan: true },
  });
  assert.equal(
    after.status,
    "COMPLETED",
    "A valid Phase 2 parent-format demo job must execute after upgrade",
  );
  assert.equal(after.scan.status, "COMPLETED");
  assert.equal(after.attempts, 1);
  assert.equal(after.deadLetteredAt, null);
  assert(await db.securityReceipt.findUnique({ where: { scanId: after.scanId } }));
  assert.deepEqual(
    after.payload,
    before.payload,
    "Preserve the original versioned job payload as history",
  );
  console.warn(
    "PASS parent-format demo executes after populated upgrade; original payload retained.",
  );
} finally {
  await db.$disconnect();
}
