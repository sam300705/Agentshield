import {
  agentActionSchema,
  agentDecisionSchema,
  type AgentAction,
  type AgentDecision,
} from "@agentshield/schemas";

export const AGENT_POLICY_VERSION = "builtin-agent-policy@1.0.0";
interface AgentRule {
  id: string;
  version: string;
  actions: readonly AgentAction[];
  decision: AgentDecision["decision"];
  allowed: boolean;
  reason: string;
}
export const AGENT_ACTION_RULES: readonly AgentRule[] = [
  {
    id: "agent.action.requires_approval",
    version: AGENT_POLICY_VERSION,
    actions: ["ACCESS_SECRET", "CHANGE_INFRASTRUCTURE", "RUN_COMMAND"],
    decision: "REQUIRE_APPROVAL",
    allowed: true,
    reason: "This action requires a separate human approval before execution.",
  },
  {
    id: "agent.action.warn",
    version: AGENT_POLICY_VERSION,
    actions: ["WRITE_FILE", "PUBLISH_ARTIFACT"],
    decision: "WARN",
    allowed: true,
    reason: "The action is permitted with an auditable warning.",
  },
  {
    id: "agent.action.allow",
    version: AGENT_POLICY_VERSION,
    actions: ["READ_FILE", "NETWORK_REQUEST"],
    decision: "ALLOW",
    allowed: true,
    reason: "The read-only or metadata action is permitted.",
  },
];
export function evaluateAgentAction(action: AgentAction, correlationId: string): AgentDecision {
  const validated = agentActionSchema.parse(action);
  const rule = AGENT_ACTION_RULES.find((candidate) => candidate.actions.includes(validated));
  if (rule == null) throw new Error("No agent policy rule matches this action.");
  return agentDecisionSchema.parse({
    decision: rule.decision,
    allowed: rule.allowed,
    reason: rule.reason,
    ruleId: rule.id,
    ruleVersion: rule.version,
    correlationId,
  });
}
