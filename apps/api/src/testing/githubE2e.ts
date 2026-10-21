import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { securityReceiptSchema } from "@agentshield/schemas";
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import { jwtVerify } from "jose";
import { POLICY_RULE_VERSION, createSecurityReceipt } from "@agentshield/policy-engine";
import { prisma } from "../db/prisma.js";
import { createServer } from "../server.js";
import { FetchGitHubAppClient } from "../integrations/githubApiClient.js";
import { createGitHubExecutor } from "../integrations/githubRuntime.js";
import { publishGitHubChecks } from "../integrations/githubCheckPublisher.js";
import { verifyGitHubDelivery } from "../integrations/githubDeliveryVerifier.js";
import {
  processNextScanJob,
  requestJobCancellation,
  renewScanJobLease,
} from "../services/scanQueue.js";
import {
  registerGitHubInstallation,
  synchronizeGitHubRepositories,
} from "../integrations/githubInstallationService.js";
import { assertSafeSeedTarget } from "../services/seedSafety.js";
import { createTar } from "./githubArchiveFixture.js";

assertSafeSeedTarget(process.env.NODE_ENV, process.env.DATABASE_URL ?? "");
assert.equal(process.env.AGENTSHIELD_DISPOSABLE_DATABASE, "true");

const suffix = randomUUID(),
  org = `github-e2e-${suffix}`,
  other = `github-foreign-${suffix}`;
const failureTrigger = `github_accept_${suffix.replaceAll("-", "")}`;
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
let rejectedCreateStatus = 0;
let mismatchedCreateField: "external_id" | "head_sha" | undefined;
let skewFailureClock = false;
const realDateNow = Date.now;
let providerCalls = 0;
let failPublication = false,
  createCount = 0;
