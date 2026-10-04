import { ApprovalStatus, AuditAction, type User, type Approval } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../db/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

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

type UpdateApprovalResult =
  | { type: "SUCCESS"; approval: Approval }
  | { type: "NOT_FOUND" }
  | { type: "CONFLICT"; currentState: ApprovalStatus };

async function updateApprovalStatus(
  approvalId: string,
  targetStatus: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  reason: string | undefined,
  actorUser: User,
): Promise<UpdateApprovalResult> {
  // First, quickly verify the approval exists. This is mostly to get relations and fail fast if it's completely missing.
  const approval = await prisma.approval.findUnique({
    where: { id: approvalId },
    include: { finding: true },
  });

  if (approval == null) {
    return { type: "NOT_FOUND" };
  }

  const authenticatedActor = actorUser.email || actorUser.id;

  return prisma.$transaction(async (tx) => {
    // Re-fetch inside transaction to lock the row and get latest state
    const currentApproval = await tx.approval.findUnique({
      where: { id: approvalId },
    });

    if (!currentApproval) {
      return { type: "NOT_FOUND" };
    }

    // State machine logic: Only allow transitioning from PENDING
    if (currentApproval.status !== ApprovalStatus.PENDING) {
      return { type: "CONFLICT", currentState: currentApproval.status };
    }

    // Update strictly checking PENDING state (atomic query constraint)
    const updateResult = await tx.approval.updateMany({
      where: {
        id: approvalId,
        status: ApprovalStatus.PENDING,
      },
      data: {
        status: targetStatus,
        actor: authenticatedActor,
        reason: reason ?? currentApproval.reason,
        reviewedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      // If count is 0, it means it was modified concurrently to a non-PENDING state
      const concurrentState = await tx.approval.findUnique({ where: { id: approvalId } });
      const finalState = concurrentState?.status ?? ApprovalStatus.PENDING;
      return { type: "CONFLICT", currentState: finalState };
    }

    // We need to fetch the updated record with relations to return it
    const updatedApproval = await tx.approval.findUnique({
      where: { id: approvalId },
      include: {
        finding: {
          include: {
            policyDecision: true,
            remediation: true,
          },
        },
      },
    });

    if (!updatedApproval) {
      return { type: "NOT_FOUND" };
    }

    // Preserve existing audit trail
    await tx.auditEvent.create({
      data: {
        actor: authenticatedActor,
        action: AuditAction.APPROVAL_UPDATED,
        entityType: "Approval",
        entityId: approvalId,
        scanId: approval.finding.scanId,
        metadata: {
          previousState: ApprovalStatus.PENDING,
          newState: targetStatus,
          findingId: approval.findingId,
          reason: reason ?? null,
          timestamp: new Date().toISOString()
        },
      },
    });

    return { type: "SUCCESS", approval: updatedApproval };
  });
}

export async function approveApprovalController(
  request: AuthenticatedRequest,
  response: Response,
): Promise<void> {
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = approvalActionBodySchema.parse(request.body);
  const user = request.user;

  if (!user) {
    response.status(401).json({ error: "UNAUTHORIZED", message: "User not authenticated" });
    return;
  }

  const result = await updateApprovalStatus(approvalId, ApprovalStatus.APPROVED, body.reason, user);

  if (result.type === "NOT_FOUND") {
    response.status(404).json({
      error: "APPROVAL_NOT_FOUND",
      message: `Approval ${approvalId} was not found.`,
    });
    return;
  }

  if (result.type === "CONFLICT") {
    response.status(409).json({
      error: "APPROVAL_CONFLICT",
      message: `Approval ${approvalId} has already been resolved with state ${result.currentState}.`,
    });
    return;
  }

  response.json({
    data: result.approval,
  });
}

export async function rejectApprovalController(
  request: AuthenticatedRequest,
  response: Response,
): Promise<void> {
  const { approvalId } = approvalParamsSchema.parse(request.params);
  const body = approvalActionBodySchema.parse(request.body);
  const user = request.user;

  if (!user) {
    response.status(401).json({ error: "UNAUTHORIZED", message: "User not authenticated" });
    return;
  }

  const result = await updateApprovalStatus(approvalId, ApprovalStatus.REJECTED, body.reason, user);

  if (result.type === "NOT_FOUND") {
    response.status(404).json({
      error: "APPROVAL_NOT_FOUND",
      message: `Approval ${approvalId} was not found.`,
    });
    return;
  }

  if (result.type === "CONFLICT") {
    response.status(409).json({
      error: "APPROVAL_CONFLICT",
      message: `Approval ${approvalId} has already been resolved with state ${result.currentState}.`,
    });
    return;
  }

  response.json({
    data: result.approval,
  });
}
