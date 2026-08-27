import { z } from "zod";

const correlationIdSchema = z.string().trim().min(1).max(128);

export const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

export const paginationMetaSchema = z
  .object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const apiErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(512),
    correlationId: correlationIdSchema,
    issues: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(128),
            message: z.string().trim().min(1).max(512),
            path: z.array(z.union([z.string(), z.number()])).max(32),
          })
          .passthrough(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export const apiErrorEnvelopeSchema = z
  .object({
    error: apiErrorSchema,
  })
  .strict();

export const paginatedResponseSchema = z
  .object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    data: z.array(z.unknown()),
  })
  .strict();

export const correlationResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
  })
  .passthrough();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type PaginatedResponse = z.infer<typeof paginatedResponseSchema>;
export type CorrelationResponse = z.infer<typeof correlationResponseSchema>;
