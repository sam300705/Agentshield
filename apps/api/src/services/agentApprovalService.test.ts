import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AgentApproval, AgentAuthorizationRequest } from "@agentshield/schemas";

type AsyncMock<T> = Mock<() => Promise<T>>;
type ApprovalMocks = {
  agentApproval: {
    findUnique: AsyncMock<AgentApproval | null>;
    findUniqueOrThrow: AsyncMock<AgentApproval>;
    findFirst: AsyncMock<AgentApproval | null>;
    create: AsyncMock<AgentApproval>;
    updateMany: AsyncMock<{ count: number }>;
  };
  agentSession: { findFirst: AsyncMock<{ id: string } | null> };
  auditEvent: { create: AsyncMock<Record<string, never>> };
  $transaction: Mock<(callback: (client: ApprovalMocks) => unknown) => Promise<unknown>>;
};

const prismaMock = vi.hoisted(() => {
  const mock: ApprovalMocks = {
    agentApproval: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    agentSession: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((callback) => callback(mock) as Promise<unknown>);
  return mock;
});

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));

const { createAgentActionDigest, ensureAgentApproval, reviewAgentApproval } =
  await import("./agentApprovalService.js");

const input: AgentAuthorizationRequest = {
  organizationId: "org-test",
  sessionId: "session-test",
  actor: "agent-test",
  action: "RUN_COMMAND",
  resource: "workspace/repository",
  correlationId: "corr-test",
  idempotencyKey: "idem-test",
};

function approval(overrides: Partial<AgentApproval> = {}): AgentApproval {
  return {
    id: "approval-test",
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    actor: input.actor,
    actionType: input.action,
    resource: input.resource,
    actionDigest: createAgentActionDigest(input),
    status: "PENDING",
    requestedBy: input.actor,
    reviewedBy: null,
    reason: null,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
    reviewedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.agentApproval.findUnique.mockResolvedValue(null);
  prismaMock.agentSession.findFirst.mockResolvedValue({ id: input.sessionId });
  prismaMock.auditEvent.create.mockResolvedValue({});
});

describe("AgentApproval service", () => {
  it("creates one pending approval and an audit event for a protected action", async () => {
    const stored = approval();
    prismaMock.agentApproval.create.mockResolvedValue(stored);

    const result = await ensureAgentApproval(input, "server-correlation");

    expect(result).toEqual({ kind: "CREATED", approval: stored });
    expect(prismaMock.agentApproval.create).toHaveBeenCalledOnce();
    const requestAudit = (prismaMock.auditEvent.create.mock.calls as unknown[][])[0]?.[0] as
      | { data?: { entityType?: string; action?: string; correlationId?: string } }
      | undefined;
    expect(requestAudit?.data).toMatchObject({
      entityType: "AgentApproval",
      action: "APPROVAL_REQUESTED",
      correlationId: "server-correlation",
    });
  });

  it("returns the existing approval for an identical idempotent request", async () => {
    const stored = approval();
    prismaMock.agentApproval.findUnique.mockResolvedValue(stored);

    const result = await ensureAgentApproval(input, "server-correlation");

    expect(result).toEqual({ kind: "EXISTING", approval: stored });
    expect(prismaMock.agentApproval.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key for different action content", async () => {
    prismaMock.agentApproval.findUnique.mockResolvedValue(
      approval({ actionType: "ACCESS_SECRET", actionDigest: "0".repeat(64) }),
    );

    await expect(ensureAgentApproval(input, "server-correlation")).resolves.toEqual({
      kind: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects self-approval and atomically records a valid reviewer decision", async () => {
    const stored = approval();
    const updated = approval({
      status: "APPROVED",
      reviewedBy: "reviewer-test",
      reviewedAt: new Date("2026-01-01T00:01:00.000Z"),
      reason: "Reviewed",
    });
    prismaMock.agentApproval.findFirst.mockResolvedValue(stored);

    await expect(
      reviewAgentApproval(
        input.organizationId,
        stored.id,
        "APPROVED",
        input.actor,
        undefined,
        "review-correlation",
      ),
    ).resolves.toEqual({ kind: "SELF_APPROVAL" });

    prismaMock.agentApproval.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.agentApproval.findUniqueOrThrow.mockResolvedValue(updated);
    await expect(
      reviewAgentApproval(
        input.organizationId,
        stored.id,
        "APPROVED",
        "reviewer-test",
        "Reviewed",
        "review-correlation",
      ),
    ).resolves.toEqual({ kind: "UPDATED", approval: updated });
    const reviewAudit = (prismaMock.auditEvent.create.mock.calls as unknown[][])[0]?.[0] as
      | { data?: { entityType?: string; action?: string; correlationId?: string } }
      | undefined;
    expect(reviewAudit?.data).toMatchObject({
      entityType: "AgentApproval",
      action: "APPROVAL_UPDATED",
      correlationId: "review-correlation",
    });

    prismaMock.agentApproval.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      reviewAgentApproval(
        input.organizationId,
        stored.id,
        "REJECTED",
        "other-reviewer",
        undefined,
        "review-correlation-2",
      ),
    ).resolves.toEqual({ kind: "CONFLICT" });
  });
});
