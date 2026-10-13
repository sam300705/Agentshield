import {
  policySimulationSchema,
  type ConditionTrace,
  type Finding,
  type JsonValue,
  type PolicyDecision,
  type PolicyDecisionType,
  type PolicyRule,
  type PolicySimulation,
} from "@agentshield/schemas";
import { createHash } from "node:crypto";

import { evaluateCondition } from "./evaluator.js";
import { canonicalJson, riskScoreForDecisions } from "./controlPlane.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function fieldValue(source: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, segment) => (isRecord(current) ? current[segment] : undefined),
      source,
    );
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function traceCondition(
  finding: Finding,
  condition: PolicyRule["conditions"][number],
): ConditionTrace {
  const actual = fieldValue(finding, condition.field);
  const expected = condition.value;
  const matched = evaluateCondition(finding, condition);
  return {
    field: condition.field,
    operator: condition.operator,
    ...(jsonValue(expected) === undefined ? {} : { expected: jsonValue(expected) }),
    ...(jsonValue(actual) === undefined ? {} : { actual: jsonValue(actual) }),
    matched,
  };
}

function targetMatches(finding: Finding, rule: PolicyRule): boolean {
  return (
    (rule.target.categories == null || rule.target.categories.includes(finding.category)) &&
    (rule.target.severities == null || rule.target.severities.includes(finding.severity))
  );
}

function evaluate(
  finding: Finding,
  rules: PolicyRule[],
): { rule: PolicyRule; traces: ConditionTrace[] } {
  for (const rule of rules) {
    const traces = rule.conditions.map((condition) => traceCondition(finding, condition));
    if (rule.enabled && targetMatches(finding, rule) && traces.every((trace) => trace.matched)) {
      return { rule, traces };
    }
  }
  throw new Error(`Policy bundle has no matching rule for finding ${finding.id}`);
}

function count(decisions: PolicyDecisionType[], decision: PolicyDecisionType): number {
  return decisions.filter((item) => item === decision).length;
}

export function simulatePolicyBundle(input: {
  sourceId: string;
  bundleId: string;
  bundleVersion: string;
  findings: Finding[];
  originalDecisions: PolicyDecision[];
  rules: PolicyRule[];
  createdAt: Date;
}): PolicySimulation {
  const originals = new Map(
    input.originalDecisions.map((decision) => [decision.findingId, decision]),
  );
  const decisions = input.findings.map((finding) => {
    const original = originals.get(finding.id);
    if (original == null) throw new Error(`Missing original decision for ${finding.id}`);
    const simulated = evaluate(finding, input.rules);
    return {
      findingId: finding.id,
      originalDecision: original.decision,
      simulatedDecision: simulated.rule.decision,
      originalRuleId: original.ruleId,
      simulatedRuleId: simulated.rule.id,
      traces: simulated.traces,
    };
  });
  const originalTypes = decisions.map((decision) => decision.originalDecision);
  const simulatedTypes = decisions.map((decision) => decision.simulatedDecision);
  const identity = createHash("sha256")
    .update(
      canonicalJson({
        sourceId: input.sourceId,
        bundleId: input.bundleId,
        bundleVersion: input.bundleVersion,
        decisions,
      }),
    )
    .digest("hex")
    .slice(0, 20);

  return policySimulationSchema.parse({
    id: `simulation-${identity}`,
    sourceId: input.sourceId,
    bundleId: input.bundleId,
    bundleVersion: input.bundleVersion,
    createdAt: input.createdAt,
    decisions,
    riskScoreDelta: riskScoreForDecisions(simulatedTypes) - riskScoreForDecisions(originalTypes),
    approvalVolumeDelta:
      count(simulatedTypes, "REQUIRE_APPROVAL") - count(originalTypes, "REQUIRE_APPROVAL"),
    newlyBlocked: decisions.filter(
      (decision) => decision.simulatedDecision === "BLOCK" && decision.originalDecision !== "BLOCK",
    ).length,
    newlyPermitted: decisions.filter(
      (decision) => decision.simulatedDecision === "ALLOW" && decision.originalDecision !== "ALLOW",
    ).length,
  });
}
