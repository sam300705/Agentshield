import {
  type Finding,
  type JsonValue,
  type PolicyDecision,
  type PolicyDecisionType,
  type PolicyRule,
  type PolicyRuleCondition,
  policyDecisionSchema,
} from "@agentshield/schemas";
import { randomUUID } from "node:crypto";

import { ORDERED_FALLBACK_POLICY_RULES, ORDERED_POLICY_RULES } from "./rules.js";

const SEVERITY_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export interface MatchedPolicyRule {
  rule: PolicyRule;
  requiresHumanApproval: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFieldValue(source: unknown, fieldPath: string): unknown {
  return fieldPath.split(".").reduce<unknown>((currentValue, fieldSegment) => {
    if (!isRecord(currentValue)) {
      return undefined;
    }

    return currentValue[fieldSegment];
  }, source);
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right) || isRecord(left) || isRecord(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return left === right;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function getSeverityRank(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return SEVERITY_RANK[value as keyof typeof SEVERITY_RANK];
}

function compareValues(left: unknown, right: unknown): number | undefined {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  const leftSeverityRank = getSeverityRank(left);
  const rightSeverityRank = getSeverityRank(right);

  if (leftSeverityRank !== undefined && rightSeverityRank !== undefined) {
    return leftSeverityRank - rightSeverityRank;
  }

  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  return undefined;
}

function matchesRegex(actualValue: unknown, expectedValue: JsonValue | undefined): boolean {
  if (typeof actualValue !== "string" || typeof expectedValue !== "string") {
    return false;
  }

  return new RegExp(expectedValue, "i").test(actualValue);
}

function evaluateCondition(finding: Finding, condition: PolicyRuleCondition): boolean {
  const actualValue = readFieldValue(finding, condition.field);

  switch (condition.operator) {
    case "EQUALS":
      return valuesAreEqual(actualValue, condition.value);
    case "NOT_EQUALS":
      return !valuesAreEqual(actualValue, condition.value);
    case "IN":
      return asArray(condition.value).some((candidate) => valuesAreEqual(actualValue, candidate));
    case "NOT_IN":
      return !asArray(condition.value).some((candidate) => valuesAreEqual(actualValue, candidate));
    case "GREATER_THAN": {
      const comparison = compareValues(actualValue, condition.value);
      return comparison !== undefined && comparison > 0;
    }
    case "GREATER_THAN_OR_EQUAL": {
      const comparison = compareValues(actualValue, condition.value);
      return comparison !== undefined && comparison >= 0;
    }
    case "LESS_THAN": {
      const comparison = compareValues(actualValue, condition.value);
      return comparison !== undefined && comparison < 0;
    }
    case "LESS_THAN_OR_EQUAL": {
      const comparison = compareValues(actualValue, condition.value);
      return comparison !== undefined && comparison <= 0;
    }
    case "MATCHES_REGEX":
      return matchesRegex(actualValue, condition.value);
    case "EXISTS":
      return actualValue !== undefined && actualValue !== null;
  }
}

function targetMatchesFinding(finding: Finding, rule: PolicyRule): boolean {
  const categoryMatches =
    rule.target.categories == null || rule.target.categories.includes(finding.category);
  const severityMatches =
    rule.target.severities == null || rule.target.severities.includes(finding.severity);

  return categoryMatches && severityMatches;
}

function ruleMatchesFinding(finding: Finding, rule: PolicyRule): boolean {
  if (!rule.enabled || !targetMatchesFinding(finding, rule)) {
    return false;
  }

  return rule.conditions.every((condition) => evaluateCondition(finding, condition));
}

function findMatchingRule(finding: Finding): MatchedPolicyRule {
  const matchedRule =
    ORDERED_POLICY_RULES.find((rule) => ruleMatchesFinding(finding, rule)) ??
    ORDERED_FALLBACK_POLICY_RULES.find((rule) => ruleMatchesFinding(finding, rule));

  if (matchedRule == null) {
    throw new Error(`No policy rule or fallback rule matched finding ${finding.id}`);
  }

  return {
    rule: matchedRule,
    requiresHumanApproval: matchedRule.decision === "REQUIRE_APPROVAL",
  };
}

function readableDecision(decision: PolicyDecisionType): string {
  switch (decision) {
    case "ALLOW":
      return "Allowed";
    case "WARN":
      return "Warned";
    case "REQUIRE_APPROVAL":
      return "Requires approval";
    case "BLOCK":
      return "Blocked";
  }
}

function formatJsonValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "undefined";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatCondition(condition: PolicyRuleCondition): string {
  if (condition.operator === "EXISTS") {
    return `${condition.field} EXISTS`;
  }

  return `${condition.field} ${condition.operator} ${formatJsonValue(condition.value)}`;
}

function createReason(finding: Finding, matchedRule: MatchedPolicyRule): string {
  const action = readableDecision(matchedRule.rule.decision);
  const approvalSuffix = matchedRule.requiresHumanApproval ? " Human approval is required." : "";
  const conditionSummary = matchedRule.rule.conditions.map(formatCondition).join("; ");

  return `${action} because ${matchedRule.rule.rationale} Rule ${matchedRule.rule.id} matched ${finding.category} finding "${finding.title}" in ${finding.filePath}. Matched conditions: ${conditionSummary}.${approvalSuffix}`;
}

export function decisionRequiresHumanApproval(decision: PolicyDecision): boolean {
  return decision.decision === "REQUIRE_APPROVAL";
}

export function evaluateFindings(findings: Finding[], scanId: string): PolicyDecision[] {
  return findings.map((finding) => {
    if (finding.scanId !== scanId) {
      throw new Error(`Finding ${finding.id} belongs to scan ${finding.scanId}, not ${scanId}`);
    }

    const matchedRule = findMatchingRule(finding);

    return policyDecisionSchema.parse({
      id: randomUUID(),
      findingId: finding.id,
      decision: matchedRule.rule.decision,
      ruleId: matchedRule.rule.id,
      ruleVersion: matchedRule.rule.version,
      reason: createReason(finding, matchedRule),
      ruleSnapshot: matchedRule.rule,
      decidedAt: new Date(),
    });
  });
}
