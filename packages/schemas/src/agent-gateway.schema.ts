import { z } from "zod";

import { agentEventTypeSchema } from "./control-plane.schema.js";
import { policyDecisionTypeSchema } from "./policy.schema.js";

const safeIdentifier = z.string().min(1).max(256);
const safeText = z.string().max(4_000);

export const agentActionSchema = z.enum([
  "READ_FILE",
  "WRITE_FILE",
  "RUN_COMMAND",
  "NETWORK_REQUEST",
  "ACCESS_SECRET",
  "CHANGE_INFRASTRUCTURE",
  "PUBLISH_ARTIFACT",
]);

export const agentAuthorizationRequestSchema = z
  .object({
    organizationId: safeIdentifier,
    sessionId: safeIdentifier,
    actor: safeIdentifier,
    action: agentActionSchema,
    resource: safeText,
    correlationId: safeIdentifier,
    idempotencyKey: safeIdentifier,
    evidence: z.unknown().optional(),
  })
  .strict();

export const agentDecisionSchema = z
  .object({
    decision: policyDecisionTypeSchema,
    allowed: z.boolean(),
    reason: safeText,
    ruleId: safeIdentifier,
    ruleVersion: safeIdentifier,
    correlationId: safeIdentifier,
    expiresAt: z.coerce.date().optional(),
  })
  .strict();

export const agentEventInputSchema = z
  .object({
    organizationId: safeIdentifier,
    sessionId: safeIdentifier,
    sequence: z.number().int().nonnegative(),
    idempotencyKey: safeIdentifier,
    timestamp: z.coerce.date(),
    actor: safeIdentifier,
    source: safeIdentifier,
    type: agentEventTypeSchema,
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    summary: safeText.min(1),
    resource: safeText.min(1).optional(),
    evidence: z.unknown().default({}),
    correlationId: safeIdentifier,
  })
  .strict();

export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentAuthorizationRequest = z.infer<typeof agentAuthorizationRequestSchema>;
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentEventInput = z.input<typeof agentEventInputSchema>;
