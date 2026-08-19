import { ScanStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "../db/prisma.js";
import { runDemoScan } from "./scanService.js";

export async function enqueueDemoScan(idempotencyKey: string) {
  const existing = await prisma.scanJob.findUnique({ where: { idempotencyKey } });
  if (existing != null) return existing;
  return prisma.$transaction(async (tx) => {
    const scan = await tx.scan.create({
      data: {
        repositoryName: "agentshield-vulnerable-demo-target",
        repositoryUrl: "https://github.com/example/agentshield-vulnerable-demo-target",
        branch: "main",
        status: ScanStatus.QUEUED,
        metadata: { source: "LOCAL_EXAMPLE", queued: true },
      },
    });
    return tx.scanJob.create({
      data: { scanId: scan.id, idempotencyKey, status: ScanStatus.QUEUED, maxAttempts: 3 },
    });
  });
}

export async function requestJobCancellation(jobId: string): Promise<boolean> {
  const updated = await prisma.scanJob.updateMany({
    where: {
      id: jobId,
      status: { in: [ScanStatus.QUEUED, ScanStatus.RUNNING, ScanStatus.FAILED] },
    },
    data: { cancelRequestedAt: new Date() },
  });
  return updated.count === 1;
}

export async function processNextScanJob(workerId = `worker-${randomUUID()}`): Promise<boolean> {
  const candidate = await prisma.scanJob.findFirst({
    where: {
      status: { in: [ScanStatus.QUEUED, ScanStatus.FAILED] },
      cancelRequestedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
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
    await runDemoScan(candidate.scanId);
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
            error instanceof Error ? error.message.slice(0, 500) : "Unknown worker failure",
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
