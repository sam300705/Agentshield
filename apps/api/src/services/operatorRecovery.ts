import { AuditAction, ScanStatus } from "@prisma/client";

import { prisma } from "../db/prisma.js";

export interface RecoveryResult {
  id: string;
  scanId: string;
  status: string;
}

export class RecoveryStateConflictError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "RecoveryStateConflictError";
  }
}

export async function retryDeadLetteredScan(
  scanId: string,
  organizationId: string,
  actor: string,
  correlationId: string,
): Promise<RecoveryResult | null> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.scanJob.findFirst({
      where: {
        scanId,
        status: ScanStatus.FAILED,
        deadLetteredAt: { not: null },
        lockedAt: null,
        scan: { organizationId, status: ScanStatus.FAILED },
      },
      select: {
        id: true,
        scanId: true,
        attempts: true,
        maxAttempts: true,
        failureCode: true,
        failureMessage: true,
        deadLetteredAt: true,
      },
    });
    if (job == null) return null;

    const revived = await tx.scanJob.updateMany({
      where: {
        id: job.id,
        status: ScanStatus.FAILED,
        deadLetteredAt: job.deadLetteredAt,
        lockedAt: null,
      },
      data: {
        status: ScanStatus.QUEUED,
        progress: 0,
        attempts: 0,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        cancelRequestedAt: null,
        failureCode: null,
        failureMessage: null,
        deadLetteredAt: null,
      },
    });
    if (revived.count !== 1) throw new RecoveryStateConflictError("SCAN_RETRY_STATE_CONFLICT");

    const scanTransition = await tx.scan.updateMany({
      where: { id: scanId, organizationId, status: ScanStatus.FAILED },
      data: { status: ScanStatus.QUEUED, completedAt: null },
    });
    if (scanTransition.count !== 1) {
      throw new RecoveryStateConflictError("SCAN_RETRY_PARENT_STATE_CONFLICT");
    }

    await tx.auditEvent.create({
      data: {
        actor,
        action: AuditAction.SCAN_CREATED,
        entityType: "ScanJob",
        entityId: job.id,
        scanId,
        organizationId,
        correlationId,
        metadata: {
          operation: "SCAN_RETRY_REQUESTED",
          previousAttempts: job.attempts,
          maxAttempts: job.maxAttempts,
          previousFailureCode: job.failureCode,
          previousFailureMessage: job.failureMessage,
          previousDeadLetteredAt: job.deadLetteredAt?.toISOString() ?? null,
        },
      },
    });

    return { id: job.id, scanId, status: ScanStatus.QUEUED };
  });
}

export async function retryDeadLetteredGitHubCheckPublication(
  scanId: string,
  organizationId: string,
  actor: string,
  correlationId: string,
): Promise<RecoveryResult | null> {
  return prisma.$transaction(async (tx) => {
    const publication = await tx.gitHubCheckPublication.findFirst({
      where: {
        scanId,
        organizationId,
        status: "DEAD_LETTER",
        deadLetteredAt: { not: null },
        lockedAt: null,
        scan: { organizationId, status: ScanStatus.COMPLETED },
      },
      select: {
        id: true,
        scanId: true,
        attempts: true,
        maxAttempts: true,
        failureMessage: true,
        deadLetteredAt: true,
        checkRunId: true,
      },
    });
    if (publication == null) return null;

    const revived = await tx.gitHubCheckPublication.updateMany({
      where: {
        id: publication.id,
        organizationId,
        status: "DEAD_LETTER",
        deadLetteredAt: publication.deadLetteredAt,
        lockedAt: null,
      },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        failureMessage: null,
        deadLetteredAt: null,
        publishedAt: null,
      },
    });
    if (revived.count !== 1) {
      throw new RecoveryStateConflictError("GITHUB_CHECK_RETRY_STATE_CONFLICT");
    }

    await tx.auditEvent.create({
      data: {
        actor,
        action: AuditAction.SCAN_CREATED,
        entityType: "GitHubCheckPublication",
        entityId: publication.id,
        scanId,
        organizationId,
        correlationId,
        metadata: {
          operation: "GITHUB_CHECK_PUBLICATION_RETRY_REQUESTED",
          previousAttempts: publication.attempts,
          maxAttempts: publication.maxAttempts,
          previousFailureMessage: publication.failureMessage,
          previousDeadLetteredAt: publication.deadLetteredAt?.toISOString() ?? null,
          reconcilesCheckRunId: publication.checkRunId,
        },
      },
    });

    return { id: publication.id, scanId, status: "PENDING" };
  });
}
