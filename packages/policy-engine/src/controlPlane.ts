import {
  agentEventSchema,
  agentFingerprintSchema,
  attackGraphSchema,
  type AgentEvent,
  type AgentEventType,
  type AgentFingerprint,
  type AttackGraph,
  type JsonValue,
  type PolicyDecisionType,
  securityReceiptSchema,
  type SecurityReceipt,
} from "@agentshield/schemas";
import { createHash } from "node:crypto";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /(secret|password|passwd|token|api[-_]?key|authorization|private[-_]?key|credential)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]{12,}\b/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const RISK_WEIGHT = { LOW: 2, MEDIUM: 5, HIGH: 10, CRITICAL: 18 } as const;
const DECISION_WEIGHT: Record<PolicyDecisionType, number> = {
  ALLOW: 0,
  WARN: 2,
  REQUIRE_APPROVAL: 6,
  BLOCK: 10,
};

export type AgentEventInput = Omit<AgentEvent, "evidence" | "integrity"> & {
  evidence: unknown;
};

export interface ReceiptInput {
  id: string;
  scanId: string;
  repository: string;
  branch: string;
  commitSha: string;
  scannerVersion: string;
  policyBundleVersion: string;
  findingCounts: Record<string, number>;
  decisionCounts: Record<string, number>;
  approvalState: string;
  evidence: unknown;
  startedAt: Date;
  completedAt: Date;
  gateResult: PolicyDecisionType;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function redactString(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, REDACTED),
    value,
  );
}

export function redactEvidence(value: unknown, key = ""): JsonValue {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value == null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [
        nestedKey,
        redactEvidence(nestedValue, nestedKey),
      ]),
    );
  }
  return typeof value === "bigint" ? value.toString() : null;
}

export function createIntegrityChain(
  inputs: AgentEventInput[],
  initialPreviousHash: string | null = null,
): AgentEvent[] {
  let previousHash: string | null = initialPreviousHash;
  return [...inputs]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map((input) => {
      const evidence = redactEvidence(input.evidence);
      const eventHash = sha256(canonicalJson({ ...input, evidence, previousHash }));
      const event = agentEventSchema.parse({
        ...input,
        evidence,
        integrity: { algorithm: "sha256", previousHash, eventHash },
      });
      previousHash = eventHash;
      return event;
    });
}

export function verifyIntegrityChain(events: AgentEvent[]): boolean {
  let previousHash: string | null = null;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const { integrity, ...payload } = event;
    if (integrity.previousHash !== previousHash) return false;
    const expectedHash = sha256(canonicalJson({ ...payload, previousHash }));
    if (expectedHash !== integrity.eventHash) return false;
    previousHash = integrity.eventHash;
  }
  return true;
}

export function buildAttackGraph(events: AgentEvent[]): AttackGraph {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const nodes: AttackGraph["nodes"] = [
    { id: "task", kind: "TASK", label: "Agent task", riskLevel: "LOW" },
  ];
  const edges: AttackGraph["edges"] = [];
  const resourceIds = new Map<string, string>();

  for (const [index, event] of ordered.entries()) {
    const nodeId = `event:${event.id}`;
    nodes.push({
      id: nodeId,
      kind: "EVENT",
      label: event.summary,
      riskLevel: event.riskLevel,
      eventId: event.id,
      ...(event.resource == null ? {} : { resource: event.resource }),
    });
    const previous = index === 0 ? "task" : `event:${ordered[index - 1]?.id ?? event.id}`;
    const sameCorrelation =
      index === 0 || ordered[index - 1]?.correlationId === event.correlationId;
    edges.push({
      id: `edge:${previous}:${nodeId}`,
      from: previous,
      to: nodeId,
      relation: sameCorrelation ? "NEXT_IN_CORRELATION" : "NEXT_OBSERVED_EVENT",
      explanation: sameCorrelation
        ? `Event ${event.sequence} followed the prior event with correlation ${event.correlationId}.`
        : "Events are connected by observed session order; causality is not asserted.",
      confidence: sameCorrelation ? "CONFIRMED" : "INFERRED",
    });

    if (event.resource != null) {
      let resourceId = resourceIds.get(event.resource);
      if (resourceId == null) {
        resourceId = `resource:${sha256(event.resource).slice(0, 12)}`;
        resourceIds.set(event.resource, resourceId);
        nodes.push({
          id: resourceId,
          kind: "RESOURCE",
          label: event.resource,
          riskLevel: event.riskLevel,
          resource: event.resource,
        });
      }
      edges.push({
        id: `edge:${nodeId}:${resourceId}`,
        from: nodeId,
        to: resourceId,
        relation: "TOUCHED_RESOURCE",
        explanation: `Stored event evidence identifies ${event.resource} as the affected resource.`,
        confidence: "CONFIRMED",
      });
    }
  }

  const highestRiskEvents = ordered
    .filter((event) => event.riskLevel === "HIGH" || event.riskLevel === "CRITICAL")
    .map((event) => `event:${event.id}`);
  const riskTotal = ordered.reduce((sum, event) => sum + RISK_WEIGHT[event.riskLevel], 0);
  const blastRadiusScore = Math.min(100, riskTotal + resourceIds.size * 8);

  return attackGraphSchema.parse({
    nodes,
    edges,
    highestRiskPath: ["task", ...highestRiskEvents],
    blastRadiusScore,
    blastRadiusExplanation: `${riskTotal} event-risk points + ${resourceIds.size} unique resources × 8, capped at 100.`,
  });
}

