import { z } from "zod";

import { findingSeveritySchema } from "./finding.schema.js";
import { jsonValueSchema } from "./json.schema.js";
import { policyDecisionTypeSchema, policyRuleSchema } from "./policy.schema.js";

export const agentEventTypeSchema = z.enum([
  "TOOL_INVOCATION",
  "SHELL_COMMAND",
  "FILE_READ",
  "FILE_MODIFICATION",
  "DEPENDENCY_INSTALLATION",
  "NETWORK_REQUEST",
  "SECRET_ACCESS_ATTEMPT",
  "INFRASTRUCTURE_CHANGE",
  "POLICY_EVALUATION",
  "APPROVAL_REQUEST",
  "HUMAN_DECISION",
]);

export const eventIntegritySchema = z.object({
  algorithm: z.literal("sha256"),
  previousHash: z.string().nullable(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const agentEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.coerce.date(),
  actor: z.string().min(1),
  source: z.string().min(1),
  type: agentEventTypeSchema,
  riskLevel: findingSeveritySchema,
  summary: z.string().min(1),
  resource: z.string().min(1).optional(),
  evidence: jsonValueSchema,
  correlationId: z.string().min(1),
  integrity: eventIntegritySchema,
});

export const riskNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["TASK", "EVENT", "RESOURCE", "RISK", "POLICY", "DECISION"]),
  label: z.string().min(1),
  riskLevel: findingSeveritySchema,
  eventId: z.string().optional(),
  resource: z.string().optional(),
});

export const riskEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.enum(["CONFIRMED", "INFERRED"]),
});

export const attackGraphSchema = z.object({
  nodes: z.array(riskNodeSchema),
  edges: z.array(riskEdgeSchema),
  highestRiskPath: z.array(z.string()),
  blastRadiusScore: z.number().int().min(0).max(100),
  blastRadiusExplanation: z.string().min(1),
});

export const policyBundleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  environment: z.enum(["DEVELOPMENT", "STAGING", "PRODUCTION"]),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  rules: z.array(policyRuleSchema).min(1),
});

export const conditionTraceSchema = z.object({
  field: z.string(),
  operator: z.string(),
  expected: jsonValueSchema.optional(),
  actual: jsonValueSchema.optional(),
  matched: z.boolean(),
});

export const simulationDecisionSchema = z.object({
  findingId: z.string(),
  originalDecision: policyDecisionTypeSchema,
  simulatedDecision: policyDecisionTypeSchema,
  originalRuleId: z.string(),
  simulatedRuleId: z.string(),
  traces: z.array(conditionTraceSchema),
});

export const policySimulationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  bundleId: z.string(),
  bundleVersion: z.string(),
  createdAt: z.coerce.date(),
  decisions: z.array(simulationDecisionSchema),
  riskScoreDelta: z.number(),
  approvalVolumeDelta: z.number().int(),
  newlyBlocked: z.number().int().nonnegative(),
  newlyPermitted: z.number().int().nonnegative(),
});

export const securityReceiptSchema = z.object({
  id: z.string(),
  scanId: z.string(),
  repository: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  scannerVersion: z.string(),
  policyBundleVersion: z.string(),
  findingCounts: z.record(z.number().int().nonnegative()),
  decisionCounts: z.record(z.number().int().nonnegative()),
  approvalState: z.string(),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date(),
  gateResult: policyDecisionTypeSchema,
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const agentFingerprintSchema = z.object({
  eventCount: z.number().int().nonnegative(),
  eventsPerMinute: z.number().nonnegative(),
  toolDistribution: z.record(z.number().int().nonnegative()),
  sensitivePathAccesses: z.number().int().nonnegative(),
  highRiskShellCommands: z.number().int().nonnegative(),
  dependencyChanges: z.number().int().nonnegative(),
  infrastructureChanges: z.number().int().nonnegative(),
  approvalFrequency: z.number().min(0).max(1),
  blockFrequency: z.number().min(0).max(1),
  drift: z.array(
    z.object({
      metric: z.string(),
      baseline: z.number(),
      current: z.number(),
      threshold: z.number(),
      explanation: z.string(),
    }),
  ),
});

export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type RiskNode = z.infer<typeof riskNodeSchema>;
export type RiskEdge = z.infer<typeof riskEdgeSchema>;
export type AttackGraph = z.infer<typeof attackGraphSchema>;
export type PolicyBundle = z.infer<typeof policyBundleSchema>;
export type ConditionTrace = z.infer<typeof conditionTraceSchema>;
export type PolicySimulation = z.infer<typeof policySimulationSchema>;
export type SecurityReceipt = z.infer<typeof securityReceiptSchema>;
export type AgentFingerprint = z.infer<typeof agentFingerprintSchema>;
