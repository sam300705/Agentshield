import { ScanStatus } from "@prisma/client";
import type { Request, Response } from "express";

import { prisma } from "../db/prisma.js";
import { getCorrelationId } from "../security/auth.js";

export async function readinessController(_request: Request, response: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
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
  const [queued, running, failed] = await Promise.all([
    prisma.scanJob.count({ where: { status: ScanStatus.QUEUED } }),
    prisma.scanJob.count({ where: { status: ScanStatus.RUNNING } }),
    prisma.scanJob.count({ where: { status: ScanStatus.FAILED } }),
  ]);
  response
    .type("text/plain")
    .send(
      [
        "# HELP agentshield_scan_jobs Scan jobs by state",
        "# TYPE agentshield_scan_jobs gauge",
        `agentshield_scan_jobs{status="queued"} ${queued}`,
        `agentshield_scan_jobs{status="running"} ${running}`,
        `agentshield_scan_jobs{status="failed"} ${failed}`,
      ].join("\n"),
    );
}
