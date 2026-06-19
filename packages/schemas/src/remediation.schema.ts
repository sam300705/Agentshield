import { z } from "zod";

import { jsonValueSchema } from "./json.schema.js";
import { policyDecisionTypeSchema } from "./policy.schema.js";

export const remediationStepSchema = z.string().min(1);

function refineRemediationDetail(
  remediation: {
    detail?: string | null | undefined;
    steps: string[];
    generatedForDecision: z.infer<typeof policyDecisionTypeSchema>;
  },
  context: z.RefinementCtx,
) {
  const canIncludeDetailedFix =
    remediation.generatedForDecision === "BLOCK" ||
    remediation.generatedForDecision === "REQUIRE_APPROVAL";

  if (!canIncludeDetailedFix && (remediation.detail != null || remediation.steps.length > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generatedForDecision"],
      message: "Detailed remediation is only allowed for BLOCK or REQUIRE_APPROVAL decisions",
    });
  }
}

const remediationObjectSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1),
  summary: z.string().min(1),
  detail: z.string().min(1).nullable().optional(),
  steps: z.array(remediationStepSchema).default([]),
  patch: jsonValueSchema.nullable().optional(),
  generatedForDecision: policyDecisionTypeSchema,
  createdAt: z.coerce.date(),
});

export const remediationSchema = remediationObjectSchema.superRefine(refineRemediationDetail);

export const createRemediationSchema = remediationObjectSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .superRefine(refineRemediationDetail);

export type RemediationStep = z.infer<typeof remediationStepSchema>;
export type Remediation = z.infer<typeof remediationSchema>;
export type CreateRemediation = z.infer<typeof createRemediationSchema>;
