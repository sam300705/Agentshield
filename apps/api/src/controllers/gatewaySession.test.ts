import { expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const db = vi.hoisted(() => ({ agentSession: { findFirst: vi.fn() } }));
const ensure = vi.hoisted(() => vi.fn());
vi.mock("../db/prisma.js", () => ({ prisma: db }));
vi.mock("../services/agentApprovalService.js", () => ({ ensureAgentApproval: ensure }));
vi.mock("../security/auth.js", () => ({
  getActor: () => ({ id: "caller", organizationId: "org" }),
  getCorrelationId: () => "corr",
}));
import { authorizeAgentActionController } from "./agentGatewayController.js";
it.each(["READ_FILE", "WRITE_FILE", "RUN_COMMAND"])(
  "requires an active owned session before %s decisions",
  async (action) => {
    db.agentSession.findFirst.mockResolvedValue(null);
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await authorizeAgentActionController(
      {
        body: {
          organizationId: "org",
          actor: "caller",
          sessionId: "foreign",
          action,
          resource: "README.md",
          correlationId: "corr",
          idempotencyKey: "synthetic-key",
        },
      } as Request,
      res as unknown as Response,
    );
    expect(db.agentSession.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", organizationId: "org", actor: "caller", status: "ACTIVE" },
      select: { id: true },
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "SESSION_NOT_FOUND" }) as unknown,
      }),
    );
    expect(ensure).not.toHaveBeenCalled();
  },
);
