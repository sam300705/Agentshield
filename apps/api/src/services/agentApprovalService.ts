import { ApprovalStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { canonicalJson, evaluateAgentAction } from "@agentshield/policy-engine";
import {
  agentApprovalSchema,
  agentAuthorizationRequestSchema,
  type AgentApproval,
  type AgentAuthorizationRequest,
} from "@agentshield/schemas";

import { prisma } from "../db/prisma.js";

export type AgentApprovalResult =
  | { kind: "CREATED"; approval: AgentApproval }
  | { kind: "EXISTING"; approval: AgentApproval }
  | { kind: "IDEMPOTENCY_CONFLICT" }
  | { kind: "SESSION_NOT_FOUND" };

export function createAgentActionDigest(input: AgentAuthorizationRequest): string {
  const normalized = {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    actor: input.actor,
    actionType: input.action,
    resource: input.resource.trim(),
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

function toAgentApproval(value: unknown): AgentApproval {
  return agentApprovalSchema.parse(value);
}

function isConcurrencyConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

function sameAction(
  approval: AgentApproval,
  input: AgentAuthorizationRequest,
  digest: string,
): boolean {
  return (
    approval.organizationId === input.organizationId &&
    approval.sessionId === input.sessionId &&
    approval.actor === input.actor &&
    approval.actionType === input.action &&
    (approval.resource ?? "") === input.resource.trim() &&
    approval.actionDigest === digest
  );
}

async function findExisting(input: AgentAuthorizationRequest): Promise<AgentApproval | null> {
  const existing = await prisma.agentApproval.findUnique({
    where: {
      organizationId_sessionId_idempotencyKey: {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  return existing == null ? null : toAgentApproval(existing);
}

export async function ensureAgentApproval(
  rawInput: AgentAuthorizationRequest,
  correlationId: string,
): Promise<AgentApprovalResult> {
  const input = agentAuthorizationRequestSchema.parse(rawInput);
  const decision = evaluateAgentAction(input.action, correlationId);
  if (decision.decision !== "REQUIRE_APPROVAL") {
    throw new Error("Agent approval can only be created for REQUIRE_APPROVAL actions.");
  }

  const digest = createAgentActionDigest(input);
  const existing = await findExisting(input);
  if (existing != null) {
    return sameAction(existing, input, digest)
      ? { kind: "EXISTING", approval: existing }
      : { kind: "IDEMPOTENCY_CONFLICT" };
  }

  const session = await prisma.agentSession.findFirst({
    where: { id: input.sessionId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (session == null) return { kind: "SESSION_NOT_FOUND" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const approval = await tx.agentApproval.create({
        data: {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          actor: input.actor,
          actionType: input.action,
          ...(input.resource.trim().length === 0 ? {} : { resource: input.resource.trim() }),
          actionDigest: digest,
          status: ApprovalStatus.PENDING,
          requestedBy: input.actor,
          correlationId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.auditEvent.create({
        data: {
          actor: input.actor,
          action: "APPROVAL_REQUESTED",
          entityType: "AgentApproval",
          entityId: approval.id,
          organizationId: input.organizationId,
          correlationId,
          metadata: {
            approvalId: approval.id,
            sessionId: input.sessionId,
            actionType: input.action,
            actionDigest: digest,
          },
        },
      });
      return approval;
    });
    return { kind: "CREATED", approval: toAgentApproval(created) };
  } catch (error) {
    if (!isConcurrencyConflict(error)) throw error;
    const concurrent = await findExisting(input);
    if (concurrent == null) throw error;
    return sameAction(concurrent, input, digest)
      ? { kind: "EXISTING", approval: concurrent }
      : { kind: "IDEMPOTENCY_CONFLICT" };
  }
}

export async function getAgentApproval(
  organizationId: string,
  approvalId: string,
): Promise<AgentApproval | null> {
  const approval = await prisma.agentApproval.findFirst({
    where: { id: approvalId, organizationId },
  });
  return approval == null ? null : toAgentApproval(approval);
}

export async function reviewAgentApproval(
  organizationId: string,
  approvalId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  reviewerId: string,
  reason: string | undefined,
  correlationId: string,
): Promise<
  | { kind: "UPDATED"; approval: AgentApproval }
  | { kind: "NOT_FOUND" }
  | { kind: "SELF_APPROVAL" }
  | { kind: "CONFLICT" }
> {
  const current = await prisma.agentApproval.findFirst({
    where: { id: approvalId, organizationId },
  });
  if (current == null) return { kind: "NOT_FOUND" };
  if (current.requestedBy === reviewerId) return { kind: "SELF_APPROVAL" };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.agentApproval.updateMany({
      where: { id: approvalId, organizationId, status: ApprovalStatus.PENDING },
      data: {
        status,
        reviewedBy: reviewerId,
        ...(reason == null ? {} : { reason }),
        reviewedAt: new Date(),
      },
    });
    if (result.count !== 1) return null;
    const approval = await tx.agentApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await tx.auditEvent.create({
      data: {
        actor: reviewerId,
        action: "APPROVAL_UPDATED",
        entityType: "AgentApproval",
        entityId: approvalId,
        organizationId,
        correlationId,
        metadata: {
          approvalId,
          sessionId: approval.sessionId,
          actionType: approval.actionType,
          actionDigest: approval.actionDigest,
          status,
          reviewedBy: reviewerId,
        },
      },
    });
    return approval;
  });
  return updated == null
    ? { kind: "CONFLICT" }
    : { kind: "UPDATED", approval: toAgentApproval(updated) };
}
