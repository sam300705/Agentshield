import { describe, expect, it } from "vitest";
import { agentActionSchema } from "@agentshield/schemas";
import { AGENT_ACTION_RULES, evaluateAgentAction } from "./agentGateway.js";

describe("declarative action policy", () => {
  it("has one explicit auditable rule for every supported action", () => {
    for (const action of agentActionSchema.options) {
      const rules = AGENT_ACTION_RULES.filter((rule) => rule.actions.includes(action));
      expect(rules).toHaveLength(1);
      const rule = rules[0]!;
      expect(evaluateAgentAction(action, "corr")).toEqual({
        decision: rule.decision,
        allowed: rule.allowed,
        reason: rule.reason,
        ruleId: rule.id,
        ruleVersion: rule.version,
        correlationId: "corr",
      });
    }
  });
  it.each(["RUN_COMMAND", "ACCESS_SECRET", "CHANGE_INFRASTRUCTURE"] as const)(
    "retains human review for %s",
    (action) => {
      expect(evaluateAgentAction(action, "corr").decision).toBe("REQUIRE_APPROVAL");
    },
  );
  it("rejects unknown runtime actions instead of default allowing", () => {
    expect(() => evaluateAgentAction("UNRECOGNIZED" as never, "corr")).toThrow();
  });
});
