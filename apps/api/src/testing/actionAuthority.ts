import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { Server } from "node:http";
import express from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createServer } from "../server.js";
import { runConfiguredScan } from "../services/scanService.js";
import { assertSafeSeedTarget } from "../services/seedSafety.js";
import {
  POLICY_RULE_VERSION,
  createSecurityReceipt,
  canonicalJson,
} from "@agentshield/policy-engine";
import { securityReceiptSchema, type AuthorityContext } from "@agentshield/schemas";

assertSafeSeedTarget(process.env.NODE_ENV, process.env.DATABASE_URL ?? "");
assert.equal(process.env.AGENTSHIELD_DISPOSABLE_DATABASE, "true");
const db = new PrismaClient();
const tag = randomUUID().replaceAll("-", "");
const org = `authority-${tag}`,
  foreignOrg = `foreign-${tag}`;
const actor = `requester-${tag}`,
  reviewer = `reviewer-${tag}`;
const repo = `repo-${tag}`,
  sessionId = `session-${tag}`;
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const guard = `authority_${tag}`;
const directory = await mkdtemp(path.join(os.tmpdir(), "agentshield-authority-"));
let apiServer: Server | undefined, keyServer: Server | undefined;
let groups = 0;
const pass = (message: string) => {
  groups++;
  console.warn(`PASS action-authority: ${message}`);
};
async function listen(app: ReturnType<typeof express>) {
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function url(server: Server) {
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server | undefined) {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
type IntentView = {
  id: string;
  created: boolean;
  context: AuthorityContext;
  contextDigest: string;
  status: string;
  dispatchEnabled: false;
};
type OperationView = {
  id: string;
  authorizationId: string;
  contextDigest: string;
  state: string;
  dispatchEnabled: false;
  observedOutcome: string;
};
type PolicyView = { revision: string; mode: string };
async function main() {
  await db.organization.createMany({
    data: [
      { id: org, slug: org, name: "Synthetic authority tenant" },
      { id: foreignOrg, slug: foreignOrg, name: "Foreign authority tenant" },
    ],
  });
  const installation = await db.gitHubInstallation.create({
    data: { organizationId: org, installationId: 7654321, accountLogin: org },
  });
  await db.repository.create({
    data: {
      id: repo,
      organizationId: org,
      provider: "GITHUB",
      externalId: "9007199254740993",
      fullName: "synthetic/authority",
      githubInstallationId: installation.id,
    },
  });
  await db.agentSession.create({
    data: {
      id: sessionId,
      organizationId: org,
      repositoryId: repo,
      actor,
      source: "test",
      taskSummary: "Authorization regression",
      correlationId: tag,
    },
  });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "authority-regression", version: "1.0.0" }),
  );
  const scan = await db.scan.create({
    data: {
      organizationId: org,
      repositoryId: repo,
      repositoryName: "synthetic/authority",
      branch: "main",
      commitSha,
      status: "QUEUED",
    },
  });
  process.env.RECEIPT_SIGNING_PRIVATE_KEY = "";
  process.env.RECEIPT_SIGNING_KEY_ID = "";
  await runConfiguredScan(
    {
      source: "MANUAL",
      targetPath: directory,
      targetPathLabel: "authority-fixture",
      repositoryName: "synthetic/authority",
      branch: "main",
      commitSha,
      organizationId: org,
      triggeredBy: actor,
      correlationId: tag,
      labels: [],
      policyBundleVersion: POLICY_RULE_VERSION,
      options: {
        maxFiles: 100,
        maxBytes: 100000,
        timeoutMs: 10000,
        ignorePaths: [],
        includeOsv: false,
      },
    },
    scan.id,
  );
  const receipt = await db.securityReceipt.findUniqueOrThrow({ where: { scanId: scan.id } });
  const originalReceipt = securityReceiptSchema.parse(receipt.signedPayload);
  assert.equal(originalReceipt.coverage?.status, "COMPLETE");
  assert.equal(originalReceipt.gateResult, "ALLOW");

  const pair = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: tag, alg: "RS256", use: "sig" };
  const keys = express();
  keys.get("/keys", (_req, res) => res.json({ keys: [jwk] }));
  keyServer = await listen(keys);
  Object.assign(process.env, {
    NODE_ENV: "test",
    AUTH_MODE: "oidc",
    DEMO_AUTH_ENABLED: "false",
    OIDC_ISSUER: url(keyServer),
    OIDC_JWKS_URL: `${url(keyServer)}/keys`,
    OIDC_AUDIENCE: "action-authority-test",
    OIDC_ROLE_CLAIM: "role",
    RATE_LIMIT_ENABLED: "false",
    GITHUB_WEBHOOK_ENABLED: "false",
    GITHUB_SCAN_LIFECYCLE_ENABLED: "false",
    GITHUB_MATERIALIZATION_ENABLED: "false",
  });
  apiServer = await listen(createServer());
  const prefix = "/api/v1/action-authority";
  async function call<T = IntentView>(
    route: string,
    body?: unknown,
    options: {
      subject?: string;
      role?: string;
      org?: string;
      method?: string;
      bearer?: string;
    } = {},
  ) {
    const token =
      options.bearer ??
      (await new SignJWT({ organization_id: options.org ?? org, role: options.role ?? "DEVELOPER" })
        .setProtectedHeader({ alg: "RS256", kid: tag })
        .setSubject(options.subject ?? actor)
        .setIssuer(url(keyServer!))
        .setAudience("action-authority-test")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(pair.privateKey));
    const response = await fetch(
      `${url(apiServer!)}${route.startsWith("/api/") ? route : prefix + route}`,
      {
        method: options.method ?? (body == null ? "GET" : "POST"),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      body: JSON.parse(text) as { data?: T; error?: { code: string } },
      text,
    };
  }
  async function error(
    route: string,
    body: unknown,
    status: number,
    code: string,
    options: Parameters<typeof call>[2] = {},
  ) {
    const result = await call(route, body, options);
    assert.equal(result.status, status, result.text);
    assert.equal(result.body.error?.code, code);
    return result;
  }
  const input = (key: string, patch: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    normalizationVersion: 1,
    actionType: "GITHUB_CREATE_REF",
    sessionId,
    repositoryId: repo,
    evidenceScanId: scan.id,
    commitSha,
    parameters: { ref: "refs/heads/agentshield/reviewed", targetMustBeAbsent: true },
    idempotencyKey: `intent-${key}-${tag}`,
    ...patch,
  });
  async function submit(key: string, patch: Record<string, unknown> = {}) {
    const result = await call("/intents", input(key, patch));
    assert.equal(result.status, 201, result.text);
    return result.body.data!;
  }
  async function approve(intent: IntentView) {
    const result = await call(
      `/intents/${intent.id}/review`,
      { contextDigest: intent.contextDigest, decision: "APPROVED" },
      { subject: reviewer, role: "SECURITY_REVIEWER" },
    );
    assert.equal(result.status, 200, result.text);
  }
  const admission = (intent: IntentView, key: string) => ({
    authorizationId: intent.id,
    contextDigest: intent.contextDigest,
    operationKey: `operation-${key}-${tag}`,
  });
  async function setPolicy(mode: string, expectedRevision: string | null) {
    const result = await call<PolicyView>(
      "/policy",
      { mode, expectedRevision },
      { role: "POLICY_ADMINISTRATOR", subject: `policy-${tag}`, method: "PUT" },
    );
    assert.equal(result.status, 200, result.text);
    return result.body.data!;
  }
  let activePolicy: PolicyView;
  await error("/intents", input("unconfigured"), 503, "ACTION_AUTHORITY_UNCONFIGURED");
  await error("/policy", { mode: "REQUIRE_APPROVAL", expectedRevision: null }, 403, "FORBIDDEN", {
    method: "PUT",
  });
  activePolicy = await setPolicy("REQUIRE_APPROVAL", null);
  await error("/intents", input("viewer"), 403, "FORBIDDEN", { role: "VIEWER" });
  assert.equal((await call("/intents", input("invalid-auth"), { bearer: "invalid" })).status, 401);
  await error(
    "/intents",
    { ...input("forged-owner"), organizationId: foreignOrg, actor: reviewer },
    400,
    "VALIDATION_ERROR",
  );
  await error("/intents", input("foreign"), 503, "ACTION_AUTHORITY_UNCONFIGURED", {
    org: foreignOrg,
  });
  await error(
    "/policy",
    { mode: "REQUIRE_APPROVAL", expectedRevision: null },
    409,
    "POLICY_REVISION_CONFLICT",
    { role: "POLICY_ADMINISTRATOR", subject: `policy-${tag}`, method: "PUT" },
  );
  const foreignPolicy = await call<PolicyView>(
    "/policy",
    { mode: "REQUIRE_APPROVAL", expectedRevision: null },
    { org: foreignOrg, role: "POLICY_ADMINISTRATOR", subject: reviewer, method: "PUT" },
  );
  assert.equal(foreignPolicy.status, 200, foreignPolicy.text);
  await error("/intents", input("foreign-configured"), 404, "SESSION_NOT_FOUND", {
    org: foreignOrg,
  });
  pass("real signed OIDC, RBAC, strict ownership fields, unconfigured policy fails closed");

  const wireToken = await new SignJWT({ organization_id: org, role: "DEVELOPER" })
    .setProtectedHeader({ alg: "RS256", kid: tag })
    .setSubject(actor)
    .setIssuer(url(keyServer))
    .setAudience("action-authority-test")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(pair.privateKey);
  for (const body of [
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"schemaVersion":1.0}',
    '{"schema\\u0056ersion":1}',
  ]) {
    const result = await fetch(url(apiServer) + prefix + "/intents", {
      method: "POST",
      headers: { authorization: `Bearer ${wireToken}`, "content-type": "application/json" },
      body,
    });
    assert.equal(result.status, 400);
    assert.equal(
      ((await result.json()) as { error: { code: string } }).error.code,
      "AMBIGUOUS_JSON",
    );
  }
  const duplicatedPrecondition = JSON.stringify(input("wire-duplicate")).replace(
    '"targetMustBeAbsent":true',
    '"targetMustBeAbsent":false,"targetMustBeAbsent":true',
  );
  const wireResponse = await fetch(url(apiServer) + prefix.toUpperCase() + "/intents", {
    method: "POST",
    headers: { authorization: `Bearer ${wireToken}`, "content-type": "application/json" },
    body: duplicatedPrecondition,
  });
  assert.equal(wireResponse.status, 400);
  assert.equal(
    ((await wireResponse.json()) as { error: { code: string } }).error.code,
    "AMBIGUOUS_JSON",
  );
  assert.equal(
    await db.actionAuthorization.count({
      where: { organizationId: org, idempotencyKey: input("wire-duplicate").idempotencyKey },
    }),
    0,
  );
  await error("/policy?actor=forged", undefined, 400, "VALIDATION_ERROR");
  const legacy = await call<{ id: string; actionDigest: string }>("/api/v1/agent/approvals", {
    organizationId: org,
    sessionId,
    actor,
    action: "RUN_COMMAND",
    resource: "workspace",
    correlationId: tag,
    idempotencyKey: `legacy-${tag}`,
  });
  assert.equal(legacy.status, 201, legacy.text);
  assert.equal(
    (
      await call(
        `/api/v1/agent/approvals/${legacy.body.data!.id}/approve`,
        {},
        { subject: reviewer, role: "SECURITY_REVIEWER" },
      )
    ).status,
    200,
  );
  await error(
    "/operations",
    {
      authorizationId: legacy.body.data!.id,
      contextDigest: legacy.body.data!.actionDigest,
      operationKey: `legacy-operation-${tag}`,
    },
    404,
    "ACTION_AUTHORIZATION_NOT_FOUND",
  );
  const credentialKey = ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("");
  await error(
    "/intents",
    input("credential-key", { idempotencyKey: credentialKey }),
    400,
    "VALIDATION_ERROR",
  );
  for (const ref of [
    "refs/heads/main",
    "refs/heads/agentshield/a/../main",
    "refs/heads/agentshield/a%2fb",
    "refs/heads/agentshield/a//b",
    "refs/heads/agentshield/a.lock",
    "refs/heads/agentshield/é",
    "refs/heads/agentshield/a\\b",
    "refs/heads/agentshield/a/",
    "refs/heads/agentshield/" + ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join(""),
  ])
    await error(
      "/intents",
      input(`bad-ref-${randomUUID()}`, { parameters: { ref, targetMustBeAbsent: true } }),
      400,
      "VALIDATION_ERROR",
    );
  for (const patch of [
    { parameters: { ref: "refs/heads/agentshield/reviewed", targetMustBeAbsent: false } },
    { commitSha: "abc1234" },
    { schemaVersion: 2 },
    { normalizationVersion: 2 },
    {
      parameters: { ref: "refs/heads/agentshield/reviewed", targetMustBeAbsent: true, force: true },
    },
  ])
    await error("/intents", input(`bad-shape-${randomUUID()}`, patch), 400, "VALIDATION_ERROR");
  const concurrent = await Promise.all([
    call("/intents", input("same")),
    call("/intents", input("same", { commitSha: commitSha.toUpperCase() })),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 201]);
  const exact = concurrent[0].body.data!;
  assert.equal(exact.id, concurrent[1].body.data!.id);
  assert.equal(exact.context.providerRepositoryId, "9007199254740993");
  assert.equal(exact.context.providerInstallationId, "7654321");
  assert.equal(exact.context.commitSha, commitSha);
  assert.equal(exact.dispatchEnabled, false);
  await error(
    "/intents",
    input("same", {
      parameters: { ref: "refs/heads/agentshield/changed", targetMustBeAbsent: true },
    }),
    409,
    "ACTION_IDEMPOTENCY_CONFLICT",
  );
  await error(`/intents/${exact.id}`, undefined, 404, "ACTION_AUTHORIZATION_NOT_FOUND", {
    org: foreignOrg,
  });
  await error(`/intents/${exact.id}`, undefined, 404, "ACTION_AUTHORIZATION_NOT_FOUND", {
    subject: "other-actor",
  });
  await error("/intents", input("other-actor-session"), 404, "SESSION_NOT_FOUND", {
    subject: "other-actor",
  });
  await error(
    `/intents/${exact.id}/review`,
    { contextDigest: exact.contextDigest, decision: "APPROVED" },
    403,
    "SELF_APPROVAL_FORBIDDEN",
    { role: "ORGANIZATION_ADMINISTRATOR" },
  );
  await error(
    `/intents/${exact.id}/review`,
    { contextDigest: "0".repeat(64), decision: "APPROVED" },
    409,
    "ACTION_REVIEW_CONFLICT",
    { role: "SECURITY_REVIEWER", subject: reviewer },
  );
  const reviewed = await Promise.all([
    call(
      `/intents/${exact.id}/review`,
      { contextDigest: exact.contextDigest, decision: "APPROVED" },
      { role: "SECURITY_REVIEWER", subject: reviewer },
    ),
    call(
      `/intents/${exact.id}/review`,
      { contextDigest: exact.contextDigest, decision: "APPROVED" },
      { role: "SECURITY_REVIEWER", subject: `reviewer-two-${tag}` },
    ),
  ]);
  assert.deepEqual(reviewed.map((result) => result.status).sort(), [200, 409]);
  pass(
    "encoding ambiguity, unknown fields, full commit and large provider ID binding, concurrent idempotency and independent exact review",
  );

  const races = await Promise.all([
    call<OperationView>("/operations", admission(exact, "same-operation")),
    call<OperationView>("/operations", admission(exact, "same-operation")),
  ]);
  assert(races.every((result) => result.status === 200));
  const operation = races[0].body.data!;
  assert.equal(operation.id, races[1].body.data!.id);
  assert.equal(operation.state, "HELD");
  assert.equal(operation.observedOutcome, "NOT_DISPATCHED");
  assert.equal(await db.actionOperation.count({ where: { authorizationId: exact.id } }), 1);
  assert.equal(
    await db.actionOutbox.count({ where: { operationId: operation.id, state: "HELD" } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({ where: { entityId: operation.id, action: "ACTION_ADMITTED" } }),
    1,
  );
  await error(
    "/operations",
    admission(exact, "distinct-operation"),
    409,
    "ACTION_ADMISSION_CONFLICT",
  );
  await error(
    "/operations",
    admission(exact, "same-operation"),
    404,
    "ACTION_AUTHORIZATION_NOT_FOUND",
    { subject: "other-actor" },
  );
  await error(`/operations/${operation.id}`, undefined, 404, "ACTION_OPERATION_NOT_FOUND", {
    org: foreignOrg,
  });
  await error(`/operations/${operation.id}/cancel`, {}, 404, "ACTION_OPERATION_NOT_FOUND", {
    subject: "other-actor",
  });
  const originalAuthorization = await db.actionAuthorization.findUniqueOrThrow({
    where: { id: exact.id },
  });
  await assert.rejects(
    db.actionAuthorization.create({
      data: {
        ...originalAuthorization,
        context: exact.context,
        id: `foreign-auth-${tag}`,
        organizationId: foreignOrg,
        status: "PENDING",
        idempotencyKey: `foreign-key-${tag}`,
      },
    }),
    (failure: unknown) =>
      failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === "P2003",
  );
  const databaseParent = await submit("database-parent");
  await assert.rejects(
    db.actionOperation.create({
      data: {
        organizationId: foreignOrg,
        actor,
        authorizationId: databaseParent.id,
        operationKey: `forged-operation-${tag}`,
        contextDigest: exact.contextDigest,
      },
    }),
    (failure: unknown) =>
      failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === "P2003",
  );
  pass(
    "concurrent one-operation consumption, durable held outbox, one audit, actor and tenant isolation",
  );

  const stale = await submit("stale-policy");
  await approve(stale);
  activePolicy = await setPolicy("DENY", activePolicy.revision);
  await error("/operations", admission(stale, "stale-policy"), 409, "ACTION_POLICY_STALE");
  const denied = await submit("denied");
  assert.equal(denied.status, "REJECTED");
  await error(
    `/intents/${denied.id}/review`,
    { contextDigest: denied.contextDigest, decision: "APPROVED" },
    409,
    "ACTION_REVIEW_CONFLICT",
    { subject: reviewer, role: "SECURITY_REVIEWER" },
  );
  assert.equal(
    (await call<OperationView>("/operations", admission(exact, "same-operation"))).body.data!.id,
    operation.id,
  );
  activePolicy = await setPolicy("REQUIRE_APPROVAL", activePolicy.revision);
  await error("/operations", admission(stale, "still-stale-policy"), 409, "ACTION_POLICY_STALE");
  const expired = await submit("expired");
  await approve(expired);
  await db.actionAuthorization.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(0) },
  });
  await error("/operations", admission(expired, "expired"), 409, "ACTION_AUTHORIZATION_EXPIRED");
  const revoked = await submit("revoked");
  await approve(revoked);
  await call(`/intents/${revoked.id}/revoke`, { contextDigest: revoked.contextDigest });
  await error("/operations", admission(revoked, "revoked"), 409, "ACTION_ADMISSION_CONFLICT");
  pass(
    "policy revisions including change-back, deny, expiry, revocation and read-only replay of prior admission",
  );

  // Every guard is restricted to this disposable run's synthetic tenant.
  async function guardAudit(action: string) {
    assert(/^[A-Z_]+$/.test(action));
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION "${guard}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic authority audit failure'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "${guard}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW WHEN (NEW."organizationId" = '${org}' AND NEW."action"::text = '${action}') EXECUTE FUNCTION "${guard}"()`,
    );
  }
  async function clearGuard() {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${guard}" ON "AuditEvent"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${guard}"()`);
  }
  const rollback = await submit("rollback-review");
  await guardAudit("APPROVAL_UPDATED");
  try {
    await error(
      `/intents/${rollback.id}/review`,
      { contextDigest: rollback.contextDigest, decision: "APPROVED" },
      500,
      "INTERNAL_SERVER_ERROR",
      { subject: reviewer, role: "SECURITY_REVIEWER" },
    );
    assert.equal(
      (await db.actionAuthorization.findUniqueOrThrow({ where: { id: rollback.id } })).status,
      "PENDING",
    );
  } finally {
    await clearGuard();
  }
  await approve(rollback);
  await guardAudit("ACTION_ADMITTED");
  try {
    await error(
      "/operations",
      admission(rollback, "rollback-admission"),
      500,
      "INTERNAL_SERVER_ERROR",
    );
    assert.equal(
      (await db.actionAuthorization.findUniqueOrThrow({ where: { id: rollback.id } })).status,
      "APPROVED",
    );
    assert.equal(await db.actionOperation.count({ where: { authorizationId: rollback.id } }), 0);
    assert.equal(await db.actionOutbox.count({ where: { operationId: { not: operation.id } } }), 0);
  } finally {
    await clearGuard();
  }
  await guardAudit("APPROVAL_REQUESTED");
  try {
    await error("/intents", input("rollback-submission"), 500, "INTERNAL_SERVER_ERROR");
    assert.equal(
      await db.actionAuthorization.count({
        where: { organizationId: org, idempotencyKey: input("rollback-submission").idempotencyKey },
      }),
      0,
    );
  } finally {
    await clearGuard();
  }
  await guardAudit("AUTHORITY_POLICY_CHANGED");
  try {
    await error(
      "/policy",
      { mode: "DENY", expectedRevision: activePolicy.revision },
      500,
      "INTERNAL_SERVER_ERROR",
      { subject: `policy-${tag}`, role: "POLICY_ADMINISTRATOR", method: "PUT" },
    );
    assert.equal(
      (await db.actionAuthorityPolicy.findUniqueOrThrow({ where: { organizationId: org } }))
        .revision,
      activePolicy.revision,
    );
  } finally {
    await clearGuard();
  }
  await guardAudit("ACTION_CANCELLED");
  try {
    await error(`/operations/${operation.id}/cancel`, {}, 500, "INTERNAL_SERVER_ERROR");
    assert.equal(
      (await db.actionOperation.findUniqueOrThrow({ where: { id: operation.id } })).state,
      "HELD",
    );
    assert.equal(
      (await db.actionOutbox.findUniqueOrThrow({ where: { operationId: operation.id } })).state,
      "HELD",
    );
  } finally {
    await clearGuard();
  }
  assert.equal(
    (await call<OperationView>(`/operations/${operation.id}/cancel`, {})).body.data!.state,
    "CANCELLED",
  );
  await call(`/operations/${operation.id}/cancel`, {});
  assert.equal(
    await db.auditEvent.count({ where: { entityId: operation.id, action: "ACTION_CANCELLED" } }),
    1,
  );
  assert.equal(
    (await call<OperationView>("/operations", admission(exact, "same-operation"))).body.data!.state,
    "CANCELLED",
  );
  pass(
    "actual audit failure rolls back submission/review/policy/consumption/operation/outbox/cancellation; terminal replay is durable",
  );

  const distinct = await submit("distinct-race");
  await approve(distinct);
  const distinctRace = await Promise.all([
    call<OperationView>("/operations", admission(distinct, "distinct-race-a")),
    call<OperationView>("/operations", admission(distinct, "distinct-race-b")),
  ]);
  assert.deepEqual(distinctRace.map((result) => result.status).sort(), [200, 409]);
  assert.equal(await db.actionOperation.count({ where: { authorizationId: distinct.id } }), 1);
  pass(
    "distinct concurrent operation keys cannot consume one approval twice; database owner links reject tenant escape",
  );

  const evidence = await submit("evidence-change");
  await approve(evidence);
  await db.securityReceipt.update({
    where: { scanId: scan.id },
    data: { receiptHash: "0".repeat(64) },
  });
  await error(
    "/operations",
    admission(evidence, "tampered-evidence"),
    409,
    "ACTION_EVIDENCE_UNAVAILABLE",
  );
  await db.securityReceipt.update({
    where: { scanId: scan.id },
    data: { receiptHash: originalReceipt.receiptHash },
  });
  await db.gitHubInstallation.update({
    where: { id: installation.id },
    data: { status: "SUSPENDED" },
  });
  await error(
    "/operations",
    admission(evidence, "revoked-installation"),
    409,
    "INSTALLATION_UNAVAILABLE",
  );
  await db.gitHubInstallation.update({
    where: { id: installation.id },
    data: { status: "ACTIVE" },
  });
  await db.repository.update({ where: { id: repo }, data: { externalId: "9007199254740995" } });
  await error(
    "/operations",
    admission(evidence, "changed-provider-id"),
    409,
    "ACTION_CONTEXT_CONFLICT",
  );
  await db.repository.update({ where: { id: repo }, data: { externalId: "9007199254740993" } });
  await error(
    "/intents",
    input("changed-commit", { commitSha: "f".repeat(40) }),
    409,
    "ACTION_EVIDENCE_UNAVAILABLE",
  );
  const oldTime = new Date(Date.now() - 31 * 60_000);
  const aged = createSecurityReceipt({
    ...originalReceipt,
    coverage: originalReceipt.coverage,
    evidence: {},
    completedAt: oldTime,
  });
  await db.scan.update({ where: { id: scan.id }, data: { completedAt: oldTime } });
  await db.securityReceipt.update({
    where: { scanId: scan.id },
    data: {
      receiptHash: aged.receiptHash,
      signedPayload: JSON.parse(JSON.stringify(aged)) as Prisma.InputJsonValue,
    },
  });
  await error("/intents", input("valid-hash-old-evidence"), 409, "ACTION_EVIDENCE_STALE");
  await db.scan.update({
    where: { id: scan.id },
    data: { completedAt: originalReceipt.completedAt },
  });
  const partial = createSecurityReceipt({
    ...originalReceipt,
    evidence: {},
    coverage: { ...originalReceipt.coverage, status: "PARTIAL" },
  });
  await db.securityReceipt.update({
    where: { scanId: scan.id },
    data: {
      receiptHash: partial.receiptHash,
      signedPayload: JSON.parse(JSON.stringify(partial)) as Prisma.InputJsonValue,
    },
  });
  await error("/intents", input("partial-evidence"), 409, "ACTION_EVIDENCE_UNAVAILABLE");
  await db.securityReceipt.update({
    where: { scanId: scan.id },
    data: {
      receiptHash: originalReceipt.receiptHash,
      signedPayload: JSON.parse(JSON.stringify(originalReceipt)) as Prisma.InputJsonValue,
    },
  });
  pass(
    "real receipt tampering, valid-hash stale/partial evidence, changed commit/provider identity and installation suspension fail closed",
  );

  // Shorten only this synthetic pending fixture's TTL before its real review.
  // This controls scheduling, not a claim against privileged database alteration.
  const lockExpiry = await submit("resource-lock-expiry");
  const expiry = new Date(Date.now() + 3000);
  const expiringContext = { ...lockExpiry.context, expiresAt: expiry.toISOString() };
  const expiringDigest = createHash("sha256").update(canonicalJson(expiringContext)).digest("hex");
  await db.actionAuthorization.update({
    where: { id: lockExpiry.id },
    data: { expiresAt: expiry, context: expiringContext, contextDigest: expiringDigest },
  });
  const expiringIntent = { ...lockExpiry, context: expiringContext, contextDigest: expiringDigest };
  await approve(expiringIntent);
  let resourceRelease!: () => void, resourceHeld!: () => void;
  let resourceHolderPid = 0;
  const resourceGate = new Promise<void>((resolve) => {
    resourceRelease = resolve;
  });
  const resourceReady = new Promise<void>((resolve) => {
    resourceHeld = resolve;
  });
  const resourceHolder = db.$transaction(
    async (tx) => {
      const backend = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      resourceHolderPid = backend[0]!.pid;
      await tx.$queryRaw`SELECT "id" FROM "Repository" WHERE "id"=${repo} FOR UPDATE`;
      resourceHeld();
      await resourceGate;
    },
    { timeout: 15000 },
  );
  await resourceReady;
  const blockedAdmission = call<OperationView>(
    "/operations",
    admission(expiringIntent, "resource-lock-expiry"),
  );
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM "Repository"%' AND ${resourceHolderPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (rows[0]!.waiting) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    assert(waiting, "Admission must actually wait on the locked repository before expiry");
    await delay(Math.max(1, expiry.getTime() - Date.now() + 30));
    resourceRelease();
    await resourceHolder;
    const result = await blockedAdmission;
    assert.equal(result.status, 409, result.text);
    assert.equal(result.body.error?.code, "ACTION_AUTHORIZATION_EXPIRED");
    assert.equal(await db.actionOperation.count({ where: { authorizationId: lockExpiry.id } }), 0);
  } finally {
    resourceRelease();
    await resourceHolder;
    await blockedAdmission;
  }
  pass("real repository-lock wait cannot carry an approval past its consumption expiry");

  const revocationRace = await submit("revocation-race");
  await approve(revocationRace);
  const revocationResults = await Promise.all([
    call(`/intents/${revocationRace.id}/revoke`, { contextDigest: revocationRace.contextDigest }),
    call<OperationView>("/operations", admission(revocationRace, "revocation-race")),
  ]);
  assert.deepEqual(revocationResults.map((result) => result.status).sort(), [200, 409]);
  const consumed = await db.actionOperation.count({
    where: { authorizationId: revocationRace.id },
  });
  assert.equal(consumed, revocationResults[1].status === 200 ? 1 : 0);
  pass("actual concurrent revocation versus consumption has one atomic winner");

  // An actual close request pauses inside its audit insert while still holding
  // the shared session lock. Admission starts while closure is uncommitted.
  const closure = await submit("closure-race");
  await approve(closure);
  const barrier = Number.parseInt(tag.slice(0, 7), 16) + 1_000_000;
  let release!: () => void, held!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holder = db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${barrier}::bigint)`);
      held();
      await gate;
    },
    { timeout: 15000 },
  );
  await ready;
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "${guard}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${barrier}::bigint); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "${guard}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW WHEN (NEW."organizationId" = '${org}' AND NEW."action"::text = 'SESSION_CLOSED') EXECUTE FUNCTION "${guard}"()`,
  );
  let closing: ReturnType<typeof call> | undefined,
    admitting: ReturnType<typeof call<OperationView>> | undefined;
  try {
    closing = call(`/api/v1/agent/sessions/${sessionId}/close`, {});
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const locks = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=${barrier}::oid AND NOT granted) AS waiting`;
      if (locks[0]!.waiting) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    assert(waiting, "Real close must reach the database barrier");
    admitting = call<OperationView>("/operations", admission(closure, "closure-race"));
    await delay(25);
    release();
    await holder;
    assert.equal((await closing).status, 200);
    const rejected = await admitting;
    assert.equal(rejected.status, 404, rejected.text);
    assert.equal(rejected.body.error?.code, "SESSION_NOT_FOUND");
    assert.equal(await db.actionOperation.count({ where: { authorizationId: closure.id } }), 0);
  } finally {
    release();
    await holder;
    await closing;
    await admitting;
    await clearGuard();
  }
  assert.equal((await call("/intents", input("same"))).body.data!.id, exact.id);
  assert.equal(
    (await call<OperationView>("/operations", admission(exact, "same-operation"))).body.data!.state,
    "CANCELLED",
  );
  await error("/intents", input("after-close"), 404, "SESSION_NOT_FOUND");
  pass(
    "actual close versus admission lock race; closed-session read-only replay; no provider call or outbox dispatch",
  );
  console.warn(`Action authority PostgreSQL verification passed (${groups} groups).`);
}
try {
  await main();
} finally {
  await close(apiServer);
  await close(keyServer);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${guard}" ON "AuditEvent"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${guard}"()`);
  const operations = await db.actionOperation.findMany({
    where: { organizationId: org },
    select: { id: true },
  });
  await db.actionOutbox.deleteMany({
    where: { operationId: { in: operations.map((item) => item.id) } },
  });
  await db.actionOperation.deleteMany({ where: { organizationId: org } });
  await db.actionAuthorization.deleteMany({ where: { organizationId: org } });
  await db.actionAuthorityPolicy.deleteMany({
    where: { organizationId: { in: [org, foreignOrg] } },
  });
  const scans = await db.scan.findMany({ where: { organizationId: org }, select: { id: true } });
  await db.securityReceipt.deleteMany({ where: { scanId: { in: scans.map((item) => item.id) } } });
  await db.auditEvent.deleteMany({ where: { organizationId: { in: [org, foreignOrg] } } });
  await db.scan.deleteMany({ where: { organizationId: org } });
  await db.organization.deleteMany({ where: { id: { in: [org, foreignOrg] } } });
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
