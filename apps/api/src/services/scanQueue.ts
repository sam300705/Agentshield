import { ScanStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "../db/prisma.js";
import { runDemoScan } from "./scanService.js";

const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_FAILURE_MESSAGE_LENGTH = 500;

export async function enqueueDemoScan(
  idempotencyKey: string,
  organizationId = "demo-organization",
  correlationId = "system",
) {
  const scopedIdempotencyKey = `${organizationId}:${idempotencyKey}`;
  const existing = await prisma.scanJob.findUnique({
    where: { idempotencyKey: scopedIdempotencyKey },
  });
  if (existing != null) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const organization =
        organizationId === "demo-organization"
          ? await tx.organization.upsert({
              where: { slug: "demo-organization" },
              update: {},
              create: {
                id: "demo-organization",
                slug: "demo-organization",
                name: "AgentShield Demo Organization",
              },
            })
          : await tx.organization.findUnique({ where: { id: organizationId } });
      if (organization == null) {
        throw new Error("Organization context is not provisioned.");
      }
      const scan = await tx.scan.create({
        data: {
          repositoryName: "agentshield-vulnerable-demo-target",
          repositoryUrl: "https://github.com/example/agentshield-vulnerable-demo-target",
          branch: "main",
          status: ScanStatus.QUEUED,
          organizationId: organization.id,
          metadata: { source: "LOCAL_EXAMPLE", queued: true, correlationId },
        },
      });
      return tx.scanJob.create({
        data: {
          scanId: scan.id,
          idempotencyKey: scopedIdempotencyKey,
          status: ScanStatus.QUEUED,
          maxAttempts: 3,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      const concurrent = await prisma.scanJob.findUnique({
        where: { idempotencyKey: scopedIdempotencyKey },
      });
      if (concurrent != null) return concurrent;
    }
    throw error;
  }
}

export async function requestJobCancellation(
  jobId: string,
  organizationId: string,
): Promise<boolean> {
  const updated = await prisma.scanJob.updateMany({
    where: {
      id: jobId,
      scan: { organizationId },
      status: { in: [ScanStatus.QUEUED, ScanStatus.RUNNING, ScanStatus.FAILED] },
    },
    data: { cancelRequestedAt: new Date() },
  });
  return updated.count === 1;
}

export async function recoverAbandonedJobs(now = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const staleJobs = await prisma.scanJob.findMany({
    where: { status: ScanStatus.RUNNING, lockedAt: { lt: staleBefore } },
    select: { id: true, scanId: true },
  });
  if (staleJobs.length === 0) return 0;

  await prisma.$transaction([
    prisma.scanJob.updateMany({
      where: { id: { in: staleJobs.map((job) => job.id) }, status: ScanStatus.RUNNING },
      data: {
        status: ScanStatus.FAILED,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: now,
        failureCode: "WORKER_ABANDONED",
        failureMessage: "The previous worker stopped responding; the job is eligible for retry.",
      },
    }),
    prisma.scan.updateMany({
      where: { id: { in: staleJobs.map((job) => job.scanId) }, status: ScanStatus.RUNNING },
      data: { status: ScanStatus.FAILED },
    }),
  ]);
  return staleJobs.length;
}

export async function processNextScanJob(workerId = `worker-${randomUUID()}`): Promise<boolean> {
  await recoverAbandonedJobs();
  const candidate = await prisma.scanJob.findFirst({
    where: {
      status: { in: [ScanStatus.QUEUED, ScanStatus.FAILED] },
      cancelRequestedAt: null,
      lockedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    include: { scan: { select: { organizationId: true } } },
  });
  if (candidate == null) return false;

  const claimed = await prisma.scanJob.updateMany({
    where: { id: candidate.id, status: candidate.status, lockedAt: null },
    data: {
      status: ScanStatus.RUNNING,
      lockedAt: new Date(),
      lockedBy: workerId,
      attempts: { increment: 1 },
      progress: 5,
    },
  });
  if (claimed.count !== 1) return true;

  try {
    const latest = await prisma.scanJob.findUniqueOrThrow({ where: { id: candidate.id } });
    if (latest.cancelRequestedAt != null) throw new Error("CANCEL_REQUESTED");
    await runDemoScan(candidate.scanId, candidate.scan.organizationId ?? "demo-organization");
    await prisma.scanJob.update({
      where: { id: candidate.id },
      data: {
        status: ScanStatus.COMPLETED,
        progress: 100,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });
  } catch (error) {
    const latest = await prisma.scanJob.findUniqueOrThrow({ where: { id: candidate.id } });
    const cancelled = error instanceof Error && error.message === "CANCEL_REQUESTED";
    const exhausted = latest.attempts >= latest.maxAttempts;
    const retrySeconds = Math.min(60, 2 ** latest.attempts);
    await prisma.$transaction([
      prisma.scanJob.update({
        where: { id: candidate.id },
        data: {
          status: cancelled ? ScanStatus.CANCELLED : ScanStatus.FAILED,
          lockedAt: null,
          lockedBy: null,
          failureCode: cancelled ? "CANCELLED" : exhausted ? "RETRIES_EXHAUSTED" : "SCAN_FAILED",
          failureMessage:
            error instanceof Error
              ? error.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH)
              : "Unknown worker failure",
          nextAttemptAt: cancelled || exhausted ? null : new Date(Date.now() + retrySeconds * 1000),
        },
      }),
      prisma.scan.update({
        where: { id: candidate.scanId },
        data: {
          status: cancelled ? ScanStatus.CANCELLED : ScanStatus.FAILED,
          completedAt: cancelled || exhausted ? new Date() : null,
        },
      }),
    ]);
  }
  return true;
}
