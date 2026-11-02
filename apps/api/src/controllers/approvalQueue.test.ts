import { expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const db = vi.hoisted(() => ({
  approval: { count: vi.fn(), findMany: vi.fn() },
  agentApproval: { count: vi.fn(), findMany: vi.fn() },
  auditEvent: { findMany: vi.fn() },
}));
vi.mock("../db/prisma.js", () => ({ prisma: db }));
vi.mock("../security/auth.js", () => ({ getActor: () => ({ organizationId: "tenant" }) }));
import { listPendingApprovalsController } from "./approvalController.js";
it("returns bounded tenant-scoped agent queue with sanitized evidence bound to the stored digest", async () => {
  const secret = ["sk", "live", "a".repeat(30)].join("_");
  db.approval.count.mockResolvedValue(0);
  db.approval.findMany.mockResolvedValue([]);
  db.agentApproval.count.mockResolvedValue(2);
  db.agentApproval.findMany.mockResolvedValue([
    { id: "approval", actionDigest: "a".repeat(64), resource: "workspace", reason: null },
    { id: "legacy", actionDigest: "b".repeat(64), resource: "workspace", reason: null },
  ]);
  db.auditEvent.findMany.mockResolvedValue([
    {
      entityId: "approval",
      metadata: { actionDigest: "a".repeat(64), evidence: { command: `deploy ${secret}` } },
    },
  ]);
  const json = vi.fn();
  await listPendingApprovalsController(
    { query: { limit: "5", page: "2" } } as unknown as Request,
    { json } as unknown as Response,
  );
  expect(db.agentApproval.findMany).toHaveBeenCalledWith({
    where: { organizationId: "tenant", status: "PENDING" },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    skip: 5,
    take: 5,
  });
  const result = json.mock.calls[0]![0] as {
    agentApprovals: { data: Array<{ evidenceAvailable: boolean }> };
  };
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result.agentApprovals.data.map((item) => item.evidenceAvailable)).toEqual([true, false]);
  expect(db.auditEvent.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ organizationId: "tenant" }) as unknown,
      take: 5,
    }),
  );
});
