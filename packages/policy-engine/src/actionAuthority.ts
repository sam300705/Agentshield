import { authorityPolicyModeSchema } from "@agentshield/schemas";
export const ACTION_AUTHORITY_POLICY_VERSION = "action-authority@1";
const decisions = {
  DENY: {
    decision: "DENY",
    ruleId: "action-authority.deny",
    reason: "Action intent is denied by tenant policy.",
  },
  REQUIRE_APPROVAL: {
    decision: "REQUIRE_APPROVAL",
    ruleId: "action-authority.independent-review",
    reason: "Exact context requires an independent reviewer before durable admission.",
  },
} as const;
export function evaluateAuthorityPolicy(mode: unknown) {
  return decisions[authorityPolicyModeSchema.parse(mode)];
}
