import {
  buildAttackGraph,
  calculateAgentFingerprint,
  createIntegrityChain,
  createSecurityReceipt,
  type AgentEventInput,
} from "@agentshield/policy-engine";
import type { Request, Response } from "express";

import { getCorrelationId } from "../security/auth.js";

const startedAt = new Date("2026-08-19T10:42:01.000Z");
const completedAt = new Date("2026-08-19T10:42:29.000Z");

const demoEventInputs: AgentEventInput[] = [
  {
    id: "evt-001",
    sessionId: "session-1842",
    sequence: 1,
    timestamp: startedAt,
    actor: "agent:codex-demo",
    source: "tool",
    type: "TOOL_INVOCATION",
    riskLevel: "LOW",
    summary: "Agent session started",
    resource: "sam300705/Agentshield",
    evidence: { task: "add telemetry exporter" },
    correlationId: "corr-demo-1842",
  },
  {
    id: "evt-002",
    sessionId: "session-1842",
    sequence: 2,
    timestamp: new Date("2026-08-19T10:42:04.000Z"),
    actor: "agent:codex-demo",
    source: "filesystem",
    type: "SECRET_ACCESS_ATTEMPT",
    riskLevel: "CRITICAL",
    summary: "Read environment credentials",
    resource: ".env",
    evidence: { command: "cat .env", token: "sk-sensitive-demo-value" },
    correlationId: "corr-demo-1842",
  },
  {
    id: "evt-003",
    sessionId: "session-1842",
    sequence: 3,
    timestamp: new Date("2026-08-19T10:42:17.000Z"),
    actor: "agent:codex-demo",
    source: "shell",
    type: "SHELL_COMMAND",
    riskLevel: "CRITICAL",
    summary: "Blocked remote script execution",
    resource: "shell",
    evidence: { commandClass: "REMOTE_PIPE_TO_SHELL", rawCommand: "[REDACTED]" },
    correlationId: "corr-demo-1842",
  },
  {
    id: "evt-004",
    sessionId: "session-1842",
    sequence: 4,
    timestamp: new Date("2026-08-19T10:42:23.000Z"),
    actor: "agent:codex-demo",
    source: "filesystem",
    type: "INFRASTRUCTURE_CHANGE",
    riskLevel: "CRITICAL",
    summary: "Modified production deployment",
    resource: "k8s/deployment.yaml",
    evidence: { ruleId: "kubernetes.privileged_container" },
    correlationId: "corr-demo-1842",
  },
  {
    id: "evt-005",
    sessionId: "session-1842",
    sequence: 5,
    timestamp: new Date("2026-08-19T10:42:24.000Z"),
    actor: "system:policy",
    source: "policy-engine",
    type: "POLICY_EVALUATION",
    riskLevel: "CRITICAL",
    summary: "Production policy BLOCK",
    resource: "policy:production@2.4.0",
    evidence: { ruleId: "kubernetes.privileged_container.block", decision: "BLOCK" },
    correlationId: "corr-demo-1842",
  },
];

export function getDemoControlPlaneController(_request: Request, response: Response): void {
  const events = createIntegrityChain(demoEventInputs);
  const graph = buildAttackGraph(events);
  const fingerprint = calculateAgentFingerprint(events, {
    eventsPerMinute: 3,
    sensitivePathAccesses: 0.5,
    highRiskShellCommands: 0.2,
    infrastructureChanges: 0.4,
  });
  const receipt = createSecurityReceipt({
    id: "ASR-2026-0819-1842",
    scanId: "scan-1842",
    repository: "sam300705/Agentshield",
    branch: "agent/recruiter-demo",
    commitSha: "8d71af0f5e3c",
    scannerVersion: "0.2.0",
    policyBundleVersion: "2.4.0",
    findingCounts: { CRITICAL: 3, HIGH: 1, MEDIUM: 1 },
    decisionCounts: { BLOCK: 2, REQUIRE_APPROVAL: 1, WARN: 1, ALLOW: 1 },
    approvalState: "PENDING",
    evidence: events.map((event) => event.integrity.eventHash),
    startedAt,
    completedAt,
    gateResult: "BLOCK",
  });
  response.json({
    data: {
      session: { id: "session-1842", status: "BLOCKED", seededDemo: true },
      events,
      graph,
      fingerprint,
      receipt,
    },
    meta: { correlationId: getCorrelationId(response), deterministic: true },
  });
}
