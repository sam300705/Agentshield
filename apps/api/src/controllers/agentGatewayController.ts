import { createIntegrityChain, canonicalJson } from "@agentshield/policy-engine";
import {
  agentAuthorizationRequestSchema,
  agentDecisionSchema,
  agentEventInputSchema,
} from "@agentshield/schemas";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma.js";
import { getActor, getCorrelationId } from "../security/auth.js";

function decisionForAction(
  action:
    | "READ_FILE"
    | "WRITE_FILE"
    | "RUN_COMMAND"
    | "NETWORK_REQUEST"
    | "ACCESS_SECRET"
    | "CHANGE_INFRASTRUCTURE"
    | "PUBLISH_ARTIFACT",
) {
  if (
    action === "ACCESS_SECRET" ||
    action === "CHANGE_INFRASTRUCTURE" ||
    action === "RUN_COMMAND"
  ) {
    return {
      decision: "REQUIRE_APPROVAL" as const,
      allowed: true,
      reason: "This action requires a separate human approval before execution.",
      ruleId: "agent.action.requires_approval",
    };
  }
  if (action === "WRITE_FILE" || action === "PUBLISH_ARTIFACT") {
    return {
      decision: "WARN" as const,
      allowed: true,
      reason: "The action is permitted with an auditable warning.",
      ruleId: "agent.action.warn",
    };
  }
  return {
    decision: "ALLOW" as const,
    allowed: true,
    reason: "The read-only or metadata action is permitted.",
    ruleId: "agent.action.allow",
  };
}

export function authorizeAgentActionController(request: Request, response: Response): void {
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
  const policy = decisionForAction(input.action);
  const decision = agentDecisionSchema.parse({
    ...policy,
    ruleVersion: "builtin-agent-policy@1.0.0",
    correlationId: input.correlationId,
  });
  response.json({ data: decision });
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
  const session = await prisma.agentSession.findFirst({
    where: { id: input.sessionId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (session == null) {
    response.status(404).json({
      error: {
        code: "SESSION_NOT_FOUND",
        message: "Agent session was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const existing = await prisma.agentEvent.findFirst({
    where: { sessionId: input.sessionId, idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing != null) {
    response
      .status(200)
      .json({ accepted: true, eventId: existing.id, correlationId: getCorrelationId(response) });
    return;
  }
  const latest = await prisma.agentEvent.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: { sequence: "desc" },
    select: { sequence: true, eventHash: true },
  });
  const expectedSequence = (latest?.sequence ?? -1) + 1;
  if (input.sequence !== expectedSequence) {
    response.status(409).json({
      error: {
        code: "EVENT_SEQUENCE_INVALID",
        message: `Expected event sequence ${expectedSequence}.`,
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  const event = createIntegrityChain(
    [
      {
        id: randomUUID(),
        sessionId: input.sessionId,
        sequence: input.sequence,
        timestamp: input.timestamp,
        actor: input.actor,
        source: input.source,
        type: input.type,
        riskLevel: input.riskLevel,
        summary: input.summary,
        ...(input.resource == null ? {} : { resource: input.resource }),
        evidence: input.evidence,
        correlationId: input.correlationId,
      },
    ],
    latest?.eventHash ?? null,
  )[0];
  if (event == null) throw new Error("Event integrity construction failed.");
  await prisma.agentEvent.create({
    data: {
      id: event.id,
      sessionId: event.sessionId,
      sequence: event.sequence,
      idempotencyKey: input.idempotencyKey,
      timestamp: event.timestamp,
      actor: event.actor,
      source: event.source,
      type: event.type,
      riskLevel: event.riskLevel,
      summary: event.summary,
      resource: event.resource ?? null,
      evidence:
        event.evidence == null
          ? Prisma.JsonNull
          : (JSON.parse(JSON.stringify(event.evidence)) as Prisma.InputJsonValue),
      correlationId: event.correlationId,
      previousHash: event.integrity.previousHash,
      eventHash: event.integrity.eventHash,
    },
  });
  response.status(201).json({
    accepted: true,
    eventId: event.id,
    correlationId: getCorrelationId(response),
    integrity: {
      eventHash: event.integrity.eventHash,
      payloadHash: createHash("sha256").update(canonicalJson(event)).digest("hex"),
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
