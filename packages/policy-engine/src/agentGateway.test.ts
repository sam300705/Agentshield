import { describe, expect, it } from "vitest";
import { agentActionSchema } from "@agentshield/schemas";
import {
  AGENT_ACTION_RULES,
  evaluateAgentAction,
  evaluateAgentAuthorization,
} from "./agentGateway.js";

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

it.each([
  ["READ_FILE", "/home/user/.ssh/id_rsa", "agent.resource.secret.requires_approval"],
  ["READ_FILE", ".env.production", "agent.resource.secret.requires_approval"],
  [
    "WRITE_FILE",
    "infrastructure/production.yaml",
    "agent.resource.infrastructure.requires_approval",
  ],
  [
    "WRITE_FILE",
    ".github/workflows/deploy.yaml",
    "agent.resource.infrastructure.requires_approval",
  ],
  ["WRITE_FILE", "terraform/main.tf", "agent.resource.infrastructure.requires_approval"],
  ["WRITE_FILE", "Dockerfile", "agent.resource.infrastructure.requires_approval"],
] as const)("escalates disguised %s on %s", (action, resource, ruleId) => {
  expect(
    evaluateAgentAuthorization({
      organizationId: "org",
      sessionId: "session",
      actor: "actor",
      action,
      resource,
      correlationId: "corr",
      idempotencyKey: "key",
    }),
  ).toMatchObject({ decision: "REQUIRE_APPROVAL", ruleId });
});

it("preserves low-risk decisions for ordinary resources", () => {
  expect(
    evaluateAgentAuthorization({
      organizationId: "org",
      sessionId: "session",
      actor: "actor",
      action: "READ_FILE",
      resource: "README.md",
      correlationId: "corr",
      idempotencyKey: "key",
    }).decision,
  ).toBe("ALLOW");
});
