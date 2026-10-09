import { createHash } from "node:crypto";
import { canonicalAgentActionIdentity, type AgentAuthorizationRequest } from "@agentshield/schemas";
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

const protectedInput = {
  organizationId: approval.organizationId,
  sessionId: approval.sessionId,
  actor: approval.actor,
  action: approval.actionType,
  resource: approval.resource,
  correlationId: approval.correlationId,
  idempotencyKey: approval.idempotencyKey,
  evidence: { command: "echo safe" },
};
const digestFor = (input: AgentAuthorizationRequest) =>
  createHash("sha256").update(canonicalAgentActionIdentity(input)).digest("hex");

const boundApproval = {
  ...approval,
  actionDigest: createHash("sha256")
    .update(canonicalAgentActionIdentity(protectedInput))
    .digest("hex"),
};

describe("AgentShield SDK", () => {
  it.each([
    "http://remote.example",
    "http://localhost.evil.test",
    "ftp://localhost",
    "https://user:password@remote.example",
    "https://remote.example?next=http://evil.test",
  ])("rejects insecure or ambiguous endpoint %s before sending credentials", (baseUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => new AgentShieldClient({ baseUrl, fetchImpl, accessToken: "synthetic" })).toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    "https://remote.example",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
  ])("accepts qualified transport %s and refuses redirects", async (baseUrl) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: approval })));
    await new AgentShieldClient({ baseUrl, fetchImpl, accessToken: "synthetic" }).getApproval(
      approval.id,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it("rejects an approved action when only command evidence changes", () => {
    const input = {
      organizationId: approval.organizationId,
      sessionId: approval.sessionId,
      actor: approval.actor,
      action: approval.actionType,
      resource: approval.resource,
      correlationId: approval.correlationId,
      idempotencyKey: approval.idempotencyKey,
      evidence: { command: "echo safe" },
    };
    const bound = {
      ...approval,
      actionDigest: createHash("sha256").update(canonicalAgentActionIdentity(input)).digest("hex"),
    };
    expect(() => assertAgentApprovalMatches(input, bound)).not.toThrow();
    expect(() =>
      assertAgentApprovalMatches({ ...input, evidence: { command: "rm -rf src" } }, bound),
    ).toThrow("not bound");
  });
  it("rejects blocked and approval-required actions before execution", () => {
    expect(() =>
      assertAgentActionAllowed(protectedInput, {
        decision: "BLOCK",
        allowed: false,
        actionDigest: digestFor(protectedInput),
        reason: "The action is prohibited.",
        ruleId: "command.block",
        ruleVersion: "1.0.0",
        correlationId: "corr-1",
      }),
    ).toThrow("denied");

    expect(() =>
      assertAgentActionAllowed(
        { ...protectedInput, action: "WRITE_FILE" },
        {
          decision: "REQUIRE_APPROVAL",
          allowed: true,
          actionDigest: digestFor({ ...protectedInput, action: "WRITE_FILE" }),
          reason: "A reviewer must approve this action.",
          ruleId: "file.write.review",
          ruleVersion: "1.0.0",
          correlationId: "corr-1",
        },
      ),
    ).toThrow("requires human approval");

    expect(() =>
      assertAgentActionAllowed(
        protectedInput,
        {
          decision: "REQUIRE_APPROVAL",
          allowed: true,
          actionDigest: digestFor(protectedInput),
          reason: "A reviewer must approve this action.",
          ruleId: "command.review",
          ruleVersion: "1.0.0",
          correlationId: "corr-1",
          approvalId: approval.id,
          approvalStatus: "APPROVED",
        },
        boundApproval,
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
            actionDigest: digestFor({
              organizationId: "org-1",
              sessionId: "session-1",
              actor: "agent-1",
              action: "READ_FILE",
              resource: "README.md",
              correlationId: "corr-1",
              idempotencyKey: "authorize-1",
            }),
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
    expect(() =>
      assertAgentApprovalMatches(input, {
        ...approval,
        actionDigest: createHash("sha256")
          .update(canonicalAgentActionIdentity(input))
          .digest("hex"),
      }),
    ).not.toThrow();
    expect(() =>
      assertAgentApprovalMatches(input, {
        ...approval,
        resource: "[REDACTED:URL_CREDENTIAL]",
        actionDigest: digestFor(input),
      }),
    ).not.toThrow();
    expect(() =>
      assertAgentApprovalMatches(input, {
        ...approval,
        actionDigest: createHash("sha256")
          .update(canonicalAgentActionIdentity(input))
          .digest("hex"),
        status: "PENDING",
      }),
    ).toThrow("pending");
  });
});

it("the final execution guard rejects modified evidence, resource, and session", () => {
  const decision = {
    decision: "REQUIRE_APPROVAL" as const,
    allowed: true,
    actionDigest: digestFor(protectedInput),
    reason: "Reviewed",
    ruleId: "review",
    ruleVersion: "1",
    correlationId: "corr",
    approvalId: approval.id,
  };
  expect(() => assertAgentActionAllowed(protectedInput, decision, boundApproval)).not.toThrow();
  for (const input of [
    { ...protectedInput, evidence: { command: "changed" } },
    { ...protectedInput, resource: "other" },
    { ...protectedInput, sessionId: "other" },
  ])
    expect(() => assertAgentActionAllowed(input, decision, boundApproval)).toThrow("not bound");
});
it.each(["fetch", "body"])("bounds approval polling when %s never resolves", async (stage) => {
  let signal: AbortSignal | null | undefined;
  const fetchImpl = vi.fn<typeof fetch>((_url, options) => {
    signal = options?.signal;
    return stage === "fetch"
      ? new Promise(() => {})
      : Promise.resolve(new Response(new ReadableStream({ start() {} })));
  });
  const client = new AgentShieldClient({ baseUrl: "https://control.test", fetchImpl });
  const started = Date.now();
  await expect(
    client.waitForApproval("approval-1", { timeoutMs: 30, intervalMs: 100 }),
  ).rejects.toThrow("Timed out");
  expect(Date.now() - started).toBeLessThan(1000);
  expect(signal?.aborted).toBe(true);
});

it.each(["stripe", "url"])("execution guard binds the original raw %s credential value", (kind) => {
  const command = (letter: string) =>
    kind === "stripe"
      ? `deploy ${["sk", "live", letter.repeat(30)].join("_")}`
      : `curl https://example.test/?token=${letter.repeat(30)}`;
  const first = { ...protectedInput, evidence: { command: command("a") } };
  const reviewed = {
    ...boundApproval,
    actionDigest: createHash("sha256").update(canonicalAgentActionIdentity(first)).digest("hex"),
  };
  const decision = {
    decision: "REQUIRE_APPROVAL" as const,
    allowed: true,
    actionDigest: digestFor(first),
    reason: "Reviewed",
    ruleId: "review",
    ruleVersion: "1",
    correlationId: "corr",
    approvalId: reviewed.id,
  };
  expect(() => assertAgentActionAllowed(first, decision, reviewed)).not.toThrow();
  expect(() =>
    assertAgentActionAllowed({ ...first, evidence: { command: command("b") } }, decision, reviewed),
  ).toThrow("not bound");
});

it("rejects reuse of ALLOW authorization across actions and resources", () => {
  const input = { ...protectedInput, action: "READ_FILE" as const };
  const decision = {
    decision: "ALLOW" as const,
    allowed: true,
    reason: "Read only",
    ruleId: "allow.read",
    ruleVersion: "1",
    correlationId: input.correlationId,
    actionDigest: digestFor(input),
  };
  expect(() => assertAgentActionAllowed(input, decision)).not.toThrow();
  expect(() => assertAgentActionAllowed({ ...input, action: "RUN_COMMAND" }, decision)).toThrow(
    "not bound",
  );
  expect(() => assertAgentActionAllowed({ ...input, resource: "other" }, decision)).toThrow(
    "not bound",
  );
  expect(() => assertAgentActionAllowed(input, { ...decision, actionDigest: undefined })).toThrow(
    "not bound",
  );
});
