import { createHash, randomUUID } from "node:crypto";
import { Prisma, type ActionAuthorization } from "@prisma/client";
import {
  actionIntentSchema,
  authorityAdmissionSchema,
  authorityAuthorizationSchema,
  authorityContextSchema,
  authorityOperationSchema,
  authorityPolicyUpdateSchema,
  authorityReviewSchema,
  sanitizeText,
  securityReceiptSchema,
  type ActionIntent,
  type AuthorityContext,
} from "@agentshield/schemas";
import {
  canonicalJson,
  verifyReceiptHash,
  ACTION_AUTHORITY_POLICY_VERSION,
  POLICY_RULE_VERSION,
  evaluateAuthorityPolicy,
} from "@agentshield/policy-engine";
import { prisma } from "../db/prisma.js";
import { hasPermission, type Permission, type RequestActor } from "../security/auth.js";
import { ServiceError } from "../security/serviceError.js";

type Tx = Prisma.TransactionClient;
const EVIDENCE_MAX_AGE_MS = 30 * 60_000;
const APPROVAL_TTL_MS = 10 * 60_000;
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function fail(code: string, message: string, status = 409): never {
  throw new ServiceError(status, code, message);
}
function permission(actor: RequestActor, required: Permission) {
  if (!hasPermission(actor.role, required)) fail("FORBIDDEN", "Permission is required.", 403);
}
async function tenantLock(tx: Tx, organizationId: string) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 1))`,
  );
}
async function sessionLock(tx: Tx, sessionId: string) {
  // Same lock as Phase 1 session closure, event and decision admission.
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`);
}
async function now(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return rows[0]!.now;
}
async function audit(
  tx: Tx,
  actor: RequestActor,
  action: Prisma.AuditEventCreateInput["action"],
  entityType: string,
  entityId: string,
  correlationId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditEvent.create({
    data: {
      actor: actor.id,
      organizationId: actor.organizationId,
      action,
      entityType,
      entityId,
      correlationId,
      metadata,
    },
  });
}
function authorizationView(row: ActionAuthorization) {
  const context = authorityContextSchema.parse(row.context);
  return authorityAuthorizationSchema.parse({
    createdAt: row.createdAt,
    id: row.id,
    decisionId: row.id,
    actor: row.actor,
    context,
    decisionRecord: {
      id: row.id,
      policyRevision: row.policyRevision,
      policyEngineVersion: context.policyEngineVersion,
      matchedRuleIds: [context.policyDecision.ruleId],
      decision: row.decision,
      reason: context.policyDecision.reason,
      contextDigest: row.contextDigest,
      evidenceStatus: "COMPLETE",
      expiresAt: row.expiresAt,
      reviewerPermission: "approval:review",
      independentOfActor: true,
    },
    contextDigest: row.contextDigest,
    decision: row.decision,
    status: row.status,
    expired: row.expiresAt.getTime() <= Date.now(),
    expiresAt: row.expiresAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reason: row.reason == null ? null : sanitizeText(row.reason),
    revokedAt: row.revokedAt,
    dispatchEnabled: false as const,
    observedOutcome: "NOT_DISPATCHED" as const,
  });
}
function operationView(row: {
  id: string;
  authorizationId: string;
  contextDigest: string;
  state: string;
  createdAt: Date;
  cancelledAt: Date | null;
}) {
  return authorityOperationSchema.parse({
    schemaVersion: 1,
    admittedAt: row.createdAt,
    cancelledAt: row.cancelledAt,
    id: row.id,
    authorizationId: row.authorizationId,
    contextDigest: row.contextDigest,
    state: row.state,
    dispatchEnabled: false,
    observedOutcome: "NOT_DISPATCHED",
  });
}
async function policy(tx: Tx, actor: RequestActor) {
  const value = await tx.actionAuthorityPolicy.findUnique({
    where: { organizationId: actor.organizationId },
  });
  if (value == null)
    fail("ACTION_AUTHORITY_UNCONFIGURED", "Action admission policy is not configured.", 503);
  return value;
}

