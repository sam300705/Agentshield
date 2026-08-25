import { describe, expect, it } from "vitest";
import type { Finding, PolicyDecision, PolicyRule } from "@agentshield/schemas";

import { simulatePolicyBundle } from "./simulation.js";

const finding: Finding = {
  id: "finding-1",
  scanId: "scan-1",
  category: "DOCKERFILE",
  severity: "HIGH",
  title: "Mutable latest tag",
  description: "The image tag is mutable",
  filePath: "Dockerfile",
  evidence: { ruleId: "dockerfile.from_latest" },
  fingerprint: "fingerprint-1",
  createdAt: new Date("2026-08-19T10:00:00.000Z"),
};

const original: PolicyDecision = {
  id: "decision-1",
  findingId: finding.id,
  decision: "WARN",
  ruleId: "docker.warn",
  ruleVersion: "1.0.0",
  reason: "Warn in development",
  ruleSnapshot: {
    id: "docker.warn",
    version: "1.0.0",
    name: "Warn",
    description: "Warn on Docker findings",
    enabled: true,
    target: { categories: ["DOCKERFILE"] },
    conditions: [{ field: "category", operator: "EQUALS", value: "DOCKERFILE" }],
    decision: "WARN",
    remediationEligible: false,
    rationale: "Development posture",
    tags: [],
  },
  decidedAt: new Date("2026-08-19T10:00:01.000Z"),
};

const strictRule: PolicyRule = {
  ...original.ruleSnapshot,
  id: "docker.block",
  version: "2.0.0",
  decision: "BLOCK",
  remediationEligible: true,
  rationale: "Production images must be reproducible",
};

describe("policy time machine", () => {
  it("compares immutable original decisions with a simulated bundle", () => {
    const simulation = simulatePolicyBundle({
      sourceId: "scan-1",
      bundleId: "production",
      bundleVersion: "2.0.0",
      findings: [finding],
      originalDecisions: [original],
      rules: [strictRule],
      createdAt: new Date("2026-08-19T10:10:00.000Z"),
    });
    expect(simulation.decisions[0]?.originalDecision).toBe("WARN");
    expect(simulation.decisions[0]?.simulatedDecision).toBe("BLOCK");
    expect(simulation.newlyBlocked).toBe(1);
    expect(simulation.riskScoreDelta).toBe(8);
    expect(simulation.decisions[0]?.traces[0]?.matched).toBe(true);
  });
});
