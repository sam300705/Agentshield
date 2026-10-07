import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  scan: { count: vi.fn(), findFirst: vi.fn() },
  finding: { count: vi.fn(), groupBy: vi.fn() },
  approval: { count: vi.fn() },
  policyDecision: { groupBy: vi.fn() },
  scanJob: { count: vi.fn() },
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
import { listRepositoriesController } from "./scanController.js";
import { getReceiptController } from "./agentGatewayController.js";
function response() {
  const res = { json: vi.fn(), type: vi.fn(), send: vi.fn() };
  res.type.mockReturnValue(res);
  return res as unknown as Response;
}
beforeEach(() => vi.resetAllMocks());
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
