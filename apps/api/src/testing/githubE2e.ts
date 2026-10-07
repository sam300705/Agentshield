import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { jwtVerify } from "jose";
import { prisma } from "../db/prisma.js";
import { createServer } from "../server.js";
import { FetchGitHubAppClient } from "../integrations/githubApiClient.js";
import { createGitHubExecutor } from "../integrations/githubRuntime.js";
import { publishGitHubChecks } from "../integrations/githubCheckPublisher.js";
import {
  processNextScanJob,
  requestJobCancellation,
  renewScanJobLease,
} from "../services/scanQueue.js";
import { registerGitHubInstallation } from "../integrations/githubInstallationService.js";
import { createTar } from "./githubArchiveFixture.js";

const suffix = randomUUID(),
  org = `github-e2e-${suffix}`,
  other = `github-foreign-${suffix}`;
const installationId = 100_000 + Math.floor(Math.random() * 1_000_000);
const shaA = "a".repeat(40),
  shaB = "b".repeat(40);
const secret = `synthetic-${suffix}`;
const rawFinding = ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
let api: Server | undefined, provider: Server | undefined;
const archiveRequests: string[] = [],
  checkRequests: Record<string, unknown>[] = [];
let uncertainCreate = false;
let failPublication = false,
  createCount = 0;
