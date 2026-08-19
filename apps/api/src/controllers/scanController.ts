import { z } from "zod";
import { type Request, type Response } from "express";

import { prisma } from "../db/prisma.js";
import { getCorrelationId } from "../security/auth.js";
import { enqueueDemoScan } from "../services/scanQueue.js";

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
});

const scanParamsSchema = z.object({
  scanId: z.string().min(1),
});

function getPagination(query: Request["query"]) {
  const pagination = paginationQuerySchema.parse(query);

  return {
    ...pagination,
    skip: (pagination.page - 1) * pagination.limit,
  };
}

export async function runDemoScanController(request: Request, response: Response): Promise<void> {
  const suppliedKey = request.header("idempotency-key");
  const idempotencyKey =
    suppliedKey != null && /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedKey)
      ? suppliedKey
      : `demo:${getCorrelationId(response)}`;
  const job = await enqueueDemoScan(idempotencyKey);

  response.status(202).json({
    scanId: job.scanId,
    jobId: job.id,
    status: job.status,
    correlationId: getCorrelationId(response),
  });
}

export async function listScansController(request: Request, response: Response): Promise<void> {
  const { limit, page, skip } = getPagination(request.query);
  const [total, scans] = await Promise.all([
    prisma.scan.count(),
    prisma.scan.findMany({
      orderBy: {
        createdAt: "desc",
      },
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

  response.json({
    page,
    limit,
    total,
    data: scans,
  });
}

export async function getScanController(request: Request, response: Response): Promise<void> {
  const { scanId } = scanParamsSchema.parse(request.params);
  const scan = await prisma.scan.findUnique({
    where: {
      id: scanId,
    },
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
      error: "SCAN_NOT_FOUND",
      message: `Scan ${scanId} was not found.`,
    });
    return;
  }

  response.json({
    data: scan,
  });
}

export async function getScanFindingsController(
  request: Request,
  response: Response,
): Promise<void> {
  const { scanId } = scanParamsSchema.parse(request.params);
  const { limit, page, skip } = getPagination(request.query);
  const [total, findings] = await Promise.all([
    prisma.finding.count({
      where: {
        scanId,
      },
    }),
    prisma.finding.findMany({
      where: {
        scanId,
      },
      orderBy: [
        {
          severity: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
      skip,
      take: limit,
      include: {
        policyDecision: true,
        remediation: true,
        approval: true,
      },
    }),
  ]);

  response.json({
    page,
    limit,
    total,
    data: findings,
  });
}

export async function getScanSbomController(request: Request, response: Response): Promise<void> {
  const { scanId } = scanParamsSchema.parse(request.params);
  const { limit, page, skip } = getPagination(request.query);
  const [total, dependencies] = await Promise.all([
    prisma.dependency.count({
      where: {
        scanId,
      },
    }),
    prisma.dependency.findMany({
      where: {
        scanId,
      },
      orderBy: [
        {
          packageName: "asc",
        },
        {
          version: "asc",
        },
      ],
      skip,
      take: limit,
    }),
  ]);

  response.json({
    page,
    limit,
    total,
    data: dependencies,
  });
}
