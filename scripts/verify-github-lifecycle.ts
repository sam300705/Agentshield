import { createHmac, randomUUID } from "node:crypto";

import { PrismaClient, ScanStatus } from "@prisma/client";

import {
  parseVerifiedGitHubWebhook,
  type VerifiedGitHubWebhook,
} from "../apps/api/src/integrations/githubApp.js";
import { PrismaGitHubDeliveryStore } from "../apps/api/src/integrations/githubDeliveryStore.js";
import { processGitHubWebhookDelivery } from "../apps/api/src/integrations/githubWebhookLifecycle.js";
import { enqueueRepositoryScan } from "../apps/api/src/services/scanQueue.js";
import { sanitizeText } from "@agentshield/schemas";

const prisma = new PrismaClient();
const suffix = randomUUID();
const organizationId = `github-lifecycle-org-${suffix}`;
const installationId = 67000 + Math.floor(Math.random() * 1000);
const installationRowId = `github-installation-${suffix}`;
const repositoryId = `github-repository-${suffix}`;
const fullName = "synthetic/github-lifecycle";
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const secret = `synthetic-webhook-secret-${suffix}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function signedPayload(
  eventName: string,
  deliveryId: string,
  payload: Record<string, unknown>,
): { raw: Buffer; headers: { signature: string; delivery: string; event: string } } {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return { raw, headers: { signature, delivery: deliveryId, event: eventName } };
}

function parseSyntheticWebhook(
  eventName: string,
  deliveryId: string,
  payload: Record<string, unknown>,
): VerifiedGitHubWebhook {
  const signed = signedPayload(eventName, deliveryId, payload);
  return parseVerifiedGitHubWebhook(signed.raw, signed.headers, secret);
}

function pushPayload(
  deliveryInstallationId = installationId,
  repositoryName = fullName,
): Record<string, unknown> {
  return {
    installation: { id: deliveryInstallationId },
    organization: { login: "synthetic-org" },
    repository: { full_name: repositoryName },
    ref: "refs/heads/main",
    after: commitSha,
  };
}

async function countJobs(): Promise<number> {
  return prisma.scanJob.count({ where: { scan: { organizationId } } });
}

async function main(): Promise<void> {
  let organizationCreated = false;
  try {
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "Synthetic GitHub lifecycle organization",
      },
    });
    organizationCreated = true;
    await prisma.gitHubInstallation.create({
      data: {
        id: installationRowId,
        organizationId,
        installationId,
        accountLogin: "synthetic-org",
        accountType: "Organization",
        permissions: { contents: "read", checks: "write" },
      },
    });
    await prisma.repository.create({
      data: {
        id: repositoryId,
        organizationId,
        provider: "GITHUB",
        externalId: `synthetic-external-${suffix}`,
        fullName,
        defaultBranch: "main",
        githubInstallationId: installationRowId,
      },
    });

    const store = new PrismaGitHubDeliveryStore(prisma);
    const first = parseSyntheticWebhook("push", `delivery-${suffix}-1`, pushPayload());
    const installation = await prisma.gitHubInstallation.findUniqueOrThrow({
      where: { installationId },
      select: { organizationId: true },
    });
    assert(
      await store.claim({
        organizationId,
        webhook: first,
        rawPayload: signedPayload("push", first.deliveryId, pushPayload()).raw,
        correlationId: `corr-${suffix}-1`,
      }),
      "signed delivery was not accepted",
    );
    const queued = await processGitHubWebhookDelivery(
      installation.organizationId,
      first,
      `corr-${suffix}-1`,
      {
        client: prisma,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "synthetic-policy",
        enqueueScan: enqueueRepositoryScan,
      },
    );
    assert(queued.status === "QUEUED" && queued.scanQueued, "mapped push was not queued");
    const job = await prisma.scanJob.findUniqueOrThrow({ where: { id: queued.jobId } });
    assert(job.status === ScanStatus.QUEUED, "queued job has incorrect status");
    assert(job.repositoryRef === "refs/heads/main", "webhook ref was not persisted");
    assert(job.commitSha === commitSha, "exact webhook commit was not persisted");
    assert(job.correlationId === `corr-${suffix}-1`, "webhook correlation was not persisted");
    assert((await countJobs()) === 1, "first delivery did not create exactly one job");

    const duplicate = parseSyntheticWebhook("push", first.deliveryId, pushPayload());
    assert(
      !(await store.claim({
        organizationId,
        webhook: duplicate,
        rawPayload: signedPayload("push", duplicate.deliveryId, pushPayload()).raw,
        correlationId: `corr-${suffix}-duplicate`,
      })),
      "duplicate delivery was accepted twice",
    );
    assert((await countJobs()) === 1, "duplicate delivery created another job");

    const unknownRepository = parseSyntheticWebhook(
      "push",
      `delivery-${suffix}-unknown-repository`,
      pushPayload(installationId, "synthetic/unknown"),
    );
    assert(
      await store.claim({
        organizationId,
        webhook: unknownRepository,
        rawPayload: signedPayload(
          "push",
          unknownRepository.deliveryId,
          pushPayload(installationId, "synthetic/unknown"),
        ).raw,
        correlationId: `corr-${suffix}-unknown-repository`,
      }),
      "unknown repository delivery was not recorded",
    );
    const unknownRepositoryResult = await processGitHubWebhookDelivery(
      organizationId,
      unknownRepository,
      `corr-${suffix}-unknown-repository`,
      {
        client: prisma,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "synthetic-policy",
        enqueueScan: enqueueRepositoryScan,
      },
    );
    assert(
      unknownRepositoryResult.status === "IGNORED" &&
        unknownRepositoryResult.reason === "UNKNOWN_REPOSITORY",
      "unknown repository was not ignored",
    );
    assert((await countJobs()) === 1, "unknown repository created a job");

    const unsupported = parseSyntheticWebhook(
      "issues",
      `delivery-${suffix}-unsupported`,
      pushPayload(),
    );
    await store.claim({
      organizationId,
      webhook: unsupported,
      rawPayload: signedPayload("issues", unsupported.deliveryId, pushPayload()).raw,
      correlationId: `corr-${suffix}-unsupported`,
    });
    const unsupportedResult = await processGitHubWebhookDelivery(
      organizationId,
      unsupported,
      `corr-${suffix}-unsupported`,
      {
        client: prisma,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "synthetic-policy",
        enqueueScan: enqueueRepositoryScan,
      },
    );
    assert(
      unsupportedResult.status === "IGNORED" && unsupportedResult.reason === "UNSUPPORTED_EVENT",
      "unsupported event was not ignored",
    );
    assert((await countJobs()) === 1, "unsupported event created a job");

    const unknownInstallation = parseSyntheticWebhook(
      "push",
      `delivery-${suffix}-unknown-installation`,
      pushPayload(installationId + 1),
    );
    const unknownInstallationRow = await prisma.gitHubInstallation.findUnique({
      where: { installationId: unknownInstallation.installationId },
    });
    assert(unknownInstallationRow == null, "unknown installation unexpectedly resolved");
    assert((await countJobs()) === 1, "unknown installation changed job count");

    const queueFailure = parseSyntheticWebhook(
      "push",
      `delivery-${suffix}-queue-failure`,
      pushPayload(),
    );
    await store.claim({
      organizationId,
      webhook: queueFailure,
      rawPayload: signedPayload("push", queueFailure.deliveryId, pushPayload()).raw,
      correlationId: `corr-${suffix}-queue-failure`,
    });
    const failed = await processGitHubWebhookDelivery(
      organizationId,
      queueFailure,
      `corr-${suffix}-queue-failure`,
      {
        client: prisma,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "synthetic-policy",
        enqueueScan: () => Promise.reject(new Error("synthetic queue outage")),
      },
    );
    assert(
      failed.status === "FAILED" && failed.reason === "QUEUE_FAILED",
      "queue failure was not deterministic",
    );
    const failedDelivery = await prisma.gitHubWebhookDelivery.findUnique({
      where: { organizationId_deliveryId: { organizationId, deliveryId: queueFailure.deliveryId } },
      select: { status: true, failureReason: true },
    });
    assert(failedDelivery?.status === "FAILED", "queue failure state was not persisted");
    assert(
      failedDelivery.failureReason === "QUEUE_FAILED",
      "raw queue failure leaked into delivery state",
    );
    assert((await countJobs()) === 1, "queue failure created a scan job");

    const tenantIsolation = await processGitHubWebhookDelivery(
      `other-tenant-${suffix}`,
      first,
      `corr-${suffix}-tenant-isolation`,
      {
        client: prisma,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "synthetic-policy",
        enqueueScan: enqueueRepositoryScan,
      },
    );
    assert(
      tenantIsolation.status === "IGNORED" && tenantIsolation.reason === "UNKNOWN_INSTALLATION",
      "cross-tenant installation was accepted",
    );
    assert((await countJobs()) === 1, "tenant-isolation attempt changed job count");

    console.warn(
      "GitHub lifecycle database verification passed: signed delivery, tenant mapping, commit pinning, dedupe, ignored states, queue failure, and isolation.",
    );
  } finally {
    if (organizationCreated) {
      await prisma.scanJob.deleteMany({ where: { scan: { organizationId } } });
      await prisma.scan.deleteMany({ where: { organizationId } });
      await prisma.repository.deleteMany({ where: { organizationId } });
      await prisma.gitHubInstallation.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      sanitizeText(error instanceof Error ? error.message : "Unknown GitHub lifecycle error"),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