const checkRuns: Array<{
  id: number;
  external_id: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
}> = [];
let observedCheckOverride: Record<string, unknown> | undefined;
let readCheckPause:
  | { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
  | undefined;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let pauseReply:
  | {
      externalId: string;
      arrived: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    }
  | undefined;
const hiddenCheckIds = new Set<string>();
const issuedScopes = new Map<
  string,
  { repositoryId: number; permissions: Record<string, string> }
>();
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
    GITHUB_SCAN_POLICY_BUNDLE_VERSION: POLICY_RULE_VERSION,
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
    /GITHUB_INSTALLATION_ORGANIZATION_MISMATCH/,
  );
  const fake = express();
  fake.use(express.json());
  fake.use((req, res) => {
    void (async () => {
      try {
        providerCalls++;
        assert.equal(req.header("user-agent"), "AgentShield");
        if (req.path.endsWith("/access_tokens")) {
          assert(req.path.includes(String(installationId)));
          await jwtVerify(req.header("authorization")!.slice(7), publicKey, { issuer: "123" });
          const scope = req.body as {
            repository_ids: number[];
            permissions: Record<string, string>;
          };
          assert.equal(scope.repository_ids.length, 1);
          assert([123, 124].includes(scope.repository_ids[0]!));
          assert.deepEqual(
            scope.permissions,
            scope.permissions.checks != null
              ? { checks: scope.permissions.checks, metadata: "read" }
              : { contents: "read", metadata: "read" },
          );
          if (scope.permissions.checks != null)
            assert(["read", "write"].includes(scope.permissions.checks));
          const issued = `synthetic-scoped-${randomUUID()}`;
          issuedScopes.set(issued, {
            repositoryId: scope.repository_ids[0]!,
            permissions: scope.permissions,
          });
          res.json({
            token: issued,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          });
          return;
        }
        const credential = req.header("authorization")?.slice(7) ?? "";
        const issuedScope = issuedScopes.get(credential);
        assert(
          issuedScope != null ||
            (req.path.includes("/branches/") && credential === "synthetic-installation-credential"),
        );
        if (req.path.includes("/check-runs")) {
          assert.equal(
            issuedScope?.permissions.checks,
            req.method === "GET" && !req.path.includes("/commits/") ? "read" : "write",
          );
          assert.equal(issuedScope?.repositoryId, req.path.includes("blocked-repo") ? 124 : 123);
        }
        if (req.path.includes("/tarball/")) assert.equal(issuedScope?.permissions.contents, "read");
        if (req.path.includes("/branches/")) {
          res.json({ commit: { sha: shaB } });
          return;
        }
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
          res.json({ check_runs: checkRuns.filter((run) => !hiddenCheckIds.has(run.external_id)) });
          return;
        }
        if (req.method === "GET" && /\/check-runs\/[0-9]+$/.test(req.path)) {
          const target = checkRuns.find((run) => run.id === Number(req.path.split("/").at(-1)));
          assert(target != null);
          const pause = readCheckPause;
          if (pause != null) {
            pause.arrived.resolve();
            await pause.release.promise;
          }
          res.json({ ...target, ...observedCheckOverride });
          return;
        }
        if (req.path.includes("/check-runs")) {
          if (failPublication) {
            if (skewFailureClock) Date.now = () => realDateNow() - 3_600_000;
            res.status(503).json({ error: "sensitive-provider-response" });
            return;
          }
          const request = req.body as Record<string, unknown>;
          if (req.method === "POST" && rejectedCreateStatus !== 0) {
            res.status(rejectedCreateStatus).json({ error: "synthetic-rejection" });
            return;
          }
          if (req.method === "POST") assert.equal(request.head_sha, shaA);
          else {
            assert(!("head_sha" in request), "PATCH must not contain create-only head_sha");
            const target = checkRuns.find((run) => run.id === Number(req.path.split("/").at(-1)));
            assert.equal(target?.external_id, request.external_id);
            assert(target != null);
            target.status = request.status as string;
            target.conclusion = (request.conclusion as string | undefined) ?? null;
          }
          assert(!JSON.stringify(request).includes(rawFinding));
          checkRequests.push(request);
          if (req.method === "POST") {
            createCount++;
            const id = 12_000_000_000 + createCount;
            checkRuns.push({
              id,
              external_id: request.external_id as string,
              head_sha: request.head_sha as string,
              status: request.status as string,
              conclusion: (request.conclusion as string | undefined) ?? null,
            });
            const pause = pauseReply;
            if (pause != null && pause.externalId === request.external_id) {
              pause.arrived.resolve();
              await pause.release.promise;
            }
            if (uncertainCreate) {
              uncertainCreate = false;
              res.status(503).json({ error: "synthetic-uncertain-create" });
              return;
            }
            res.status(201).json({
              id: mismatchedCreateField == null ? id : id + 5000,
              external_id: request.external_id,
              head_sha: request.head_sha,
              ...(mismatchedCreateField == null
                ? {}
                : { [mismatchedCreateField]: "wrong-context" }),
            });
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
  const oversized = await webhook("pull_request", "x".repeat(1024 * 1024 + 1));
  assert.equal(oversized.status, 413);
  assert.equal((oversized.body.error as { code: string }).code, "PAYLOAD_TOO_LARGE");
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
  const failedDelivery = randomUUID();
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION "${failureTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = '${org}' AND NEW."action" = 'GITHUB_DELIVERY_ACCEPTED' THEN RAISE EXCEPTION 'Synthetic GitHub acceptance audit failure'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${failureTrigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${failureTrigger}"()`,
  );
  assert.equal((await webhook("pull_request", payload(), failedDelivery)).status, 503);
  assert.equal(
    await prisma.gitHubWebhookDelivery.count({
      where: { organizationId: org, deliveryId: failedDelivery },
    }),
    0,
  );
  assert.equal(await prisma.scan.count({ where: { organizationId: org } }), 0);
  await prisma.$executeRawUnsafe(`DROP TRIGGER "${failureTrigger}" ON "AuditEvent"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION "${failureTrigger}"()`);
  const recoveredDelivery = await webhook("pull_request", payload(), failedDelivery);
  assert.equal(recoveredDelivery.body.status, "queued");
  const recoveredJob = await prisma.scanJob.findUniqueOrThrow({
    where: { scanId: recoveredDelivery.body.scanId as string },
  });
  await requestJobCancellation(recoveredJob.id, org, { actor: "synthetic", correlationId: suffix });
  await publishGitHubChecks(prisma, github, recoveredJob.scanId);
  pass("acceptance audit failure rolls back delivery/scan/job; redelivery safely succeeds");
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
  assert.equal(
    await prisma.scan.count({ where: { organizationId: org, status: { not: "CANCELLED" } } }),
    1,
  );
  assert.equal(
    (await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).organizationId,
    org,
  );
  pass("concurrent delivery dedupe, one durable scan/job, tenant-body override ignored");
  // The source branch has moved to B. Acquisition must still request the accepted PR SHA A.
  const movedBranch = (await (
    await fetch(`${url(provider)}/repos/synthetic/github-e2e/branches/feature`, {
      headers: {
        "user-agent": "AgentShield",
        authorization: "Bearer synthetic-installation-credential",
      },
    })
  ).json()) as { commit: { sha: string } };
  assert.equal(movedBranch.commit.sha, shaB);
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(checkRequests.at(-1)!.status, "queued");
  await publishGitHubChecks(prisma, github, scanId);
  assert(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId } })).nextAttemptAt >
      new Date(),
  );
  // RUNNING/completion must wake this deferred no-op poll without bypassing failure backoff.
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
  skewFailureClock = true;
  try {
    await publishGitHubChecks(prisma, github, scanId);
  } finally {
    Date.now = realDateNow;
    skewFailureClock = false;
  }
  const databaseNow = (
    await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
  )[0]!.now;
  const delayed = await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId } });
  assert(
    delayed.nextAttemptAt > databaseNow,
    "Slow application clock must not bypass database-clock retry backoff",
  );
  assert(delayed.nextAttemptAt.getTime() < databaseNow.getTime() + 310_000);
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId } })).attempts,
    1,
  );
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
  assert.equal(createCount, 2);
  assert.equal(archiveRequests.length, 1);
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(createCount, 2);
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
  const beforeVerificationCreates: number = createCount;
  const beforeVerificationWrites = checkRequests.length;
  const verified = await verifyGitHubDelivery(prisma, github, org, delivery);
  assert.equal(verified.result, "PASS");
  assert.equal(verified.scope, "GITHUB_CHECK_OBSERVATION");
  assert.equal(verified.hashVerification, "VERIFIED");
  assert.equal(verified.signatureVerification, "UNSIGNED");
  assert.equal(verified.coverage, "COMPLETE");
  assert.equal(verified.conclusion, "success");
  for (const override of [
    { id: verified.checkRunId + 1 },
    { head_sha: shaB },
    { external_id: "other-scan" },
    { status: "in_progress" },
    { conclusion: "failure" },
  ]) {
    observedCheckOverride = override;
    await assert.rejects(
      verifyGitHubDelivery(prisma, github, org, delivery),
      /LIVE_CHECK_MISMATCH/,
    );
  }
  observedCheckOverride = undefined;
  let beforeLocalRefusal = providerCalls;
  await assert.rejects(verifyGitHubDelivery(prisma, github, other, delivery));
  assert.equal(providerCalls, beforeLocalRefusal, "Foreign tenant must fail before provider HTTP");
  const originalPublication = await prisma.gitHubCheckPublication.findUniqueOrThrow({
    where: { scanId },
  });
  for (const invalid of [
    { checkRunId: "9007199254740993" },
    { checkRunId: "00123" },
    { lastOutcome: "UNKNOWN" },
    { publishedState: "queued" },
  ]) {
    await prisma.gitHubCheckPublication.update({ where: { scanId }, data: invalid });
    beforeLocalRefusal = providerCalls;
    await assert.rejects(verifyGitHubDelivery(prisma, github, org, delivery));
    assert.equal(providerCalls, beforeLocalRefusal);
    await prisma.gitHubCheckPublication.update({
      where: { scanId },
      data: {
        checkRunId: originalPublication.checkRunId,
        lastOutcome: originalPublication.lastOutcome,
        publishedState: originalPublication.publishedState,
      },
    });
  }
  pass(
    "read-only verifier uses repository-scoped Checks-read auth; exact returned identity/conclusion and current tenant/projection are required",
  );

  const verifierReceipt = await prisma.securityReceipt.findUniqueOrThrow({ where: { scanId } });
  const originalVerifierPayload = securityReceiptSchema.parse(verifierReceipt.signedPayload);
  const {
    receiptHash: _verifierHash,
    coverage: verifierCoverage,
    ...verifierInput
  } = originalVerifierPayload;
  void _verifierHash;
  assert(verifierCoverage != null);
  const partialVerifierReceipt = createSecurityReceipt({
    ...verifierInput,
    evidence: [],
    coverage: { ...verifierCoverage, status: "PARTIAL" },
  });
  const legacyVerifierReceipt = createSecurityReceipt({ ...verifierInput, evidence: [] });
  for (const invalid of [
    {
      signedPayload: { ...originalVerifierPayload, gateResult: "BLOCK" },
      receiptHash: verifierReceipt.receiptHash,
    },
    { signedPayload: partialVerifierReceipt, receiptHash: partialVerifierReceipt.receiptHash },
    { signedPayload: legacyVerifierReceipt, receiptHash: legacyVerifierReceipt.receiptHash },
    { signedPayload: {}, receiptHash: verifierReceipt.receiptHash },
  ]) {
    await prisma.securityReceipt.update({
      where: { scanId },
      data: {
        signedPayload: JSON.parse(JSON.stringify(invalid.signedPayload)) as object,
        receiptHash: invalid.receiptHash,
      },
    });
    beforeLocalRefusal = providerCalls;
    await assert.rejects(
      verifyGitHubDelivery(prisma, github, org, delivery),
      /LIVE_RECEIPT_INCOMPLETE/,
    );
    assert.equal(providerCalls, beforeLocalRefusal);
  }
  await prisma.securityReceipt.update({
    where: { scanId },
    data: {
      signedPayload: verifierReceipt.signedPayload as object,
      receiptHash: verifierReceipt.receiptHash,
      signature: "synthetic-signature",
      keyId: "synthetic-key",
      signingAlgorithm: "ed25519",
    },
  });
  assert.equal(
    (await verifyGitHubDelivery(prisma, github, org, delivery)).signatureVerification,
    "NOT_VERIFIED",
  );
  await prisma.securityReceipt.update({
    where: { scanId },
    data: {
      signature: verifierReceipt.signature,
      keyId: verifierReceipt.keyId,
      signingAlgorithm: verifierReceipt.signingAlgorithm,
    },
  });
  pass(
    "verifier refuses tampered/partial/legacy-without-coverage/missing receipt payload before HTTP and never claims a present signature was verified",
  );

  const verifierRepository = await prisma.repository.findFirstOrThrow({
    where: { organizationId: org, externalId: "123" },
  });
  for (const change of ["suspend", "deselect", "unknown"]) {
    const pause = { arrived: deferred(), release: deferred() };
    readCheckPause = pause;
    const verifierTag = `verifier-${suffix}-${change}`;
    const verifierUrl = new URL(process.env.DATABASE_URL!);
    verifierUrl.searchParams.set("application_name", verifierTag);
    const verificationDb = new PrismaClient({ datasourceUrl: verifierUrl.href });
    const marked = await verificationDb.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_setting('application_name') AS name`;
    assert.equal(marked[0]!.name, verifierTag);
    const pendingVerification = verifyGitHubDelivery(verificationDb, github, org, delivery);
    const observer = new PrismaClient();
    try {
      await Promise.race([
        pause.arrived.promise,
        pendingVerification.then(() => {
          throw new Error("Verifier returned without reaching provider read");
        }),
      ]);
      const openTransactions = await observer.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_stat_activity WHERE application_name=${verifierTag} AND xact_start IS NOT NULL`;
      assert.equal(
        openTransactions[0]!.count,
        0n,
        "Verifier must hold no PostgreSQL transaction during provider HTTP",
      );
      if (change === "suspend")
        await observer.gitHubInstallation.update({
          where: { id: installation.id },
          data: { status: "SUSPENDED" },
        });
      if (change === "deselect")
        await observer.repository.update({
          where: { id: verifierRepository.id },
          data: { githubAccessible: false },
        });
      if (change === "unknown")
        await observer.gitHubCheckPublication.update({
          where: { scanId },
          data: { lastOutcome: "UNKNOWN" },
        });
      const beforeChangedRead = providerCalls;
      await assert.rejects(
        verifyGitHubDelivery(prisma, github, org, delivery),
        /LIVE_LIFECYCLE_INCOMPLETE/,
      );
      assert.equal(
        providerCalls,
        beforeChangedRead,
        "Already invalid local context must fail before provider HTTP",
      );
      pause.release.resolve();
      await assert.rejects(pendingVerification, /LIVE_CONTEXT_CHANGED/);
    } finally {
      pause.release.resolve();
      readCheckPause = undefined;
      await pendingVerification.catch(() => undefined);
      await verificationDb.$disconnect();
      await observer.$disconnect();
      await prisma.gitHubInstallation.update({
        where: { id: installation.id },
        data: { status: "ACTIVE" },
      });
      await prisma.repository.update({
        where: { id: verifierRepository.id },
        data: { githubAccessible: verifierRepository.githubAccessible },
      });
      await prisma.gitHubCheckPublication.update({
        where: { scanId },
        data: { lastOutcome: originalPublication.lastOutcome },
      });
    }
  }
  assert.equal(createCount, beforeVerificationCreates);
  assert.equal(
    checkRequests.length,
    beforeVerificationWrites,
    "Verification must perform no provider writes",
  );
  pass(
    "paused read-only verification holds no database transaction across HTTP and rejects in-flight suspend/deselect/unknown changes",
  );

  const renamed = await webhook(
    "pull_request",
    payload({ repository: { id: 123, full_name: "synthetic/renamed-repo" } }),
  );
  assert.equal(
    (await prisma.repository.findUniqueOrThrow({ where: { id: repository.id } })).fullName,
    "synthetic/renamed-repo",
  );
  const renameJob = await prisma.scanJob.findUniqueOrThrow({
    where: { scanId: renamed.body.scanId as string },
  });
  await requestJobCancellation(renameJob.id, org, { actor: "synthetic", correlationId: suffix });
  await publishGitHubChecks(prisma, github, renameJob.scanId);
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
  const blockedDelivery = await prisma.gitHubWebhookDelivery.findFirstOrThrow({
    where: { organizationId: org, scanId: blockedScan },
  });
  const verifiedBlock = await verifyGitHubDelivery(prisma, github, org, blockedDelivery.deliveryId);
  assert.equal(
    verifiedBlock.result,
    "PASS",
    "Successful observation does not mean the security gate allows",
  );
  assert.equal(verifiedBlock.conclusion, "failure");
  assert(!JSON.stringify(checkRequests).includes(rawFinding));
  assert(
    !JSON.stringify(await prisma.finding.findMany({ where: { scanId: blockedScan } })).includes(
      rawFinding,
    ),
  );
  const cancelled = await webhook("pull_request", payload());
  const cancelledScan = cancelled.body.scanId as string;
  const cancelJob = await prisma.scanJob.findUniqueOrThrow({ where: { scanId: cancelledScan } });
  await requestJobCancellation(cancelJob.id, org, { actor: "synthetic", correlationId: suffix });
  await publishGitHubChecks(prisma, github, cancelledScan);
  assert.equal(checkRequests.at(-1)!.conclusion, "cancelled");
  assert.equal(await renewScanJobLease(job.id, "old-attempt"), false);
  const requestsBeforeStale = checkRequests.length;
  await assert.rejects(
    executor.execute({
      scanId,
      payload: job.payload,
      signal: new AbortController().signal,
      lease: { owner: "old-attempt", attempt: job.attempts },
    }),
    /WORKER_LEASE_LOST/,
  );
  assert.equal(checkRequests.length, requestsBeforeStale);
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
  await requestJobCancellation(uncertainJob.id, org, { actor: "synthetic", correlationId: suffix });
  await publishGitHubChecks(prisma, github, uncertainScan);
  pass(
    "blocking findings yield failure with redacted output; cancellation yields cancelled; expired/completed worker lease rejected",
  );
  // Real provider HTTP pauses after creating its object; the database must remain usable.
  const pausedDelivery = await webhook("pull_request", payload());
  const pausedScan = pausedDelivery.body.scanId as string;
  const observer = new PrismaClient();
  const arrived = deferred(),
    release = deferred();
  pauseReply = { externalId: pausedScan, arrived, release };
  const delayedPublisher = publishGitHubChecks(prisma, github, pausedScan);
  try {
    await Promise.race([
      arrived.promise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Provider pause was not reached")), 5000);
        timer.unref();
      }),
    ]);
    await observer.$transaction(
      async (tx) => {
        const locks = await tx.$queryRaw<
          Array<{ locked: boolean }>
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`github-check:${pausedScan}`}, 0)) AS locked`;
        if (!locks[0]?.locked)
          console.warn(
            "FAIL: publication advisory transaction lock remains held during real provider HTTP",
          );
        assert.equal(locks[0]!.locked, true, "No publication transaction may span provider HTTP");
        await tx.$queryRaw`SELECT "id" FROM "ScanJob" WHERE "scanId"=${pausedScan} FOR UPDATE NOWAIT`;
      },
      { timeout: 1500 },
    );
    const activeClaim = await observer.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: pausedScan },
    });
    assert(activeClaim.leaseOwner != null);
    assert.equal(activeClaim.lastOutcome, "IN_FLIGHT");
    const beforeConcurrent = createCount;
    await publishGitHubChecks(prisma, github, pausedScan);
    assert.equal(createCount, beforeConcurrent, "Live publication lease excludes another create");
    const pausedJob = await observer.scanJob.findUniqueOrThrow({ where: { scanId: pausedScan } });
    await requestJobCancellation(pausedJob.id, org, { actor: "synthetic", correlationId: suffix });
    // Synthetic crash/lease expiry while the old HTTP response is still outstanding.
    await observer.gitHubCheckPublication.update({
      where: { scanId: pausedScan },
      data: { leaseExpiresAt: new Date(0) },
    });
    await publishGitHubChecks(prisma, github, pausedScan);
    assert.equal(createCount, beforeConcurrent);
    const recovered = await observer.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: pausedScan },
    });
    assert.equal(recovered.generation, activeClaim.generation + 1);
    assert.equal(recovered.status, "COMPLETE");
    assert.equal(recovered.publishedState, "completed:CANCELLED");
    release.resolve();
    await delayedPublisher;
    const afterStale = await observer.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: pausedScan },
    });
    assert.equal(afterStale.generation, recovered.generation);
    assert.equal(afterStale.status, "COMPLETE");
    assert.equal(afterStale.publishedState, "completed:CANCELLED");
    assert.equal(
      await observer.auditEvent.count({
        where: { organizationId: org, entityId: pausedScan, action: "GITHUB_CHECK_PUBLISHED" },
      }),
      1,
    );
  } finally {
    release.resolve();
    await delayedPublisher;
    pauseReply = undefined;
    await observer.$disconnect();
  }
  pass(
    "paused real provider holds no publication/job transaction lock; concurrent claim excluded; cancellation and generation takeover reject stale finalizer",
  );

  // A valid finalizer can hold its row past lease expiry while its audit is blocked.
  // The next claimant must lock/reload that row, not overwrite an earlier MVCC snapshot.
  const finalizationDelivery = await webhook("pull_request", payload());
  const finalizationScan = finalizationDelivery.body.scanId as string;
  const finalizationJob = await prisma.scanJob.findUniqueOrThrow({
    where: { scanId: finalizationScan },
  });
  await requestJobCancellation(finalizationJob.id, org, {
    actor: "synthetic",
    correlationId: suffix,
  });
  const finalizeObserver = new PrismaClient();
  const barrier = Number.parseInt(suffix.replaceAll("-", "").slice(0, 7), 16) + 1_000_000;
  const holderReady = deferred(),
    holderRelease = deferred();
  let holderPid = 0;
  const holder = finalizeObserver.$transaction(
    async (tx) => {
      holderPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]!
        .pid;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${barrier}::bigint)`;
      holderReady.resolve();
      await holderRelease.promise;
    },
    { timeout: 10000 },
  );
  await holderReady.promise;
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "${failureTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${barrier}::bigint); RETURN NEW; END; $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${failureTrigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW WHEN (NEW."organizationId" = '${org}' AND NEW."entityId" = '${finalizationScan}' AND NEW."action"::text = 'GITHUB_CHECK_PUBLISHED') EXECUTE FUNCTION "${failureTrigger}"()`,
  );
  const finalizationArrived = deferred(),
    finalizationRelease = deferred();
  pauseReply = {
    externalId: finalizationScan,
    arrived: finalizationArrived,
    release: finalizationRelease,
  };
  let validFinalizer: Promise<void> | undefined, nextClaimant: Promise<void> | undefined;
  try {
    validFinalizer = publishGitHubChecks(prisma, github, finalizationScan);
    await Promise.race([
      finalizationArrived.promise,
      validFinalizer.then(() => {
        throw new Error("Expected provider pause before finalization");
      }),
    ]);
    const originalClaim = await finalizeObserver.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: finalizationScan },
    });
    const expiry = new Date(Date.now() + 2000);
    await finalizeObserver.gitHubCheckPublication.update({
      where: { scanId: finalizationScan },
      data: { leaseExpiresAt: expiry },
    });
    finalizationRelease.resolve();
    let finalizerPid: number | undefined;
    for (let probe = 0; probe < 100; probe++) {
      const rows = await finalizeObserver.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%AuditEvent%'`;
      if (rows.length) {
        finalizerPid = rows[0]!.pid;
        break;
      }
      await delay(10);
    }
    assert(finalizerPid != null, "Actual successful finalizer must be blocked at its audit");
    await delay(Math.max(1, expiry.getTime() - Date.now() + 30));
    nextClaimant = publishGitHubChecks(prisma, github, finalizationScan);
    let claimantWaiting = false;
    for (let probe = 0; probe < 100; probe++) {
      const rows = await finalizeObserver.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${finalizerPid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%GitHubCheckPublication%' AND wait_event_type='Lock') AS waiting`;
      if (rows[0]!.waiting) {
        claimantWaiting = true;
        break;
      }
      await delay(10);
    }
    assert(claimantWaiting, "Contender must actually wait for the successful finalization row");
    const callsBeforeRelease = providerCalls;
    holderRelease.resolve();
    await holder;
    await validFinalizer;
    await nextClaimant;
    const terminalRow = await finalizeObserver.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: finalizationScan },
    });
    assert.equal(terminalRow.status, "COMPLETE");
    assert.equal(
      terminalRow.lastOutcome,
      "OBSERVED",
      "A stale claim snapshot must not overwrite successful finalization",
    );
    assert.equal(terminalRow.leaseOwner, null);
    assert.equal(terminalRow.generation, originalClaim.generation);
    assert.equal(
      providerCalls,
      callsBeforeRelease,
      "The stale claimant must not dispatch after observing committed completion",
    );
  } finally {
    holderRelease.resolve();
    finalizationRelease.resolve();
    await holder;
    await Promise.allSettled(
      [validFinalizer, nextClaimant].filter((value): value is Promise<void> => value != null),
    );
    pauseReply = undefined;
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${failureTrigger}" ON "AuditEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failureTrigger}"()`);
    await finalizeObserver.$disconnect();
  }
  pass(
    "a claimant waiting past lease expiry reloads committed successful finalization instead of overwriting it or dispatching again",
  );

  const rejectedClaimDelivery = await webhook("pull_request", payload());
  const rejectedClaimScan = rejectedClaimDelivery.body.scanId as string;
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "${failureTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = '${org}' AND NEW."entityId" = '${rejectedClaimScan}' AND NEW."action"::text = 'GITHUB_CHECK_CLAIMED' THEN RAISE EXCEPTION 'Synthetic claim audit failure'; END IF; RETURN NEW; END; $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${failureTrigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${failureTrigger}"()`,
  );
  const beforeRejectedClaimCalls = providerCalls;
  try {
    await assert.rejects(publishGitHubChecks(prisma, github, rejectedClaimScan));
    assert.equal(
      providerCalls,
      beforeRejectedClaimCalls,
      "Claim audit failure must prevent all provider HTTP",
    );
    const failedClaim = await prisma.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: rejectedClaimScan },
    });
    assert.equal(failedClaim.generation, 0);
    assert.equal(failedClaim.leaseOwner, null);
    assert.equal(failedClaim.createMayHaveOccurred, false);
    assert.equal(
      await prisma.auditEvent.count({
        where: { organizationId: org, entityId: rejectedClaimScan, action: "GITHUB_CHECK_CLAIMED" },
      }),
      0,
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER "${failureTrigger}" ON "AuditEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${failureTrigger}"()`);
  }
  const rejectedClaimJob = await prisma.scanJob.findUniqueOrThrow({
    where: { scanId: rejectedClaimScan },
  });
  await requestJobCancellation(rejectedClaimJob.id, org, {
    actor: "synthetic",
    correlationId: suffix,
  });
  await publishGitHubChecks(prisma, github, rejectedClaimScan);
  pass(
    "real claim-audit failure rolls back generation/lease/dispatch marker and prevents every provider HTTP call",
  );

  const rollbackDelivery = await webhook("pull_request", payload());
  const rollbackScan = rollbackDelivery.body.scanId as string;
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "${failureTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = '${org}' AND NEW."entityId" = '${rollbackScan}' AND NEW."action"::text = 'GITHUB_CHECK_PUBLISHED' THEN RAISE EXCEPTION 'Synthetic publication audit failure'; END IF; RETURN NEW; END; $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${failureTrigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${failureTrigger}"()`,
  );
  const beforeRollbackCreate = createCount;
  try {
    await assert.rejects(publishGitHubChecks(prisma, github, rollbackScan));
    const row = await prisma.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: rollbackScan },
    });
    assert.equal(row.checkRunId, null);
    assert.equal(row.lastOutcome, "IN_FLIGHT");
    assert.equal(row.createMayHaveOccurred, true);
    assert.equal(createCount, beforeRollbackCreate + 1);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER "${failureTrigger}" ON "AuditEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${failureTrigger}"()`);
  }
  await prisma.gitHubCheckPublication.update({
    where: { scanId: rollbackScan },
    data: { leaseExpiresAt: new Date(0) },
  });
  await publishGitHubChecks(prisma, github, rollbackScan);
  assert.equal(createCount, beforeRollbackCreate + 1);
  assert(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId: rollbackScan } }))
      .checkRunId != null,
  );
  const rollbackJob = await prisma.scanJob.findUniqueOrThrow({ where: { scanId: rollbackScan } });
  await requestJobCancellation(rollbackJob.id, org, { actor: "synthetic", correlationId: suffix });
  await publishGitHubChecks(prisma, github, rollbackScan);
  pass(
    "real audit failure after remote create rolls back finalization; expired dispatch reconciles existing object without duplicate create",
  );

  for (const field of ["external_id", "head_sha"] as const) {
    const mismatched = await webhook("pull_request", payload());
    const mismatchedScan = mismatched.body.scanId as string;
    const beforeMismatch: number = createCount;
    mismatchedCreateField = field;
    await publishGitHubChecks(prisma, github, mismatchedScan);
    mismatchedCreateField = undefined;
    const uncertain = await prisma.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: mismatchedScan },
    });
    assert.equal(
      uncertain.checkRunId,
      null,
      "Mismatched success must not bind returned provider ID",
    );
    assert.equal(uncertain.lastOutcome, "UNKNOWN");
    assert.equal(uncertain.createMayHaveOccurred, true);
    await prisma.gitHubCheckPublication.update({
      where: { scanId: mismatchedScan },
      data: { nextAttemptAt: new Date(0) },
    });
    await publishGitHubChecks(prisma, github, mismatchedScan);
    assert.equal(
      createCount,
      beforeMismatch + 1,
      "Reconcile the actual object without a second create",
    );
    assert.equal(
      (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId: mismatchedScan } }))
        .checkRunId,
      String(checkRuns.find((run) => run.external_id === mismatchedScan)!.id),
    );
    const mismatchJob = await prisma.scanJob.findUniqueOrThrow({
      where: { scanId: mismatchedScan },
    });
    await requestJobCancellation(mismatchJob.id, org, {
      actor: "synthetic",
      correlationId: suffix,
    });
    await publishGitHubChecks(prisma, github, mismatchedScan);
  }
  pass(
    "mismatched successful create identity remains unbound and UNKNOWN; exact lookup recovers the real object",
  );

  const selectionBefore = await prisma.repository.findMany({
    where: { organizationId: org },
    orderBy: { id: "asc" },
  });
  const snapshotClient = new FetchGitHubAppClient(
    { appId: "123", privateKey: pem, webhookSecret: secret },
    {
      fetchImpl: (input) => {
        const endpoint = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (endpoint.pathname.endsWith("/access_tokens"))
          return Promise.resolve(
            Response.json({
              token: ["synthetic", "snapshot"].join("-"),
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }),
          );
        const page = Number(endpoint.searchParams.get("page"));
        return Promise.resolve(
          Response.json({
            total_count: 102,
            repositories: Array.from({ length: page === 1 ? 100 : 2 }, (_, index) => ({
              id: page === 1 ? index + 1 : index + 100,
              full_name: `synthetic/overlap-${page}-${index}`,
              private: true,
              default_branch: "main",
            })),
          }),
        );
      },
    },
  );
  await assert.rejects(
    synchronizeGitHubRepositories(prisma, snapshotClient, {
      organizationId: org,
      installationId,
      accountLogin: "synthetic",
    }),
    /GITHUB_REPOSITORY_SNAPSHOT_INCOMPLETE/,
  );
  assert.deepEqual(
    await prisma.repository.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
    selectionBefore,
    "Rejected snapshot must preserve every existing customer mapping",
  );
  pass(
    "overlapping repository pages fail before synchronization mutates persisted customer mappings",
  );

  for (const status of [401, 403, 404, 422]) {
    const refused = await webhook("pull_request", payload());
    const refusedScan = refused.body.scanId as string;
    const beforeRefused: number = createCount;
    rejectedCreateStatus = status;
    await publishGitHubChecks(prisma, github, refusedScan);
    rejectedCreateStatus = 0;
    const refusedPublication = await prisma.gitHubCheckPublication.findUniqueOrThrow({
      where: { scanId: refusedScan },
    });
    assert.equal(refusedPublication.status, "STOPPED");
    assert.equal(refusedPublication.failureCode, `GITHUB_HTTP_${status}`);
    assert.equal(refusedPublication.createMayHaveOccurred, false);
    assert.equal(refusedPublication.lastOutcome, "NOT_DISPATCHED");
    assert.equal(createCount, beforeRefused);
    // Same state transition as the operator retry-check command, preserving uncertainty markers.
    await prisma.gitHubCheckPublication.update({
      where: { scanId: refusedScan },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(0) },
    });
    await publishGitHubChecks(prisma, github, refusedScan);
    assert.equal(createCount, beforeRefused + 1);
    assert(
      (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId: refusedScan } }))
        .checkRunId != null,
    );
    const refusedJob = await prisma.scanJob.findUniqueOrThrow({ where: { scanId: refusedScan } });
    await requestJobCancellation(refusedJob.id, org, { actor: "synthetic", correlationId: suffix });
    await publishGitHubChecks(prisma, github, refusedScan);
  }
  pass(
    "definitive create rejections stop without uncertainty; operator retry can create after correction",
  );

  const invisible = await webhook("pull_request", payload());
  const invisibleScan = invisible.body.scanId as string;
  hiddenCheckIds.add(invisibleScan);
  uncertainCreate = true;
  const beforeInvisibleCreate = createCount;
  for (let attempt = 0; attempt < 10; attempt++) {
    await prisma.gitHubCheckPublication.update({
      where: { scanId: invisibleScan },
      data: { nextAttemptAt: new Date(0) },
    });
    await publishGitHubChecks(prisma, github, invisibleScan);
  }
  const unknown = await prisma.gitHubCheckPublication.findUniqueOrThrow({
    where: { scanId: invisibleScan },
  });
  assert.equal(unknown.attempts, 10);
  assert.equal(unknown.status, "STOPPED");
  assert.equal(unknown.lastOutcome, "UNKNOWN");
  assert.equal(unknown.checkRunId, null);
  assert.equal(
    createCount,
    beforeInvisibleCreate + 1,
    "Missing provider visibility must not trigger a second create",
  );
  hiddenCheckIds.delete(invisibleScan);
  const invisibleJob = await prisma.scanJob.findUniqueOrThrow({ where: { scanId: invisibleScan } });
  await requestJobCancellation(invisibleJob.id, org, { actor: "synthetic", correlationId: suffix });
  pass(
    "ambiguous invisible create remains UNKNOWN; ten-attempt reconciliation budget stops without a blind duplicate",
  );

  const completeReceipt = await prisma.securityReceipt.findUniqueOrThrow({ where: { scanId } });
  const parsedReceipt = securityReceiptSchema.parse(completeReceipt.signedPayload);
  const { receiptHash: _oldHash, ...receiptInput } = parsedReceipt;
  void _oldHash;
  assert(receiptInput.coverage != null);
  const partial = createSecurityReceipt({
    ...receiptInput,
    evidence: [],
    coverage: { ...receiptInput.coverage, status: "PARTIAL" },
  });
  await prisma.securityReceipt.update({
    where: { scanId },
    data: {
      signedPayload: JSON.parse(JSON.stringify(partial)) as object,
      receiptHash: partial.receiptHash,
    },
  });
  await prisma.gitHubCheckPublication.update({
    where: { scanId },
    data: { status: "PENDING", publishedState: null, nextAttemptAt: new Date(0) },
  });
  try {
    await publishGitHubChecks(prisma, github, scanId);
    assert.equal(checkRequests.at(-1)!.conclusion, "action_required");
    assert.match(JSON.stringify(checkRequests.at(-1)!.output), /incomplete/);
  } finally {
    await prisma.securityReceipt.update({
      where: { scanId },
      data: {
        signedPayload: completeReceipt.signedPayload as object,
        receiptHash: completeReceipt.receiptHash,
      },
    });
  }
  pass(
    "valid-hash partial evidence cannot produce a successful Check even with no blocking findings",
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
  await prisma.gitHubCheckPublication.update({
    where: { scanId },
    data: { status: "PENDING", publishedState: null, nextAttemptAt: new Date() },
  });
  await publishGitHubChecks(prisma, github, scanId);
  assert.equal(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId } })).status,
    "STOPPED",
  );
  assert.equal(
    (await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).status,
    "COMPLETED",
  );
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
  const fairIds = Array.from({ length: 25 }, (_, index) => `fair-${suffix}-${index}`);
  const foreignFair = `fair-foreign-${suffix}`;
  await prisma.scan.createMany({
    data: [
      ...fairIds.map((id) => ({
        id,
        organizationId: org,
        repositoryName: "synthetic/fairness",
        branch: "main",
      })),
      {
        id: foreignFair,
        organizationId: other,
        repositoryName: "synthetic/foreign-fairness",
        branch: "main",
      },
    ],
  });
  await prisma.gitHubCheckPublication.createMany({
    data: [
      ...fairIds.map((id, index) => ({
        scanId: id,
        nextAttemptAt: new Date(index),
        updatedAt: new Date(),
      })),
      { scanId: foreignFair, nextAttemptAt: new Date(100), updatedAt: new Date() },
    ],
  });
  // Missing provider authority stops these synthetic rows before HTTP. Their selection
  // still exercises the actual tenant-lane SQL and the twenty-item work bound.
  await publishGitHubChecks(prisma, github);
  assert.equal(
    (await prisma.gitHubCheckPublication.findUniqueOrThrow({ where: { scanId: foreignFair } }))
      .status,
    "STOPPED",
  );
  assert.equal(
    await prisma.gitHubCheckPublication.count({
      where: { scanId: { in: fairIds }, status: "STOPPED" },
    }),
    19,
  );
  assert.equal(
    await prisma.gitHubCheckPublication.count({
      where: { scanId: { in: fairIds }, status: "PENDING" },
    }),
    6,
  );
  pass(
    "actual tenant-lane selection includes another tenant ahead of a 25-item backlog and respects the twenty-item bound",
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
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${failureTrigger}" ON "AuditEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failureTrigger}"()`);
    pauseReply?.release.resolve();
    readCheckPause?.release.resolve();
    await close(api);
    await close(provider);
    await prisma.gitHubWebhookDelivery.deleteMany({
      where: { organizationId: { in: [org, other] } },
    });
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await prisma.securityReceipt.deleteMany({ where: { scan: { organizationId: org } } });
    await prisma.scan.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await prisma.repository.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await prisma.gitHubInstallation.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await prisma.$disconnect();
  });
