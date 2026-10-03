import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticate, type AuthenticatedRequest } from "../src/middleware/auth.js";
import { requireRole } from "../src/middleware/rbac.js";
import jwt from "jsonwebtoken";
import type { Response, NextFunction } from "express";

// Mock prisma and express
vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        if (where.id === "viewer-id") return Promise.resolve({ id: "viewer-id", role: "VIEWER", email: "viewer@example.com" });
        if (where.id === "reviewer-id") return Promise.resolve({ id: "reviewer-id", role: "REVIEWER", email: "reviewer@example.com" });
        if (where.id === "admin-id") return Promise.resolve({ id: "admin-id", role: "ADMIN", email: "admin@example.com" });
        return Promise.resolve(null);
      }),
    },
    safaAuditLog: {
      create: vi.fn(() => Promise.resolve({})),
    },
  },
}));

describe("Authentication & RBAC Middleware", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  const mockReq = (token?: string, path: string = "/api/scans"): AuthenticatedRequest => {
    return {
      cookies: token ? { token } : {},
      originalUrl: path,
      method: "GET",
    } as unknown as AuthenticatedRequest;
  };

  const mockRes = (): Response => {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response;
  };

  const next: NextFunction = vi.fn();

  it("authenticate: returns 401 if no token provided", async () => {
    const req = mockReq();
    const res = mockRes();
    await authenticate(req, res, next);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("authenticate: returns 401 if token invalid", async () => {
    const req = mockReq("bad-token");
    const res = mockRes();
    await authenticate(req, res, next);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("authenticate: populates req.user if token valid", async () => {
    const token = jwt.sign({ userId: "viewer-id" }, "test-secret");
    const req = mockReq(token);
    const res = mockRes();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe("viewer-id");
  });

  it("requireRole: returns 403 if role not allowed", async () => {
    const req = mockReq(undefined, "/api/scans");
    req.user = { id: "viewer-id", email: "v", role: "VIEWER", createdAt: new Date(), updatedAt: new Date() };
    const res = mockRes();
    const middleware = requireRole(["ADMIN"]);
    await middleware(req, res, next);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("requireRole: allows access if role allowed", async () => {
    const req = mockReq(undefined, "/api/scans");
    req.user = { id: "viewer-id", email: "v", role: "VIEWER", createdAt: new Date(), updatedAt: new Date() };
    const res = mockRes();
    const middleware = requireRole(["VIEWER", "ADMIN"]);
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("requireRole: writes audit log if unauthorized approval attempted", async () => {
    const req = mockReq(undefined, "/api/approvals/123/approve");
    req.user = { id: "viewer-id", email: "v", role: "VIEWER", createdAt: new Date(), updatedAt: new Date() };
    const res = mockRes();
    const middleware = requireRole(["REVIEWER"]);
    await middleware(req, res, next);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(403);

    // Check if prisma.safaAuditLog.create was called
    const { prisma } = await import("../src/db/prisma.js");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.safaAuditLog.create).toHaveBeenCalled();
  });
});