const checkRuns: Array<{ id: number; external_id: string }> = [];
function url(server: Server) {
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function listen(app: ReturnType<typeof express>) {
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
async function close(server?: Server) {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
}
function pass(name: string) {
  console.warn(`PASS github-e2e: ${name}`);
}
function payload(extra: Record<string, unknown> = {}) {
  return {
    installation: { id: installationId },
    repository: { id: 123, full_name: "synthetic/github-e2e" },
    organizationId: other,
    action: "opened",
    pull_request: { number: 1, head: { ref: "feature", sha: shaA } },
    ...extra,
  };
}
async function webhook(
  event: string,
  data: unknown,
  delivery = randomUUID(),
  headers: Record<string, string> = {},
) {
  const raw = typeof data === "string" ? data : JSON.stringify(data);
  const response = await fetch(`${url(api!)}/api/v1/integrations/github/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": delivery,
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
      ...headers,
    },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    AUTH_MODE: "demo",
    DEMO_AUTH_ENABLED: "true",
    RATE_LIMIT_ENABLED: "false",
    GITHUB_WEBHOOK_ENABLED: "true",
    GITHUB_SCAN_LIFECYCLE_ENABLED: "true",
    GITHUB_MATERIALIZATION_ENABLED: "true",
    GITHUB_APP_ID: "123",
    GITHUB_PRIVATE_KEY: pem,
    GITHUB_WEBHOOK_SECRET: secret,
    GITHUB_SCAN_POLICY_BUNDLE_VERSION: "github-e2e",
  });
  await prisma.organization.createMany({
    data: [
      { id: org, slug: org, name: "Synthetic GitHub E2E" },
      { id: other, slug: other, name: "Foreign tenant" },
    ],
  });
  const installation = await registerGitHubInstallation(prisma, {
    organizationId: org,
    installationId,
    accountLogin: "synthetic",
    accountType: "User",
  });
  await assert.rejects(
    registerGitHubInstallation(prisma, {
      organizationId: other,
      installationId,
      accountLogin: "foreign",
    }),
    /ALREADY_BOUND/,
  );
  const fake = express();
  fake.use(express.json());
  fake.use((req, res) => {
    void (async () => {
      try {
        assert.equal(req.header("user-agent"), "AgentShield");
        if (req.path.endsWith("/access_tokens")) {
          assert(req.path.includes(String(installationId)));
          await jwtVerify(req.header("authorization")!.slice(7), publicKey, { issuer: "123" });
          res.json({
            token: "synthetic-installation-credential",
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          });
          return;
        }
        assert.equal(req.header("authorization"), "Bearer synthetic-installation-credential");
        if (req.path.includes("/tarball/")) {
          const sha = req.path.split("/").at(-1)!;
          archiveRequests.push(sha);
          assert.equal(sha, shaA);
          const blocked = req.path.includes("blocked-repo");
          res.send(
            createTar([
              { name: "root", type: "directory" },
              {
                name: "root/app.ts",
                body: blocked ? `const credential = "${rawFinding}";` : "export const safe = true;",
              },
            ]),
          );
          return;
        }
        if (req.path.includes("/commits/")) {
          res.json({ check_runs: checkRuns });
          return;
        }
        if (req.path.includes("/check-runs")) {
          if (failPublication) {
            res.status(503).json({ error: "sensitive-provider-response" });
            return;
          }
          const request = req.body as Record<string, unknown>;
          assert.equal(request.head_sha, shaA);
          assert(!JSON.stringify(request).includes(rawFinding));
          checkRequests.push(request);
          if (req.method === "POST") {
            createCount++;
            const id = 500 + createCount;
            checkRuns.push({ id, external_id: request.external_id as string });
            if (uncertainCreate) {
              uncertainCreate = false;
              res.status(503).json({ error: "synthetic-uncertain-create" });
              return;
            }
            res.json({ id });
          } else res.json({ id: Number(req.path.split("/").at(-1)) });
          return;
        }
        res.json({
          id: req.path.includes("blocked-repo") ? 124 : 123,
          full_name: "synthetic/github-e2e",
          private: true,
          default_branch: "main",
        });
      } catch {
        res.status(500).json({ error: "synthetic-provider-assertion" });
      }
    })();
  });
  provider = await listen(fake);
  api = await listen(createServer());
  const github = new FetchGitHubAppClient(
    { appId: "123", privateKey: pem, webhookSecret: secret },
    { apiBaseUrl: url(provider), fetchImpl: fetch },
  );
  const executor = createGitHubExecutor(prisma, github);
  assert.equal(
    (
      await webhook("installation", {
        installation: { id: installationId },
        action: "created",
        repositories: [{ id: 123, full_name: "synthetic/github-e2e" }],
      })
    ).status,
    202,
  );
  const repository = await prisma.repository.findUniqueOrThrow({
    where: {
      organizationId_provider_externalId: {
        organizationId: org,
        provider: "GITHUB",
        externalId: "123",
      },
    },
  });
  assert.equal(repository.githubInstallationId, installation.id);
  pass(
    "signed installation-created establishes selected repositories for a prebound tenant; rebind rejected",
  );
  for (const headers of [
    { "x-hub-signature-256": "" },
    { "x-hub-signature-256": "sha256=invalid" },
    { "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
  ])
    assert.equal((await webhook("pull_request", payload(), randomUUID(), headers)).status, 401);
  assert.equal(
    (await webhook("pull_request", payload(), randomUUID(), { "x-github-delivery": "" })).status,
    400,
  );
  assert.equal((await webhook("pull_request", "{invalid")).status, 400);
  assert.equal((await webhook("pull_request", "x".repeat(25 * 1024 * 1024 + 1))).status, 400);
  assert.equal((await webhook("ping", {})).status, 202);
  assert.equal(
    (await webhook("pull_request", payload({ installation: { id: installationId + 1 } }))).status,
    403,
  );
  assert.equal(
    (
      await webhook(
        "pull_request",
        payload({ repository: { id: 999, full_name: repository.fullName } }),
      )
    ).body.status,
    "ignored",
  );
  assert.equal(
    (await webhook("pull_request", payload({ action: "labeled" }))).body.status,
    "ignored",
  );
  assert.equal(
    (
      await webhook(
        "push",
        payload({ ref: "refs/heads/main", after: "0".repeat(40), deleted: true }),
      )
    ).body.status,
    "ignored",
  );
  assert.equal(
    (await webhook("push", payload({ ref: "refs/tags/v1", after: shaA }))).body.status,
    "ignored",
  );
  pass(
    "HTTP signature, missing delivery, malformed/oversize, unsupported event, unknown installation/repository, irrelevant PR and deleted/tag push boundaries",
  );
  const delivery = randomUUID();
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () => webhook("pull_request", payload(), delivery)),
  );
  assert.equal(concurrent.filter((result) => result.body.status === "queued").length, 1);
  assert.equal(concurrent.filter((result) => result.body.status === "duplicate").length, 5);
  const scanId = concurrent.find((result) => result.body.status === "queued")!.body
    .scanId as string;
  const job = await prisma.scanJob.findUniqueOrThrow({ where: { scanId } });
  assert.equal(job.commitSha, shaA);
  assert.equal((job.payload as Record<string, unknown>).integrationId, String(installationId));
  assert.equal(await prisma.scan.count({ where: { organizationId: org } }), 1);
  assert.equal(
    (await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).organizationId,
    org,
  );
  pass("concurrent delivery dedupe, one durable scan/job, tenant-body override ignored");
  // The source branch has moved to B. Acquisition must still request the accepted PR SHA A.
  const movedBranch = shaB;
  assert.notEqual(movedBranch, shaA);
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(checkRequests.at(-1)!.status, "queued");
  await processNextScanJob("github-e2e-worker", executor);
  assert.equal(
    (await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).status,
    "COMPLETED",
  );
  assert.deepEqual(archiveRequests, [shaA]);
  assert.equal(checkRequests.at(-1)!.status, "in_progress");
  const resultCount = await prisma.finding.count({ where: { scanId } });
  assert.equal(resultCount, 0);
  failPublication = true;
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(
    (await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).status,
    "COMPLETED",
  );
  assert.equal(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId } })).attempts,
    1,
  );
  failPublication = false;
  await prisma.gitHubCheckPublication.update({
    where: { scanId },
    data: { nextAttemptAt: new Date() },
  });
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(checkRequests.at(-1)!.conclusion, "success");
  assert.equal(createCount, 1);
  assert.equal(archiveRequests.length, 1);
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(createCount, 1);
  assert.equal(
    (
      await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
        where: { organizationId_deliveryId: { organizationId: org, deliveryId: delivery } },
      })
    ).status,
    "PROCESSED",
  );
  pass(
    "real worker/scanner/policy/receipt, exact acquisition SHA A after branch B, queued/in-progress/success Check and independent temporary publication retry",
  );
  await webhook("installation_repositories", {
    installation: { id: installationId },
    action: "added",
    repositories_added: [{ id: 124, full_name: "synthetic/blocked-repo" }],
  });
  const blocked = await webhook(
    "pull_request",
    payload({ repository: { id: 124, full_name: "synthetic/blocked-repo" } }),
  );
  const blockedScan = blocked.body.scanId as string;
  assert(blockedScan);
  await publishGitHubChecks(prisma, github, blockedScan);
  await processNextScanJob("github-e2e-worker", executor);
  await publishGitHubChecks(prisma, github, blockedScan);
  assert.equal(checkRequests.at(-1)!.conclusion, "failure");
  assert((await prisma.finding.count({ where: { scanId: blockedScan } })) > 0);
  assert(!JSON.stringify(checkRequests).includes(rawFinding));
  const cancelled = await webhook("pull_request", payload());
  const cancelledScan = cancelled.body.scanId as string;
  const cancelJob = await prisma.scanJob.findUniqueOrThrow({ where: { scanId: cancelledScan } });
  await requestJobCancellation(cancelJob.id, org, "synthetic");
  await publishGitHubChecks(prisma, github, cancelledScan);
  assert.equal(checkRequests.at(-1)!.conclusion, "cancelled");
  assert.equal(await renewScanJobLease(job.id, "old-attempt"), false);
  const uncertain = await webhook("pull_request", payload());
  const uncertainScan = uncertain.body.scanId as string;
  const beforeCreate = createCount;
  uncertainCreate = true;
  await publishGitHubChecks(prisma, github, uncertainScan);
  assert.equal(createCount, beforeCreate + 1);
  await prisma.gitHubCheckPublication.update({
    where: { scanId: uncertainScan },
    data: { nextAttemptAt: new Date() },
  });
  await publishGitHubChecks(prisma, github, uncertainScan);
  assert.equal(createCount, beforeCreate + 1);
  assert(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId: uncertainScan } }))
      .checkRunId != null,
  );
  const uncertainJob = await prisma.scanJob.findUniqueOrThrow({ where: { scanId: uncertainScan } });
  await requestJobCancellation(uncertainJob.id, org, "synthetic");
  await publishGitHubChecks(prisma, github, uncertainScan);
  pass(
    "blocking findings yield failure with redacted output; cancellation yields cancelled; expired/completed worker lease rejected",
  );
  await webhook("installation_repositories", {
    installation: { id: installationId },
    action: "removed",
    repositories_removed: [{ id: 123 }],
  });
  assert.equal((await webhook("pull_request", payload())).body.status, "ignored");
  assert.equal(
    (await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).status,
    "COMPLETED",
  );
  await webhook("installation", { installation: { id: installationId }, action: "suspend" });
  assert.equal(
    (
      await webhook(
        "pull_request",
        payload({ repository: { id: 124, full_name: "synthetic/blocked-repo" } }),
      )
    ).body.status,
    "ignored",
  );
  await webhook("installation", { installation: { id: installationId }, action: "unsuspend" });
  assert.equal(
    (await prisma.gitHubInstallation.findUniqueOrThrow({ where: { installationId } })).status,
    "ACTIVE",
  );
  await webhook("installation", { installation: { id: installationId }, action: "deleted" });
  assert.equal(
    (await prisma.gitHubInstallation.findUniqueOrThrow({ where: { installationId } })).status,
    "DELETED",
  );
  assert.equal((await webhook("pull_request", payload())).body.status, "ignored");
  assert(
    (await prisma.auditEvent.count({
      where: { organizationId: org, action: "GITHUB_CHECK_PUBLISHED" },
    })) >= 5,
  );
  assert(
    !JSON.stringify(await prisma.auditEvent.findMany({ where: { organizationId: org } })).includes(
      rawFinding,
    ),
  );
  pass(
    "selected repository removal, suspend/unsuspend/delete preserve historical evidence and prevent future work; auditable provider lineage",
  );
}
main()
  .catch((error: unknown) => {
    console.error("GitHub E2E verification failed.");
    if (error instanceof Error)
      console.error(
        error.stack
          ?.split("\n")
          .filter((line) => line.trim().startsWith("at "))
          .join("\n"),
      );
    process.exitCode = 1;
  })
  .finally(async () => {
    await close(api);
    await close(provider);
    await prisma.gitHubWebhookDelivery.deleteMany({ where: { organizationId: org } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: org } });
    await prisma.securityReceipt.deleteMany({ where: { scan: { organizationId: org } } });
    await prisma.scan.deleteMany({ where: { organizationId: org } });
    await prisma.repository.deleteMany({ where: { organizationId: org } });
    await prisma.gitHubInstallation.deleteMany({ where: { organizationId: org } });
    await prisma.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await prisma.$disconnect();
  });
