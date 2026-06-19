import { z } from "zod";

import { jsonObjectSchema } from "./json.schema.js";

export const findingCategorySchema = z.enum([
  "SECRET",
  "DOCKERFILE",
  "KUBERNETES",
  "DEPENDENCY",
  "AGENT_WORKFLOW",
]);

export const findingSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function refineLineRange(
  finding: { lineStart?: number | null | undefined; lineEnd?: number | null | undefined },
  context: z.RefinementCtx,
) {
  if (finding.lineStart != null && finding.lineEnd != null && finding.lineEnd < finding.lineStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lineEnd"],
      message: "lineEnd must be greater than or equal to lineStart",
    });
  }
}

const findingObjectSchema = z.object({
  id: z.string().min(1),
  scanId: z.string().min(1),
  category: findingCategorySchema,
  severity: findingSeveritySchema,
  title: z.string().min(1).max(160),
  description: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive().nullable().optional(),
  lineEnd: z.number().int().positive().nullable().optional(),
  evidence: jsonObjectSchema.default({}),
  fingerprint: z.string().min(1),
  createdAt: z.coerce.date(),
});

export const findingSchema = findingObjectSchema.superRefine(refineLineRange);

export const createFindingSchema = findingObjectSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .superRefine(refineLineRange);

export type FindingCategory = z.infer<typeof findingCategorySchema>;
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type CreateFinding = z.infer<typeof createFindingSchema>;
