import { ApprovalStatus, AuditAction } from "@prisma/client";
import { type Request, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db/prisma.js";
import {
  canIndependentlyApprove,
  getActor,
  getCorrelationId,
  type RequestActor,
} from "../security/auth.js";

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
});

const approvalParamsSchema = z.object({
  approvalId: z.string().min(1).max(128),
});

const approvalActionBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional(),
});

function getPagination(query: Request["query"]) {
  const pagination = paginationQuerySchema.parse(query);
  return { ...pagination, skip: (pagination.page - 1) * pagination.limit };
}

export async function listPendingApprovalsController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { limit, page, skip } = getPagination(request.query);
  const where = {
    status: ApprovalStatus.PENDING,
    finding: { scan: { organizationId: actor.organizationId } },
  };
  const [total, approvals] = await Promise.all([
    prisma.approval.count({ where }),
    prisma.approval.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip,
      take: limit,
      include: {
        finding: { include: { policyDecision: true, remediation: true } },
      },
    }),
  ]);

  response.json({ page, limit, total, data: approvals });
}

async function updateApprovalStatus(
  approvalId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  reason: string | undefined,
  actor: RequestActor,
  correlationId: string,
) {
  const approval = await prisma.approval.findFirst({
    where: {
      id: approvalId,
      status: ApprovalStatus.PENDING,
      finding: { scan: { organizationId: actor.organizationId } },
    },
    include: { finding: true },
  });

  if (approval == null) return { kind: "NOT_FOUND" as const };
  if (!canIndependentlyApprove(actor, approval.requestedBy)) return { kind: "FORBIDDEN" as const };

  const data = await prisma.$transaction(async (tx) => {
    const updatedCount = await tx.approval.updateMany({
      where: {
        id: approvalId,
        status: ApprovalStatus.PENDING,
        finding: { scan: { organizationId: actor.organizationId } },
      },
      data: {
        status,
        actor: actor.id,
        reviewedBy: actor.id,
        reason: reason ?? approval.reason,
        reviewedAt: new Date(),
      },
    });
    if (updatedCount.count !== 1) return null;

    const updatedApproval = await tx.approval.findUniqueOrThrow({
      where: { id: approvalId },
      include: { finding: { include: { policyDecision: true, remediation: true } } },
    });
    await tx.auditEvent.create({
      data: {
        actor: actor.id,
        action: AuditAction.APPROVAL_UPDATED,
        entityType: "Approval",
        entityId: approvalId,
        scanId: approval.finding.scanId,
        organizationId: actor.organizationId,
        correlationId,
        metadata: { status, findingId: approval.findingId, reason: reason ?? null },
      },
    });
    return updatedApproval;
  });

  return data == null ? { kind: "CONFLICT" as const } : { kind: "UPDATED" as const, data };
}

function sendApprovalError(
  response: Response,
  code: string,
  message: string,
  status: number,
): void {
  response.status(status).json({
    error: { code, message, correlationId: getCorrelationId(response) },
  });
}

export async function approveApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = approvalActionBodySchema.parse(request.body);
  const approval = await updateApprovalStatus(
    approvalId,
    ApprovalStatus.APPROVED,
    body.reason,
    getActor(response),
    getCorrelationId(response),
  );

  if (approval.kind === "NOT_FOUND") {
    sendApprovalError(response, "APPROVAL_NOT_FOUND", "Approval was not found.", 404);
    return;
  }
  if (approval.kind === "FORBIDDEN") {
    sendApprovalError(
      response,
      "SEPARATION_OF_DUTIES",
      "The requester cannot approve their own risky change.",
      403,
    );
    return;
  }
  if (approval.kind === "CONFLICT") {
    sendApprovalError(response, "APPROVAL_ALREADY_REVIEWED", "Approval is no longer pending.", 409);
    return;
  }
  response.json({ data: approval.data });
}

export async function rejectApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = approvalActionBodySchema.parse(request.body);
  const approval = await updateApprovalStatus(
    approvalId,
    ApprovalStatus.REJECTED,
    body.reason,
    getActor(response),
    getCorrelationId(response),
  );

  if (approval.kind === "NOT_FOUND") {
    sendApprovalError(response, "APPROVAL_NOT_FOUND", "Approval was not found.", 404);
    return;
  }
  if (approval.kind === "FORBIDDEN") {
    sendApprovalError(
      response,
      "SEPARATION_OF_DUTIES",
      "The requester cannot review their own risky change.",
      403,
    );
    return;
  }
  if (approval.kind === "CONFLICT") {
    sendApprovalError(response, "APPROVAL_ALREADY_REVIEWED", "Approval is no longer pending.", 409);
    return;
  }
  response.json({ data: approval.data });
}
