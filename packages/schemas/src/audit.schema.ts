import { z } from "zod";

import { jsonObjectSchema } from "./json.schema.js";

export const auditActionSchema = z.enum([
  "AUTHORITY_POLICY_CHANGED",
  "ACTION_ADMITTED",
  "ACTION_CANCELLED",
  "AUTHORIZATION_REVOKED",
  "SCAN_ATTEMPT_ARCHIVED",
  "SESSION_CREATED",
  "SESSION_CLOSED",
  "SCAN_CANCELLATION_REQUESTED",
  "SCAN_CREATED",
  "SCAN_STARTED",
  "SCAN_FAILED",
  "SCAN_CANCELLED",
  "SCAN_RECOVERED",
  "SCAN_COMPLETED",
  "FINDING_CREATED",
  "POLICY_DECIDED",
  "REMEDIATION_CREATED",
  "APPROVAL_REQUESTED",
  "APPROVAL_UPDATED",
  "AGENT_EVENT_INGESTED",
  "POLICY_SIMULATED",
  "RECEIPT_GENERATED",
  "GITHUB_DELIVERY_ACCEPTED",
  "GITHUB_INSTALLATION_UPDATED",
  "GITHUB_CHECK_CLAIMED",
  "GITHUB_CHECK_PUBLISHED",
  "GITHUB_CHECK_FAILED",
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
