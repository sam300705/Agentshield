import { describe, expect, it } from "vitest";

import {
  buildAttackGraph,
  calculateAgentFingerprint,
  createIntegrityChain,
  createSecurityReceipt,
  redactEvidence,
  verifyIntegrityChain,
  type AgentEventInput,
} from "./controlPlane.js";

const baseEvents: AgentEventInput[] = [
  {
    id: "evt-1",
    sessionId: "session-1",
    sequence: 1,
    timestamp: new Date("2026-08-19T10:00:00.000Z"),
    actor: "agent:codex",
    source: "shell",
    type: "SECRET_ACCESS_ATTEMPT",
    riskLevel: "CRITICAL",
    summary: "Read environment credentials",
    resource: ".env",
    evidence: { command: "cat .env", apiKey: "sk-this-must-never-leak" },
    correlationId: "corr-1",
  },
  {
    id: "evt-2",
    sessionId: "session-1",
    sequence: 2,
    timestamp: new Date("2026-08-19T10:00:20.000Z"),
    actor: "agent:codex",
    source: "filesystem",
    type: "INFRASTRUCTURE_CHANGE",
    riskLevel: "HIGH",
    summary: "Modified production deployment",
    resource: "k8s/deployment.yaml",
    evidence: { patchDigest: "sha256:abc" },
    correlationId: "corr-1",
  },
];

describe("control plane primitives", () => {
  it("redacts sensitive keys and high-confidence token values", () => {
    expect(redactEvidence({ token: "abc", note: "Bearer secret-value" })).toEqual({
      token: "[REDACTED]",
      note: "[REDACTED]",
    });
  });

  it("creates and verifies a deterministic integrity chain", () => {
    const first = createIntegrityChain(baseEvents);
    const second = createIntegrityChain([...baseEvents].reverse());
    expect(first.map((event) => event.integrity.eventHash)).toEqual(
      second.map((event) => event.integrity.eventHash),
    );
    expect(verifyIntegrityChain(first)).toBe(true);
  });

  it("continues an integrity chain from a persisted chain head", () => {
    const first = createIntegrityChain(baseEvents.slice(0, 1));
    const continued = createIntegrityChain(
      [
        {
          ...baseEvents[1]!,
          sequence: 2,
        },
      ],
      first[0]?.integrity.eventHash ?? null,
    );
    expect(continued[0]?.integrity.previousHash).toBe(first[0]?.integrity.eventHash);
    expect(verifyIntegrityChain([...first, ...continued])).toBe(true);
  });

  it("rejects a tampered event chain", () => {
    const events = createIntegrityChain(baseEvents);
    const tampered = events.map((event, index) =>
      index === 1 ? { ...event, summary: "Tampered summary" } : event,
    );
    expect(verifyIntegrityChain(tampered)).toBe(false);
  });

  it("derives an explainable attack graph and blast-radius score", () => {
    const graph = buildAttackGraph(createIntegrityChain(baseEvents));
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges.every((edge) => edge.explanation.length > 0)).toBe(true);
    expect(graph.highestRiskPath).toEqual(["task", "event:evt-1", "event:evt-2"]);
    expect(graph.blastRadiusScore).toBe(44);
  });

  it("creates deterministic security receipts without raw evidence", () => {
    const input = {
      id: "receipt-1",
      scanId: "scan-1",
      repository: "sam300705/Agentshield",
      branch: "main",
      commitSha: "abc123",
      scannerVersion: "0.2.0",
      policyBundleVersion: "2.1.0",
      findingCounts: { critical: 1, high: 1 },
      decisionCounts: { BLOCK: 1, REQUIRE_APPROVAL: 1 },
      approvalState: "PENDING",
      evidence: { password: "must-not-appear" },
      startedAt: new Date("2026-08-19T10:00:00.000Z"),
      completedAt: new Date("2026-08-19T10:01:00.000Z"),
      gateResult: "BLOCK" as const,
    };
    const first = createSecurityReceipt(input);
    const second = createSecurityReceipt(input);
    expect(first.receiptHash).toBe(second.receiptHash);
    expect(JSON.stringify(first)).not.toContain("must-not-appear");
  });

  it("reports drift using explicit baseline thresholds", () => {
    const fingerprint = calculateAgentFingerprint(createIntegrityChain(baseEvents), {
      eventsPerMinute: 1,
      sensitivePathAccesses: 0,
      highRiskShellCommands: 0,
      infrastructureChanges: 0,
    });
    expect(fingerprint.drift.map((item) => item.metric)).toContain("sensitivePathAccesses");
    expect(fingerprint.drift.map((item) => item.metric)).toContain("infrastructureChanges");
  });
});
