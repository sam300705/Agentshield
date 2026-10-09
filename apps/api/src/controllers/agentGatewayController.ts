import { z } from "zod";
import { evaluateAgentAction, verifyReceiptHash } from "@agentshield/policy-engine";
import {
  agentAuthorizationRequestSchema,
  agentDecisionSchema,
  agentEventInputSchema,
  securityReceiptSchema,
  sanitizeText,
} from "@agentshield/schemas";
import type { Request, Response } from "express";
import { AuditAction } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createAgentActionDigest, ensureAgentApproval } from "../services/agentApprovalService.js";
import { ingestAgentEvent } from "../services/agentEventService.js";
import { getActor, getCorrelationId } from "../security/auth.js";

export async function authorizeAgentActionController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const input = agentAuthorizationRequestSchema.parse(request.body);
  if (input.organizationId !== actor.organizationId || input.actor !== actor.id) {
    response.status(403).json({
      error: {
        code: "TENANT_MISMATCH",
        message: "Organization context does not match the authenticated actor.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const session = await prisma.agentSession.findFirst({
    where: {
      id: input.sessionId,
      organizationId: actor.organizationId,
      actor: actor.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (session == null) {
    response.status(404).json({
      error: {
        code: "SESSION_NOT_FOUND",
        message: "An active agent session was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const decision = agentDecisionSchema.parse({
    ...evaluateAgentAction(input.action, input.correlationId),
    actionDigest: createAgentActionDigest(input),
  });
  // Event submission by the cooperative SDK is optional. Every server decision
  // must therefore have its own authoritative audit record.
  await prisma.auditEvent.create({
    data: {
      actor: actor.id,
      organizationId: actor.organizationId,
      action: AuditAction.POLICY_DECIDED,
      entityType: "AgentSession",
      entityId: input.sessionId,
      correlationId: getCorrelationId(response),
      metadata: {
        actionType: input.action,
        decision: decision.decision,
        ruleId: decision.ruleId,
        ruleVersion: decision.ruleVersion,
        reason: sanitizeText(decision.reason),
      },
    },
  });
  if (decision.decision !== "REQUIRE_APPROVAL") {
    response.json({ data: decision });
    return;
  }

  const approval = await ensureAgentApproval(input, getCorrelationId(response));
  if (approval.kind === "SESSION_NOT_FOUND") {
    response.status(404).json({
      error: {
        code: "SESSION_NOT_FOUND",
        message: "Agent session was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  if (approval.kind === "IDEMPOTENCY_CONFLICT") {
    response.status(409).json({
      error: {
        code: "APPROVAL_IDEMPOTENCY_CONFLICT",
        message: "The idempotency key is already bound to a different protected action.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  response.json({
    data: {
      ...decision,
      approvalId: approval.approval.id,
      approvalStatus: approval.approval.status,
    },
  });
}

export async function recordAgentEventController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const input = agentEventInputSchema.parse(request.body);
  if (input.organizationId !== actor.organizationId || input.actor !== actor.id) {
    response.status(403).json({
      error: {
        code: "TENANT_MISMATCH",
        message: "Organization context does not match the authenticated actor.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const result = await ingestAgentEvent(input);
  if (result.kind === "SESSION_NOT_FOUND") {
    response.status(404).json({
      error: {
        code: "SESSION_NOT_FOUND",
        message: "Agent session was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  if (result.kind === "SEQUENCE_INVALID") {
    response.status(409).json({
      error: {
        code: "EVENT_SEQUENCE_INVALID",
        message: `Expected event sequence ${result.expected}.`,
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  if (result.kind === "SEQUENCE_CONFLICT") {
    response.status(409).json({
      error: {
        code: "EVENT_SEQUENCE_CONFLICT",
        message: "Another event was accepted for this sequence; retry with the next sequence.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  if (result.kind === "IDEMPOTENCY_CONFLICT") {
    response.status(409).json({
      error: {
        code: "EVENT_IDEMPOTENCY_CONFLICT",
        message: "The idempotency key is already bound to different event content.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  response.status(result.kind === "CREATED" ? 201 : 200).json({
    accepted: true,
    eventId: result.eventId,
    correlationId: getCorrelationId(response),
    integrity: {
      eventHash: result.eventHash,
      previousHash: result.previousHash,
      payloadHash: result.payloadHash,
    },
  });
}

export async function getReceiptController(request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const { scanId } = z.object({ scanId: z.string().min(1).max(128) }).parse(request.params);
  const receipt = await prisma.securityReceipt.findFirst({
    where: { scanId, scan: { organizationId: actor.organizationId } },
    include: {
      scan: {
        select: {
          repositoryName: true,
          branch: true,
          commitSha: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });
  if (receipt == null) {
    response.status(404).json({
      error: {
        code: "RECEIPT_NOT_FOUND",
        message: "Receipt was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const unsigned = receipt.signedPayload ?? {
    id: `receipt:${scanId}`,
    scanId,
    repository: receipt.scan.repositoryName,
    branch: receipt.branch ?? receipt.scan.branch,
    commitSha: receipt.commitSha ?? receipt.scan.commitSha ?? "unresolved",
    scannerVersion: receipt.scannerVersion,
    policyBundleVersion: receipt.policyBundleVersion,
    findingCounts: receipt.findingCounts,
    decisionCounts: receipt.decisionCounts,
    approvalState: receipt.approvalState,
    evidenceDigest: receipt.evidenceDigest,
    startedAt: receipt.scan.startedAt,
    completedAt: receipt.scan.completedAt,
    gateResult: receipt.gateResult,
    receiptHash: receipt.receiptHash,
  };
  const canonical = securityReceiptSchema.safeParse(unsigned);
  if (
    !canonical.success ||
    !verifyReceiptHash(canonical.data) ||
    canonical.data.receiptHash !== receipt.receiptHash
  ) {
    response.status(409).json({
      error: {
        code: "RECEIPT_INTEGRITY_UNAVAILABLE",
        message: "The stored receipt cannot be verified against its original payload.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  let signedReceipt = null;
  if (
    receipt.keyId != null &&
    receipt.signature != null &&
    receipt.signingAlgorithm === "ed25519"
  ) {
    signedReceipt = {
      format: "agentshield-signed-receipt",
      version: 1,
      algorithm: "ed25519",
      keyId: receipt.keyId,
      payload: canonical.data,
      signature: receipt.signature,
    };
  }
  response.json({
    data: canonical.data,
    ...(signedReceipt == null ? {} : { signedReceipt }),
  });
}
