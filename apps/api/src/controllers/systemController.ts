import { ScanStatus } from "@prisma/client";
import type { Request, Response } from "express";

import { prisma } from "../db/prisma.js";
import { getActor, getCorrelationId } from "../security/auth.js";

export async function readinessController(_request: Request, response: Response): Promise<void> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("READINESS_TIMEOUT")), 3000);
        timer.unref();
      }),
    ]);
    response.json({
      service: "agentshield-api",
      status: "ready",
      checks: { database: "ok" },
      correlationId: getCorrelationId(response),
    });
  } catch {
    response.status(503).json({
      service: "agentshield-api",
      status: "not_ready",
      checks: { database: "unavailable" },
      correlationId: getCorrelationId(response),
    });
  }
}

export async function metricsController(_request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const scope = { scan: { organizationId: actor.organizationId } };
  const since = new Date(Date.now() - 86_400_000);
  const [
    queued,
    running,
    failed,
    retrying,
    stale,
    deadLettered,
    oldest,
    findings,
    durations,
    publicationFailures,
    recoveries,
  ] = await Promise.all([
    prisma.scanJob.count({ where: { ...scope, status: ScanStatus.QUEUED } }),
    prisma.scanJob.count({ where: { ...scope, status: ScanStatus.RUNNING } }),
    prisma.scanJob.count({ where: { ...scope, status: ScanStatus.FAILED } }),
    prisma.scanJob.count({
      where: {
        ...scope,
        status: ScanStatus.FAILED,
        deadLetteredAt: null,
        nextAttemptAt: { not: null },
      },
    }),
    prisma.scanJob.count({
      where: { ...scope, status: ScanStatus.RUNNING, leaseExpiresAt: { lt: new Date() } },
    }),
    prisma.scanJob.count({ where: { ...scope, deadLetteredAt: { not: null } } }),
    prisma.scanJob.findFirst({
      where: { ...scope, status: ScanStatus.QUEUED },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.finding.groupBy({
      by: ["category"],
      where: { scan: { organizationId: actor.organizationId } },
      _count: true,
    }),
    prisma.scan.findMany({
      where: {
        organizationId: actor.organizationId,
        status: "COMPLETED",
        completedAt: { gte: since },
      },
      orderBy: { completedAt: "desc" },
      take: 100,
      select: { startedAt: true, completedAt: true },
    }),
    prisma.auditEvent.count({
      where: {
        organizationId: actor.organizationId,
        action: "GITHUB_CHECK_FAILED",
        createdAt: { gte: since },
      },
    }),
    prisma.auditEvent.count({
      where: {
        organizationId: actor.organizationId,
        action: "SCAN_RECOVERED",
        createdAt: { gte: since },
      },
    }),
  ]);
  const durationSeconds = durations.reduce(
    (sum, scan) =>
      sum +
      Math.max(
        0,
        (scan.completedAt?.getTime() ?? scan.startedAt.getTime()) - scan.startedAt.getTime(),
      ) /
        1000,
    0,
  );
  response
    .type("text/plain")
    .send(
      [
        "# HELP agentshield_scan_jobs Scan jobs by state",
        "# TYPE agentshield_scan_jobs gauge",
        `agentshield_scan_jobs{status="queued"} ${queued}`,
        `agentshield_scan_jobs{status="running"} ${running}`,
        `agentshield_scan_jobs{status="failed"} ${failed}`,
        `agentshield_scan_jobs{status="retrying"} ${retrying}`,
        `agentshield_scan_jobs{status="stale"} ${stale}`,
        `agentshield_scan_jobs{status="dead_lettered"} ${deadLettered}`,
        `agentshield_queue_oldest_seconds ${oldest == null ? 0 : Math.max(0, Date.now() - oldest.createdAt.getTime()) / 1000}`,
        `agentshield_scan_duration_sample_seconds_sum ${durationSeconds}`,
        `agentshield_scan_duration_sample_count ${durations.length}`,
        `agentshield_github_publication_failures_24h ${publicationFailures}`,
        `agentshield_stale_recoveries_24h ${recoveries}`,
        ...findings.map(
          (finding) => `agentshield_findings{category="${finding.category}"} ${finding._count}`,
        ),
      ].join("\n"),
    );
}
