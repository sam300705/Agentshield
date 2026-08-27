import { describe, expect, it, vi } from "vitest";

import { AgentShieldClient, assertAgentActionAllowed } from "./index.js";

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
});
