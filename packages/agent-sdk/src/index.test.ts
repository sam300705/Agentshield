import { describe, expect, it, vi } from "vitest";

import {
  AgentShieldClient,
  assertAgentActionAllowed,
  assertAgentApprovalMatches,
} from "./index.js";

const approval = {
  id: "approval-1",
  organizationId: "org-1",
  sessionId: "session-1",
  actor: "agent-1",
  actionType: "RUN_COMMAND" as const,
  resource: "workspace/repository",
  actionDigest: "a".repeat(64),
  status: "APPROVED" as const,
  requestedBy: "agent-1",
  reviewedBy: "reviewer-1",
  reason: "Reviewed",
  correlationId: "corr-1",
  idempotencyKey: "authorize-1",
  requestedAt: new Date("2026-01-01T00:00:00.000Z"),
  reviewedAt: new Date("2026-01-01T00:01:00.000Z"),
};

describe("AgentShield SDK", () => {
  it("rejects blocked and approval-required actions before execution", () => {
    expect(() =>
      assertAgentActionAllowed("RUN_COMMAND", {
        decision: "BLOCK",
        allowed: false,
        reason: "The action is prohibited.",
        ruleId: "command.block",
        ruleVersion: "1.0.0",
        correlationId: "corr-1",
      }),
    ).toThrow("denied");

    expect(() =>
      assertAgentActionAllowed("WRITE_FILE", {
        decision: "REQUIRE_APPROVAL",
        allowed: true,
        reason: "A reviewer must approve this action.",
        ruleId: "file.write.review",
        ruleVersion: "1.0.0",
        correlationId: "corr-1",
      }),
    ).toThrow("requires human approval");

    expect(() =>
      assertAgentActionAllowed(
        "RUN_COMMAND",
        {
          decision: "REQUIRE_APPROVAL",
          allowed: true,
          reason: "A reviewer must approve this action.",
          ruleId: "command.review",
          ruleVersion: "1.0.0",
          correlationId: "corr-1",
          approvalId: approval.id,
          approvalStatus: "APPROVED",
        },
        approval,
      ),
    ).not.toThrow();
  });

  it("validates authorization responses and sends no command execution payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            decision: "ALLOW",
            allowed: true,
            reason: "Read-only access is permitted.",
            ruleId: "read.allow",
            ruleVersion: "1.0.0",
            correlationId: "corr-1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new AgentShieldClient({ baseUrl: "https://control-plane.example", fetchImpl });

    await expect(
      client.authorize({
        organizationId: "org-1",
        sessionId: "session-1",
        actor: "agent-1",
        action: "READ_FILE",
        resource: "README.md",
        correlationId: "corr-1",
        idempotencyKey: "authorize-1",
      }),
    ).resolves.toMatchObject({ data: { allowed: true } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://control-plane.example/api/v1/agent/authorize");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.body).not.toContain("command");
  });

  it("retrieves and polls approvals without executing the protected action", async () => {
    const pending = { ...approval, status: "PENDING" as const, reviewedBy: null, reviewedAt: null };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: pending }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: approval }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new AgentShieldClient({ baseUrl: "https://control-plane.example", fetchImpl });

    await expect(
      client.waitForApproval(approval.id, { intervalMs: 100, timeoutMs: 500 }),
    ).resolves.toEqual({
      data: approval,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("rejects approval replay against another action or non-approved status", () => {
    const input = {
      organizationId: "org-1",
      sessionId: "session-1",
      actor: "agent-1",
      action: "RUN_COMMAND" as const,
      resource: "workspace/repository",
      correlationId: "corr-1",
      idempotencyKey: "authorize-1",
    };
    expect(() => assertAgentApprovalMatches(input, approval)).not.toThrow();
    expect(() =>
      assertAgentApprovalMatches(input, { ...approval, resource: "different-resource" }),
    ).toThrow("not bound");
    expect(() => assertAgentApprovalMatches(input, { ...approval, status: "PENDING" })).toThrow(
      "pending",
    );
  });
});
