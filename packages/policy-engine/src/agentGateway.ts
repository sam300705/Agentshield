import {
  agentActionSchema,
  agentDecisionSchema,
  type AgentAction,
  type AgentAuthorizationRequest,
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

/**
 * The action enum is supplied by the agent and cannot attest to the resource
 * being accessed. Escalate recognizable protected targets regardless of the
 * claimed action type. A cooperative SDK is not an operating-system sandbox.
 */
const SENSITIVE_RESOURCE =
  /(?:^|[/\\\\])(?:\\.env(?:\\.[^/\\\\]+)?|\\.ssh|\\.aws|\\.kube|\\.npmrc|\\.pypirc|id_rsa|id_ed25519|secrets?(?:\\.[^/\\\\]+)?|credentials?(?:\\.[^/\\\\]+)?|shadow)(?:$|[/\\\\?#])/i;
const INFRASTRUCTURE_RESOURCE =
  /(?:^|[/\\\\])(?:terraform|k8s|kubernetes|helm|charts?|\\.github[/\\\\]workflows|\\.terraform)(?:[/\\\\]|$)|(?:^|[/\\\\])(?:Dockerfile(?:\\.[^/\\\\]+)?|render\\.yaml|vercel\\.json|[^/\\\\]+\\.tf(?:vars)?|cloudformation\\.[^/\\\\]+)(?:$|[?#])/i;

export function evaluateAgentAuthorization(
  request: AgentAuthorizationRequest,
): AgentDecision {
  const input = agentAuthorizationRequestSchema.parse(request);
  const declared = evaluateAgentAction(input.action, input.correlationId);
  const resource = input.resource.trim();
  const sensitive = SENSITIVE_RESOURCE.test(resource);
  const infrastructure = INFRASTRUCTURE_RESOURCE.test(resource);
  if (
    declared.decision === "REQUIRE_APPROVAL" ||
    (!sensitive && !(infrastructure && input.action === "WRITE_FILE"))
  ) return declared;

  return agentDecisionSchema.parse({
    decision: "REQUIRE_APPROVAL",
    allowed: true,
    reason: sensitive
      ? "Access to a protected credential or secret resource requires independent human approval."
      : "Changes to infrastructure resources require independent human approval.",
    ruleId: sensitive
      ? "agent.resource.secret.requires_approval"
      : "agent.resource.infrastructure.requires_approval",
    ruleVersion: AGENT_POLICY_VERSION,
    correlationId: input.correlationId,
  });
}
