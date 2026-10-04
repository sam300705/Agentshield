/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { approveApprovalController, rejectApprovalController } from "../src/controllers/approvalController.js";
import type { AuthenticatedRequest } from "../src/middleware/auth.js";
import type { Response } from "express";

// Mocks
const mockTx = {
  approval: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  }
};

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    approval: {
      findUnique: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(mockTx);
    })
  }
}));

import { prisma } from "../src/db/prisma.js";

describe("Approval State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const req = (id: string, role: string = "REVIEWER"): AuthenticatedRequest => ({
    params: { approvalId: id },
    body: { reason: "looks good" },
    user: { id: "user1", email: "user1@example.com", role }
  } as unknown as AuthenticatedRequest);

  const res = (): Response => {
    const r: Partial<Response> = {};
    r.status = vi.fn().mockReturnValue(r);
    r.json = vi.fn().mockReturnValue(r);
    return r as Response;
  };

  it("approve pending: transitions to APPROVED atomically", async () => {
    const response = res();
    const request = req("approval-1");

    // Initial check
    const findUniqueMock = prisma.approval.findUnique as any;
    findUniqueMock.mockResolvedValue({ id: "approval-1", status: "PENDING", finding: { scanId: "scan1" } });

    // TX Check
    mockTx.approval.findUnique.mockResolvedValue({ id: "approval-1", status: "PENDING" });

    // Atomic update succeeds
    mockTx.approval.updateMany.mockResolvedValue({ count: 1 });

    // Final fetch for return
    mockTx.approval.findUnique.mockResolvedValueOnce({ id: "approval-1", status: "PENDING" }) // for the initial tx check
      .mockResolvedValueOnce({ id: "approval-1", status: "APPROVED", finding: {} });

    await approveApprovalController(request, response);

    const updateManyArgsList = mockTx.approval.updateMany.mock.calls as any;
    const updateManyArg = updateManyArgsList[0][0];
    expect(updateManyArg).toEqual(expect.objectContaining({
      where: { id: "approval-1", status: "PENDING" },
      data: expect.objectContaining({ status: "APPROVED" })
    }));

    const responseJson = response.json as any;
    expect(responseJson.mock.calls.length).toBeGreaterThan(0);
  });

  it("approve approved: returns 409 Conflict", async () => {
    const response = res();
    const request = req("approval-2");

    const findUniqueMock = prisma.approval.findUnique as any;
    findUniqueMock.mockResolvedValue({ id: "approval-2", status: "APPROVED", finding: { scanId: "scan1" } });
    mockTx.approval.findUnique.mockResolvedValue({ id: "approval-2", status: "APPROVED" });

    await approveApprovalController(request, response);

    const responseStatus = response.status as any;
    const statusCalls = responseStatus.mock.calls;
    expect(statusCalls[0][0]).toBe(409);
    expect(mockTx.approval.updateMany).not.toHaveBeenCalled();
  });

  it("reject approved: returns 409 Conflict", async () => {
    const response = res();
    const request = req("approval-3");

    const findUniqueMock = prisma.approval.findUnique as any;
    findUniqueMock.mockResolvedValue({ id: "approval-3", status: "APPROVED", finding: { scanId: "scan1" } });
    mockTx.approval.findUnique.mockResolvedValue({ id: "approval-3", status: "APPROVED" });

    await rejectApprovalController(request, response);

    const responseStatus = response.status as any;
    const statusCalls = responseStatus.mock.calls;
    expect(statusCalls[0][0]).toBe(409);
    expect(mockTx.approval.updateMany).not.toHaveBeenCalled();
  });

  it("simultaneous/race condition: updateMany returns count 0, yields 409", async () => {
    const response = res();
    const request = req("approval-4");

    const findUniqueMock = prisma.approval.findUnique as any;
    findUniqueMock.mockResolvedValue({ id: "approval-4", status: "PENDING", finding: { scanId: "scan1" } });

    // Looks pending initially in the tx
    mockTx.approval.findUnique.mockResolvedValueOnce({ id: "approval-4", status: "PENDING" });

    // But the atomic update fails (count 0) because another thread beat it
    mockTx.approval.updateMany.mockResolvedValue({ count: 0 });

    // The fallback check sees it was REJECTED by someone else
    mockTx.approval.findUnique.mockResolvedValueOnce({ id: "approval-4", status: "REJECTED" });

    await approveApprovalController(request, response);

    const responseStatus = response.status as any;
    const statusCalls = responseStatus.mock.calls;
    expect(statusCalls[0][0]).toBe(409);

    const responseJson = response.json as any;
    const jsonCallsList = responseJson.mock.calls;
    const jsonCallArg = jsonCallsList[0][0];
    expect(jsonCallArg).toEqual(expect.objectContaining({
      error: "APPROVAL_CONFLICT",
      message: expect.stringContaining("REJECTED")
    }));
  });
});
