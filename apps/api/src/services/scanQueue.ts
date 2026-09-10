import { ScanStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  createRepositoryScanSchema,
  sanitizeText,
  scanJobPayloadSchema,
  scanTriggerSchema,
  type CreateRepositoryScan,
  type ScanTrigger,
} from "@agentshield/schemas";

import { prisma } from "../db/prisma.js";
import { defaultScanJobExecutor, type ScanJobExecutor } from "./scanJobExecutor.js";

const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_FAILURE_MESSAGE_LENGTH = 500;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;

export const SCAN_LEASE_MS = STALE_LOCK_MS;
export const SCAN_HEARTBEAT_MS = Math.max(1_000, Math.floor(SCAN_LEASE_MS / 3));

export interface ScanProvenance {
  trigger?: ScanTrigger;
  webhook?: {
    deliveryId: string;
    eventName: string;
    action?: string;
  };
}

export function calculateRetryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(attempt) - 1));
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
  const jitter = Math.floor(random() * Math.min(1_000, Math.floor(base / 4)));
  return Math.min(RETRY_MAX_MS, base + jitter);
}

export async function enqueueRepositoryScan(
  input: CreateRepositoryScan,
  idempotencyKey: string,
  organizationId: string,
  requester: string,
  correlationId: string,
  provenance: ScanProvenance = {},
): Promise<{ id: string; scanId: string; status: ScanStatus }> {
  const request = createRepositoryScanSchema.parse(input);
  const trigger = scanTriggerSchema.parse(provenance.trigger ?? "MANUAL");
  const scopedIdempotencyKey = `${organizationId}:${idempotencyKey}`;
  const existing = await prisma.scanJob.findUnique({
    where: { idempotencyKey: scopedIdempotencyKey },
  });
  if (existing != null)
    return { id: existing.id, scanId: existing.scanId, status: existing.status };

  return prisma.$transaction(async (tx) => {
    const repository = await tx.repository.findFirst({
      where: { id: request.repositoryId, organizationId },
      select: {
        id: true,
        provider: true,
        fullName: true,
        defaultBranch: true,
        githubInstallation: { select: { installationId: true } },
      },
    });
    if (repository == null) throw new Error("Repository is not registered for this organization.");
    const provider = repository.provider.toUpperCase();
    if (provider !== "GITHUB" && provider !== "LOCAL") {
      throw new Error("Repository provider is not supported.");
    }
    if (provider === "GITHUB" && repository.githubInstallation == null) {
      throw new Error("GitHub repository is not bound to an active installation.");
    }

    const github =
      provider === "GITHUB"
        ? {
            installationId: repository.githubInstallation!.installationId,
            repositoryFullName: repository.fullName,
            ...(provenance.webhook == null
              ? {}
              : {
                  deliveryId: provenance.webhook.deliveryId,
                  eventName: provenance.webhook.eventName,
                  ...(provenance.webhook.action == null
                    ? {}
                    : { action: provenance.webhook.action }),
                }),
          }
        : undefined;

    const payload = scanJobPayloadSchema.parse({
      organizationId,
      ...(github == null ? {} : { github }),
      repositoryId: repository.id,
      provider,
      repositoryName: repository.fullName,
      ...(provider === "GITHUB"
        ? { repositoryUrl: `https://github.com/${repository.fullName}` }
        : {}),
      ref: request.ref || repository.defaultBranch,
      ...(request.commitSha == null ? {} : { commitSha: request.commitSha }),
      policyBundleVersion: request.policyBundleVersion,
      trigger,
      requester,
      correlationId,
      options: request.options,
    });

    const scan = await tx.scan.create({
      data: {
        repositoryName: repository.fullName,
        repositoryUrl: provider === "GITHUB" ? `https://github.com/${repository.fullName}` : null,
        branch: payload.ref,
        ...(payload.commitSha == null ? {} : { commitSha: payload.commitSha }),
        status: ScanStatus.QUEUED,
        organizationId,
        repositoryId: repository.id,
        metadata: {
          source: trigger,
          triggeredBy: requester,
          correlationId,
          provider,
          ref: payload.ref,
          policyBundleVersion: request.policyBundleVersion,
          ...(github?.deliveryId == null ? {} : { deliveryId: github.deliveryId }),
          ...(github?.eventName == null ? {} : { eventName: github.eventName }),
          ...(github?.action == null ? {} : { action: github.action }),
        },
      },
    });
    const job = await tx.scanJob.create({
      data: {
        scanId: scan.id,
        idempotencyKey: scopedIdempotencyKey,
        status: ScanStatus.QUEUED,
        provider,
        repositoryRef: payload.ref,
        ...(payload.commitSha == null ? {} : { commitSha: payload.commitSha }),
        policyBundleVersion: request.policyBundleVersion,
        trigger,
        requester,
        correlationId,
        payload,
      },
      select: { id: true, scanId: true, status: true },
    });
    return job;
  });
}

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
          provider: "LOCAL",
          repositoryRef: "local-demo",
          policyBundleVersion: "demo",
          trigger: "MANUAL",
          requester: "demo",
          correlationId,
          payload: {
            organizationId: organization.id,
            repositoryId: "local-demo",
            provider: "LOCAL",
            repositoryName: "agentshield-vulnerable-demo-target",
            ref: "main",
            policyBundleVersion: "demo",
            trigger: "MANUAL",
            requester: "demo",
            correlationId,
          },
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
    where: {
      status: ScanStatus.RUNNING,
      OR: [
        { leaseExpiresAt: { lt: now } },
        { leaseExpiresAt: null, lockedAt: { lt: staleBefore } },
      ],
    },
    select: { id: true, scanId: true },
  });
  if (staleJobs.length === 0) return 0;

  await prisma.$transaction([
    prisma.scanJob.updateMany({
      where: {
        id: { in: staleJobs.map((job: { id: string; scanId: string }) => job.id) },
        status: ScanStatus.RUNNING,
      },
      data: {
        status: ScanStatus.FAILED,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: now,
        nextAttemptAt: now,
        failureCode: "WORKER_ABANDONED",
        failureMessage: "The previous worker stopped responding; the job is eligible for retry.",
      },
    }),
    prisma.scan.updateMany({
      where: {
        id: { in: staleJobs.map((job: { id: string; scanId: string }) => job.scanId) },
        status: ScanStatus.RUNNING,
      },
      data: { status: ScanStatus.FAILED },
    }),
  ]);
  return staleJobs.length;
}

