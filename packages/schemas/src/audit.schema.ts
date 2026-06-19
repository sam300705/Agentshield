import { z } from "zod";

import { jsonObjectSchema } from "./json.schema.js";

export const auditActionSchema = z.enum([
  "SCAN_CREATED",
  "SCAN_COMPLETED",
  "FINDING_CREATED",
  "POLICY_DECIDED",
  "REMEDIATION_CREATED",
  "APPROVAL_REQUESTED",
  "APPROVAL_UPDATED",
]);

export const auditEventSchema = z.object({
  id: z.string().min(1),
  actor: z.string().min(1),
  action: auditActionSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  scanId: z.string().min(1).nullable().optional(),
  metadata: jsonObjectSchema.default({}),
  createdAt: z.coerce.date(),
});

export const createAuditEventSchema = auditEventSchema.omit({
  id: true,
  createdAt: true,
});

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type CreateAuditEvent = z.infer<typeof createAuditEventSchema>;
