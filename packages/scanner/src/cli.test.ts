import { describe, expect, it } from "vitest";
import type { PolicyDecision } from "@agentshield/schemas";

import { gateResult } from "./cliGate.js";

function decision(value: PolicyDecision["decision"]): PolicyDecision {
  return {
    id: value,
    findingId: value,
    decision: value,
    ruleId: value,
    ruleVersion: "1",
    reason: value,
    ruleSnapshot: {
      id: value,
      version: "1",
      name: value,
      description: value,
      enabled: true,
      target: {},
      conditions: [{ field: "category", operator: "EXISTS" }],
      decision: value,
      remediationEligible: value === "BLOCK" || value === "REQUIRE_APPROVAL",
      rationale: value,
      tags: [],
    },
    decidedAt: new Date(),
  };
}

describe("scanner CLI gates", () => {
  it("uses the most restrictive deterministic decision", () => {
    expect(gateResult([decision("ALLOW"), decision("WARN"), decision("BLOCK")])).toBe("BLOCK");
    expect(gateResult([])).toBe("ALLOW");
  });
});
