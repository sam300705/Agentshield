import { z } from "zod";

import { findingCategorySchema, findingSeveritySchema } from "./finding.schema.js";
import { jsonValueSchema } from "./json.schema.js";

export const policyDecisionTypeSchema = z.enum(["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"]);

export const policyConditionOperatorSchema = z.enum([
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "MATCHES_REGEX",
  "EXISTS",
]);

export const policyRuleConditionSchema = z
  .object({
    field: z.string().min(1),
    operator: policyConditionOperatorSchema,
    value: jsonValueSchema.optional(),
  })
  .strict();

export const policyRuleTargetSchema = z
  .object({
    categories: z.array(findingCategorySchema).min(1).optional(),
    severities: z.array(findingSeveritySchema).min(1).optional(),
  })
  .strict();

export const policyRuleSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    enabled: z.boolean().default(true),
    target: policyRuleTargetSchema.default({}),
    conditions: z.array(policyRuleConditionSchema).min(1),
    decision: policyDecisionTypeSchema,
    severityOverride: findingSeveritySchema.optional(),
    remediationEligible: z.boolean().default(false),
    rationale: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((rule, context) => {
    const canGenerateDetailedRemediation =
      rule.decision === "BLOCK" || rule.decision === "REQUIRE_APPROVAL";

    if (rule.remediationEligible && !canGenerateDetailedRemediation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remediationEligible"],
        message: "Detailed remediation may only be eligible for BLOCK or REQUIRE_APPROVAL rules",
      });
    }
  });

export const policyRuleDictionarySchema = z.record(policyRuleSchema).superRefine((rules, context) => {
  for (const [dictionaryKey, rule] of Object.entries(rules)) {
    if (dictionaryKey !== rule.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [dictionaryKey, "id"],
        message: "Policy rule dictionary key must match the rule id",
      });
    }
  }
});

export const policyDecisionSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1),
  decision: policyDecisionTypeSchema,
  ruleId: z.string().min(1),
  ruleVersion: z.string().min(1),
  reason: z.string().min(1),
  ruleSnapshot: policyRuleSchema,
  decidedAt: z.coerce.date(),
});

export type PolicyDecisionType = z.infer<typeof policyDecisionTypeSchema>;
export type PolicyConditionOperator = z.infer<typeof policyConditionOperatorSchema>;
export type PolicyRuleCondition = z.infer<typeof policyRuleConditionSchema>;
export type PolicyRuleTarget = z.infer<typeof policyRuleTargetSchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyRuleDictionary = z.infer<typeof policyRuleDictionarySchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

