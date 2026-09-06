import { agentDecisionSchema, type AgentAction, type AgentDecision } from "@agentshield/schemas";

export function evaluateAgentAction(action: AgentAction, correlationId: string): AgentDecision {
  const policy =
    action === "ACCESS_SECRET" || action === "CHANGE_INFRASTRUCTURE" || action === "RUN_COMMAND"
      ? {
          decision: "REQUIRE_APPROVAL" as const,
          allowed: true,
          reason: "This action requires a separate human approval before execution.",
          ruleId: "agent.action.requires_approval",
        }
      : action === "WRITE_FILE" || action === "PUBLISH_ARTIFACT"
        ? {
            decision: "WARN" as const,
            allowed: true,
            reason: "The action is permitted with an auditable warning.",
            ruleId: "agent.action.warn",
          }
        : {
            decision: "ALLOW" as const,
            allowed: true,
            reason: "The read-only or metadata action is permitted.",
            ruleId: "agent.action.allow",
          };

  return agentDecisionSchema.parse({
    ...policy,
    ruleVersion: "builtin-agent-policy@1.0.0",
    correlationId,
  });
}
