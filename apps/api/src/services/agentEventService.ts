import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { canonicalJson, createIntegrityChain, redactEvidence } from "@agentshield/policy-engine";
import { agentEventInputSchema, type AgentEventInput } from "@agentshield/schemas";

import { prisma } from "../db/prisma.js";

type ParsedAgentEvent = {
  organizationId: string;
  sessionId: string;
  sequence: number;
  idempotencyKey: string;
  timestamp: Date;
  actor: string;
  source: string;
  type: AgentEventInput["type"];
  riskLevel: AgentEventInput["riskLevel"];
  summary: string;
  resource?: string;
  evidence: unknown;
  correlationId: string;
};

type PersistedAgentEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: Date;
  actor: string;
  source: string;
  type: ParsedAgentEvent["type"];
  riskLevel: ParsedAgentEvent["riskLevel"];
  summary: string;
  resource: string | null;
  evidence: unknown;
  correlationId: string;
  eventHash: string;
  previousHash: string | null;
};

export type AgentEventIngestResult =
  | {
      kind: "CREATED";
      eventId: string;
      eventHash: string;
      previousHash: string | null;
      payloadHash: string;
    }
  | {
      kind: "EXISTING";
      eventId: string;
      eventHash: string;
      previousHash: string | null;
      payloadHash: string;
    }
  | { kind: "SESSION_NOT_FOUND" }
  | { kind: "SEQUENCE_INVALID"; expected: number }
  | { kind: "SEQUENCE_CONFLICT" }
  | { kind: "IDEMPOTENCY_CONFLICT" };

function payloadValue(input: {
  sessionId: string;
  sequence: number;
  timestamp: Date;
  actor: string;
  source: string;
  type: ParsedAgentEvent["type"];
  riskLevel: ParsedAgentEvent["riskLevel"];
  summary: string;
  resource?: string | null;
  evidence: unknown;
  correlationId: string;
}) {
  return {
    sessionId: input.sessionId,
    sequence: input.sequence,
    timestamp: input.timestamp,
    actor: input.actor,
    source: input.source,
    type: input.type,
    riskLevel: input.riskLevel,
    summary: input.summary,
    resource: input.resource ?? null,
    evidence: redactEvidence(input.evidence),
    correlationId: input.correlationId,
  };
}

function payloadHash(input: ParsedAgentEvent): string {
  return createHash("sha256")
    .update(canonicalJson(payloadValue(input)))
    .digest("hex");
}

function persistedPayloadHash(event: PersistedAgentEvent): string {
  return createHash("sha256")
    .update(canonicalJson(payloadValue(event)))
    .digest("hex");
}

function isConcurrencyConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

function samePayload(event: PersistedAgentEvent, expectedHash: string): boolean {
  return persistedPayloadHash(event) === expectedHash;
}

async function findExisting(input: ParsedAgentEvent): Promise<PersistedAgentEvent | null> {
  return prisma.agentEvent.findFirst({
    where: {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      session: { organizationId: input.organizationId },
    },
  });
}

function resultFromEvent(
  kind: "CREATED" | "EXISTING",
  event: Pick<PersistedAgentEvent, "id" | "eventHash" | "previousHash">,
  expectedHash: string,
): AgentEventIngestResult {
  return {
    kind,
    eventId: event.id,
    eventHash: event.eventHash,
    previousHash: event.previousHash,
    payloadHash: expectedHash,
  };
}

export async function ingestAgentEvent(
  rawInput: AgentEventInput,
  retryOnConcurrency = true,
): Promise<AgentEventIngestResult> {
  const input = agentEventInputSchema.parse(rawInput) as ParsedAgentEvent;
  const expectedHash = payloadHash(input);

  const existing = await findExisting(input);
  if (existing != null) {
    return samePayload(existing, expectedHash)
      ? resultFromEvent("EXISTING", existing, expectedHash)
      : { kind: "IDEMPOTENCY_CONFLICT" };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}))`,
        );
        const session = await tx.agentSession.findFirst({
          where: { id: input.sessionId, organizationId: input.organizationId },
          select: { id: true },
        });
        if (session == null) return { kind: "SESSION_NOT_FOUND" as const };

        const inTransactionExisting = await tx.agentEvent.findFirst({
          where: {
            sessionId: input.sessionId,
            idempotencyKey: input.idempotencyKey,
            session: { organizationId: input.organizationId },
          },
        });
        if (inTransactionExisting != null) {
          return samePayload(inTransactionExisting, expectedHash)
            ? resultFromEvent("EXISTING", inTransactionExisting, expectedHash)
            : ({ kind: "IDEMPOTENCY_CONFLICT" } as const);
        }

        const latest = await tx.agentEvent.findFirst({
          where: { sessionId: input.sessionId },
          orderBy: { sequence: "desc" },
          select: { sequence: true, eventHash: true },
        });
        const expectedSequence = (latest?.sequence ?? -1) + 1;
        if (input.sequence !== expectedSequence) {
          return { kind: "SEQUENCE_INVALID" as const, expected: expectedSequence };
        }

        const event = createIntegrityChain(
          [
            {
              id: randomUUID(),
              sessionId: input.sessionId,
              sequence: input.sequence,
              timestamp: input.timestamp,
              actor: input.actor,
              source: input.source,
              type: input.type,
              riskLevel: input.riskLevel,
              summary: input.summary,
              ...(input.resource == null ? {} : { resource: input.resource }),
              evidence: input.evidence,
              correlationId: input.correlationId,
            },
          ],
          latest?.eventHash ?? null,
        )[0];
        if (event == null) throw new Error("Event integrity construction failed.");

        await tx.agentEvent.create({
          data: {
            id: event.id,
            sessionId: event.sessionId,
            sequence: event.sequence,
            idempotencyKey: input.idempotencyKey,
            timestamp: event.timestamp,
            actor: event.actor,
            source: event.source,
            type: event.type,
            riskLevel: event.riskLevel,
            summary: event.summary,
            resource: event.resource ?? null,
            evidence: JSON.parse(JSON.stringify(event.evidence)) as Prisma.InputJsonValue,
            correlationId: event.correlationId,
            previousHash: event.integrity.previousHash,
            eventHash: event.integrity.eventHash,
          },
        });
        await tx.auditEvent.create({
          data: {
            actor: input.actor,
            action: "AGENT_EVENT_INGESTED",
            entityType: "AgentEvent",
            entityId: event.id,
            organizationId: input.organizationId,
            correlationId: input.correlationId,
            metadata: {
              eventId: event.id,
              sessionId: input.sessionId,
              sequence: input.sequence,
              eventHash: event.integrity.eventHash,
              payloadHash: expectedHash,
            },
          },
        });
        return resultFromEvent(
          "CREATED",
          {
            id: event.id,
            eventHash: event.integrity.eventHash,
            previousHash: event.integrity.previousHash,
          },
          expectedHash,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return result;
  } catch (error) {
    if (!isConcurrencyConflict(error)) throw error;
    const retryDelays = retryOnConcurrency ? [0, 10, 50, 150] : [0];
    for (const delay of retryDelays) {
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      const concurrent = await findExisting(input);
      if (concurrent != null) {
        return samePayload(concurrent, expectedHash)
          ? resultFromEvent("EXISTING", concurrent, expectedHash)
          : { kind: "IDEMPOTENCY_CONFLICT" };
      }
    }
    return { kind: "SEQUENCE_CONFLICT" };
  }
}
