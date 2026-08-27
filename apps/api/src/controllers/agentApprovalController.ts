import { ApprovalStatus } from "@prisma/client";
import { agentAuthorizationRequestSchema } from "@agentshield/schemas";
import type { Request, Response } from "express";
import { z } from "zod";

import {
  ensureAgentApproval,
  getAgentApproval,
  reviewAgentApproval,
} from "../services/agentApprovalService.js";
import { getActor, getCorrelationId, hasPermission } from "../security/auth.js";

const approvalParamsSchema = z.object({
  approvalId: z.string().min(1).max(128),
});

const reviewBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({
    error: { code, message, correlationId: getCorrelationId(response) },
  });
}

function assertActorMatchesInput(request: Request, response: Response) {
  const actor = getActor(response);
  const input = agentAuthorizationRequestSchema.parse(request.body);
  if (input.organizationId !== actor.organizationId || input.actor !== actor.id) {
    sendError(
      response,
      403,
      "TENANT_MISMATCH",
      "Organization or actor context does not match the authenticated actor.",
    );
    return null;
  }
  return { actor, input };
}

function sendApprovalResult(
  response: Response,
  result: Awaited<ReturnType<typeof ensureAgentApproval>>,
): void {
  if (result.kind === "SESSION_NOT_FOUND") {
    sendError(response, 404, "SESSION_NOT_FOUND", "Agent session was not found.");
    return;
  }
  if (result.kind === "IDEMPOTENCY_CONFLICT") {
    sendError(
      response,
      409,
      "APPROVAL_IDEMPOTENCY_CONFLICT",
      "The idempotency key is already bound to a different protected action.",
    );
    return;
  }
  response.status(result.kind === "CREATED" ? 201 : 200).json({ data: result.approval });
}

export async function createAgentApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  const matched = assertActorMatchesInput(request, response);
  if (matched == null) return;
  const result = await ensureAgentApproval(matched.input, getCorrelationId(response));
  sendApprovalResult(response, result);
}

export async function getAgentApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const approval = await getAgentApproval(actor.organizationId, approvalId);
  if (approval == null) {
    sendError(response, 404, "AGENT_APPROVAL_NOT_FOUND", "Agent approval was not found.");
    return;
  }
  if (approval.requestedBy !== actor.id && !hasPermission(actor.role, "approval:review")) {
    sendError(response, 403, "FORBIDDEN", "The actor cannot view this agent approval.");
    return;
  }
  response.json({ data: approval });
}

async function review(
  request: Request,
  response: Response,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
): Promise<void> {
  const actor = getActor(response);
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = reviewBodySchema.parse(request.body);
  const result = await reviewAgentApproval(
    actor.organizationId,
    approvalId,
    status,
    actor.id,
    body.reason,
    getCorrelationId(response),
  );
  if (result.kind === "NOT_FOUND") {
    sendError(response, 404, "AGENT_APPROVAL_NOT_FOUND", "Agent approval was not found.");
    return;
  }
  if (result.kind === "SELF_APPROVAL") {
    sendError(
      response,
      403,
      "SELF_APPROVAL_FORBIDDEN",
      "The requester cannot approve or reject their own protected action.",
    );
    return;
  }
  if (result.kind === "CONFLICT") {
    sendError(
      response,
      409,
      "AGENT_APPROVAL_ALREADY_REVIEWED",
      "Agent approval is no longer pending.",
    );
    return;
  }
  response.json({ data: result.approval });
}

export function approveAgentApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  return review(request, response, ApprovalStatus.APPROVED);
}

export function rejectAgentApprovalController(request: Request, response: Response): Promise<void> {
  return review(request, response, ApprovalStatus.REJECTED);
}