export async function updateAuthorityPolicy(
  actor: RequestActor,
  raw: unknown,
  correlationId: string,
) {
  permission(actor, "policy:manage");
  const input = authorityPolicyUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tenantLock(tx, actor.organizationId);
    const current = await tx.actionAuthorityPolicy.findUnique({
      where: { organizationId: actor.organizationId },
    });
    if ((current?.revision ?? null) !== input.expectedRevision)
      fail("POLICY_REVISION_CONFLICT", "Policy revision changed.");
    const data = { revision: randomUUID(), mode: input.mode, changedBy: actor.id };
    const updated = await tx.actionAuthorityPolicy.upsert({
      where: { organizationId: actor.organizationId },
      create: { organizationId: actor.organizationId, ...data },
      update: data,
    });
    await audit(
      tx,
      actor,
      "AUTHORITY_POLICY_CHANGED",
      "ActionAuthorityPolicy",
      actor.organizationId,
      correlationId,
      { revision: updated.revision, mode: updated.mode },
    );
    return { revision: updated.revision, mode: updated.mode, dispatchEnabled: false as const };
  });
}

async function deriveContext(
  tx: Tx,
  actor: RequestActor,
  input: ActionIntent,
  policyRevision: string,
  expiresAt: Date,
  policyMode: string,
): Promise<AuthorityContext> {
  const session = await tx.agentSession.findFirst({
    where: {
      id: input.sessionId,
      organizationId: actor.organizationId,
      actor: actor.id,
      status: "ACTIVE",
      repositoryId: input.repositoryId,
    },
  });
  if (session == null)
    fail("SESSION_NOT_FOUND", "An active owned repository session was not found.", 404);
  const selectedRepository = await tx.repository.findFirst({
    where: { id: input.repositoryId, organizationId: actor.organizationId, provider: "GITHUB" },
  });
  if (selectedRepository?.githubInstallationId == null)
    fail("REPOSITORY_NOT_FOUND", "An owned GitHub repository was not found.", 404);
  // Same installation-before-repository order as webhook revocation and scan admission.
  await tx.$queryRaw`SELECT "id" FROM "GitHubInstallation" WHERE "id"=${selectedRepository.githubInstallationId} AND "organizationId"=${actor.organizationId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Repository" WHERE "id"=${input.repositoryId} AND "organizationId"=${actor.organizationId} FOR SHARE`;
  const repository = await tx.repository.findFirst({
    where: { id: input.repositoryId, organizationId: actor.organizationId, provider: "GITHUB" },
  });
  if (
    repository == null ||
    !repository.githubAccessible ||
    repository.githubInstallationId !== selectedRepository.githubInstallationId
  )
    fail("REPOSITORY_NOT_FOUND", "An accessible owned GitHub repository was not found.", 404);
  const installation = await tx.gitHubInstallation.findFirst({
    where: {
      id: repository.githubInstallationId,
      organizationId: actor.organizationId,
      status: "ACTIVE",
    },
  });
  if (
    installation == null ||
    !Number.isSafeInteger(installation.installationId) ||
    installation.installationId <= 0
  )
    fail("INSTALLATION_UNAVAILABLE", "Repository installation is unavailable.");
  await tx.$queryRaw`SELECT "id" FROM "Scan" WHERE "id"=${input.evidenceScanId} AND "organizationId"=${actor.organizationId} FOR SHARE`;
  const scan = await tx.scan.findFirst({
    where: {
      id: input.evidenceScanId,
      organizationId: actor.organizationId,
      repositoryId: input.repositoryId,
      status: "COMPLETED",
      commitSha: input.commitSha,
    },
  });
  if (scan?.completedAt == null)
    fail(
      "ACTION_EVIDENCE_UNAVAILABLE",
      "Completed evidence for this repository and commit is required.",
    );
  await tx.$queryRaw`SELECT "id" FROM "SecurityReceipt" WHERE "scanId"=${scan.id} FOR SHARE`;
  const receipt = await tx.securityReceipt.findUnique({ where: { scanId: scan.id } });
  const parsed = securityReceiptSchema.safeParse(receipt?.signedPayload);
  if (
    !parsed.success ||
    receipt == null ||
    !verifyReceiptHash(parsed.data) ||
    parsed.data.receiptHash !== receipt.receiptHash ||
    parsed.data.scanId !== scan.id ||
    parsed.data.policyBundleVersion !== POLICY_RULE_VERSION ||
    parsed.data.commitSha !== input.commitSha ||
    parsed.data.coverage?.status !== "COMPLETE" ||
    !["ALLOW", "WARN"].includes(parsed.data.gateResult) ||
    (parsed.data.decisionCounts.BLOCK ?? 0) > 0 ||
    (parsed.data.decisionCounts.REQUIRE_APPROVAL ?? 0) > 0
  )
    fail("ACTION_EVIDENCE_UNAVAILABLE", "Verified complete nonblocking evidence is required.");
  const timestamp = await now(tx);
  const completedAt = scan.completedAt.getTime();
  if (
    parsed.data.completedAt.getTime() !== completedAt ||
    completedAt > timestamp.getTime() ||
    completedAt + EVIDENCE_MAX_AGE_MS <= timestamp.getTime()
  )
    fail("ACTION_EVIDENCE_STALE", "Evidence freshness cannot be established.");
  if (expiresAt.getTime() > completedAt + EVIDENCE_MAX_AGE_MS)
    expiresAt = new Date(completedAt + EVIDENCE_MAX_AGE_MS);
  if (expiresAt.getTime() <= timestamp.getTime())
    fail("ACTION_AUTHORIZATION_EXPIRED", "Authorization expired while validating context.");
  return authorityContextSchema.parse({
    canonicalizationVersion: 1,
    schemaVersion: 1,
    normalizationVersion: 1,
    actionType: input.actionType,
    provider: "GITHUB",
    organizationId: actor.organizationId,
    actor: actor.id,
    sessionId: session.id,
    repositoryId: repository.id,
    providerRepositoryId: repository.externalId,
    providerInstallationId: String(installation.installationId),
    commitSha: input.commitSha,
    parameters: input.parameters,
    evidenceScanId: scan.id,
    evidenceCompletedAt: scan.completedAt.toISOString(),
    evidenceMaxAgeSeconds: 1800,
    evidenceVerification: "APPLICATION_HASH_ONLY",
    evidencePolicyVersion: parsed.data.policyBundleVersion,
    policyDecision: evaluateAuthorityPolicy(policyMode),
    evidenceReceiptHash: receipt.receiptHash,
    policyRevision,
    policyEngineVersion: ACTION_AUTHORITY_POLICY_VERSION,
    expiresAt: expiresAt.toISOString(),
  });
}

