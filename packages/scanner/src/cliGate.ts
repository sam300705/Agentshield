import type { PolicyDecision, PolicyDecisionType } from "@agentshield/schemas";

export function gateResult(decisions: PolicyDecision[]): PolicyDecisionType {
  const order: PolicyDecisionType[] = ["BLOCK", "REQUIRE_APPROVAL", "WARN", "ALLOW"];
  return order.find((decision) => decisions.some((item) => item.decision === decision)) ?? "ALLOW";
}
