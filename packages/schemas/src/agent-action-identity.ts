import {
  agentAuthorizationRequestSchema,
  type AgentAuthorizationRequest,
} from "./agent-gateway.schema.js";
import { jsonValueSchema } from "./json.schema.js";

function stable(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Action evidence must contain finite JSON numbers.");
  if (Array.isArray(value)) return value.map(stable);
  if (value != null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  return value;
}

// Sensitive preimage: hash in memory only. Never persist or log this canonical string.
export function canonicalAgentActionIdentity(raw: AgentAuthorizationRequest): string {
  const input = agentAuthorizationRequestSchema.parse(raw);
  return JSON.stringify(
    stable({
      version: "agent-action@3",
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      actor: input.actor,
      actionType: input.action,
      resource: input.resource.trim(),
      evidence: jsonValueSchema.parse(input.evidence ?? null),
    }),
  );
}
