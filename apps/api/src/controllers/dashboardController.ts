import { ApprovalStatus, PolicyDecisionType } from "@prisma/client";
import { type Request, type Response } from "express";

import { prisma } from "../db/prisma.js";
import { getActor } from "../security/auth.js";

function createEmptySeverityCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function createEmptyDecisionCounts() {
  return { allow: 0, warn: 0, requireApproval: 0, block: 0 };
}

function calculatePlatformRiskScore(input: {
  critical: number;
  high: number;
  block: number;
  requireApproval: number;
}): "A" | "B" | "C" | "F" {
  if (input.critical > 0 || input.block > 0) return "F";
  if (input.high > 0 || input.requireApproval > 0) return "C";
  return "A";
}

export async function getDashboardSummaryController(
  _request: Request,
  response: Response,
): Promise<void> {
  const { organizationId } = getActor(response);
  const scanWhere = { organizationId };
  const [totalScans, totalFindings, pendingApprovalsCount, latestScan] = await Promise.all([
    prisma.scan.count({ where: scanWhere }),
    prisma.finding.count({ where: { scan: scanWhere } }),
    prisma.approval.count({
      where: { status: ApprovalStatus.PENDING, finding: { scan: scanWhere } },
    }),
    prisma.scan.findFirst({
      where: scanWhere,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { findings: true, dependencies: true } },
      },
    }),
  ]);

  if (latestScan == null) {
    response.json({
      totalScans,
      totalFindings,
      pendingApprovalsCount,
      platformRiskScore: "A",
      latestScan: null,
    });
    return;
  }

  const [severityRows, decisionRows, organizationSeverityRows, organizationDecisionRows] =
    await Promise.all([
      prisma.finding.groupBy({
        by: ["severity"],
        where: { scanId: latestScan.id, scan: scanWhere },
        _count: { _all: true },
      }),
      prisma.policyDecision.groupBy({
        by: ["decision"],
        where: { finding: { scanId: latestScan.id, scan: scanWhere } },
        _count: { _all: true },
      }),
      prisma.finding.groupBy({
        by: ["severity"],
        where: { scan: scanWhere },
        _count: { _all: true },
      }),
      prisma.policyDecision.groupBy({
        by: ["decision"],
        where: { finding: { scan: scanWhere } },
        _count: { _all: true },
      }),
    ]);
  const severityCounts = createEmptySeverityCounts();
  const decisionCounts = createEmptyDecisionCounts();

  for (const row of severityRows) {
    switch (row.severity) {
      case "CRITICAL":
        severityCounts.critical = row._count._all;
        break;
      case "HIGH":
        severityCounts.high = row._count._all;
        break;
      case "MEDIUM":
        severityCounts.medium = row._count._all;
        break;
      case "LOW":
        severityCounts.low = row._count._all;
        break;
    }
  }

  for (const row of decisionRows) {
    switch (row.decision) {
      case PolicyDecisionType.ALLOW:
        decisionCounts.allow = row._count._all;
        break;
      case PolicyDecisionType.WARN:
        decisionCounts.warn = row._count._all;
        break;
      case PolicyDecisionType.REQUIRE_APPROVAL:
        decisionCounts.requireApproval = row._count._all;
        break;
      case PolicyDecisionType.BLOCK:
        decisionCounts.block = row._count._all;
        break;
    }
  }

  const platformRiskScore = calculatePlatformRiskScore({
    critical: organizationSeverityRows.find((row) => row.severity === "CRITICAL")?._count._all ?? 0,
    high: organizationSeverityRows.find((row) => row.severity === "HIGH")?._count._all ?? 0,
    block: organizationDecisionRows.find((row) => row.decision === "BLOCK")?._count._all ?? 0,
    requireApproval:
      organizationDecisionRows.find((row) => row.decision === "REQUIRE_APPROVAL")?._count._all ?? 0,
  });
  response.json({
    platformRiskScore,
    totalScans,
    totalFindings,
    pendingApprovalsCount,
    latestScan: {
      id: latestScan.id,
      status: latestScan.status,
      repositoryName: latestScan.repositoryName,
      branch: latestScan.branch,
      createdAt: latestScan.createdAt,
      completedAt: latestScan.completedAt,
      findingsCount: latestScan._count.findings,
      dependenciesCount: latestScan._count.dependencies,
      severityCounts,
      decisionCounts,
      platformRiskScore,
    },
  });
}
