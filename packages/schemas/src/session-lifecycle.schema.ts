import { z } from "zod";

export const sessionIdentifierSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const createAgentSessionSchema = z
  .object({
    repositoryId: sessionIdentifierSchema,
    source: z.string().trim().min(1).max(128),
    taskSummary: z.string().trim().min(1).max(1000),
    idempotencyKey: sessionIdentifierSchema,
  })
  .strict();
export const sessionQuerySchema = z.object({}).strict();
export const closeAgentSessionSchema = z.object({}).strict();
export const agentSessionParamsSchema = z.object({ sessionId: sessionIdentifierSchema }).strict();
export const agentSessionResponseSchema = z
  .object({
    id: sessionIdentifierSchema,
    organizationId: z.string(),
    repositoryId: z.string(),
    actor: z.string(),
    source: z.string(),
    taskSummary: z.string(),
    status: z.enum(["ACTIVE", "COMPLETED", "BLOCKED", "FAILED", "CANCELLED"]),
    correlationId: z.string(),
    startedAt: z.coerce.date(),
    completedAt: z.coerce.date().nullable(),
  })
  .strict();
export type CreateAgentSession = z.infer<typeof createAgentSessionSchema>;