export async function renewScanJobLease(
  jobId: string,
  workerId: string,
  now = new Date(),
  leaseMs = SCAN_LEASE_MS,
): Promise<boolean> {
  const updated = await prisma.scanJob.updateMany({
    where: { id: jobId, status: ScanStatus.RUNNING, lockedBy: workerId },
    data: {
      lockedAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      lastHeartbeatAt: now,
    },
  });
  return updated.count === 1;
}

export async function processNextScanJob(
  workerId = `worker-${randomUUID()}`,
  executor: ScanJobExecutor = defaultScanJobExecutor,
  shutdownSignal?: AbortSignal,
): Promise<boolean> {
  if (shutdownSignal?.aborted === true) return false;
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
      leaseExpiresAt: new Date(Date.now() + SCAN_LEASE_MS),
      lastHeartbeatAt: new Date(),
      attempts: { increment: 1 },
      progress: 5,
    },
  });
  if (claimed.count !== 1) return true;

  const abortController = new AbortController();
  const shutdownHandler = () => abortController.abort();
  if (shutdownSignal != null && shutdownSignal.aborted) abortController.abort();
  shutdownSignal?.addEventListener("abort", shutdownHandler, { once: true });
  let leaseLost = false;
  let timeoutTriggered = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const heartbeat = setInterval(() => {
    void renewScanJobLease(candidate.id, workerId)
      .then((owned) => {
        if (!owned) {
          leaseLost = true;
          abortController.abort();
        }
      })
      .catch(() => {
        leaseLost = true;
        abortController.abort();
      });
  }, SCAN_HEARTBEAT_MS);
  const cancellationPoll = setInterval(() => {
    void prisma.scanJob
      .findUnique({ where: { id: candidate.id }, select: { cancelRequestedAt: true } })
      .then((latest) => {
        if (latest?.cancelRequestedAt != null) abortController.abort();
      })
      .catch(() => undefined);
  }, 500);

  try {
    const latest = await prisma.scanJob.findUniqueOrThrow({ where: { id: candidate.id } });
    if (latest.cancelRequestedAt != null) throw new Error("CANCEL_REQUESTED");
    const payload = scanJobPayloadSchema.parse(latest.payload);
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      abortController.abort();
    }, payload.options.timeoutMs);
    await executor.execute({
      scanId: candidate.scanId,
      payload: latest.payload,
      signal: abortController.signal,
    });
    if (leaseLost) throw new Error("WORKER_LEASE_LOST");
    if (abortController.signal.aborted) throw new Error("CANCEL_REQUESTED");
    const completed = await prisma.scanJob.updateMany({
      where: { id: candidate.id, lockedBy: workerId, status: ScanStatus.RUNNING },
      data: {
        status: ScanStatus.COMPLETED,
        progress: 100,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: new Date(),
        nextAttemptAt: null,
      },
    });
    if (completed.count !== 1) throw new Error("WORKER_LEASE_LOST");
  } catch (error) {
    const latest = await prisma.scanJob.findUniqueOrThrow({ where: { id: candidate.id } });
    const cancelled =
      !timeoutTriggered &&
      (abortController.signal.aborted ||
        (error instanceof Error && error.message === "CANCEL_REQUESTED"));
    const timedOut =
      timeoutTriggered || (error instanceof Error && error.message === "SCAN_TIMEOUT");
    const exhausted = latest.attempts >= latest.maxAttempts;
    const retryDelayMs = calculateRetryDelayMs(latest.attempts);
    const failureMessage = sanitizeText(
      error instanceof Error ? error.message : "Unknown worker failure",
    ).slice(0, MAX_FAILURE_MESSAGE_LENGTH);
    await prisma.$transaction(async (tx) => {
      const transitioned = await tx.scanJob.updateMany({
        where: { id: candidate.id, lockedBy: workerId, status: ScanStatus.RUNNING },
        data: {
          status: cancelled ? ScanStatus.CANCELLED : ScanStatus.FAILED,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          failureCode: cancelled
            ? "CANCELLED"
            : timedOut
              ? "SCAN_TIMEOUT"
              : exhausted
                ? "RETRIES_EXHAUSTED"
                : "SCAN_FAILED",
          failureMessage,
          deadLetteredAt: exhausted && !cancelled ? new Date() : null,
          nextAttemptAt: cancelled || exhausted ? null : new Date(Date.now() + retryDelayMs),
        },
      });
      if (transitioned.count !== 1) {
        throw new Error("WORKER_LEASE_LOST");
      }
      await tx.scan.update({
        where: { id: candidate.scanId },
        data: {
          status: cancelled
            ? ScanStatus.CANCELLED
            : exhausted
              ? ScanStatus.DEAD_LETTER
              : ScanStatus.FAILED,
          ...(cancelled || exhausted ? { completedAt: new Date() } : {}),
        },
      });
    });
  } finally {
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
    clearInterval(heartbeat);
    clearInterval(cancellationPoll);
    shutdownSignal?.removeEventListener("abort", shutdownHandler);
  }
  return true;
}