export async function submitActionIntent(actor: RequestActor, raw: unknown, correlationId: string) {
  permission(actor, "scan:run");
  const input = actionIntentSchema.parse(raw);
  const requestDigest = digest(input);
  return prisma.$transaction(async (tx) => {
    await tenantLock(tx, actor.organizationId);
    const existing = await tx.actionAuthorization.findUnique({
      where: {
        organizationId_actor_idempotencyKey: {
          organizationId: actor.organizationId,
          actor: actor.id,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing != null) {
      if (existing.requestDigest !== requestDigest)
        fail("ACTION_IDEMPOTENCY_CONFLICT", "Key is bound to different action context.");
      return { created: false, ...authorizationView(existing) };
    }
    await sessionLock(tx, input.sessionId);
    const active = await policy(tx, actor);
    const timestamp = await now(tx);
    const context = await deriveContext(
      tx,
      actor,
      input,
      active.revision,
      new Date(timestamp.getTime() + APPROVAL_TTL_MS),
      active.mode,
    );
    const decision = evaluateAuthorityPolicy(active.mode);
    const row = await tx.actionAuthorization.create({
      data: {
        organizationId: actor.organizationId,
        actor: actor.id,
        sessionId: input.sessionId,
        repositoryId: input.repositoryId,
        evidenceScanId: input.evidenceScanId,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        contextDigest: digest(context),
        context,
        policyRevision: active.revision,
        decision: decision.decision,
        status: decision.decision === "DENY" ? "REJECTED" : "PENDING",
        expiresAt: new Date(context.expiresAt),
      },
    });
    await audit(tx, actor, "POLICY_DECIDED", "ActionAuthorization", row.id, correlationId, {
      contextDigest: row.contextDigest,
      policyRevision: active.revision,
      ruleId: decision.ruleId,
      decision: decision.decision,
    });
    if (row.status === "PENDING")
      await audit(tx, actor, "APPROVAL_REQUESTED", "ActionAuthorization", row.id, correlationId, {
        contextDigest: row.contextDigest,
      });
    return { created: true, ...authorizationView(row) };
  });
}

async function lockedAuthorization(tx: Tx, actor: RequestActor, id: string) {
  const row = await tx.actionAuthorization.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (row == null) fail("ACTION_AUTHORIZATION_NOT_FOUND", "Authorization was not found.", 404);
  await sessionLock(tx, row.sessionId);
  await tx.$queryRaw`SELECT "id" FROM "ActionAuthorization" WHERE "id"=${row.id} FOR UPDATE`;
  return tx.actionAuthorization.findUniqueOrThrow({ where: { id: row.id } });
}
async function validateCurrent(tx: Tx, actor: RequestActor, row: ActionAuthorization) {
  const active = await policy(tx, actor);
  if (active.mode !== "REQUIRE_APPROVAL" || active.revision !== row.policyRevision)
    fail("ACTION_POLICY_STALE", "Authorization policy changed.");
  if (row.expiresAt <= (await now(tx)))
    fail("ACTION_AUTHORIZATION_EXPIRED", "Authorization expired.");
  const context = authorityContextSchema.parse(row.context);
  if (
    context.organizationId !== row.organizationId ||
    context.actor !== row.actor ||
    context.sessionId !== row.sessionId ||
    context.repositoryId !== row.repositoryId ||
    context.evidenceScanId !== row.evidenceScanId ||
    context.policyRevision !== row.policyRevision ||
    context.policyDecision.decision !== row.decision ||
    context.expiresAt !== row.expiresAt.toISOString() ||
    digest(context) !== row.contextDigest
  )
    fail("ACTION_CONTEXT_CONFLICT", "Stored context cannot be verified.");
  const request = actionIntentSchema.parse({
    schemaVersion: 1,
    normalizationVersion: 1,
    actionType: context.actionType,
    sessionId: row.sessionId,
    repositoryId: row.repositoryId,
    evidenceScanId: row.evidenceScanId,
    commitSha: context.commitSha,
    parameters: context.parameters,
    idempotencyKey: row.idempotencyKey,
  });
  const derived = await deriveContext(
    tx,
    { ...actor, id: row.actor },
    request,
    active.revision,
    row.expiresAt,
    active.mode,
  );
  if (digest(derived) !== row.contextDigest)
    fail("ACTION_CONTEXT_CONFLICT", "Repository, evidence or policy context changed.");
}

export async function getActionAuthorization(actor: RequestActor, id: string) {
  permission(actor, "scan:read");
  const row = await prisma.actionAuthorization.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      ...(hasPermission(actor.role, "approval:review") ? {} : { actor: actor.id }),
    },
  });
  if (row == null) fail("ACTION_AUTHORIZATION_NOT_FOUND", "Authorization was not found.", 404);
  return authorizationView(row);
}
export async function reviewActionAuthorization(
  actor: RequestActor,
  id: string,
  raw: unknown,
  correlationId: string,
) {
  permission(actor, "approval:review");
  const input = authorityReviewSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tenantLock(tx, actor.organizationId);
    const row = await lockedAuthorization(tx, actor, id);
    if (row.actor === actor.id)
      fail("SELF_APPROVAL_FORBIDDEN", "Requester cannot review their own intent.", 403);
    if (row.status !== "PENDING" || row.contextDigest !== input.contextDigest)
      fail("ACTION_REVIEW_CONFLICT", "Pending context changed or was already reviewed.");
    await validateCurrent(tx, actor, row);
    const updated = await tx.actionAuthorization.update({
      where: { id },
      data: {
        status: input.decision,
        reviewedBy: actor.id,
        reviewedAt: await now(tx),
        ...(input.reason == null ? {} : { reason: sanitizeText(input.reason).slice(0, 1000) }),
      },
    });
    await audit(tx, actor, "APPROVAL_UPDATED", "ActionAuthorization", id, correlationId, {
      contextDigest: row.contextDigest,
      status: updated.status,
      reviewerRole: actor.role,
      reviewerAuthoritySource: "VERIFIED_REQUEST_IDENTITY_AT_REVIEW",
    });
    return authorizationView(updated);
  });
}
export async function revokeActionAuthorization(
  actor: RequestActor,
  id: string,
  contextDigest: string,
  correlationId: string,
) {
  permission(actor, "scan:read");
  return prisma.$transaction(async (tx) => {
    await tenantLock(tx, actor.organizationId);
    const row = await lockedAuthorization(tx, actor, id);
    if (row.actor !== actor.id && !hasPermission(actor.role, "approval:review"))
      fail("ACTION_AUTHORIZATION_NOT_FOUND", "Authorization was not found.", 404);
    if (row.contextDigest !== contextDigest || !["PENDING", "APPROVED"].includes(row.status))
      fail("ACTION_REVOCATION_CONFLICT", "Authorization cannot be revoked.");
    const updated = await tx.actionAuthorization.update({
      where: { id },
      data: { status: "REVOKED", revokedAt: await now(tx) },
    });
    await audit(tx, actor, "AUTHORIZATION_REVOKED", "ActionAuthorization", id, correlationId, {
      contextDigest,
    });
    return authorizationView(updated);
  });
}

