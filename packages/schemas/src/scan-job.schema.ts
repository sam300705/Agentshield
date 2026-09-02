import { z } from "zod";

const boundedString = (max: number) => z.string().trim().min(1).max(max);

export const scanProviderSchema = z.enum(["LOCAL", "GITHUB"]);
export const scanTriggerSchema = z.enum(["MANUAL", "PUSH", "PULL_REQUEST", "INSTALLATION"]);

export const scanOptionsSchema = z
  .object({
    maxFiles: z.number().int().positive().max(100_000).default(10_000),
    maxBytes: z.number().int().positive().max(1_000_000_000).default(100_000_000),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(15 * 60_000)
      .default(120_000),
    ignorePaths: z.array(boundedString(256)).max(64).default([]),
    includeOsv: z.boolean().default(false),
  })
  .strict();

export const createRepositoryScanSchema = z
  .object({
    repositoryId: boundedString(128),
    ref: boundedString(256),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/i)
      .optional(),
    policyBundleVersion: boundedString(128),
    options: scanOptionsSchema.default({}),
  })
  .strict();

export const scanJobPayloadSchema = z
  .object({
    organizationId: boundedString(128),
    integrationId: boundedString(128).optional(),
    repositoryId: boundedString(128),
    provider: scanProviderSchema,
    repositoryName: boundedString(256),
    repositoryUrl: z.string().url().max(2_048).optional(),
    ref: boundedString(256),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/i)
      .optional(),
    policyBundleVersion: boundedString(128),
    trigger: scanTriggerSchema,
    requester: boundedString(256),
    correlationId: boundedString(128),
    options: scanOptionsSchema.default({}),
  })
  .strict();

export const scanJobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);

export type ScanProvider = z.infer<typeof scanProviderSchema>;
export type ScanTrigger = z.infer<typeof scanTriggerSchema>;
export type ScanOptions = z.infer<typeof scanOptionsSchema>;
export type CreateRepositoryScan = z.infer<typeof createRepositoryScanSchema>;
export type ScanJobPayload = z.infer<typeof scanJobPayloadSchema>;
export type ScanJobStatus = z.infer<typeof scanJobStatusSchema>;
