import { z } from "zod";

export const RoleSchema = z.enum(["SECURITY_ADMIN", "ENGINEER", "STANDARD_USER"]);

export const PlaybookStatusSchema = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
  "FAILED_EXECUTION",
]);

export const SafaEventTypeSchema = z.enum([
  "PRE_DEPLOYMENT_TEST_FAILURE",
  "EXCESSIVE_AGENCY_ATTEMPT",
  "DESTRUCTIVE_COMMAND_BLOCKED",
  "PROMPT_INJECTION_DETECTED",
  "UNAUTHORIZED_APPROVAL_ATTEMPT",
]);

export const SeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const SafaIncidentMetadataSchema = z.object({
  modelVersion: z.string(),
  latencyMs: z.number(),
  tokenCount: z.number(),
  rawInput: z.string(),
  blockedCommand: z.string(),
}).catchall(z.any());

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  role: RoleSchema.default("STANDARD_USER"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PlaybookSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string(),
  generatedPlan: z.string(),
  sanitizedPlan: z.string(),
  requiresApproval: z.boolean().default(true),
  approvedById: z.string().nullable(),
  status: PlaybookStatusSchema.default("PENDING_REVIEW"),
  createdAt: z.date(),
  executedAt: z.date().nullable(),
});

export const SafaAuditLogSchema = z.object({
  id: z.string().uuid(),
  eventType: SafaEventTypeSchema,
  severity: SeveritySchema,
  description: z.string(),
  metadata: SafaIncidentMetadataSchema,
  scanId: z.string().nullable(),
  userId: z.string().nullable(),
  createdAt: z.date(),
});

export type Role = z.infer<typeof RoleSchema>;
export type PlaybookStatus = z.infer<typeof PlaybookStatusSchema>;
export type SafaEventType = z.infer<typeof SafaEventTypeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type SafaIncidentMetadata = z.infer<typeof SafaIncidentMetadataSchema>;
export type User = z.infer<typeof UserSchema>;
export type Playbook = z.infer<typeof PlaybookSchema>;
export type SafaAuditLog = z.infer<typeof SafaAuditLogSchema>;
