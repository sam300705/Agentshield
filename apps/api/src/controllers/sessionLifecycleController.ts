import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  agentSessionParamsSchema,
  agentSessionResponseSchema,
  closeAgentSessionSchema,
  createAgentSessionSchema,
  sessionQuerySchema,
  sanitizeText,
} from "@agentshield/schemas";
import { prisma } from "../db/prisma.js";
import { getActor, getCorrelationId } from "../security/auth.js";

function failure(response: Response, status: number, code: string) {
  response.status(status).json({
    error: {
      code,
      message:
        code === "SESSION_IDEMPOTENCY_CONFLICT"
          ? "The session key is bound to a different context."
          : "Resource was not found.",
      correlationId: getCorrelationId(response),
    },
  });
}
function publicSession(session: unknown) {
  // Explicit projection excludes internal idempotency and context digest fields.
  return agentSessionResponseSchema.parse(session);
}
function project(session: {
  id: string;
  organizationId: string;
  repositoryId: string;
  actor: string;
  source: string;
  taskSummary: string;
  status: string;
  correlationId: string;
  startedAt: Date;
  completedAt: Date | null;
}) {
  return publicSession({
    id: session.id,
    organizationId: session.organizationId,
    repositoryId: session.repositoryId,
    actor: session.actor,
    source: sanitizeText(session.source),
    taskSummary: sanitizeText(session.taskSummary),
    status: session.status,
    correlationId: session.correlationId,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  });
}
export async function createAgentSessionController(
  request: Request,
  response: Response,
): Promise<void> {
  sessionQuerySchema.parse(request.query);
  const actor = getActor(response);
  const input = createAgentSessionSchema.parse(request.body);
  const correlationId = getCorrelationId(response);
  const contextDigest = createHash("sha256")
    .update(JSON.stringify([input.repositoryId, input.source, input.taskSummary]))
    .digest("hex");
  const result = await prisma.$transaction(async (tx) => {
    // Scope the serialization key exactly as the unique constraint, without concatenation ambiguity.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([actor.organizationId, actor.id, input.idempotencyKey])}))`,
    );
    const repository = await tx.repository.findFirst({
      where: { id: input.repositoryId, organizationId: actor.organizationId },
    });
    if (repository == null) return { kind: "MISSING" as const };
    const existing = await tx.agentSession.findFirst({
      where: {
        organizationId: actor.organizationId,
        actor: actor.id,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (existing != null)
      return existing.contextDigest === contextDigest
        ? { kind: "EXISTING" as const, session: existing }
        : { kind: "CONFLICT" as const };
    const session = await tx.agentSession.create({
      data: {
        organizationId: actor.organizationId,
        repositoryId: repository.id,
        actor: actor.id,
        source: sanitizeText(input.source).slice(0, 128),
        taskSummary: sanitizeText(input.taskSummary).slice(0, 1000),
        idempotencyKey: input.idempotencyKey,
        contextDigest,
        correlationId: `session-${randomUUID()}`,
      },
    });
    await tx.auditEvent.create({
      data: {
        action: "SESSION_CREATED",
        actor: actor.id,
        organizationId: actor.organizationId,
        correlationId,
        entityType: "AgentSession",
        entityId: session.id,
        metadata: { repositoryId: repository.id },
      },
    });
    return { kind: "CREATED" as const, session };
  });
  if (result.kind === "MISSING") return failure(response, 404, "REPOSITORY_NOT_FOUND");
  if (result.kind === "CONFLICT") return failure(response, 409, "SESSION_IDEMPOTENCY_CONFLICT");
  response.status(result.kind === "CREATED" ? 201 : 200).json({ data: project(result.session) });
}
export async function getAgentSessionController(
  request: Request,
  response: Response,
): Promise<void> {
  sessionQuerySchema.parse(request.query);
  const actor = getActor(response);
  const { sessionId } = agentSessionParamsSchema.parse(request.params);
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, organizationId: actor.organizationId, actor: actor.id },
  });
  if (session == null) return failure(response, 404, "SESSION_NOT_FOUND");
  response.json({ data: project(session) });
}
export async function closeAgentSessionController(
  request: Request,
  response: Response,
): Promise<void> {
  sessionQuerySchema.parse(request.query);
  const actor = getActor(response);
  const { sessionId } = agentSessionParamsSchema.parse(request.params);
  closeAgentSessionSchema.parse(request.body);
  const session = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`);
    const current = await tx.agentSession.findFirst({
      where: { id: sessionId, organizationId: actor.organizationId, actor: actor.id },
    });
    if (current == null || current.status !== "ACTIVE") return current;
    const closed = await tx.agentSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        action: "SESSION_CLOSED",
        actor: actor.id,
        organizationId: actor.organizationId,
        correlationId: getCorrelationId(response),
        entityType: "AgentSession",
        entityId: sessionId,
        metadata: { status: closed.status },
      },
    });
    return closed;
  });
  if (session == null) return failure(response, 404, "SESSION_NOT_FOUND");
  response.json({ data: project(session) });
}
