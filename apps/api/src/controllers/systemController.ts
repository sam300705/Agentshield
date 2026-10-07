import { ScanStatus } from "@prisma/client";
import type { Request, Response } from "express";

import { renderHttpMetrics } from "../observability.js";
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
  const [queued, running, failed] = await Promise.all([
    prisma.scanJob.count({ where: { ...scope, status: ScanStatus.QUEUED } }),
    prisma.scanJob.count({ where: { ...scope, status: ScanStatus.RUNNING } }),
    prisma.scanJob.count({ where: { ...scope, status: ScanStatus.FAILED } }),
  ]);
  response
    .type("text/plain")
    .send(
      [
        renderHttpMetrics(),
        "# HELP agentshield_scan_jobs Scan jobs by state",
        "# TYPE agentshield_scan_jobs gauge",
        `agentshield_scan_jobs{status="queued"} ${queued}`,
        `agentshield_scan_jobs{status="running"} ${running}`,
        `agentshield_scan_jobs{status="failed"} ${failed}`,
      ].join("\n"),
    );
}
