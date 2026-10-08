import { describe, expect, it, vi, type Mock } from "vitest";

import type { AgentEventInput } from "@agentshield/schemas";

type EventRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  idempotencyKey: string;
  timestamp: Date;
  actor: string;
  source: string;
  type: AgentEventInput["type"];
  riskLevel: AgentEventInput["riskLevel"];
  summary: string;
  resource: string | null;
  evidence: unknown;
  correlationId: string;
  eventHash: string;
  previousHash: string | null;
  rawPayloadHash?: string | null;
};

type FakeClient = {
  $executeRaw: Mock<(...args: unknown[]) => Promise<number>>;
  agentSession: { findFirst: Mock<() => Promise<{ id: string } | null>> };
  agentEvent: {
    findUnique: Mock<() => Promise<EventRecord | null>>;
    findFirst: Mock<() => Promise<EventRecord | null>>;
    create: Mock<(args: { data: EventRecord }) => Promise<EventRecord>>;
  };
  auditEvent: { create: Mock<(args: { data: unknown }) => Promise<unknown>> };
};

type FakePrisma = FakeClient & {
  $transaction: Mock<
    (callback: (client: FakeClient) => Promise<unknown>, options?: unknown) => Promise<unknown>
  >;
};

const fakePrisma = vi.hoisted(() => {
  const events: EventRecord[] = [];
  let transactionChain = Promise.resolve();
  const findByIdempotency = (args: unknown): Promise<EventRecord | null> => {
    const key = (args as { where: { sessionId_idempotencyKey: { idempotencyKey: string } } }).where
      .sessionId_idempotencyKey.idempotencyKey;
    return Promise.resolve(events.find((event) => event.idempotencyKey === key) ?? null);
  };
  const findFirst = (args: unknown): Promise<EventRecord | null> => {
    const where = (args as { where?: { idempotencyKey?: string } }).where;
    return Promise.resolve(
      where?.idempotencyKey == null
        ? (events.at(-1) ?? null)
        : (events.find((event) => event.idempotencyKey === where.idempotencyKey) ?? null),
    );
  };
  const client: FakeClient = {
    $executeRaw: vi.fn(() => Promise.resolve(1)),
    agentSession: { findFirst: vi.fn(() => Promise.resolve({ id: "session-test" })) },
    agentEvent: {
      findUnique: vi.fn(findByIdempotency),
      findFirst: vi.fn(findFirst),
      create: vi.fn(({ data }: { data: EventRecord }) => {
        events.push(data);
        return Promise.resolve(data);
      }),
    },
    auditEvent: { create: vi.fn(() => Promise.resolve({})) },
  };
  const prisma: FakePrisma = {
    ...client,
    $transaction: vi.fn((callback) => {
      const run = transactionChain.then(() => callback(client));
      transactionChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
  };
  return {
    prisma,
    reset: () => {
      events.splice(0);
      transactionChain = Promise.resolve();
      vi.clearAllMocks();
    },
    events,
  };
});

vi.mock("../db/prisma.js", () => ({ prisma: fakePrisma.prisma }));

const { ingestAgentEvent } = await import("./agentEventService.js");

function input(overrides: Partial<AgentEventInput> = {}): AgentEventInput {
  return {
    organizationId: "org-test",
    sessionId: "session-test",
    sequence: 0,
    idempotencyKey: "event-0",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    actor: "agent-test",
    source: "synthetic-test",
    type: "SHELL_COMMAND",
    riskLevel: "HIGH",
    summary: "Synthetic event",
    evidence: { note: "safe" },
    correlationId: "corr-test",
    ...overrides,
  };
}

describe("serializable agent-event ingestion", () => {
  it("accepts exactly one of two concurrent same-sequence events and preserves one chain head", async () => {
    fakePrisma.reset();
    const [first, second] = await Promise.all([
      ingestAgentEvent(input({ idempotencyKey: "event-a" })),
      ingestAgentEvent(input({ idempotencyKey: "event-b" })),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["CREATED", "SEQUENCE_INVALID"]);
    expect(fakePrisma.events).toHaveLength(1);
    expect(fakePrisma.events[0]?.previousHash).toBeNull();
  });

  it("returns the existing event for concurrent identical idempotent requests", async () => {
    fakePrisma.reset();
    const [first, second] = await Promise.all([
      ingestAgentEvent(input()),
      ingestAgentEvent(input()),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["CREATED", "EXISTING"]);
    expect(fakePrisma.events).toHaveLength(1);
    const eventId =
      first.kind === "CREATED" || first.kind === "EXISTING"
        ? first.eventId
        : second.kind === "CREATED" || second.kind === "EXISTING"
          ? second.eventId
          : undefined;
    expect(eventId).toBe(fakePrisma.events[0]?.id);
  });

  it("rejects changed content under an existing idempotency key", async () => {
    fakePrisma.reset();
    await expect(ingestAgentEvent(input())).resolves.toMatchObject({ kind: "CREATED" });
    await expect(
      ingestAgentEvent(input({ summary: "Different synthetic event" })),
    ).resolves.toEqual({ kind: "IDEMPOTENCY_CONFLICT" });
    expect(fakePrisma.events).toHaveLength(1);
  });

  it("rejects sequence gaps and preserves previous-hash continuity", async () => {
    fakePrisma.reset();
    await expect(ingestAgentEvent(input({ sequence: 1 }))).resolves.toEqual({
      kind: "SEQUENCE_INVALID",
      expected: 0,
    });

    const first = await ingestAgentEvent(input());
    const second = await ingestAgentEvent(
      input({ sequence: 1, idempotencyKey: "event-1", summary: "Second synthetic event" }),
    );
    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("CREATED");
    if (first.kind === "CREATED" && second.kind === "CREATED") {
      expect(second.previousHash).toBe(first.eventHash);
    }
  });
});

it("denies another actor before both append and idempotent replay", async () => {
  fakePrisma.reset();
  await ingestAgentEvent(input());
  fakePrisma.prisma.agentSession.findFirst.mockResolvedValue(null);
  await expect(ingestAgentEvent(input({ actor: "other-actor" }))).resolves.toEqual({
    kind: "SESSION_NOT_FOUND",
  });
  await expect(
    ingestAgentEvent(input({ actor: "other-actor", idempotencyKey: "new-event" })),
  ).resolves.toEqual({ kind: "SESSION_NOT_FOUND" });
  expect(fakePrisma.events).toHaveLength(1);
  fakePrisma.prisma.agentSession.findFirst.mockResolvedValue({ id: "session-test" });
});

it("binds idempotency to raw secrets without persisting either original token", async () => {
  fakePrisma.reset();
  const secret = (letter: string) => `sk_live_${letter.repeat(30)}`;
  const first = input({ evidence: { command: `deploy ${secret("a")}` } });
  const second = input({ evidence: { command: `deploy ${secret("b")}` } });
  await expect(ingestAgentEvent(first)).resolves.toMatchObject({ kind: "CREATED" });
  const stored = fakePrisma.events[0];
  expect(stored?.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(stored)).not.toContain(secret("a"));
  expect(JSON.stringify(stored)).not.toContain(secret("b"));
  await expect(ingestAgentEvent(second)).resolves.toEqual({
    kind: "IDEMPOTENCY_CONFLICT",
  });
  expect(fakePrisma.events).toHaveLength(1);
});

it("fails closed on a legacy event lacking its unredacted identity hash", async () => {
  fakePrisma.reset();
  await ingestAgentEvent(input());
  const stored = fakePrisma.events[0];
  if (stored == null) throw new Error("Expected fixture event");
  stored.rawPayloadHash = null;
  await expect(ingestAgentEvent(input())).resolves.toEqual({
    kind: "IDEMPOTENCY_CONFLICT",
  });
});

it("rejects append and retry when a session is no longer active", async () => {
  fakePrisma.reset();
  await ingestAgentEvent(input());
  fakePrisma.prisma.agentSession.findFirst.mockResolvedValue(null);
  await expect(
    ingestAgentEvent(input({ sequence: 1, idempotencyKey: "late" })),
  ).resolves.toEqual({ kind: "SESSION_NOT_FOUND" });
  await expect(ingestAgentEvent(input())).resolves.toEqual({ kind: "SESSION_NOT_FOUND" });
  expect(fakePrisma.events).toHaveLength(1);
});
