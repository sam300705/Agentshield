import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  scan: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  finding: { count: vi.fn(), groupBy: vi.fn() },
  approval: { count: vi.fn() },
  agentApproval: { count: vi.fn() },
  policyDecision: { groupBy: vi.fn() },
  scanJob: { count: vi.fn(), create: vi.fn() },
  repository: { count: vi.fn(), findMany: vi.fn() },
  securityReceipt: { findFirst: vi.fn() },
}));
vi.mock("../db/prisma.js", () => ({ prisma: db }));
vi.mock("../security/auth.js", () => ({
  getActor: () => ({ organizationId: "tenant-a" }),
  getCorrelationId: () => "corr",
}));
import { getDashboardSummaryController } from "./dashboardController.js";
import { metricsController } from "./systemController.js";
import { listRepositoriesController, createRepositoryScanController } from "./scanController.js";
import { getReceiptController } from "./agentGatewayController.js";
function response() {
  const res = { json: vi.fn(), type: vi.fn(), send: vi.fn() };
  res.type.mockReturnValue(res);
  return res as unknown as Response;
}
beforeEach(() => {
  vi.resetAllMocks();
  db.agentApproval.count.mockResolvedValue(0);
});
describe("tenant dashboard and request regressions", () => {
  it("keeps older tenant risk even when the latest scan is clean", async () => {
    db.scan.count.mockResolvedValue(2);
    db.finding.count.mockResolvedValue(1);
    db.approval.count.mockResolvedValue(0);
    db.scan.findFirst.mockResolvedValue({
      id: "clean-latest",
      _count: { findings: 0, dependencies: 0 },
    });
    db.finding.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ severity: "CRITICAL", _count: { _all: 1 } }]);
    db.policyDecision.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ decision: "BLOCK", _count: { _all: 1 } }]);
    const res = response();
    await getDashboardSummaryController({} as Request, res);
    expect(res.json).toHaveBeenCalledWith(
      contains({
        platformRiskScore: "F",
        latestScan: contains({
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        }),
      }),
    );
    expect((db.finding.groupBy.mock.calls[1]?.[0] as { where: unknown }).where).toEqual({
      scan: { organizationId: "tenant-a" },
    });
    expect((db.policyDecision.groupBy.mock.calls[1]?.[0] as { where: unknown }).where).toEqual({
      finding: { scan: { organizationId: "tenant-a" } },
    });
  });
  it("scopes every metrics count to the authenticated tenant", async () => {
    db.scanJob.count.mockResolvedValue(0);
    await metricsController({} as Request, response());
    for (const [args] of db.scanJob.count.mock.calls)
      expect((args as { where: { scan: unknown } }).where.scan).toEqual({
        organizationId: "tenant-a",
      });
  });
  it("paginates repository rows with tenant-scoped totals", async () => {
    db.repository.count.mockResolvedValue(30);
    db.repository.findMany.mockResolvedValue([]);
    const res = response();
    await listRepositoriesController(
      { query: { page: "2", limit: "10" } } as unknown as Request,
      res,
    );
    expect(db.repository.findMany).toHaveBeenCalledWith(
      contains({ skip: 10, take: 10, where: { organizationId: "tenant-a" } }),
    );
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 30, page: 2, limit: 10 });
  });
  it.each(["", "a".repeat(129)])("rejects invalid receipt IDs before querying", async (scanId) => {
    await expect(
      getReceiptController({ params: { scanId } } as unknown as Request, response()),
    ).rejects.toThrow();
    expect(db.securityReceipt.findFirst).not.toHaveBeenCalled();
  });
});

function contains(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value) as unknown;
}

it("rejects live repository admission before any durable database operation", async () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await createRepositoryScanController(
    {
      body: { repositoryId: "repo", ref: "main", policyBundleVersion: "2026.06.0", options: {} },
    } as Request,
    res as unknown as Response,
  );
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({
    error: {
      code: "REPOSITORY_SCANS_UNAVAILABLE",
      message: "Repository scanning is not available in this release.",
      correlationId: "corr",
    },
  });
  expect(db.scan.create).not.toHaveBeenCalled();
  expect(db.scanJob.create).not.toHaveBeenCalled();
  expect(db.scan.count).not.toHaveBeenCalled();
  expect(db.scanJob.count).not.toHaveBeenCalled();
  expect(db.repository.findMany).not.toHaveBeenCalled();
});

it("includes pending agent approvals even without a repository scan", async () => {
  db.scan.count.mockResolvedValue(0);
  db.finding.count.mockResolvedValue(0);
  db.approval.count.mockResolvedValue(2);
  db.agentApproval.count.mockResolvedValue(3);
  db.scan.findFirst.mockResolvedValue(null);
  const res = response();
  await getDashboardSummaryController({} as Request, res);
  expect(res.json).toHaveBeenCalledWith(contains({ pendingApprovalsCount: 5 }));
  expect(db.agentApproval.count).toHaveBeenCalledWith({
    where: { organizationId: "tenant-a", status: "PENDING" },
  });
});