export function createSecurityReceipt(input: ReceiptInput): SecurityReceipt {
  const evidenceDigest = sha256(canonicalJson(redactEvidence(input.evidence)));
  const receiptPayload = {
    id: input.id,
    scanId: input.scanId,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    scannerVersion: input.scannerVersion,
    policyBundleVersion: input.policyBundleVersion,
    findingCounts: input.findingCounts,
    decisionCounts: input.decisionCounts,
    approvalState: input.approvalState,
    evidenceDigest,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    gateResult: input.gateResult,
  };
  return securityReceiptSchema.parse({
    ...receiptPayload,
    receiptHash: sha256(canonicalJson(receiptPayload)),
  });
}

function eventDurationMinutes(events: AgentEvent[]): number {
  if (events.length < 2) return 1;
  const timestamps = events.map((event) => event.timestamp.getTime());
  return Math.max(1, (Math.max(...timestamps) - Math.min(...timestamps)) / 60_000);
}

function countType(events: AgentEvent[], type: AgentEventType): number {
  return events.filter((event) => event.type === type).length;
}

export function calculateAgentFingerprint(
  events: AgentEvent[],
  baseline?: Partial<
    Pick<
      AgentFingerprint,
      | "eventsPerMinute"
      | "sensitivePathAccesses"
      | "highRiskShellCommands"
      | "infrastructureChanges"
    >
  >,
): AgentFingerprint {
  const toolDistribution = events.reduce<Record<string, number>>((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
  const eventCount = events.length;
  const metrics = {
    eventsPerMinute: eventCount / eventDurationMinutes(events),
    sensitivePathAccesses: countType(events, "SECRET_ACCESS_ATTEMPT"),
    highRiskShellCommands: events.filter(
      (event) => event.type === "SHELL_COMMAND" && ["HIGH", "CRITICAL"].includes(event.riskLevel),
    ).length,
    infrastructureChanges: countType(events, "INFRASTRUCTURE_CHANGE"),
  };
  const drift = Object.entries(metrics).flatMap(([metric, current]) => {
    const baselineValue = baseline?.[metric as keyof typeof baseline];
    if (baselineValue == null) return [];
    const threshold = baselineValue === 0 ? 0 : Math.max(1, baselineValue * 1.5);
    return current > threshold
      ? [
          {
            metric,
            baseline: baselineValue,
            current,
            threshold,
            explanation: `${metric} is ${current.toFixed(2)}, above the transparent drift threshold of ${threshold.toFixed(2)}.`,
          },
        ]
      : [];
  });
  const policyEvents = countType(events, "POLICY_EVALUATION");
  const approvalEvents = countType(events, "APPROVAL_REQUEST");
  const blockEvents = events.filter(
    (event) => event.type === "POLICY_EVALUATION" && /block/i.test(event.summary),
  ).length;

  return agentFingerprintSchema.parse({
    eventCount,
    eventsPerMinute: metrics.eventsPerMinute,
    toolDistribution,
    sensitivePathAccesses: metrics.sensitivePathAccesses,
    highRiskShellCommands: metrics.highRiskShellCommands,
    dependencyChanges: countType(events, "DEPENDENCY_INSTALLATION"),
    infrastructureChanges: metrics.infrastructureChanges,
    approvalFrequency: policyEvents === 0 ? 0 : approvalEvents / policyEvents,
    blockFrequency: policyEvents === 0 ? 0 : blockEvents / policyEvents,
    drift,
  });
}

export function riskScoreForDecisions(decisions: PolicyDecisionType[]): number {
  return decisions.reduce((total, decision) => total + DECISION_WEIGHT[decision], 0);
}
