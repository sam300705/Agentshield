// CI-only fixture workspace provider. The production worker never selects this provider.
import console from "node:console";
import assert from "node:assert/strict";
import process from "node:process";
import { hostname } from "node:os";
import { createPublicKey } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

if (!process.env.DATABASE_URL?.includes("@127.0.0.1:5434/ops?"))
  throw new Error("DISPOSABLE_DATABASE_REQUIRED");
const { prisma } = await import("file:///app/apps/api/dist/db/prisma.js");
const { enqueueRepositoryScan, processNextScanJob } =
  await import("file:///app/apps/api/dist/services/scanQueue.js");
const { ConfiguredScanJobExecutor } =
  await import("file:///app/apps/api/dist/services/scanJobExecutor.js");
const { verifySignedSecurityReceipt } =
  await import("file:///app/apps/api/node_modules/@agentshield/policy-engine/dist/index.js");
try {
  if (process.argv[2] === "prepare") {
    await prisma.organization.create({
      data: { id: "ops-fixture", slug: "ops-fixture", name: "Disposable container fixture" },
    });
    await prisma.repository.create({
      data: {
        id: "ops-fixture-repo",
        organizationId: "ops-fixture",
        provider: "LOCAL",
        externalId: "ops-fixture-repo",
        fullName: "fixture/container",
      },
    });
    for (const index of [1, 2])
      await enqueueRepositoryScan(
        {
          repositoryId: "ops-fixture-repo",
          ref: "main",
          policyBundleVersion: "ops-fixture",
          options: { includeOsv: false },
        },
        `ops-fixture-${index}`,
        "ops-fixture",
        "fixture-operator",
        `ops-fixture-${index}`,
      );
  } else if (process.argv[2] === "work") {
    const executor = new ConfiguredScanJobExecutor({
      prepare: () => Promise.resolve({ path: "/fixture", cleanup: () => Promise.resolve() }),
    });
    for (let attempt = 0; attempt < 20; attempt++) {
      await processNextScanJob(`container-fixture-${hostname()}`, executor);
      const pending = await prisma.scanJob.count({
        where: { scan: { organizationId: "ops-fixture" }, status: { in: ["QUEUED", "RUNNING"] } },
      });
      if (pending === 0) break;
      await delay(100);
    }
  } else if (process.argv[2] === "verify") {
    const jobs = await prisma.scanJob.findMany({
      where: { scan: { organizationId: "ops-fixture" } },
      include: { scan: { include: { findings: true, receipt: true } } },
    });
    assert.equal(jobs.length, 2);
    const signingMaterial = process.env.RECEIPT_SIGNING_PRIVATE_KEY.replaceAll("\\n", "\n");
    const publicKey = createPublicKey(signingMaterial);
    for (const job of jobs) {
      assert.equal(job.status, "COMPLETED");
      assert.equal(job.attempts, 1);
      assert.equal(job.scan.status, "COMPLETED");
      assert.ok(job.scan.findings.length > 0);
      const receipt = job.scan.receipt;
      assert.ok(receipt && receipt.signature && receipt.keyId);
      assert.ok(
        verifySignedSecurityReceipt(
          {
            format: "agentshield-signed-receipt",
            version: 1,
            algorithm: "ed25519",
            keyId: receipt.keyId,
            payload: receipt.signedPayload,
            signature: receipt.signature,
          },
          { [receipt.keyId]: publicKey },
        ),
      );
    }
    console.log(
      "PASS: two container workers, bounded fixture scans, persisted findings and verified real Ed25519 receipts",
    );
  } else throw new Error("FIXTURE_MODE_REQUIRED");
} finally {
  await prisma.$disconnect();
}