export async function admitActionOperation(
  actor: RequestActor,
  raw: unknown,
  correlationId: string,
) {
  permission(actor, "scan:run");
  const input = authorityAdmissionSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tenantLock(tx, actor.organizationId);
    const existing = await tx.actionOperation.findUnique({
      where: {
        organizationId_actor_operationKey: {
          organizationId: actor.organizationId,
          actor: actor.id,
          operationKey: input.operationKey,
        },
      },
    });
    if (existing != null) {
      if (
        existing.authorizationId !== input.authorizationId ||
        existing.contextDigest !== input.contextDigest
      )
        fail("OPERATION_IDEMPOTENCY_CONFLICT", "Operation key is bound to another context.");
      return operationView(existing);
    }
    const row = await lockedAuthorization(tx, actor, input.authorizationId);
    if (row.actor !== actor.id)
      fail("ACTION_AUTHORIZATION_NOT_FOUND", "Authorization was not found.", 404);
    if (
      row.status !== "APPROVED" ||
      row.decision !== "REQUIRE_APPROVAL" ||
      row.reviewedBy == null ||
      row.reviewedBy === row.actor ||
      row.reviewedAt == null ||
      row.contextDigest !== input.contextDigest
    )
      fail("ACTION_ADMISSION_CONFLICT", "An independent exact-context approval is required.");
    await validateCurrent(tx, actor, row);
    const consumed = await tx.$executeRaw`UPDATE "ActionAuthorization" SET "status"='CONSUMED'
      WHERE "id"=${row.id} AND "organizationId"=${actor.organizationId} AND "actor"=${actor.id}
      AND "status"='APPROVED' AND "contextDigest"=${input.contextDigest}
      AND "expiresAt" > clock_timestamp()`;
    if (consumed !== 1)
      fail("ACTION_AUTHORIZATION_EXPIRED", "Authorization expired before consumption.");
    const operation = await tx.actionOperation.create({
      data: {
        organizationId: actor.organizationId,
        actor: actor.id,
        authorizationId: row.id,
        operationKey: input.operationKey,
        contextDigest: row.contextDigest,
      },
    });
    await tx.actionOutbox.create({ data: { operationId: operation.id } });
    await audit(tx, actor, "ACTION_ADMITTED", "ActionOperation", operation.id, correlationId, {
      authorizationId: row.id,
      contextDigest: row.contextDigest,
      dispatchEnabled: false,
    });
    return operationView(operation);
  });
}
export async function cancelActionOperation(
  actor: RequestActor,
  id: string,
  correlationId: string,
) {
  permission(actor, "scan:run");
  return prisma.$transaction(async (tx) => {
    await tenantLock(tx, actor.organizationId);
    const row = await tx.actionOperation.findFirst({
      where: { id, organizationId: actor.organizationId, actor: actor.id },
    });
    if (row == null) fail("ACTION_OPERATION_NOT_FOUND", "Operation was not found.", 404);
    if (row.state === "CANCELLED") return operationView(row);
    const updated = await tx.actionOperation.update({
      where: { id },
      data: { state: "CANCELLED", cancelledAt: await now(tx) },
    });
    await tx.actionOutbox.update({ where: { operationId: id }, data: { state: "CANCELLED" } });
    await audit(tx, actor, "ACTION_CANCELLED", "ActionOperation", id, correlationId, {
      dispatchEnabled: false,
      observedOutcome: "NOT_DISPATCHED",
    });
    return operationView(updated);
  });
}
export async function getAuthorityPolicy(actor: RequestActor) {
  permission(actor, "scan:read");
  const row = await prisma.actionAuthorityPolicy.findUnique({
    where: { organizationId: actor.organizationId },
  });
  return {
    configured: row != null,
    revision: row?.revision ?? null,
    mode: row?.mode ?? null,
    dispatchEnabled: false as const,
  };
}
export async function getActionOperation(actor: RequestActor, id: string) {
  permission(actor, "scan:read");
  const row = await prisma.actionOperation.findFirst({
    where: { id, organizationId: actor.organizationId, actor: actor.id },
  });
  if (row == null) fail("ACTION_OPERATION_NOT_FOUND", "Operation was not found.", 404);
  return operationView(row);
}
