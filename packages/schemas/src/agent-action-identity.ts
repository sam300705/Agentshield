import {
  agentAuthorizationRequestSchema,
  type AgentAuthorizationRequest,
} from "./agent-gateway.schema.js";
import { sanitizeEvidence } from "./evidenceRedaction.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value != null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  return value;
}

// Versioned identity excludes transport metadata and applies shared evidence sanitization.
export function canonicalAgentActionIdentity(raw: AgentAuthorizationRequest): string {
  const input = agentAuthorizationRequestSchema.parse(raw);
  return JSON.stringify(
    stable({
      version: "agent-action@2",
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      actor: input.actor,
      actionType: input.action,
      resource: input.resource.trim(),
      evidence: sanitizeEvidence(input.evidence ?? null),
    }),
  );
}
