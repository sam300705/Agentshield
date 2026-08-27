import { evaluateAgentAction } from "@agentshield/policy-engine";
import {
  agentAuthorizationRequestSchema,
  agentDecisionSchema,
  agentEventInputSchema,
} from "@agentshield/schemas";
import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { ensureAgentApproval } from "../services/agentApprovalService.js";
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
  const decision = agentDecisionSchema.parse(
    evaluateAgentAction(input.action, input.correlationId),
  );
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
  const scanId = request.params.scanId;
  if (scanId == null || scanId.length === 0) {
    response.status(400).json({
      error: {
        code: "INVALID_SCAN_ID",
        message: "A scan ID is required.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const receipt = await prisma.securityReceipt.findFirst({
    where: { scanId, scan: { organizationId: actor.organizationId } },
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
  response.json({ data: receipt });
}
