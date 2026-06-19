import { ApprovalStatus, AuditAction } from "@prisma/client";
import { type Request, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db/prisma.js";

const ADMIN_ACTOR = "Admin User";

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
});

const approvalParamsSchema = z.object({
  approvalId: z.string().min(1),
});

const approvalActionBodySchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
});

function getPagination(query: Request["query"]) {
  const pagination = paginationQuerySchema.parse(query);

  return {
    ...pagination,
    skip: (pagination.page - 1) * pagination.limit,
  };
}

export async function listPendingApprovalsController(
  request: Request,
  response: Response,
): Promise<void> {
  const { limit, page, skip } = getPagination(request.query);
  const [total, approvals] = await Promise.all([
    prisma.approval.count({
      where: {
        status: ApprovalStatus.PENDING,
      },
    }),
    prisma.approval.findMany({
      where: {
        status: ApprovalStatus.PENDING,
      },
      orderBy: {
        requestedAt: "desc",
      },
      skip,
      take: limit,
      include: {
        finding: {
          include: {
            policyDecision: true,
            remediation: true,
          },
        },
      },
    }),
  ]);

  response.json({
    page,
    limit,
    total,
    data: approvals,
  });
}

async function updateApprovalStatus(
  approvalId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  reason: string | undefined,
) {
  const approval = await prisma.approval.findUnique({
    where: {
      id: approvalId,
    },
    include: {
      finding: true,
    },
  });

  if (approval == null) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const updatedApproval = await tx.approval.update({
      where: {
        id: approvalId,
      },
      data: {
        status,
        actor: ADMIN_ACTOR,
        reason: reason ?? approval.reason,
        reviewedAt: new Date(),
      },
      include: {
        finding: {
          include: {
            policyDecision: true,
            remediation: true,
          },
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        actor: ADMIN_ACTOR,
        action: AuditAction.APPROVAL_UPDATED,
        entityType: "Approval",
        entityId: approvalId,
        scanId: approval.finding.scanId,
        metadata: {
          status,
          findingId: approval.findingId,
          reason: reason ?? null,
        },
      },
    });

    return updatedApproval;
  });
}

export async function approveApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = approvalActionBodySchema.parse(request.body);
  const approval = await updateApprovalStatus(approvalId, ApprovalStatus.APPROVED, body.reason);

  if (approval == null) {
    response.status(404).json({
      error: "APPROVAL_NOT_FOUND",
      message: `Approval ${approvalId} was not found.`,
    });
    return;
  }

  response.json({
    data: approval,
  });
}

export async function rejectApprovalController(
  request: Request,
  response: Response,
): Promise<void> {
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = approvalActionBodySchema.parse(request.body);
  const approval = await updateApprovalStatus(approvalId, ApprovalStatus.REJECTED, body.reason);

  if (approval == null) {
    response.status(404).json({
      error: "APPROVAL_NOT_FOUND",
      message: `Approval ${approvalId} was not found.`,
    });
    return;
  }

  response.json({
    data: approval,
  });
}
