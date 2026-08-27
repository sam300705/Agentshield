import { ApprovalStatus, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  ensureAgentApproval,
  reviewAgentApproval,
} from "../apps/api/src/services/agentApprovalService.js";
import { ingestAgentEvent } from "../apps/api/src/services/agentEventService.js";
import {
  sanitizeText,
  type AgentAuthorizationRequest,
  type AgentEventInput,
} from "@agentshield/schemas";

const prisma = new PrismaClient();
const suffix = randomUUID();
const organizationId = `gateway-org-${suffix}`;
const sessionId = `gateway-session-${suffix}`;
const actor = `gateway-agent-${suffix}`;
const reviewer = `gateway-reviewer-${suffix}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const authorizationInput: AgentAuthorizationRequest = {
  organizationId,
  sessionId,
  actor,
  action: "RUN_COMMAND",
  resource: "synthetic/workspace",
  correlationId: `gateway-correlation-${suffix}`,
  idempotencyKey: `gateway-approval-${suffix}`,
};

function eventInput(overrides: Partial<AgentEventInput> = {}): AgentEventInput {
  return {
    organizationId,
    sessionId,
    sequence: 0,
    idempotencyKey: `gateway-event-${suffix}-0`,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    actor,
    source: "synthetic-gateway-test",
    type: "SHELL_COMMAND",
    riskLevel: "HIGH",
    summary: "Synthetic gateway event",
    evidence: { note: "safe synthetic evidence" },
    correlationId: `gateway-event-correlation-${suffix}`,
    ...overrides,
  };
}

async function main(): Promise<void> {
  let organizationCreated = false;
  try {
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: organizationId,
        name: "Synthetic gateway verification organization",
        repositories: {
          create: {
            id: `gateway-repository-${suffix}`,
            provider: "LOCAL_TEST",
            externalId: `gateway-external-${suffix}`,
            fullName: "synthetic/gateway",
          },
        },
      },
    });
    organizationCreated = true;
    await prisma.agentSession.create({
      data: {
        id: sessionId,
        organizationId,
        repositoryId: `gateway-repository-${suffix}`,
        actor,
        source: "synthetic-gateway-test",
        taskSummary: "Synthetic gateway verification",
        correlationId: `gateway-session-correlation-${suffix}`,
      },
    });

    const approvals = await Promise.all([
      ensureAgentApproval(authorizationInput, `server-correlation-${suffix}`),
      ensureAgentApproval(authorizationInput, `server-correlation-${suffix}`),
    ]);
    assert(
      approvals.filter((result) => result.kind === "CREATED").length === 1,
      "approval creation forked",
    );
    assert(
      approvals.filter((result) => result.kind === "EXISTING").length === 1,
      "approval idempotency failed",
    );
    const approval = approvals.find((result) => result.kind === "CREATED")?.approval;
    assert(approval != null, "approval was not created");
    assert(approval.status === ApprovalStatus.PENDING, "approval was not pending");

    const selfReview = await reviewAgentApproval(
      organizationId,
      approval.id,
      ApprovalStatus.APPROVED,
      actor,
      undefined,
      `review-${suffix}`,
    );
    assert(selfReview.kind === "SELF_APPROVAL", "self-approval was not rejected");

    const reviewed = await reviewAgentApproval(
      organizationId,
      approval.id,
      ApprovalStatus.APPROVED,
      reviewer,
      "Synthetic review",
      `review-${suffix}`,
    );
    assert(
      reviewed.kind === "UPDATED" && reviewed.approval.status === ApprovalStatus.APPROVED,
      "review did not approve",
    );
    const terminalReview = await reviewAgentApproval(
      organizationId,
      approval.id,
      ApprovalStatus.REJECTED,
      `other-${suffix}`,
      undefined,
      `review-2-${suffix}`,
    );
    assert(terminalReview.kind === "CONFLICT", "terminal approval was rewritten");

    const concurrentEvents = await Promise.all([
      ingestAgentEvent(eventInput({ idempotencyKey: `gateway-event-${suffix}-a` })),
      ingestAgentEvent(eventInput({ idempotencyKey: `gateway-event-${suffix}-b` })),
    ]);
    assert(
      concurrentEvents.filter((result) => result.kind === "CREATED").length === 1,
      "event sequence forked",
    );
    assert(
      (await prisma.agentEvent.count({ where: { sessionId } })) === 1,
      "concurrent event created duplicates",
    );

    const identicalEvents = await Promise.all([
      ingestAgentEvent(eventInput({ idempotencyKey: `gateway-event-${suffix}-same` })),
      ingestAgentEvent(eventInput({ idempotencyKey: `gateway-event-${suffix}-same` })),
    ]);
    assert(
      identicalEvents.filter((result) => result.kind === "CREATED").length === 1,
      "identical event creation was not singular",
    );
    assert(
      identicalEvents.filter((result) => result.kind === "EXISTING").length === 1,
      "identical event was not idempotent",
    );

    const changed = await ingestAgentEvent(
      eventInput({ idempotencyKey: `gateway-event-${suffix}-same`, summary: "Changed content" }),
    );
    assert(changed.kind === "IDEMPOTENCY_CONFLICT", "changed idempotency payload was accepted");

    const next = await ingestAgentEvent(
      eventInput({
        sequence: 2,
        idempotencyKey: `gateway-event-${suffix}-2`,
        summary: "Synthetic sequence two",
      }),
    );
    assert(next.kind === "SEQUENCE_INVALID", "sequence gap was accepted");
    const sequential = await ingestAgentEvent(
      eventInput({
        sequence: 1,
        idempotencyKey: `gateway-event-${suffix}-1`,
        summary: "Synthetic sequence one",
      }),
    );
    assert(sequential.kind === "CREATED", "next sequential event was not accepted");
    const firstEvent = await prisma.agentEvent.findFirst({
      where: { sessionId },
      orderBy: { sequence: "asc" },
    });
    assert(
      firstEvent != null && sequential.previousHash === firstEvent.eventHash,
      "event hash continuity failed",
    );

    console.warn(
      "Agent Gateway database verification passed: approvals, reviewer rules, idempotency, concurrency, and chain continuity.",
    );
  } finally {
    if (organizationCreated) {
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      sanitizeText(error instanceof Error ? error.message : "Unknown gateway verification error"),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
