import { type Request, type Response } from "express";
import { createRepositoryScanSchema } from "@agentshield/schemas";
import { z } from "zod";

import { prisma } from "../db/prisma.js";
import { getActor, getCorrelationId } from "../security/auth.js";
import {
  enqueueDemoScan,
  enqueueRepositoryScan,
  requestJobCancellation,
} from "../services/scanQueue.js";

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
});

const scanParamsSchema = z.object({
  scanId: z.string().min(1).max(128),
});

function getPagination(query: Request["query"]) {
  const pagination = paginationQuerySchema.parse(query);

  return {
    ...pagination,
    skip: (pagination.page - 1) * pagination.limit,
  };
}

export async function listRepositoriesController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const repositories = await prisma.repository.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      provider: true,
      externalId: true,
      fullName: true,
      defaultBranch: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  response.json({ data: repositories });
}

export async function createRepositoryScanController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const body = createRepositoryScanSchema.parse(request.body);
  const suppliedKey = request.header("idempotency-key");
  const idempotencyKey =
    suppliedKey != null && /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedKey)
      ? suppliedKey
      : `manual:${getCorrelationId(response)}`;
  const job = await enqueueRepositoryScan(
    body,
    idempotencyKey,
    actor.organizationId,
    actor.id,
    getCorrelationId(response),
  );
  response.status(202).json({ ...job, correlationId: getCorrelationId(response) });
}

export async function getScanProgressController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { scanId } = scanParamsSchema.parse(request.params);
  const job = await prisma.scanJob.findFirst({
    where: { scanId, scan: { organizationId: actor.organizationId } },
    select: {
      id: true,
      scanId: true,
      status: true,
      progress: true,
      attempts: true,
      maxAttempts: true,
      failureCode: true,
      deadLetteredAt: true,
      updatedAt: true,
    },
  });
  if (job == null) {
    response.status(404).json({
      error: {
        code: "SCAN_JOB_NOT_FOUND",
        message: "Scan job was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  response.json({ data: job });
}

export async function cancelScanController(request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const { scanId } = scanParamsSchema.parse(request.params);
  const job = await prisma.scanJob.findFirst({
    where: { scanId, scan: { organizationId: actor.organizationId } },
    select: { id: true },
  });
  if (job == null || !(await requestJobCancellation(job.id, actor.organizationId))) {
    response.status(404).json({
      error: {
        code: "SCAN_JOB_NOT_FOUND",
        message: "An active scan job was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  response.status(202).json({
    scanId,
    status: "CANCEL_REQUESTED",
    correlationId: getCorrelationId(response),
  });
}

export async function runDemoScanController(request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const suppliedKey = request.header("idempotency-key");
  const idempotencyKey =
    suppliedKey != null && /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedKey)
      ? suppliedKey
      : `demo:${getCorrelationId(response)}`;
  const job = await enqueueDemoScan(
    idempotencyKey,
    actor.organizationId,
    getCorrelationId(response),
  );

  response.status(202).json({
    scanId: job.scanId,
    jobId: job.id,
    status: job.status,
    correlationId: getCorrelationId(response),
  });
}

export async function listScansController(request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const { limit, page, skip } = getPagination(request.query);
  const where = { organizationId: actor.organizationId };
  const [total, scans] = await Promise.all([
    prisma.scan.count({ where }),
    prisma.scan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        _count: {
          select: {
            findings: true,
            dependencies: true,
          },
        },
      },
    }),
  ]);

  response.json({ page, limit, total, data: scans });
}

export async function getScanController(request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const { scanId } = scanParamsSchema.parse(request.params);
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, organizationId: actor.organizationId },
    include: {
      _count: {
        select: {
          findings: true,
          dependencies: true,
          auditEvents: true,
        },
      },
    },
  });

  if (scan == null) {
    response.status(404).json({
      error: {
        code: "SCAN_NOT_FOUND",
        message: "Scan was not found.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }

  response.json({ data: scan });
}

export async function getScanFindingsController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { scanId } = scanParamsSchema.parse(request.params);
  const { limit, page, skip } = getPagination(request.query);
  const where = { scanId, scan: { organizationId: actor.organizationId } };
  const [total, findings] = await Promise.all([
    prisma.finding.count({ where }),
    prisma.finding.findMany({
      where,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
      include: {
        policyDecision: true,
        remediation: true,
        approval: true,
      },
    }),
  ]);

  response.json({ page, limit, total, data: findings });
}

export async function getScanSbomController(request: Request, response: Response): Promise<void> {
  const actor = getActor(response);
  const { scanId } = scanParamsSchema.parse(request.params);
  const { limit, page, skip } = getPagination(request.query);
  const where = { scanId, scan: { organizationId: actor.organizationId } };
  const [total, dependencies] = await Promise.all([
    prisma.dependency.count({ where }),
    prisma.dependency.findMany({
      where,
      orderBy: [{ packageName: "asc" }, { version: "asc" }],
      skip,
      take: limit,
    }),
  ]);

  response.json({ page, limit, total, data: dependencies });
}
